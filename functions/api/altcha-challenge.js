// functions/api/altcha-challenge.js
//
// GET /api/altcha-challenge — issues a fresh ALTCHA proof-of-work
// challenge for the widget to solve before submitting the contribute
// form (Task 14). Must never be cached: each challenge is single-use
// and HMAC-signed with a server secret.
import { issueChallenge } from '../_shared/altcha.js';

export async function onRequestGet({ env }) {
  const challenge = await issueChallenge(env);
  return Response.json(challenge, { headers: { 'cache-control': 'no-store' } });
}
