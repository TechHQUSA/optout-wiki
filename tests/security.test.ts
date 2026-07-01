// tests/security.test.ts
import { expect, test } from 'vitest';
import { hashIp, isHoneypotTripped, checkRateLimit } from '../functions/_shared/security.js';

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
