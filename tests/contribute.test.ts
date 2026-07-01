// tests/contribute.test.ts
import { expect, test, vi } from 'vitest';
import { handleContribute } from '../functions/api/contribute.js';

vi.mock('../functions/_shared/altcha.js', () => ({ verifyAltcha: async (p: string) => p === 'good' }));

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
});

test('honeypot filled -> 400, no insert', async () => {
  const db = makeDb();
  const res = await handleContribute(req({ ...valid, website: 'bot' }), { ...env, DB: db }, 1000);
  expect(res.status).toBe(400);
  expect(db.rows.length).toBe(0);
});

test('bad altcha -> 400', async () => {
  const db = makeDb();
  const res = await handleContribute(req({ ...valid, altcha: 'bad' }), { ...env, DB: db }, 1000);
  expect(res.status).toBe(400);
  expect(db.rows.length).toBe(0);
});

test('missing required field -> 400', async () => {
  const db = makeDb();
  const res = await handleContribute(req({ ...valid, title: '' }), { ...env, DB: db }, 1000);
  expect(res.status).toBe(400);
  expect(db.rows.length).toBe(0);
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

test('non-string field (title: 123) -> 400, no insert', async () => {
  const db = makeDb();
  const res = await handleContribute(req({ ...valid, title: 123 }), { ...env, DB: db }, 1000);
  expect(res.status).toBe(400);
  expect(db.rows.length).toBe(0);
});

test('rate limit exceeded -> 429, no insert', async () => {
  // window already at max (5) for this ip hash -> checkRateLimit returns false
  const db = makeRateLimitedDb(5);
  const res = await handleContribute(req(valid), { ...env, DB: db }, 1000);
  expect(res.status).toBe(429);
  expect(db.rows.length).toBe(0);
});
