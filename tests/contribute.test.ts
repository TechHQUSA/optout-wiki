// tests/contribute.test.ts
import { expect, test, vi, beforeEach } from 'vitest';
import { handleContribute } from '../functions/api/contribute.js';
import { verifyAltcha } from '../functions/_shared/altcha.js';
import { hashIp } from '../functions/_shared/security.js';
import { recordAbuseEvent } from '../functions/_shared/abuse.js';

// A trackable mock (not a plain async fn) so tests can assert verifyAltcha
// was never called for requests rejected on cheaper grounds (honeypot,
// invalid/oversized fields, rate limit) — verifying a solution also spends
// it, so those paths must not reach it at all. See the check-order note
// atop functions/api/contribute.js.
vi.mock('../functions/_shared/altcha.js', () => ({ verifyAltcha: vi.fn(async (p: string) => p === 'good') }));
vi.mock('../functions/_shared/abuse.js', () => ({ recordAbuseEvent: vi.fn(async () => {}) }));

beforeEach(() => {
  vi.mocked(verifyAltcha).mockClear();
  vi.mocked(recordAbuseEvent).mockClear();
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

test('submission INSERT persists no ip_hash (rate-limit still runs)', async () => {
  // Capture the SQL of the submissions INSERT and assert it has no ip_hash
  // column — an "anonymous" row must not carry an IP-derived value that lets
  // posts be clustered. The rate limiter (rate_limits table) still uses the
  // hashed IP; only the submissions row drops it.
  let insertSql = '';
  let rateLimitSelected = false;
  const db = {
    prepare(sql: string) {
      if (sql.startsWith('INSERT INTO submissions')) insertSql = sql;
      if (sql.startsWith('SELECT window_start, count FROM rate_limits')) rateLimitSelected = true;
      return {
        bind() {
          return {
            async first() {
              return null;
            },
            async run() {},
          };
        },
      };
    },
  };
  const res = await handleContribute(req(valid), { ...env, DB: db }, 1000);
  expect(res.status).toBe(200);
  expect(insertSql).not.toContain('ip_hash');
  expect(rateLimitSelected).toBe(true); // rate limiting still enforced
});

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

test('javascript: source URL -> 400, no insert, ALTCHA never spent', async () => {
  const db = makeDb();
  const res = await handleContribute(
    req({ ...valid, sources: ['javascript:alert(1)'] }),
    { ...env, DB: db },
    1000,
  );
  expect(res.status).toBe(400);
  expect(db.rows.length).toBe(0);
  expect(verifyAltcha).not.toHaveBeenCalled();
});

test('data: source URL -> 400, no insert, ALTCHA never spent', async () => {
  const db = makeDb();
  const res = await handleContribute(
    req({ ...valid, sources: ['data:text/html,<script>alert(1)</script>'] }),
    { ...env, DB: db },
    1000,
  );
  expect(res.status).toBe(400);
  expect(db.rows.length).toBe(0);
  expect(verifyAltcha).not.toHaveBeenCalled();
});

test('non-URL source string (no scheme) -> 400, no insert', async () => {
  const db = makeDb();
  const res = await handleContribute(
    req({ ...valid, sources: ['not a url'] }),
    { ...env, DB: db },
    1000,
  );
  expect(res.status).toBe(400);
  expect(db.rows.length).toBe(0);
  expect(verifyAltcha).not.toHaveBeenCalled();
});

test('http/https source URLs are accepted', async () => {
  const db = makeDb();
  const res = await handleContribute(
    req({ ...valid, sources: ['http://example.com/a', 'https://example.com/b'] }),
    { ...env, DB: db },
    1000,
  );
  expect(res.status).toBe(200);
  expect(db.rows.length).toBe(1);
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

// --- IP-spoof regression -----------------------------------------------
//
// contribute.js reads ONLY `cf-connecting-ip` (Cloudflare's edge-set,
// non-spoofable header) with no fallback to any other header — see the
// comment at its `const ip = request.headers.get('cf-connecting-ip') ...`
// line. This is a regression guard for that specific fact: it builds a db
// mock whose rate-limit row is only "at cap" for the ip_hash derived from
// the TRUSTED header. If a future change added a fallback to
// X-Forwarded-For / X-Real-IP (a common pattern OUTSIDE Cloudflare's edge,
// but wrong here since those headers are entirely attacker-controlled),
// the code would hash one of the forged values instead, miss the seeded
// "at cap" row, and this test would flip from 429 to 200 — failing loudly.
test('rate limiting keys off cf-connecting-ip only; forged X-Forwarded-For/X-Real-IP cannot redirect or evade it', async () => {
  const trustedIp = '1.1.1.1';
  const forgedXff = '9.9.9.9';
  const forgedXRealIp = '8.8.8.8';
  const RATE_LIMIT_MAX = 5; // mirrors the private constant in functions/api/contribute.js
  const expectedHash = await hashIp(trustedIp, env.IP_SALT);

  const submissions: unknown[] = [];
  const selectedHashes: string[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...a: unknown[]) {
          return {
            async first() {
              if (sql.startsWith('SELECT window_start, count FROM rate_limits')) {
                selectedHashes.push(a[0] as string);
                // Only the TRUSTED ip's hash is already at the cap. Any
                // other ip_hash (e.g. one derived from a spoofed header)
                // looks like a fresh, never-seen window.
                return a[0] === expectedHash ? { window_start: 1000, count: RATE_LIMIT_MAX } : null;
              }
              return null;
            },
            async run() {
              if (sql.startsWith('INSERT INTO submissions')) submissions.push(a);
            },
          };
        },
      };
    },
  };

  const request = new Request('https://x/api/contribute', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': trustedIp,
      'x-forwarded-for': forgedXff,
      'x-real-ip': forgedXRealIp,
    },
    body: JSON.stringify(valid),
  });

  const res = await handleContribute(request, { ...env, DB: db }, 1000);
  expect(res.status).toBe(429);
  expect(submissions.length).toBe(0);
  expect(verifyAltcha).not.toHaveBeenCalled();
  // Confirms the rate limiter actually queried the trusted-ip's hash (not
  // e.g. skipping the check entirely for some other reason).
  expect(selectedHashes).toContain(expectedHash);
});

