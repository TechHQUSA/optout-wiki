// tests/contribute.test.ts
import { expect, test, vi, beforeEach } from 'vitest';
import { handleContribute } from '../functions/api/contribute.js';
import { verifyAltcha } from '../functions/_shared/altcha.js';

// A trackable mock (not a plain async fn) so tests can assert verifyAltcha
// was never called for requests rejected on cheaper grounds (honeypot,
// invalid/oversized fields, rate limit) — verifying a solution also spends
// it, so those paths must not reach it at all. See the check-order note
// atop functions/api/contribute.js.
vi.mock('../functions/_shared/altcha.js', () => ({ verifyAltcha: vi.fn(async (p: string) => p === 'good') }));

beforeEach(() => {
  vi.mocked(verifyAltcha).mockClear();
});

function makeDb() {
  const rows: unknown[] = [];
  return {
    rows,
    prepare(sql: string) {
      return {
        bind(...a: unknown[]) {
          return {
            async first() {
              return null;
            },
            async run() {
              if (sql.startsWith('INSERT INTO submissions')) rows.push(a);
            },
          };
        },
      };
    },
  };
}

// A db mock that also simulates the fixed-window rate limiter from
// functions/_shared/security.js, so we can drive checkRateLimit into its
// blocked (429) branch without reimplementing it here.
function makeRateLimitedDb(count: number) {
  const rows: unknown[] = [];
  const rateLimitRow = { window_start: 1000, count };
  return {
    rows,
    prepare(sql: string) {
      return {
        bind(...a: unknown[]) {
          return {
            async first() {
              if (sql.startsWith('SELECT window_start, count FROM rate_limits')) return rateLimitRow;
              return null;
            },
            async run() {
              if (sql.startsWith('INSERT INTO submissions')) rows.push(a);
            },
          };
        },
      };
    },
  };
}

function req(body: unknown) {
  return new Request('https://x/api/contribute', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '9.9.9.9' },
    body: JSON.stringify(body),
  });
}

const env = { DB: null, ALTCHA_HMAC_SECRET: 's', ALTCHA_HMAC_KEY_SECRET: 'k', IP_SALT: 'salt' };
const valid = { category: 'Cars', level: 'MED', title: 'T', body: 'B', sources: [], anonymous: true, altcha: 'good', website: '' };

test('happy path inserts a pending submission', async () => {
  const db = makeDb();
  const res = await handleContribute(req(valid), { ...env, DB: db }, 1000);
  expect(res.status).toBe(200);
  expect(db.rows.length).toBe(1);
  expect(verifyAltcha).toHaveBeenCalledTimes(1);
});

test('honeypot filled -> 400, no insert, ALTCHA never spent', async () => {
  const db = makeDb();
  const res = await handleContribute(req({ ...valid, website: 'bot' }), { ...env, DB: db }, 1000);
  expect(res.status).toBe(400);
  expect(db.rows.length).toBe(0);
  expect(verifyAltcha).not.toHaveBeenCalled();
});

test('bad altcha -> 400', async () => {
  const db = makeDb();
  const res = await handleContribute(req({ ...valid, altcha: 'bad' }), { ...env, DB: db }, 1000);
  expect(res.status).toBe(400);
  expect(db.rows.length).toBe(0);
  expect(verifyAltcha).toHaveBeenCalledTimes(1);
});

test('missing required field -> 400, no insert, ALTCHA never spent', async () => {
  const db = makeDb();
  const res = await handleContribute(req({ ...valid, title: '' }), { ...env, DB: db }, 1000);
  expect(res.status).toBe(400);
  expect(db.rows.length).toBe(0);
  expect(verifyAltcha).not.toHaveBeenCalled();
});

test('null JSON body -> 400, no throw, no insert', async () => {
  const db = makeDb();
  const request = new Request('https://x/api/contribute', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(null),
  });
  const res = await handleContribute(request, { ...env, DB: db }, 1000);
  expect(res.status).toBe(400);
  expect(db.rows.length).toBe(0);
});

