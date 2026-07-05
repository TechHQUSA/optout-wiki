// functions/api/contribute.js
//
// POST /api/contribute — verifies a wiki contribution submission and
// writes it to D1 as a `pending` row for moderation. Checks run in this
// fixed order, each a hard gate (fail-closed) before the next runs:
//
//   1. Honeypot (`website` field filled)        -> 400, generic response
//   2. Required-field validation + length caps  -> 400
//   2c. Source URLs must be http(s)              -> 400 (blocks javascript:/data:)
//   3. Per-IP rate limit (5 / hour)              -> 429
//   4. ALTCHA proof-of-work solution             -> 400
//   5. INSERT into `submissions` (status=pending) -> 200 {ok:true,id}
//
// ALTCHA verification runs LAST, deliberately after every cheap
// (no-DB) check and the rate limit: verifying a solution also claims
// its signature as spent (single-use — see _shared/altcha.js), so a
// request that was always going to be rejected for an unrelated
// reason (an oversized field, an exhausted rate-limit window) must
// never burn the client's proof-of-work for nothing. Only a request
// that would otherwise succeed reaches the ALTCHA check.
//
// PRIVACY: the raw client IP is only ever used in-memory to derive
// `ipHash` (salted SHA-256, see `_shared/security.js`); it is never
// logged or persisted. The hash is used ONLY for rate-limiting (the
// `rate_limits` table) — the `submissions` row stores no IP-derived
// value at all, so an "anonymous" submission can't be linked to an
// origin or clustered with a contributor's other posts. See the schema
// note in migrations/0001_submissions.sql.
//
// The honeypot rejection (step 1) intentionally returns the same
// generic `{ok:false}` 400 shape as other failures — it must not leak
// to a bot that it was caught by the honeypot specifically, or the bot
// could adapt.
import { verifyAltcha } from '../_shared/altcha.js';
import { hashIp, isHoneypotTripped, checkRateLimit } from '../_shared/security.js';

const LEVELS = new Set(['LOW', 'MED', 'HIGH']);
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 5;

// Per-field length caps (fail-closed). Without these a solver who clears the
// ALTCHA/rate-limit gates could store multi-MB `title`/`body`/`sources`/etc.
// rows, 5x/hour/IP. Checked on the trimmed values that actually get persisted,
// and enforced BEFORE the INSERT so oversized payloads never reach D1.
const MAX_TITLE = 200;
const MAX_CATEGORY = 64;
const MAX_BODY = 20000;
const MAX_CONTRIBUTOR = 120;
const MAX_SOURCES = 20; // number of source URLs
const MAX_SOURCE_URL = 500; // chars per source URL

const json = (obj, status) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

// A source must parse as a URL AND use an http(s) scheme. Anything else
// (javascript:, data:, mailto:, a non-URL string) is rejected: these values
// are eventually rendered as `<a href>` on a published guide, so a
// `javascript:`/`data:` source is a stored-XSS / malware-link vector. Enforced
// server-side here, not just in the content schema, so a bad URL never reaches
// the moderation queue in the first place.
function isHttpUrl(value) {
  let u;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  return u.protocol === 'http:' || u.protocol === 'https:';
}

/**
 * Testable core of the contribute endpoint. Pure function of
 * (request, env, now) — no reliance on ambient time/globals — so tests
 * can pass a mock D1 binding and a fixed `now`.
 *
 * @param {Request} request
 * @param {{DB: unknown, ALTCHA_HMAC_SECRET: string, IP_SALT: string}} env
 * @param {number} now current time in ms (e.g. Date.now())
 * @returns {Promise<Response>}
 */
