// functions/api/altcha-challenge.js
//
// GET /api/altcha-challenge — issues a fresh ALTCHA proof-of-work
// challenge for the widget to solve before submitting the contribute
// form (Task 14). Must never be cached: the challenge is HMAC-signed
// with a server secret and time-limited (expires ~10 minutes after
// issuance — see `issueChallenge` in `../_shared/altcha.js`). It is
// NOT nonce-tracked/single-use — a solved payload can be replayed
// until it expires — so this alone does not stop a bot from reusing
// one solved challenge across multiple submissions within that
// window; true single-use would require server-side nonce storage
// (e.g. KV/D1) to record spent challenges, which is out of scope here.
import { issueChallenge } from '../_shared/altcha.js';

export async function onRequestGet({ env }) {
  const challenge = await issueChallenge(env);
  return Response.json(challenge, { headers: { 'cache-control': 'no-store' } });
}
