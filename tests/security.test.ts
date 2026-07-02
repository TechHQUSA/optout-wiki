// tests/security.test.ts
import { expect, test } from 'vitest';
import { hashIp, isHoneypotTripped, checkRateLimit, sweepStaleRateLimits } from '../functions/_shared/security.js';

// A Map-backed D1-shaped fake that actually understands DELETE (unlike the
// single-row mock above, which only ever tracks one ip_hash) so the sweep's
// real filtering logic — not just that *a* query ran — gets exercised.
function makeMultiRowDb() {
  const store = new Map<string, { window_start: number; count: number }>();
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first() {
              return store.get(args[0] as string) ?? null;
            },
            async run() {
              if (sql.startsWith('INSERT')) {
                store.set(args[0] as string, { window_start: args[1] as number, count: 1 });
              } else if (sql.startsWith('UPDATE')) {
                const r = store.get(args[0] as string)!;
                r.count += 1;
              } else if (sql.startsWith('DELETE')) {
                const cutoff = args[0] as number;
                for (const [key, row] of store) {
                  if (row.window_start < cutoff) store.delete(key);
                }
              }
            },
          };
        },
      };
    },
  };
  return { db, store };
}

test('hashIp is deterministic, salted, and not the raw ip', async () => {
  const a = await hashIp('1.2.3.4', 'salt');
  const b = await hashIp('1.2.3.4', 'salt');
  const c = await hashIp('1.2.3.4', 'other');
  expect(a).toBe(b);
  expect(a).not.toBe(c);
  expect(a).not.toContain('1.2.3.4');
  expect(a).toMatch(/^[0-9a-f]{64}$/);
});

test('honeypot trips only when filled', () => {
  expect(isHoneypotTripped('')).toBe(false);
  expect(isHoneypotTripped(undefined)).toBe(false);
  expect(isHoneypotTripped('bot')).toBe(true);
});

test('rate limit allows up to max then blocks within window', async () => {
  const store = new Map();
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first() { const r = store.get(args[0]); return r ?? null; },
            async run() {
              if (sql.startsWith('INSERT')) store.set(args[0], { window_start: args[1], count: 1 });
              else if (sql.startsWith('DELETE')) { /* sweepStaleRateLimits: no-op, not under test here */ }
              else { const r = store.get(args[0]); r.count += 1; }
            },
          };
        },
      };
    },
  };
  const now = 1000;
  expect(await checkRateLimit(db, 'h', now, 60000, 3)).toBe(true);  // 1
  expect(await checkRateLimit(db, 'h', now, 60000, 3)).toBe(true);  // 2
  expect(await checkRateLimit(db, 'h', now, 60000, 3)).toBe(true);  // 3
  expect(await checkRateLimit(db, 'h', now, 60000, 3)).toBe(false); // blocked
  // new window resets
  expect(await checkRateLimit(db, 'h', now + 61000, 60000, 3)).toBe(true);
});

test('sweepStaleRateLimits deletes rows past the threshold, keeps recent ones', async () => {
  const { db, store } = makeMultiRowDb();
  const now = 100_000_000;
  const staleMs = 24 * 60 * 60 * 1000;
  store.set('stale', { window_start: now - staleMs - 1, count: 1 }); // 1ms past the cutoff
  store.set('fresh', { window_start: now - staleMs + 1, count: 1 }); // 1ms inside the cutoff
  await sweepStaleRateLimits(db, now, staleMs);
  expect(store.has('stale')).toBe(false);
  expect(store.has('fresh')).toBe(true);
});

test('checkRateLimit opportunistically sweeps other stale ip_hashes on a reset/cold window', async () => {
  const { db, store } = makeMultiRowDb();
  const now = 100_000_000;
  const staleMs = 24 * 60 * 60 * 1000;
  // A different ip_hash whose window is long past both its own windowMs
  // AND the sweep's stale threshold — should be swept away as a side
  // effect of checkRateLimit handling an unrelated ip_hash's cold window.
  store.set('long-gone', { window_start: now - staleMs - 1, count: 1 });
  expect(await checkRateLimit(db, 'someone-else', now, 60_000, 5)).toBe(true);
  expect(store.has('long-gone')).toBe(false);
  expect(store.has('someone-else')).toBe(true); // its own row is unaffected
});
