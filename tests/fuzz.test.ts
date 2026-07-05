// tests/fuzz.test.ts
//
// Fuzz-testing harness for the pure/testable functions that accept
// untrusted input: `handleContribute` (functions/api/contribute.js),
// `generateGuideMarkdown`/`slugify` (functions/_shared/guide-markdown.js),
// and `hasUnfilledPlaceholders`/`parseApprovedRows` (scripts/publish-lib.mjs).
//
// Goal: throw a large, deterministic corpus of malformed/adversarial JSON
// shapes at each function and prove none of them crash it. An uncaught
// throw here IS the bug — every one of these functions is documented as
// "pure" / meant to handle untrusted input without throwing, so any throw
// is a real finding, not a false positive.
//
// Determinism: seeded with a fixed constant (mulberry32 PRNG, ~10 lines, no
// new dependency) so a failing case is always reproducible from this file
// alone, run to run. No other test file in this repo uses randomness.
//
// This file also carries the Task-B error-handling audit test for
// functions/api/contribute.js (see "Task B" section near the bottom) —
// colocated here rather than tests/contribute.test.ts since it shares the
// same mock-D1/Request-building helpers as the rest of this file.
import { expect, test, vi, beforeEach } from 'vitest';
import { handleContribute } from '../functions/api/contribute.js';
import { verifyAltcha } from '../functions/_shared/altcha.js';
import { generateGuideMarkdown, slugify } from '../functions/_shared/guide-markdown.js';
import { hasUnfilledPlaceholders, parseApprovedRows } from '../scripts/publish-lib.mjs';

// Same mock shape as tests/contribute.test.ts: verifyAltcha resolves true
// only for the literal string 'good', so any fuzzed `altcha` field reliably
// fails closed (400) instead of accidentally validating.
vi.mock('../functions/_shared/altcha.js', () => ({ verifyAltcha: vi.fn(async (p: string) => p === 'good') }));

beforeEach(() => {
  vi.mocked(verifyAltcha).mockClear();
});

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32) — deterministic across runs/machines. Not
// cryptographic; just a fast, decent-quality stream of [0,1) floats seeded
// from one fixed constant so the whole corpus below is reproducible.
const SEED = 0xc0ffee;
function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);
const rand = () => rng();
const randInt = (max: number) => Math.floor(rand() * max);
function pick<T>(arr: T[]): T {
  return arr[randInt(arr.length)];
}

function randomAsciiString(len: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 !@#$%^&*()_+-=[]{}|;:,.<>?/';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[randInt(chars.length)];
  return s;
}

// Control chars (incl. null byte), lone surrogate, bidi overrides, combining
// marks, and multi-byte emoji — all legal content for a JS/JSON string field.
const WEIRD_CHARS = [
  '\u0000', '\u0001', '\u0007', '\u001b', '\u200e', '\u200f', '\u202e', '\u202d',
  '\ud800', '\n', '\r', '\t', '\u{1f4a9}', '\u{1f600}', 'A\u0300', '\ufeff',
];
function randomWeirdString(len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += rand() < 0.5 ? pick(WEIRD_CHARS) : String.fromCharCode(32 + randInt(94));
  return s;
}

const longString = (len: number): string => randomAsciiString(len);

function deepObject(depth: number): unknown {
  let node: unknown = 'bottom';
  for (let i = 0; i < depth; i++) node = { nested: node, i };
  return node;
}

function deepArray(depth: number): unknown {
  let node: unknown = ['bottom'];
  for (let i = 0; i < depth; i++) node = [node, i];
  return node;
}

const WRONG_TYPE_POOL: unknown[] = [
  0, 1, -1, 3.14, NaN, Infinity, true, false, null,
  [], [1, 2, 3], {}, { a: 1 }, deepObject(12), deepArray(12),
  longString(10000), randomWeirdString(50),
];
const wrongType = (): unknown => pick(WRONG_TYPE_POOL);

// =============================================================================
// Task A.1 — fuzzing handleContribute (functions/api/contribute.js)
// =============================================================================

