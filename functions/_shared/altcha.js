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
//
// `verifyAltcha` additionally enforces single-use: `expires` alone only
// bounds a payload's *replay window* (10 minutes), it doesn't stop it
// being replayed repeatedly inside that window. See
// `claimAltchaSignature`/`spent_altcha_signatures` (migrations/0002) below.
import { createChallenge, verifySolution } from 'altcha-lib';

const ALGORITHM = 'SHA-256'; // no-WASM default; keeps CSP without wasm-unsafe-eval
const MAX_NUMBER = 100000;
const CHALLENGE_TTL_MS = 10 * 60 * 1000; // 10 minutes: enough for a human, short enough to blunt replay

// A correctly-solved payload verifies as long as its challenge hasn't
// expired — nothing stopped it being replayed any number of times inside
// that 10-minute window. `spent_altcha_signatures` (migrations/0002)
// tracks each payload's `signature` (HMAC-unique per issued challenge) so
// verifyAltcha can enforce single-use. Retention only needs to outlive the
// challenge TTL: once a payload's own `expires` has passed, verifySolution's
// checkExpires rejects it before the nonce check ever runs, so a spent-row
// older than that TTL can never be legitimately consulted again — the
// margin below is just slack for clock skew between requests.
const SIGNATURE_RETENTION_MS = CHALLENGE_TTL_MS + 5 * 60 * 1000;

/**
 * Claims a solved challenge's signature as spent. Returns `true` the first
 * time a given signature is claimed (i.e. genuinely allowed), `false` if
 * it was already spent (replay). Also opportunistically sweeps signatures
 * past `SIGNATURE_RETENTION_MS` so the table stays bounded.
 *
 * @param {{prepare: (sql: string) => {bind: (...args: unknown[]) => {run: () => Promise<{meta?: {changes?: number}}>}}}} db D1-like binding
 * @param {string} signature
 * @param {number} now current time in ms
 * @returns {Promise<boolean>}
 */
export async function claimAltchaSignature(db, signature, now) {
  await db.prepare('DELETE FROM spent_altcha_signatures WHERE spent_at < ?').bind(now - SIGNATURE_RETENTION_MS).run();
  const result = await db
    .prepare('INSERT OR IGNORE INTO spent_altcha_signatures (signature, spent_at) VALUES (?, ?)')
    .bind(signature, now)
    .run();
  return (result?.meta?.changes ?? 0) > 0;
}

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
 * Once the solution itself verifies, its `signature` is claimed via
 * `claimAltchaSignature` — a second submission reusing the same solved
 * payload (still within its TTL) fails here even though the cryptographic
 * check alone would pass, closing the single-use gap noted in
 * SIGNATURE_RETENTION_MS above. The nonce check only runs after crypto +
 * expiry both pass, so a garbage/tampered/expired payload never touches
 * `db` at all.
 *
 * @param {string} payloadB64 base64-encoded JSON payload from the widget
 * @param {{ALTCHA_HMAC_SECRET: string}} env
 * @param {Parameters<typeof claimAltchaSignature>[0]} db D1-like binding (spent_altcha_signatures)
 * @param {number} [now]
 * @returns {Promise<boolean>} true only when the solution verifies, has not expired, and has not been used before
 */
export async function verifyAltcha(payloadB64, env, db, now = Date.now()) {
  if (typeof payloadB64 !== 'string' || !payloadB64) return false;
  let decoded;
  try {
    decoded = JSON.parse(atob(payloadB64));
  } catch {
    return false;
  }
  if (typeof decoded?.signature !== 'string' || !decoded.signature) return false;

  let verified;
  try {
    verified = await verifySolution(payloadB64, env.ALTCHA_HMAC_SECRET, true);
  } catch {
    return false;
  }
  if (!verified) return false;

  return claimAltchaSignature(db, decoded.signature, now);
}