// --- Rate-limit boundary DoS -------------------------------------------
//
// Drives the real fixed-window counter (not a canned "already at cap" row)
// through exactly RATE_LIMIT_MAX requests from the same ip_hash within one
// window, confirming all of them succeed, then confirms request #6 is
// blocked AND that its ALTCHA payload is never spent — mirroring the
// existing "rate limit exceeded" test's assertion pattern, but exercising
// the counter's actual increment logic across a full window instead of a
// single pre-seeded snapshot.
function makeStatefulRateLimitDb() {
  const rateLimits = new Map<string, { window_start: number; count: number }>();
  const submissions: unknown[] = [];
  return {
    submissions,
    rateLimits,
    prepare(sql: string) {
      return {
        bind(...a: unknown[]) {
          return {
            async first() {
              if (sql.startsWith('SELECT window_start, count FROM rate_limits')) {
                return rateLimits.get(a[0] as string) ?? null;
              }
              return null;
            },
            async run() {
              if (sql.startsWith('INSERT INTO submissions')) submissions.push(a);
              else if (sql.startsWith('INSERT OR REPLACE INTO rate_limits')) {
                rateLimits.set(a[0] as string, { window_start: a[1] as number, count: 1 });
              } else if (sql.startsWith('UPDATE rate_limits')) {
                const r = rateLimits.get(a[0] as string);
                if (r) r.count += 1;
              }
              // DELETE (sweepStaleRateLimits opportunistic sweep): no rows
              // are stale here, so a no-op is correct.
            },
          };
        },
      };
    },
  };
}