test('non-string field (title: 123) -> 400, no insert, ALTCHA never spent', async () => {
  const db = makeDb();
  const res = await handleContribute(req({ ...valid, title: 123 }), { ...env, DB: db }, 1000);
  expect(res.status).toBe(400);
  expect(db.rows.length).toBe(0);
  expect(verifyAltcha).not.toHaveBeenCalled();
});

test('over-length title -> 400, no insert, ALTCHA never spent', async () => {
  const db = makeDb();
  const res = await handleContribute(req({ ...valid, title: 'x'.repeat(201) }), { ...env, DB: db }, 1000);
  expect(res.status).toBe(400);
  expect(db.rows.length).toBe(0);
  expect(verifyAltcha).not.toHaveBeenCalled();
});

test('over-length body -> 400, no insert, ALTCHA never spent', async () => {
  const db = makeDb();
  const res = await handleContribute(req({ ...valid, body: 'x'.repeat(20001) }), { ...env, DB: db }, 1000);
  expect(res.status).toBe(400);
  expect(db.rows.length).toBe(0);
  expect(verifyAltcha).not.toHaveBeenCalled();
});

test('over-length category -> 400, no insert, ALTCHA never spent', async () => {
  const db = makeDb();
  const res = await handleContribute(req({ ...valid, category: 'x'.repeat(65) }), { ...env, DB: db }, 1000);
  expect(res.status).toBe(400);
  expect(db.rows.length).toBe(0);
  expect(verifyAltcha).not.toHaveBeenCalled();
});

test('over-length contributor -> 400, no insert, ALTCHA never spent', async () => {
  const db = makeDb();
  const res = await handleContribute(
    req({ ...valid, anonymous: false, contributor: 'x'.repeat(121) }),
    { ...env, DB: db },
    1000,
  );
  expect(res.status).toBe(400);
  expect(db.rows.length).toBe(0);
  expect(verifyAltcha).not.toHaveBeenCalled();
});

test('too many sources (>20) -> 400, no insert, ALTCHA never spent', async () => {
  const db = makeDb();
  const sources = Array.from({ length: 21 }, (_, i) => `https://example.com/${i}`);
  const res = await handleContribute(req({ ...valid, sources }), { ...env, DB: db }, 1000);
  expect(res.status).toBe(400);
  expect(db.rows.length).toBe(0);
  expect(verifyAltcha).not.toHaveBeenCalled();
});

test('over-length source URL (>500 chars) -> 400, no insert, ALTCHA never spent', async () => {
  const db = makeDb();
  const sources = ['https://example.com/' + 'x'.repeat(500)];
  const res = await handleContribute(req({ ...valid, sources }), { ...env, DB: db }, 1000);
  expect(res.status).toBe(400);
  expect(db.rows.length).toBe(0);
  expect(verifyAltcha).not.toHaveBeenCalled();
});

test('field lengths exactly at the cap are accepted (boundary)', async () => {
  const db = makeDb();
  const res = await handleContribute(
    req({
      ...valid,
      title: 'x'.repeat(200),
      category: 'x'.repeat(64),
      body: 'x'.repeat(20000),
      anonymous: false,
      contributor: 'x'.repeat(120),
      sources: Array.from({ length: 20 }, () => 'https://example.com/' + 'x'.repeat(480)), // 500 chars each
    }),
    { ...env, DB: db },
    1000,
  );
  expect(res.status).toBe(200);
  expect(db.rows.length).toBe(1);
  expect(verifyAltcha).toHaveBeenCalledTimes(1);
});

test('rate limit exceeded -> 429, no insert, ALTCHA never spent', async () => {
  // window already at max (5) for this ip hash -> checkRateLimit returns false
  const db = makeRateLimitedDb(5);
  const res = await handleContribute(req(valid), { ...env, DB: db }, 1000);
  expect(res.status).toBe(429);
  expect(db.rows.length).toBe(0);
  // The regression this closes: verifying a solution also spends it
  // (single-use), so a request that was always going to be
  // rate-limited must never burn the client's proof-of-work for
  // nothing — the rate-limit check must run BEFORE verifyAltcha.
  expect(verifyAltcha).not.toHaveBeenCalled();
});
