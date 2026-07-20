// tests/admin-abuse.test.ts
import { expect, test, vi, beforeEach } from 'vitest';

vi.mock('../functions/_shared/access.js', () => ({
  requireModerator: vi.fn(async () => null),
}));
import { requireModerator } from '../functions/_shared/access.js';
import { onRequestGet } from '../functions/admin/abuse.js';

beforeEach(() => vi.mocked(requireModerator).mockReset().mockResolvedValue(null));

function dbWith(rows: unknown[]) {
  const calls: { sql: string; args: unknown[] }[] = [];
  return {
    calls,
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          calls.push({ sql, args });
          return {
            async all() {
              return { results: rows };
            },
            async run() {},
          };
        },
      };
    },
  };
}

const req = () => new Request('https://x/admin/abuse');

test('returns 403 when the gate denies', async () => {
  vi.mocked(requireModerator).mockResolvedValue(new Response('Forbidden', { status: 403 }));
  const res = await onRequestGet({ request: req(), env: { DB: dbWith([]) } });
  expect(res.status).toBe(403);
});

test('sweeps stale rows before running the grouped query', async () => {
  const db = dbWith([]);
  await onRequestGet({ request: req(), env: { DB: db } });
  const deleteIdx = db.calls.findIndex((c) => c.sql.startsWith('DELETE FROM abuse_events'));
  const selectIdx = db.calls.findIndex((c) => c.sql.startsWith('SELECT'));
  expect(deleteIdx).toBeGreaterThanOrEqual(0);
  expect(selectIdx).toBeGreaterThan(deleteIdx);
});

test('renders a pivoted table row per day, with counts', async () => {
  const db = dbWith([
    { day: '2026-07-20', type: 'honeypot', n: 3 },
    { day: '2026-07-20', type: 'rate', n: 2 },
    { day: '2026-07-19', type: 'altcha', n: 5 },
  ]);
  const res = await onRequestGet({ request: req(), env: { DB: db } });
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain('2026-07-20');
  expect(html).toContain('2026-07-19');
  expect(html).toMatch(/<td>3<\/td>/);
  expect(html).toMatch(/<td>5<\/td>/);
});

test('shows an empty-state row when there are no events', async () => {
  const res = await onRequestGet({ request: req(), env: { DB: dbWith([]) } });
  const html = await res.text();
  expect(html).toContain('No abuse events');
});

test('includes the admin nav with abuse marked active', async () => {
  const res = await onRequestGet({ request: req(), env: { DB: dbWith([]) } });
  const html = await res.text();
  expect(html).toMatch(/href="\/admin\/abuse"[^>]*aria-current="page"/);
});