function fuzzReq(body: unknown) {
  return new Request('https://x/api/contribute', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '9.9.9.9' },
    body: JSON.stringify(body),
  });
}

// Same shape as makeDb() in tests/contribute.test.ts: `first()` always
// resolves null (fresh rate-limit window -> allowed) and `rows` only
// accumulates the submissions INSERT calls, so `db.rows.length` doubles as
// the "was a row actually persisted" call log the task asks for.
function makeFuzzDb() {
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

const fuzzEnv = { DB: null, ALTCHA_HMAC_SECRET: 's', ALTCHA_HMAC_KEY_SECRET: 'k', IP_SALT: 'salt' };
const VALID_STATUSES = new Set([200, 400, 429]);

const CONTRIBUTE_FIELDS = ['title', 'body', 'category', 'level', 'sources', 'contributor', 'anonymous', 'altcha', 'website'] as const;
type ContributePayload = Record<string, unknown>;
const validContribute = (): ContributePayload => ({
  category: 'Cars', level: 'MED', title: 'T', body: 'B', sources: [],
  anonymous: true, altcha: 'good', website: '', contributor: '',
});

function buildContributeCorpus(): { label: string; payload: unknown }[] {
  const cases: { label: string; payload: unknown }[] = [];

  // 1. Wrong type for every field, two passes of independently-random values.
  for (let pass = 0; pass < 2; pass++) {
    for (const f of CONTRIBUTE_FIELDS) {
      const p = validContribute();
      p[f] = wrongType();
      cases.push({ label: `wrong-type:${f}:pass${pass}`, payload: p });
    }
  }

  // 2. Deeply nested objects (10+ levels) in string-ish fields.
  for (const f of ['title', 'body', 'category', 'contributor'] as const) {
    const p = validContribute();
    p[f] = deepObject(14);
    cases.push({ label: `deep-nested-object:${f}`, payload: p });
  }

  // 3. Very long strings (10k+ chars) in each field.
  for (const f of ['title', 'body', 'category', 'contributor', 'website', 'altcha'] as const) {
    const p = validContribute();
    p[f] = longString(10000 + randInt(10000));
    cases.push({ label: `long-string:${f}`, payload: p });
  }

  // 4. Unicode control chars / null bytes embedded in string fields.
  for (const f of ['title', 'body', 'category', 'contributor', 'website', 'altcha'] as const) {
    const p = validContribute();
    p[f] = randomWeirdString(20 + randInt(200));
    cases.push({ label: `unicode-control:${f}`, payload: p });
  }

  // 5. Missing fields entirely.
  for (const f of CONTRIBUTE_FIELDS) {
    const p = validContribute();
    delete p[f];
    cases.push({ label: `missing-field:${f}`, payload: p });
  }

  // 6. Extra unexpected top-level fields.
  for (let i = 0; i < 5; i++) {
    const p = validContribute();
    const extraCount = 1 + randInt(5);
    for (let j = 0; j < extraCount; j++) p[`__extra_${i}_${j}_${randomAsciiString(6)}`] = wrongType();
    cases.push({ label: `extra-fields:${i}`, payload: p });
  }

  // 7. `sources` as a variety of non-array types. (`null` and array-like
  // `{length}` objects are deliberately NOT included here: handleContribute
  // itself guards `sources` with `Array.isArray(data.sources) ? ... : []`
  // so it can never crash on those — unlike generateGuideMarkdown, see the
  // CONFIRMED FINDING section below.)
  for (const val of [42, 'a string', true, {}, { length: 3 }, null, undefined]) {
    const p = validContribute();
    p.sources = val;
    cases.push({ label: `sources-non-array:${String(val)}`, payload: p });
  }

  // 8. `sources` array containing non-string / weird entries.
  for (let i = 0; i < 3; i++) {
    const p = validContribute();
    p.sources = [wrongType(), wrongType(), 'https://example.com/ok'];
    cases.push({ label: `sources-weird-entries:${i}`, payload: p });
  }

  // 9. Fully-random "kitchen sink" payloads: every field independently
  // wrong-typed, weird-stringed, valid, or omitted.
  for (let i = 0; i < 12; i++) {
    const p: ContributePayload = {};
    for (const f of CONTRIBUTE_FIELDS) {
      const r = rand();
      if (r < 0.15) continue; // omit entirely
      if (r < 0.55) p[f] = wrongType();
      else if (r < 0.75) p[f] = randomWeirdString(10 + randInt(100));
      else p[f] = validContribute()[f];
    }
    cases.push({ label: `kitchen-sink:${i}`, payload: p });
  }

  // 10. Top-level body isn't a plain object at all.
  for (const val of [true, false, 0, 1, 42, 3.14, '', 'just a string', [], [1, 2, 3], null, deepArray(12)]) {
    cases.push({ label: `top-level-primitive:${JSON.stringify(val)}`, payload: val });
  }

  return cases;
}

const contributeCorpus = buildContributeCorpus();

test('contribute fuzz corpus has at least 50 cases', () => {
  expect(contributeCorpus.length).toBeGreaterThanOrEqual(50);
});

test.each(contributeCorpus)('fuzz handleContribute: $label', async ({ label, payload }) => {
  const db = makeFuzzDb();
  let res: Response;
  try {
    res = await handleContribute(fuzzReq(payload), { ...fuzzEnv, DB: db }, 1000);
  } catch (err) {
    // An uncaught throw here IS the bug this harness hunts for.
    throw new Error(`handleContribute threw for case "${label}": ${(err as Error)?.stack ?? err}`);
  }
  expect(res).toBeInstanceOf(Response);
  expect(VALID_STATUSES.has(res.status)).toBe(true);
  if (res.status === 400 || res.status === 429) {
    expect(db.rows.length).toBe(0);
  }
});

// =============================================================================
// Task B — contribute.js error-handling audit (investigate + report; the
// production code is intentionally NOT modified by this test).
//
// Reading functions/api/contribute.js top to bottom: the ONLY try/catch
// blocks are around `request.json()` (bad-json -> 400) and around
// `new URL(value)` inside `isHttpUrl` (bad-source -> 400). There is no
// try/catch anywhere around `checkRateLimit(env.DB, ...)`,
// `verifyAltcha(data.altcha, env, env.DB, now)`, or the final
// `env.DB.prepare(...).run()` INSERT. This test proves that empirically: a
// D1 binding whose `run()` throws on the submissions INSERT causes
// `handleContribute` itself to reject (the throw propagates out of the
// function), rather than being caught and turned into a Response.
//
// Framing this as a finding, not a fix target: Cloudflare Pages Functions'
// runtime wraps the whole `onRequestPost` invocation and turns any uncaught
// exception into a generic runtime 500 — so in production this is not an
// unhandled-crash outage, just a genuinely uncaught path inside this
// function's OWN code. Whether that's acceptable (rely on the platform's
// catch-all) or should get its own try/catch (for a domain-specific error
// response, logging, etc.) is a call for the project owner, not something
// this test/audit decides.
// =============================================================================
test('Task B finding: a throwing D1 .run() on the submissions INSERT propagates uncaught out of handleContribute', async () => {
  const validPayload = {
    category: 'Cars', level: 'MED', title: 'T', body: 'B',
    sources: [], anonymous: true, altcha: 'good', website: '',
  };
  const throwingDb = {
    prepare(sql: string) {
      return {
        bind(..._args: unknown[]) {
          return {
            async first() {
              return null; // fresh rate-limit window -> allowed
            },
            async run() {
              if (sql.startsWith('INSERT INTO submissions')) throw new Error('D1 unavailable');
              // rate_limits bookkeeping writes succeed normally
            },
          };
        },
      };
    },
  };
  // The test itself must catch the throw (via .rejects) to observe it —
  // that in itself proves handleContribute does NOT catch it internally.
  await expect(
    handleContribute(fuzzReq(validPayload), { ...fuzzEnv, DB: throwingDb }, 1000),
  ).rejects.toThrow('D1 unavailable');
});

// =============================================================================
// Task A.2 — fuzzing generateGuideMarkdown / slugify (functions/_shared/guide-markdown.js)
// =============================================================================

const NO_PATH_SEP = /[\\/]/;

function buildGuideMarkdownCorpus(): { label: string; submission: unknown }[] {
  const titles: unknown[] = ['', 'Normal Title', longString(10000), randomWeirdString(200), 123, true, null, undefined, {}, [], deepObject(12), deepArray(12)];
  const bodies: unknown[] = ['', 'Body text', longString(15000), randomWeirdString(300), 456, false, null, {}, ['a', 'b'], deepObject(11)];
  const categories: unknown[] = ['', 'Cars', longString(10000), randomWeirdString(100), 0, null, {}, []];
  const levels: unknown[] = ['LOW', 'MED', 'HIGH', '', 'BOGUS', 123, null, {}];
  // `sources` pool deliberately excludes `null` and array-like `{length}`
  // objects — those are the CONFIRMED FINDING below, captured as fixed
  // regression cases rather than mixed into the random corpus (a fuzz loop
  // can't assert "never throws" over a case that's already proven to throw).
  const sourcesPool: unknown[] = [
    [], ['https://a.example'], Array.from({ length: 25 }, (_, i) => `https://x.example/${i}`),
    [longString(2000)], [randomWeirdString(50)], [123, {}, null, true],
    42, 'not-an-array-but-a-string', true, {}, deepArray(10),
  ];

  const cases: { label: string; submission: unknown }[] = [];
  for (let i = 0; i < 26; i++) {
    cases.push({
      label: `guide-markdown:${i}`,
      submission: {
        title: pick(titles),
        category: pick(categories),
        level: pick(levels),
        body: pick(bodies),
        sources: pick(sourcesPool),
      },
    });
  }
  return cases;
}

const guideMarkdownCorpus = buildGuideMarkdownCorpus();

test('guide-markdown fuzz corpus has 20-30 cases', () => {
  expect(guideMarkdownCorpus.length).toBeGreaterThanOrEqual(20);
  expect(guideMarkdownCorpus.length).toBeLessThanOrEqual(30);
});

test.each(guideMarkdownCorpus)('fuzz generateGuideMarkdown: $label', ({ label, submission }) => {
  let result: { filename: string; markdown: string };
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    result = generateGuideMarkdown(submission as any, '2026-07-04');
  } catch (err) {
    throw new Error(`generateGuideMarkdown threw for case "${label}": ${(err as Error)?.stack ?? err}`);
  }
  expect(typeof result.filename).toBe('string');
  expect(result.filename.length).toBeGreaterThan(0);
  expect(result.filename.startsWith('.')).toBe(false);
  expect(NO_PATH_SEP.test(result.filename)).toBe(false);
  expect(typeof result.markdown).toBe('string');
});

