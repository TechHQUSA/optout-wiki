// tests/altcha.test.ts
//
// Round-trips a real ALTCHA challenge through the installed `altcha-lib`
// (v1.4.1, single-hmacKey API: createChallenge/verifySolution(payload, hmacKey)),
// proving `issueChallenge`/`verifyAltcha` actually delegate to it rather than
// stubbing verification.
import { expect, test } from 'vitest';
import { createChallenge, solveChallenge } from 'altcha-lib';
import { issueChallenge, verifyAltcha } from '../functions/_shared/altcha.js';

const env = { ALTCHA_HMAC_SECRET: 'test-secret', ALTCHA_HMAC_KEY_SECRET: 'test-key-secret' };

test('issued challenge is solvable and verifies', async () => {
  const challenge = await issueChallenge(env);
  expect(challenge.algorithm).toBe('SHA-256');
  expect(challenge.challenge).toBeTypeOf('string');
  expect(challenge.salt).toBeTypeOf('string');
  expect(challenge.signature).toBeTypeOf('string');

  const solution = await solveChallenge(challenge.challenge, challenge.salt, challenge.algorithm, challenge.maxnumber).promise;
  if (!solution) throw new Error('challenge unsolved');

  const payload = btoa(
    JSON.stringify({
      algorithm: challenge.algorithm,
      challenge: challenge.challenge,
      number: solution.number,
      salt: challenge.salt,
      signature: challenge.signature,
    }),
  );

  expect(await verifyAltcha(payload, env)).toBe(true);
});

test('tampered signature fails verification', async () => {
  const challenge = await issueChallenge(env);
  const solution = await solveChallenge(challenge.challenge, challenge.salt, challenge.algorithm, challenge.maxnumber).promise;
  if (!solution) throw new Error('challenge unsolved');

  const tamperedPayload = btoa(
    JSON.stringify({
      algorithm: challenge.algorithm,
      challenge: challenge.challenge,
      number: solution.number,
      salt: challenge.salt,
      signature: 'deadbeef', // wrong signature
    }),
  );

  expect(await verifyAltcha(tamperedPayload, env)).toBe(false);
});

test('wrong solution number fails verification', async () => {
  const challenge = await issueChallenge(env);

  const wrongPayload = btoa(
    JSON.stringify({
      algorithm: challenge.algorithm,
      challenge: challenge.challenge,
      number: 999999999, // almost certainly not the real solution
      salt: challenge.salt,
      signature: challenge.signature,
    }),
  );

  expect(await verifyAltcha(wrongPayload, env)).toBe(false);
});

test('expired challenge fails verification even when correctly solved', async () => {
  // Build a challenge the same way issueChallenge does, but with `expires`
  // already in the past — the realistic shape of a replayed-too-late payload.
  const challenge = await createChallenge({
    hmacKey: env.ALTCHA_HMAC_SECRET,
    algorithm: 'SHA-256',
    maxnumber: 100000,
    expires: new Date(Date.now() - 60_000),
  });

  const solution = await solveChallenge(challenge.challenge, challenge.salt, challenge.algorithm, challenge.maxnumber).promise;
  if (!solution) throw new Error('challenge unsolved');

  const payload = btoa(
    JSON.stringify({
      algorithm: challenge.algorithm,
      challenge: challenge.challenge,
      number: solution.number,
      salt: challenge.salt,
      signature: challenge.signature,
    }),
  );

  // Sanity check: this is a correctly-solved, correctly-signed payload —
  // the only thing wrong with it is that it's expired. Without the
  // `checkExpires: true` enforcement in verifyAltcha this would verify `true`.
  expect(await verifyAltcha(payload, env)).toBe(false);
});

test('garbage payload fails verification without throwing', async () => {
  expect(await verifyAltcha('not-valid-base64-json!!!', env)).toBe(false);
  expect(await verifyAltcha(btoa('not json'), env)).toBe(false);
  expect(
    await verifyAltcha(btoa(JSON.stringify({ challenge: 'x', number: 1, salt: 'y', signature: 'z', algorithm: 'SHA-256' })), env),
  ).toBe(false);
});