test('exactly RATE_LIMIT_MAX requests from the same ip_hash all succeed; the next is blocked and never spends ALTCHA', async () => {
  const RATE_LIMIT_MAX = 5; // mirrors the private constant in functions/api/contribute.js
  const db = makeStatefulRateLimitDb();
  const now = 1000;

  for (let i = 0; i < RATE_LIMIT_MAX; i++) {
    const res = await handleContribute(req(valid), { ...env, DB: db }, now);
    expect(res.status).toBe(200);
  }
  expect(db.submissions.length).toBe(RATE_LIMIT_MAX);
  expect(verifyAltcha).toHaveBeenCalledTimes(RATE_LIMIT_MAX);

  vi.mocked(verifyAltcha).mockClear();
  const blocked = await handleContribute(req(valid), { ...env, DB: db }, now);
  expect(blocked.status).toBe(429);
  expect(db.submissions.length).toBe(RATE_LIMIT_MAX); // no new row from the rejected request
  // The regression this closes: verifying a solution also spends it
  // (single-use), so the 6th, rejected-for-rate-limit request must never
  // have burned its ALTCHA signature.
  expect(verifyAltcha).not.toHaveBeenCalled();
});

// --- Multi-byte / emoji length-cap edge cases --------------------------
//
// MAX_TITLE (200) caps `title.length`, which counts UTF-16 code units, not
// bytes or grapheme clusters. These tests confirm the cap's documented
// behavior — it bounds *code units*, not storage size — and quantify by
// how much stored byte size can exceed the "200" the cap name suggests, so
// any future silent change to that ratio would need to touch a test.
test('title at MAX_TITLE made of astral-plane emoji: cap holds at the code-unit boundary (documented, not a bug)', async () => {
  const db = makeDb();
  // U+1F600 is a surrogate pair: 2 UTF-16 code units but 4 UTF-8 bytes per
  // code point. 100 of them == exactly 200 code units == MAX_TITLE.
  const emojiTitle = '\u{1F600}'.repeat(100);
  expect(emojiTitle.length).toBe(200);

  const res = await handleContribute(req({ ...valid, title: emojiTitle }), { ...env, DB: db }, 1000);
  expect(res.status).toBe(200);
  expect(db.rows.length).toBe(1);

  const storedTitle = (db.rows[0] as unknown[])[5] as string; // bind order: id, created_at, type, category, level, title, ...
  expect(storedTitle).toBe(emojiTitle);
  const byteLength = new TextEncoder().encode(storedTitle).length;
  // 100 code points * 4 bytes = 400 -- 2x the "200" the cap's name implies,
  // by design (see MAX_TITLE's file-header comment): it's a code-unit cap,
  // not a byte cap.
  expect(byteLength).toBe(400);
});

test('one code unit over MAX_TITLE in emoji is still rejected (boundary holds past the surrogate-pair case)', async () => {
  const db = makeDb();
  const overTitle = '\u{1F600}'.repeat(100) + 'x'; // 201 UTF-16 code units
  expect(overTitle.length).toBe(201);
  const res = await handleContribute(req({ ...valid, title: overTitle }), { ...env, DB: db }, 1000);
  expect(res.status).toBe(400);
  expect(db.rows.length).toBe(0);
});

test('BMP characters inflate stored bytes further than emoji at the same .length cap (finding: worse ratio, not a regression)', async () => {
  const db = makeDb();
  // U+4E00 is a single UTF-16 code unit (no surrogate pair needed) but
  // encodes as 3 bytes in UTF-8 -- so unlike the emoji case, ballooning
  // storage doesn't even require surrogate pairs. 200 of these hit
  // MAX_TITLE's .length cap exactly (no surrogate-pair "discount" the way
  // emoji get) while storing 600 bytes: a 3x inflation over the naive
  // "200 chars ~ 200 bytes" reading of the constant's name -- worse than
  // the emoji case above (2x). Still tiny in absolute terms (600 bytes),
  // nowhere near the "multi-MB" row the length caps guard against, so this
  // is noted as a documentation/expectation gap, not a security bug.
  const title = '一'.repeat(200);
  expect(title.length).toBe(200);

  const res = await handleContribute(req({ ...valid, title }), { ...env, DB: db }, 1000);
  expect(res.status).toBe(200);
  const storedTitle = (db.rows[0] as unknown[])[5] as string;
  expect(new TextEncoder().encode(storedTitle).length).toBe(600);
});