function buildSlugifyCorpus(): { label: string; input: unknown }[] {
  const cases: { label: string; input: unknown }[] = [];
  for (let i = 0; i < 25; i++) {
    const r = rand();
    let input: unknown;
    if (r < 0.4) input = randomWeirdString(1 + randInt(300));
    else if (r < 0.6) input = longString(5000 + randInt(10000));
    else if (r < 0.8) input = wrongType();
    else input = pick(['', '   ', '***', '\u0000\u0000', '../../etc/passwd', 'a'.repeat(500)]);
    cases.push({ label: `slugify:${i}`, input });
  }
  return cases;
}

const slugifyCorpus = buildSlugifyCorpus();

test.each(slugifyCorpus)('fuzz slugify: $label', ({ label, input }) => {
  let out: string;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    out = slugify(input as any);
  } catch (err) {
    throw new Error(`slugify threw for case "${label}": ${(err as Error)?.stack ?? err}`);
  }
  expect(typeof out).toBe('string');
  expect(out.length).toBeGreaterThan(0);
  expect(NO_PATH_SEP.test(out)).toBe(false);
  expect(out.startsWith('.')).toBe(false);
});

// =============================================================================
// Task A.3 — fuzzing hasUnfilledPlaceholders / parseApprovedRows (scripts/publish-lib.mjs)
// =============================================================================

