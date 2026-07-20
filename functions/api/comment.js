// functions/api/comment.js
//
// POST /api/comment — public open-review comment (pipeline stage 2) on a
// pending submission. Same fail-closed gate order as /api/contribute, and
// for the same reason (ALTCHA last so a doomed request never spends the
// client's proof-of-work):
//
//   1. Honeypot (`website` filled)                    -> 400, generic
//   2. Required-field validation + length caps        -> 400
//   3. Target submission must exist and be pending    -> 400 invalid
//   4. Per-IP rate limit (10 / hour, own bucket)      -> 429
//   5. ALTCHA proof-of-work solution                  -> 400
//   6. INSERT into `comments`                         -> 200 {ok:true,id}
//
// PRIVACY: identical stance to contribute — the raw IP only ever feeds
// hashIp in-memory; the comments row stores no IP-derived value. The
// rate-limit bucket key is 'c:'+ipHash so comment volume and submission
// volume are limited independently (a commenter doesn't burn their
// submission budget, and vice versa).
import { verifyAltcha } from '../_shared/altcha.js';
import { recordAbuseEvent } from '../_shared/abuse.js';
import { hashIp, isHoneypotTripped, checkRateLimit } from '../_shared/security.js';

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 10;

const MAX_AUTHOR = 120;
const MAX_BODY = 2000;
const MAX_SUBMISSION_ID = 64;

const json = (obj, status) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

/**
 * Testable core. Pure function of (request, env, now) like handleContribute.
 * @param {Request} request
 * @param {{DB: unknown, ALTCHA_HMAC_SECRET: string, IP_SALT: string}} env
 * @param {number} now
 * @returns {Promise<Response>}
 */
export async function handleComment(request, env, now) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'bad-json' }, 400);
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return json({ ok: false, error: 'invalid' }, 400);
  }

  // 1. Honeypot — same generic 400 as contribute, no tell.
  if (isHoneypotTripped(data.website)) {
    await recordAbuseEvent(env.DB, 'honeypot', now);
    return json({ ok: false }, 400);
  }

  // 2. Validation + caps (fail-closed, before any D1 access).
  const submissionId = typeof data.submission_id === 'string' ? data.submission_id.trim() : '';
  const body = typeof data.body === 'string' ? data.body.trim() : '';
  const author = typeof data.author === 'string' ? data.author.trim() : '';
  if (!submissionId || !body) return json({ ok: false, error: 'invalid' }, 400);
  if (submissionId.length > MAX_SUBMISSION_ID || body.length > MAX_BODY || author.length > MAX_AUTHOR) {
    return json({ ok: false, error: 'too-long' }, 400);
  }

  try {
    // 3. The target must exist and still be pending — comments are an
    // open-review artifact, not a general message board; moderated
    // submissions no longer accept them.
    const target = await env.DB.prepare('SELECT status FROM submissions WHERE id = ?').bind(submissionId).first();
    if (!target || target.status !== 'pending') return json({ ok: false, error: 'invalid' }, 400);

    // 4. Rate limit, own bucket (see header note).
    const ip = request.headers.get('cf-connecting-ip') || '0.0.0.0';
    const ipHash = await hashIp(ip, env.IP_SALT);
    if (!(await checkRateLimit(env.DB, `c:${ipHash}`, now, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX))) {
      await recordAbuseEvent(env.DB, 'rate', now);
      return json({ ok: false, error: 'rate' }, 429);
    }

    // 5. ALTCHA — deliberately last (spends the solve).
    if (!(await verifyAltcha(data.altcha, env, env.DB, now))) {
      await recordAbuseEvent(env.DB, 'altcha', now);
      return json({ ok: false, error: 'altcha' }, 400);
    }

    // 6. Insert. No IP-derived value on the row.
    const id = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO comments (id, submission_id, created_at, author, body, source_flag, deleted) VALUES (?,?,?,?,?,?,0)',
    )
      .bind(id, submissionId, now, author || null, body, data.source_flag ? 1 : 0)
      .run();

    return json({ ok: true, id }, 200);
  } catch {
    return json({ ok: false, error: 'unavailable' }, 503);
  }
}

export async function onRequestPost({ request, env }) {
  return handleComment(request, env, Date.now());
}
