// tests/comment.test.ts
// POST /api/comment — open-review comments. Mirrors contribute.test.ts
// conventions: trackable verifyAltcha mock so cheap rejections provably
// never spend a solve.
import { expect, test, vi, beforeEach } from 'vitest';
import { handleComment } from '../functions/api/comment.js';
import { verifyAltcha } from '../functions/_shared/altcha.js';
import { recordAbuseEvent } from '../functions/_shared/abuse.js';

vi.mock('../functions/_shared/altcha.js', () => ({ verifyAltcha: vi.fn(async (p: string) => p === 'good') }));
vi.mock('../functions/_shared/abuse.js', () => ({ recordAbuseEvent: vi.fn(async () => {}) }));

beforeEach(() => {
  vi.mocked(verifyAltcha).mockClear();
  vi.mocked(recordAbuseEvent).mockClear();
});

// D1 mock: submissions lookup by id + comment INSERT capture + optional
// rate-limit row. Captures every prepared SQL + args for assertions.
function makeDb(opts: { submission?: { status: string } | null; rateCount?: number } = {}) {
  const rows: unknown[] = [];
  const calls: { sql: string; args: unknown[] }[] = [];
  const rateLimitRow = opts.rateCount === undefined ? null : { window_start: 1000, count: opts.rateCount };
  return {
    rows,
    calls,
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          calls.push({ sql, args });
          return {
            async first() {
              if (sql.startsWith('SELECT status FROM submissions')) return opts.submission ?? null;
              if (sql.startsWith('SELECT window_start, count FROM rate_limits')) return rateLimitRow;
              return null;
            },
            async run() {
              if (sql.startsWith('INSERT INTO comments')) rows.push(args);
            },
          };
        },
      };
    },
  };
}

function req(body: unknown) {
  return new Request('https://x/api/comment', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '9.9.9.9' },
    body: JSON.stringify(body),
  });
}

const env = { DB: null, ALTCHA_HMAC_SECRET: 's', ALTCHA_HMAC_KEY_SECRET: 'k', IP_SALT: 'salt' };
const valid = { submission_id: 'sub-1', body: 'The source link 404s.', author: 'Sam', source_flag: true, altcha: 'good', website: '' };
const pending = { submission: { status: 'pending' } };

test('happy path inserts a comment with source_flag=1 and no IP-derived value', async () => {
  const db = makeDb(pending);
  const res = await handleComment(req(valid), { ...env, DB: db }, 1000);
  expect(res.status).toBe(200);
  expect(db.rows.length).toBe(1);
  const insert = db.calls.find((c) => c.sql.startsWith('INSERT INTO comments'));
  expect(insert!.sql).not.toContain('ip');
  expect(insert!.args).toContain('sub-1');
  expect(insert!.args).toContain('The source link 404s.');
  expect(insert!.args).toContain('Sam');
  expect(insert!.args).toContain(1); // source_flag
  expect(verifyAltcha).toHaveBeenCalledTimes(1);
});

test('anonymous comment (no author) binds null author; source_flag defaults 0', async () => {
  const db = makeDb(pending);
  const res = await handleComment(req({ ...valid, author: undefined, source_flag: undefined }), { ...env, DB: db }, 1000);
  expect(res.status).toBe(200);
  const insert = db.calls.find((c) => c.sql.startsWith('INSERT INTO comments'));
  expect(insert!.args).toContain(null);
  expect(insert!.args).toContain(0);
});

test('honeypot filled -> generic 400, no insert, ALTCHA never spent', async () => {
  const db = makeDb(pending);
  const res = await handleComment(req({ ...valid, website: 'bot' }), { ...env, DB: db }, 1000);
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ ok: false });
  expect(db.rows.length).toBe(0);
  expect(verifyAltcha).not.toHaveBeenCalled();
});

