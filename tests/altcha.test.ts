// tests/altcha.test.ts
//
// Round-trips a real ALTCHA challenge through the installed `altcha-lib`
// (v1.4.1, single-hmacKey API: createChallenge/verifySolution(payload, hmacKey)),
// proving `issueChallenge`/`verifyAltcha` actually delegate to it rather than
// stubbing verification.
import { expect, test } from 'vitest';
import { createChallenge, solveChallenge } from 'altcha-lib';
import { issueChallenge, verifyAltcha, claimAltchaSignature } from '../functions/_shared/altcha.js';

const env = { ALTCHA_HMAC_SECRET: 'test-secret', ALTCHA_HMAC_KEY_SECRET: 'test-key-secret' };

// D1-shaped fake for spent_altcha_signatures: INSERT OR IGNORE reports
// `meta.changes` (1 = newly claimed, 0 = already spent), matching what
// claimAltchaSignature reads to detect a replay.
function makeAltchaDb() {
  const store = new Map<string, number>();
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async run() {
              if (sql.startsWith('DELETE')) {
                const cutoff = args[0] as number;
                for (const [sig, spentAt] of store) if (spentAt < cutoff) store.delete(sig);
                return { meta: { changes: 0 } };
              }
              const [signature, spentAt] = args as [string, number];
              if (store.has(signature)) return { meta: { changes: 0 } };
              store.set(signature, spentAt);
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
  return { db, store };
}

test('issued challenge is solvable and verifies', async () => {
  const { db } = makeAltchaDb();
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

  expect(await verifyAltcha(payload, env, db, 1000)).toBe(true);
});

test('a solved payload can be used only once (replay is rejected)', async () => {
  const { db, store } = makeAltchaDb();
  const challenge = await issueChallenge(env);
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

  // First submission: genuinely new — allowed.
  expect(await verifyAltcha(payload, env, db, 1000)).toBe(true);
  expect(store.has(challenge.signature)).toBe(true);
  // Second submission of the SAME payload, still well inside its 10-minute
  // TTL — the cryptographic check alone would pass again, but the
  // signature is already spent.
  expect(await verifyAltcha(payload, env, db, 2000)).toBe(false);
});

test('tampered signature fails verification and never claims a nonce', async () => {
  const { db, store } = makeAltchaDb();
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

  expect(await verifyAltcha(tamperedPayload, env, db, 1000)).toBe(false);
  // Failed crypto verification must short-circuit before the nonce check —
  // otherwise a flood of tampered payloads could pre-claim (and so block)
  // signatures the attacker doesn't even hold.
  expect(store.size).toBe(0);
});

test('wrong solution number fails verification', async () => {
  const { db } = makeAltchaDb();
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

  expect(await verifyAltcha(wrongPayload, env, db, 1000)).toBe(false);
});

test('expired challenge fails verification even when correctly solved', async () => {
  const { db } = makeAltchaDb();
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
  expect(await verifyAltcha(payload, env, db, 1000)).toBe(false);
});

test('garbage payload fails verification without throwing, and never touches the nonce store', async () => {
  const { db, store } = makeAltchaDb();
  expect(await verifyAltcha('not-valid-base64-json!!!', env, db, 1000)).toBe(false);
  expect(await verifyAltcha(btoa('not json'), env, db, 1000)).toBe(false);
  expect(
    await verifyAltcha(
      btoa(JSON.stringify({ challenge: 'x', number: 1, salt: 'y', signature: 'z', algorithm: 'SHA-256' })),
      env,
      db,
      1000,
    ),
  ).toBe(false);
  expect(store.size).toBe(0);
});

test('claimAltchaSignature: first claim succeeds, replay is rejected, sweep drops stale rows', async () => {
  const { db, store } = makeAltchaDb();
  expect(await claimAltchaSignature(db, 'sig-a', 1000)).toBe(true);
  expect(await claimAltchaSignature(db, 'sig-a', 2000)).toBe(false); // same signature again -> replay
  expect(await claimAltchaSignature(db, 'sig-b', 2000)).toBe(true); // different signature -> fine

  // 20 minutes later: sig-a/sig-b (spent at 1000/2000) are well past the
  // 15-minute retention window, so the opportunistic sweep inside the next
  // claim call drops them — but that's irrelevant to correctness (their own
  // challenges already expired at 10 minutes), only to table size.
  await claimAltchaSignature(db, 'sig-c', 1000 + 20 * 60 * 1000);
  expect(store.has('sig-a')).toBe(false);
  expect(store.has('sig-b')).toBe(false);
  expect(store.has('sig-c')).toBe(true);
});