function buildPublishLibCorpus(): { label: string; input: string }[] {
  const pool: string[] = [
    '', 'plain text', '[ADD SUMMARY]', longString(10000), randomWeirdString(300),
    JSON.stringify({ results: [{ id: '1', sources: 'not json[' }] }),
    JSON.stringify([{ results: [{ id: '1', sources: null }] }]),
    JSON.stringify({ results: 'not-an-array' }),
    JSON.stringify(null), JSON.stringify(42), JSON.stringify(true), JSON.stringify([1, 2, 3]),
    '{"broken": ', 'not json at all {{{', randomAsciiString(500),
    JSON.stringify(deepObject(12)),
    JSON.stringify([{ results: [{ sources: 12345 }] }]),
    JSON.stringify([{ results: [{ sources: ['a', 1, null, {}] }] }]),
  ];
  const cases: { label: string; input: string }[] = [];
  for (let i = 0; i < 20; i++) cases.push({ label: `publish-lib:${i}`, input: pick(pool) });
  return cases;
}

const publishLibCorpus = buildPublishLibCorpus();

test.each(publishLibCorpus)('fuzz hasUnfilledPlaceholders/parseApprovedRows: $label', ({ label, input }) => {
  let flag: boolean;
  let rows: unknown;
  try {
    flag = hasUnfilledPlaceholders(input);
    rows = parseApprovedRows(input);
  } catch (err) {
    throw new Error(`publish-lib threw for case "${label}": ${(err as Error)?.stack ?? err}`);
  }
  expect(typeof flag).toBe('boolean');
  expect(Array.isArray(rows)).toBe(true);
});

