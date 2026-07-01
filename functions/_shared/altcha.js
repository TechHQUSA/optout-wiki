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
//   createChallenge(options: { hmacKey, algorithm?, maxnumber?, ... }): Promise<Challenge>
//   verifySolution(payload: string | Payload, hmacKey: string, checkExpires?: boolean): Promise<boolean>
//
// Notably `verifySolution` resolves to a plain boolean, not an object
// with a `.verified` field.
//
// We only need one HMAC key for this shape, so we use
// `env.ALTCHA_HMAC_SECRET` as that key. `env.ALTCHA_HMAC_KEY_SECRET` is
// reserved/unused for now — it exists for a possible future upgrade to
// an altcha-lib version that derives a per-challenge key from a second
// secret (the `hmacSignatureSecret`/`hmacKeySignatureSecret` shape).
import { createChallenge, verifySolution } from 'altcha-lib';

const ALGORITHM = 'SHA-256'; // no-WASM default; keeps CSP without wasm-unsafe-eval
const MAX_NUMBER = 100000;

/**
 * Issues a new ALTCHA challenge, HMAC-signed with the env secret.
 *
 * @param {{ALTCHA_HMAC_SECRET: string}} env
 * @returns {Promise<import('altcha-lib/dist/types.js').Challenge>}
 */
export async function issueChallenge(env) {
  return createChallenge({
    hmacKey: env.ALTCHA_HMAC_SECRET,
    algorithm: ALGORITHM,
    maxnumber: MAX_NUMBER,
  });
}

/**
 * Verifies the base64 `altcha` field submitted by the widget.
 * Never throws — malformed/tampered/garbage input resolves to `false`.
 *
 * @param {string} payloadB64 base64-encoded JSON payload from the widget
 * @param {{ALTCHA_HMAC_SECRET: string}} env
 * @returns {Promise<boolean>} true only when the solution verifies
 */
export async function verifyAltcha(payloadB64, env) {
  if (typeof payloadB64 !== 'string' || !payloadB64) return false;
  try {
    return await verifySolution(payloadB64, env.ALTCHA_HMAC_SECRET);
  } catch {
    return false;
  }
}