export async function handleContribute(request, env, now) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'bad-json' }, 400);
  }

  // Reject anything whose top level isn't a plain object (null, arrays,
  // strings, numbers, booleans are all valid JSON but not a valid payload
  // shape) before any field access below.
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return json({ ok: false, error: 'invalid' }, 400);
  }

  // 1. Honeypot: bots that fill the hidden field get a generic 400 —
  // no indication it was the honeypot specifically that tripped.
  if (isHoneypotTripped(data.website)) return json({ ok: false }, 400);

  // 2. Required-field validation. Non-string fields become '' (empty)
  // rather than throwing, so they cleanly fail the non-empty check below.
  const title = typeof data.title === 'string' ? data.title.trim() : '';
  const body = typeof data.body === 'string' ? data.body.trim() : '';
  const category = typeof data.category === 'string' ? data.category.trim() : '';
  if (!title || !body || !category || !LEVELS.has(data.level)) return json({ ok: false, error: 'invalid' }, 400);

  // 2b. Length caps (fail-closed). Reject oversized fields with a 400 before
  // the INSERT so a solver cannot persist multi-MB rows. `sources` is bounded
  // both in count and per-URL length; non-string entries are rejected too.
  const contributor = typeof data.contributor === 'string' ? data.contributor : '';
  const sources = Array.isArray(data.sources) ? data.sources : [];
  if (
    title.length > MAX_TITLE ||
    category.length > MAX_CATEGORY ||
    body.length > MAX_BODY ||
    contributor.length > MAX_CONTRIBUTOR ||
    sources.length > MAX_SOURCES ||
    sources.some((s) => typeof s !== 'string' || s.length > MAX_SOURCE_URL)
  ) {
    return json({ ok: false, error: 'too-long' }, 400);
  }

  // 2c. Source URL scheme (fail-closed). Every source must be an http(s) URL;
  // reject javascript:/data:/mailto:/garbage before it can be queued and later
  // rendered as an <a href> on a published guide. Runs before the ALTCHA gate
  // so a rejected payload never spends the client's proof-of-work.
  if (!sources.every(isHttpUrl)) {
    return json({ ok: false, error: 'bad-source' }, 400);
  }

  // 3-5. Rate limit, ALTCHA verification, and the submissions INSERT all
  // touch D1. Wrapped in one try/catch so a transient D1 failure returns the
  // same structured {ok:false,...} JSON shape as every other rejection in
  // this file, instead of an uncaught throw (Cloudflare's runtime would
  // still turn that into a generic platform 500, but with no consistent
  // error body).
  try {
    // 3. Per-IP rate limit. Only the salted hash of the IP is ever
    // computed/stored — the raw IP is used solely as input to hashIp.
    const ip = request.headers.get('cf-connecting-ip') || '0.0.0.0';
    const ipHash = await hashIp(ip, env.IP_SALT);
    if (!(await checkRateLimit(env.DB, ipHash, now, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX))) {
      return json({ ok: false, error: 'rate' }, 429);
    }

    // 4. ALTCHA proof-of-work solution must verify, not be expired, and not
    // have been used before (verifyAltcha claims the signature as spent).
    // Deliberately last of the gates — see the file-header note on why.
    if (!(await verifyAltcha(data.altcha, env, env.DB, now))) return json({ ok: false, error: 'altcha' }, 400);

    // 5. Insert as a pending submission for moderation. The submission row
    // deliberately stores NO ip_hash — the salted IP hash is used only above
    // for rate-limiting (rate_limits table) and is never persisted next to
    // the content, so "anonymous" submissions can't be clustered by origin.
    // See the schema note in migrations/0001_submissions.sql.
    const id = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO submissions (id, created_at, category, level, title, body, sources, contributor, anonymous, status) VALUES (?,?,?,?,?,?,?,?,?,?)',
    )
      .bind(
        id,
        now,
        category,
        data.level,
        title,
        body,
        JSON.stringify(sources),
        data.anonymous ? null : contributor || null,
        data.anonymous ? 1 : 0,
        'pending',
      )
      .run();

    return json({ ok: true, id }, 200);
  } catch {
    return json({ ok: false, error: 'unavailable' }, 503);
  }
}

export async function onRequestPost({ request, env }) {
  return handleContribute(request, env, Date.now());
}
