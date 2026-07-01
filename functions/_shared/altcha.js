// functions/_shared/altcha.js
//
// Thin wrapper around `altcha-lib` so every call into that package is
// confined to this one file — if a future major version changes the
// `createChallenge`/`verifySolution` signatures, only this file needs
// to change.
//
// Installed version: altcha-lib@1.4.1. That version's API is the
// "single hmacKey" shape (NOT the newer `hmacSignatureSecret` /
// `hmacKeySignatureSecret` / `deriveKey` options object some later
// versions use):
//
//   createChallenge(options: { hmacKey, algorithm?, maxnumber?, expires?: Date, ... }): Promise<Challenge>
//   verifySolution(payload: string | Payload, hmacKey: string, checkExpires?: boolean = true): Promise<boolean>
//
// Notably `verifySolution` resolves to a plain boolean, not an object
// with a `.verified` field.
//
// `expires` on `createChallenge` is embedded (HMAC-signed) into the
// `salt` string; `verifySolution` reads it back out via its internal
// `extractParams` and, when `checkExpires` is true, rejects payloads
// solved against an expired challenge. Without an `expires` on the
// challenge, that check is a no-op and a solved payload verifies
// forever — see `issueChallenge`/`verifyAltcha` below.
//
// We only need one HMAC key for this shape, so we use
// `env.ALTCHA_HMAC_SECRET` as that key. `env.ALTCHA_HMAC_KEY_SECRET` is
// reserved/unused for now — it exists for a possible future upgrade to
// an altcha-lib version that derives a per-challenge key from a second
// secret (the `hmacSignatureSecret`/`hmacKeySignatureSecret` shape).
import { createChallenge, verifySolution } from 'altcha-lib';

const ALGORITHM = 'SHA-256'; // no-WASM default; keeps CSP without wasm-unsafe-eval
const MAX_NUMBER = 100000;
const CHALLENGE_TTL_MS = 10 * 60 * 1000; // 10 minutes: enough for a human, short enough to blunt replay

/**
 * Issues a new ALTCHA challenge, HMAC-signed with the env secret.
 *
 * The challenge carries an `expires` param (embedded in `salt` by
 * altcha-lib, HMAC-signed along with everything else) so a solved
 * payload cannot be replayed indefinitely — see `verifyAltcha`, which
 * enforces it via `checkExpires: true`.
 *
 * @param {{ALTCHA_HMAC_SECRET: string}} env
 * @returns {Promise<import('altcha-lib/dist/types.js').Challenge>}
 */
export async function issueChallenge(env) {
  return createChallenge({
    hmacKey: env.ALTCHA_HMAC_SECRET,
    algorithm: ALGORITHM,
    maxnumber: MAX_NUMBER,
    expires: new Date(Date.now() + CHALLENGE_TTL_MS),
  });
}

/**
 * Verifies the base64 `altcha` field submitted by the widget.
 * Never throws — malformed/tampered/garbage input resolves to `false`.
 *
 * Passes `checkExpires: true` explicitly (it's the altcha-lib default,
 * but we pin it here so this guarantee can't silently regress if a
 * future altcha-lib version changes that default) so a payload solved
 * against a challenge whose `expires` has passed is rejected, closing
 * the indefinite-replay window.
 *
 * @param {string} payloadB64 base64-encoded JSON payload from the widget
 * @param {{ALTCHA_HMAC_SECRET: string}} env
 * @returns {Promise<boolean>} true only when the solution verifies and has not expired
 */
export async function verifyAltcha(payloadB64, env) {
  if (typeof payloadB64 !== 'string' || !payloadB64) return false;
  try {
    return await verifySolution(payloadB64, env.ALTCHA_HMAC_SECRET, true);
  } catch {
    return false;
  }
}