test.each([
  ['missing submission_id', { submission_id: '' }],
  ['missing body', { body: '' }],
  ['whitespace body', { body: '   ' }],
  ['non-string body', { body: 42 }],
])('%s -> 400 invalid, ALTCHA never spent', async (_label, patch) => {
  const db = makeDb(pending);
  const res = await handleComment(req({ ...valid, ...patch }), { ...env, DB: db }, 1000);
  expect(res.status).toBe(400);
  expect(db.rows.length).toBe(0);
  expect(verifyAltcha).not.toHaveBeenCalled();
});

test.each([
  ['body', 'x'.repeat(2001)],
  ['author', 'x'.repeat(121)],
  ['submission_id', 'x'.repeat(65)],
])('over-length %s -> 400 too-long, ALTCHA never spent', async (field, value) => {
  const db = makeDb(pending);
  const res = await handleComment(req({ ...valid, [field]: value }), { ...env, DB: db }, 1000);
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ ok: false, error: 'too-long' });
  expect(db.rows.length).toBe(0);
  expect(verifyAltcha).not.toHaveBeenCalled();
});

test('unknown submission -> 400 invalid, ALTCHA never spent', async () => {
  const db = makeDb({ submission: null });
  const res = await handleComment(req(valid), { ...env, DB: db }, 1000);
  expect(res.status).toBe(400);
  expect(db.rows.length).toBe(0);
  expect(verifyAltcha).not.toHaveBeenCalled();
});

test('already-moderated submission -> 400 invalid (comments only while pending)', async () => {
  const db = makeDb({ submission: { status: 'approved' } });
  const res = await handleComment(req(valid), { ...env, DB: db }, 1000);
  expect(res.status).toBe(400);
  expect(db.rows.length).toBe(0);
  expect(verifyAltcha).not.toHaveBeenCalled();
});

test('rate limited -> 429 before ALTCHA is spent; bucket key is c:-prefixed (own budget)', async () => {
  const db = makeDb({ ...pending, rateCount: 10 });
  const res = await handleComment(req(valid), { ...env, DB: db }, 1000);
  expect(res.status).toBe(429);
  expect(db.rows.length).toBe(0);
  expect(verifyAltcha).not.toHaveBeenCalled();
  const rateCall = db.calls.find((c) => c.sql.startsWith('SELECT window_start'));
  expect(String(rateCall!.args[0])).toMatch(/^c:[0-9a-f]{64}$/);
});

test('bad altcha -> 400, no insert', async () => {
  const db = makeDb(pending);
  const res = await handleComment(req({ ...valid, altcha: 'bad' }), { ...env, DB: db }, 1000);
  expect(res.status).toBe(400);
  expect(db.rows.length).toBe(0);
  expect(verifyAltcha).toHaveBeenCalledTimes(1);
});

test('D1 throw -> structured 503', async () => {
  const db = {
    prepare() {
      throw new Error('boom');
    },
  };
  const res = await handleComment(req(valid), { ...env, DB: db }, 1000);
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ ok: false, error: 'unavailable' });
});

test('array/null JSON body -> 400, no throw', async () => {
  const db = makeDb(pending);
  for (const bad of [null, [1, 2]]) {
    const res = await handleComment(req(bad), { ...env, DB: db }, 1000);
    expect(res.status).toBe(400);
  }
  expect(db.rows.length).toBe(0);
});

test('honeypot trip records a "honeypot" abuse event', async () => {
  const db = makeDb(pending);
  await handleComment(req({ ...valid, website: 'bot' }), { ...env, DB: db }, 5000);
  expect(recordAbuseEvent).toHaveBeenCalledWith(db, 'honeypot', 5000);
});

test('rate-limit rejection records a "rate" abuse event', async () => {
  const db = makeDb({ ...pending, rateCount: 10 });
  await handleComment(req(valid), { ...env, DB: db }, 5000);
  expect(recordAbuseEvent).toHaveBeenCalledWith(db, 'rate', 5000);
});

test('a failed ALTCHA solve records an "altcha" abuse event', async () => {
  const db = makeDb(pending);
  await handleComment(req({ ...valid, altcha: 'bad' }), { ...env, DB: db }, 5000);
  expect(recordAbuseEvent).toHaveBeenCalledWith(db, 'altcha', 5000);
});