// =============================================================================
// CONFIRMED FINDING (fuzz-discovered — NOT fixed here, per task instructions)
//
// generateGuideMarkdown destructures `const { sources = [] } = submission`.
// A default parameter only kicks in when the property is strictly
// `undefined` — so a submission whose `sources` is explicitly `null`, or an
// array-like object with a numeric `.length` that isn't actually iterable
// (e.g. `{ length: 2, 0: 'a', 1: 'b' }` — a plausible shape for a
// hand-crafted/malformed JSON row), throws instead of degrading gracefully:
//
//   sources: null                    -> TypeError: Cannot read properties
//                                        of null (reading 'length')
//   sources: { length: 2, 0: 'a' }    -> TypeError: sources is not iterable
//
// Neither current call site can produce these shapes today —
// functions/admin/approve.js's `parseSources` and
// scripts/publish-lib.mjs's `normalizeSources` both always coerce `sources`
// to a real array (or `[]`) before calling generateGuideMarkdown — so this
// is not reachable in production right now. It IS a latent robustness gap
// in the exported function itself (documented as a pure, testable-in-
// isolation transform), which is why it surfaced from fuzzing the function
// directly rather than through either wrapper. Left unfixed; flagging for a
// fix decision from the project owner.
// =============================================================================
test('CONFIRMED FINDING: generateGuideMarkdown throws when sources is null', () => {
  expect(() =>
    generateGuideMarkdown(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { title: 't', category: 'c', level: 'LOW', body: 'b', sources: null as any },
      '2026-07-04',
    ),
  ).toThrow(/Cannot read propert/);
});

test('CONFIRMED FINDING: generateGuideMarkdown throws when sources is a non-iterable array-like object', () => {
  expect(() =>
    generateGuideMarkdown(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { title: 't', category: 'c', level: 'LOW', body: 'b', sources: { length: 2, 0: 'a', 1: 'b' } as any },
      '2026-07-04',
    ),
  ).toThrow(/not iterable/);
});