// --- Concurrent requests / fixed-window race ---------------------------
//
// Deliberately NOT added: a "fire several handleContribute calls via
// Promise.all against the same ip_hash" test was prototyped to probe
// whether the fixed-window counter's read-then-write shape
// (SELECT count, decide, then UPDATE count = count + 1 as two separate
// round trips in functions/_shared/security.js#checkRateLimit) is safe
// under concurrency. Empirically, against this suite's D1 mock (a plain
// object/Map whose `first()`/`run()` resolve with no real I/O delay),
// Promise.all-ing N > RATE_LIMIT_MAX concurrent handleContribute calls
// against the same ip_hash consistently allowed exactly RATE_LIMIT_MAX and
// blocked the rest — indistinguishable from sequential calls. That's a
// property of the JS engine's microtask scheduling for equal-depth
// await-chains (each call's continuations happen to interleave in a way
// that serializes the read/write pairs), not evidence the production
// checkRateLimit is race-free — over a real network to D1 the SELECT and
// UPDATE are two independent round trips and nothing prevents two
// concurrent requests both reading count=4 before either's UPDATE lands.
// Asserting today's incidental mock-scheduling behavior would be a test of
// the mock, not of the code, so per the instructions to skip rather than
// write a test that doesn't exercise anything real, no test is added
// here. A genuine regression test for this would need a mock that can
// model interleaved round trips (e.g. deferred/delayed `first()`/`run()`
// promises), which is out of scope for this pass.

// ---- software submissions (type='software') ----

const validSw = {
  type: 'software',
  name: 'Mullvad VPN',
  category: 'Network',
  url: 'https://mullvad.net',
  summary: 'Anonymous VPN.',
  tags: ['vpn', 'no-logs'],
  justification: 'Audited, no logs, cash payment.',
  sources: ['https://mullvad.net/en/blog/audit'],
  anonymous: true,
  altcha: 'good',
  website: '',
};

test('unknown type -> 400 invalid, ALTCHA never spent', async () => {
  const db = makeDb();
  const res = await handleContribute(req({ ...valid, type: 'exploit' }), { ...env, DB: db }, 1000);
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ ok: false, error: 'invalid' });
  expect(db.rows.length).toBe(0);
  expect(verifyAltcha).not.toHaveBeenCalled();
});

test("explicit type:'guide' behaves exactly like the legacy payload", async () => {
  const db = makeDb();
  const res = await handleContribute(req({ ...valid, type: 'guide' }), { ...env, DB: db }, 1000);
  expect(res.status).toBe(200);
  expect(db.rows.length).toBe(1);
});

test('software happy path inserts pending row: type=software, level NULL, columns mapped', async () => {
  const db = makeDb();
  const res = await handleContribute(req(validSw), { ...env, DB: db }, 1000);
  expect(res.status).toBe(200);
  expect(db.rows.length).toBe(1);
  expect(verifyAltcha).toHaveBeenCalledTimes(1);
  const bound = db.rows[0] as unknown[];
  expect(bound).toContain('software'); // type
  expect(bound).toContain('Mullvad VPN'); // title=name
  expect(bound).toContain('https://mullvad.net'); // url
  expect(bound).toContain('Anonymous VPN.'); // summary
  expect(bound).toContain('Audited, no logs, cash payment.'); // body=justification
  expect(bound).toContain(JSON.stringify(['vpn', 'no-logs'])); // tags JSON
  expect(bound).toContain(null); // level bound as NULL
});

test.each(['name', 'category', 'url', 'summary'])(
  'software missing required %s -> 400, ALTCHA never spent',
  async (field) => {
    const db = makeDb();
    const res = await handleContribute(req({ ...validSw, [field]: '' }), { ...env, DB: db }, 1000);
    expect(res.status).toBe(400);
    expect(db.rows.length).toBe(0);
    expect(verifyAltcha).not.toHaveBeenCalled();
  },
);

