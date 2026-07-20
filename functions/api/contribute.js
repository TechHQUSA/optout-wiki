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
import { recordAbuseEvent } from '../_shared/abuse.js';

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

// Software-submission caps (type='software'). Same fail-closed rationale.
const MAX_SW_NAME = 120;
const MAX_SW_URL = 500;
const MAX_SW_SUMMARY = 500;
const MAX_SW_JUSTIFICATION = 5000;
const MAX_SW_TAGS = 10; // number of tags
const MAX_SW_TAG = 40; // chars per tag

// Fixed category list for software submissions — mirrors the /contribute
// form's <select>. Fail-closed: an unknown category can't reach the queue
// (unlike guide categories, which are historically free-form).
const SOFTWARE_CATEGORIES = new Set([
  'Browser',
  'Search',
  'Email',
  'Messaging',
  'Network',
  'DNS',
  'Passwords',
  'OS',
  'Other',
]);

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
  if (isHoneypotTripped(data.website)) {
    await recordAbuseEvent(env.DB, 'honeypot', now);
    return json({ ok: false }, 400);
  }

  // 1b. Type discriminator: absent means 'guide' (legacy payloads), only
  // 'guide'/'software' are valid — anything else fails closed before any
  // further field access.
  const type =
    data.type === undefined || data.type === 'guide' ? 'guide' : data.type === 'software' ? 'software' : null;
  if (!type) return json({ ok: false, error: 'invalid' }, 400);

  // 2. Required-field validation (per type). Non-string fields become ''
  // (empty) rather than throwing, so they cleanly fail the non-empty check.
  // 2b. Length caps (fail-closed). Reject oversized fields with a 400 before
  // the INSERT so a solver cannot persist multi-MB rows. `sources` is bounded
  // both in count and per-URL length; non-string entries are rejected too.
  // 2c. URL scheme (fail-closed): every stored URL (guide sources, software
  // homepage + evidence sources) must be http(s) — they are eventually
  // rendered as <a href>, so javascript:/data: is a stored-XSS vector.
  // All of 2* runs before the ALTCHA gate so a rejected payload never spends
  // the client's proof-of-work.
  const contributor = typeof data.contributor === 'string' ? data.contributor : '';
  const sources = Array.isArray(data.sources) ? data.sources : [];
  if (
    contributor.length > MAX_CONTRIBUTOR ||
    sources.length > MAX_SOURCES ||
    sources.some((s) => typeof s !== 'string' || s.length > MAX_SOURCE_URL)
  ) {
    return json({ ok: false, error: 'too-long' }, 400);
  }

  // Per-type column values for the single INSERT below. Software reuses:
  // title=name, body=justification (moderator-only), sources=evidence URLs;
  // level is guides-only, url/tags/summary are software-only (NULL for guides).
  let fields;
  if (type === 'guide') {
    const title = typeof data.title === 'string' ? data.title.trim() : '';
    const body = typeof data.body === 'string' ? data.body.trim() : '';
    const category = typeof data.category === 'string' ? data.category.trim() : '';
    if (!title || !body || !category || !LEVELS.has(data.level)) return json({ ok: false, error: 'invalid' }, 400);
    if (title.length > MAX_TITLE || category.length > MAX_CATEGORY || body.length > MAX_BODY) {
      return json({ ok: false, error: 'too-long' }, 400);
    }
    fields = { title, category, level: data.level, body, url: null, tags: null, summary: null };
  } else {
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    const category = typeof data.category === 'string' ? data.category.trim() : '';
    const url = typeof data.url === 'string' ? data.url.trim() : '';
    const summary = typeof data.summary === 'string' ? data.summary.trim() : '';
    const justification = typeof data.justification === 'string' ? data.justification.trim() : '';
    const tags = Array.isArray(data.tags) ? data.tags : [];
    if (!name || !category || !SOFTWARE_CATEGORIES.has(category) || !url || !summary) {
      return json({ ok: false, error: 'invalid' }, 400);
    }
    if (
      name.length > MAX_SW_NAME ||
      category.length > MAX_CATEGORY ||
      url.length > MAX_SW_URL ||
      summary.length > MAX_SW_SUMMARY ||
      justification.length > MAX_SW_JUSTIFICATION ||
      tags.length > MAX_SW_TAGS ||
      tags.some((t) => typeof t !== 'string' || t.length > MAX_SW_TAG)
    ) {
      return json({ ok: false, error: 'too-long' }, 400);
    }
    if (!isHttpUrl(url)) return json({ ok: false, error: 'bad-source' }, 400);
    fields = {
      title: name,
      category,
      level: null,
      body: justification,
      url,
      // caps above ran on the raw entries; store them normalized (trimmed,
      // whitespace-only entries dropped)
      tags: JSON.stringify(tags.map((t) => t.trim()).filter(Boolean)),
      summary,
    };
  }

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
      await recordAbuseEvent(env.DB, 'rate', now);
      return json({ ok: false, error: 'rate' }, 429);
    }

    // 4. ALTCHA proof-of-work solution must verify, not be expired, and not
    // have been used before (verifyAltcha claims the signature as spent).
    // Deliberately last of the gates — see the file-header note on why.
    if (!(await verifyAltcha(data.altcha, env, env.DB, now))) {
      await recordAbuseEvent(env.DB, 'altcha', now);
      return json({ ok: false, error: 'altcha' }, 400);
    }

    // 5. Insert as a pending submission for moderation. The submission row
    // deliberately stores NO ip_hash — the salted IP hash is used only above
    // for rate-limiting (rate_limits table) and is never persisted next to
    // the content, so "anonymous" submissions can't be clustered by origin.
    // See the schema note in migrations/0001_submissions.sql.
    const id = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO submissions (id, created_at, type, category, level, title, body, sources, contributor, anonymous, status, url, tags, summary) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    )
      .bind(
        id,
        now,
        type,
        fields.category,
        fields.level,
        fields.title,
        fields.body,
        JSON.stringify(sources),
        data.anonymous ? null : contributor || null,
        data.anonymous ? 1 : 0,
        'pending',
        fields.url,
        fields.tags,
        fields.summary,
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
