// functions/api/contribute.js
//
// POST /api/contribute — verifies a wiki contribution submission and
// writes it to D1 as a `pending` row for moderation. Checks run in this
// fixed order, each a hard gate (fail-closed) before the next runs:
//
//   1. Honeypot (`website` field filled)      -> 400, generic response
//   2. ALTCHA proof-of-work solution           -> 400
//   3. Required-field validation                -> 400
//   4. Per-IP rate limit (5 / hour)             -> 429
//   5. INSERT into `submissions` (status=pending) -> 200 {ok:true,id}
//
// PRIVACY: the raw client IP is only ever used in-memory to derive
// `ipHash` (salted SHA-256, see `_shared/security.js`); it is never
// logged or persisted. Only `ip_hash` is stored, matching the Task 11
// D1 schema (migrations/0001_submissions.sql), which has no raw-ip
// column.
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

const json = (obj, status) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

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

  // 2. ALTCHA proof-of-work solution must verify (and not be expired).
  if (!(await verifyAltcha(data.altcha, env))) return json({ ok: false, error: 'altcha' }, 400);

  // 3. Required-field validation. Non-string fields become '' (empty)
  // rather than throwing, so they cleanly fail the non-empty check below.
  const title = typeof data.title === 'string' ? data.title.trim() : '';
  const body = typeof data.body === 'string' ? data.body.trim() : '';
  const category = typeof data.category === 'string' ? data.category.trim() : '';
  if (!title || !body || !category || !LEVELS.has(data.level)) return json({ ok: false, error: 'invalid' }, 400);

  // 4. Per-IP rate limit. Only the salted hash of the IP is ever
  // computed/stored — the raw IP is used solely as input to hashIp.
  const ip = request.headers.get('cf-connecting-ip') || '0.0.0.0';
  const ipHash = await hashIp(ip, env.IP_SALT);
  if (!(await checkRateLimit(env.DB, ipHash, now, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX))) {
    return json({ ok: false, error: 'rate' }, 429);
  }

  // 5. Insert as a pending submission for moderation.
  const id = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO submissions (id, created_at, category, level, title, body, sources, contributor, anonymous, status, ip_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  )
    .bind(
      id,
      now,
      category,
      data.level,
      title,
      body,
      JSON.stringify(Array.isArray(data.sources) ? data.sources : []),
      data.anonymous ? null : data.contributor || null,
      data.anonymous ? 1 : 0,
      'pending',
      ipHash,
    )
    .run();

  return json({ ok: true, id }, 200);
}

export async function onRequestPost({ request, env }) {
  return handleContribute(request, env, Date.now());
}