test('software javascript: url -> 400 bad-source', async () => {
  const db = makeDb();
  const res = await handleContribute(
    req({ ...validSw, url: 'javascript:alert(1)' }),
    { ...env, DB: db },
    1000,
  );
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ ok: false, error: 'bad-source' });
  expect(db.rows.length).toBe(0);
  expect(verifyAltcha).not.toHaveBeenCalled();
});

test('software bad evidence source scheme -> 400 bad-source', async () => {
  const db = makeDb();
  const res = await handleContribute(
    req({ ...validSw, sources: ['data:text/html,x'] }),
    { ...env, DB: db },
    1000,
  );
  expect(res.status).toBe(400);
  expect(db.rows.length).toBe(0);
});

test.each([
  ['name', 'x'.repeat(121)],
  ['url', `https://e.com/${'x'.repeat(500)}`],
  ['summary', 'x'.repeat(501)],
  ['justification', 'x'.repeat(5001)],
])('software over-length %s -> 400 too-long, ALTCHA never spent', async (field, value) => {
  const db = makeDb();
  const res = await handleContribute(req({ ...validSw, [field]: value }), { ...env, DB: db }, 1000);
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ ok: false, error: 'too-long' });
  expect(db.rows.length).toBe(0);
  expect(verifyAltcha).not.toHaveBeenCalled();
});

test('software tags: >10 entries, over-length entry, or non-string entry -> 400', async () => {
  const db = makeDb();
  for (const tags of [Array.from({ length: 11 }, () => 't'), ['x'.repeat(41)], ['ok', 7]]) {
    const res = await handleContribute(req({ ...validSw, tags }), { ...env, DB: db }, 1000);
    expect(res.status).toBe(400);
  }
  expect(db.rows.length).toBe(0);
  expect(verifyAltcha).not.toHaveBeenCalled();
});

test('software honeypot filled -> 400 generic, ALTCHA never spent', async () => {
  const db = makeDb();
  const res = await handleContribute(req({ ...validSw, website: 'bot' }), { ...env, DB: db }, 1000);
  expect(res.status).toBe(400);
  expect(db.rows.length).toBe(0);
  expect(verifyAltcha).not.toHaveBeenCalled();
});

test('software rate-limited -> 429 before ALTCHA is spent', async () => {
  const db = makeRateLimitedDb(5);
  const res = await handleContribute(req(validSw), { ...env, DB: db }, 1000);
  expect(res.status).toBe(429);
  expect(db.rows.length).toBe(0);
  expect(verifyAltcha).not.toHaveBeenCalled();
});

test('software category outside the allow-list -> 400 invalid', async () => {
  const db = makeDb();
  const res = await handleContribute(req({ ...validSw, category: 'Games' }), { ...env, DB: db }, 1000);
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ ok: false, error: 'invalid' });
  expect(db.rows.length).toBe(0);
  expect(verifyAltcha).not.toHaveBeenCalled();
});

test('software tags are trimmed and empty entries dropped before storage', async () => {
  const db = makeDb();
  const res = await handleContribute(
    req({ ...validSw, tags: ['  vpn  ', '   ', 'no-logs'] }),
    { ...env, DB: db },
    1000,
  );
  expect(res.status).toBe(200);
  expect(db.rows[0]).toContain(JSON.stringify(['vpn', 'no-logs']));
});

test('honeypot trip records a "honeypot" abuse event', async () => {
  const db = makeDb();
  const body = { ...valid, website: 'i-am-a-bot' };
  await handleContribute(req(body), { ...env, DB: db }, 5000);
  expect(recordAbuseEvent).toHaveBeenCalledWith(db, 'honeypot', 5000);
});

test('rate-limit rejection records a "rate" abuse event', async () => {
  const db = makeRateLimitedDb(5);
  await handleContribute(req(valid), { ...env, DB: db }, 5000);
  expect(recordAbuseEvent).toHaveBeenCalledWith(db, 'rate', 5000);
});

test('a failed ALTCHA solve records an "altcha" abuse event', async () => {
  const db = makeDb();
  const body = { ...valid, altcha: 'bad' };
  await handleContribute(req(body), { ...env, DB: db }, 5000);
  expect(recordAbuseEvent).toHaveBeenCalledWith(db, 'altcha', 5000);
});
