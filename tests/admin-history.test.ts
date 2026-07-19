// tests/admin-history.test.ts
import { expect, test, vi, beforeEach } from 'vitest';

vi.mock('../functions/_shared/access.js', () => ({
  requireModerator: vi.fn(async () => null),
}));
import { requireModerator } from '../functions/_shared/access.js';
import { onRequestGet } from '../functions/admin/history.js';

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
            async all() { return { results: rows }; },
            async first() { return { n: rows.length }; },
          };
        },
      };
    },
  };
}
const req = (path = 'https://x/admin/history') => new Request(path);

test('lists non-pending submissions with moderator and timestamp, escaped', async () => {
  const db = dbWith([
    {
      id: 'a1', created_at: 1, category: '<b>Cars</b>', level: 'MED', title: 'T', status: 'approved',
      moderated_by: 'mod@example.com', moderated_at: 1720000000000,
    },
  ]);
  const res = await onRequestGet({ request: req(), env: { DB: db } });
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).not.toContain('<b>Cars</b>');
  expect(html).toContain('&lt;b&gt;Cars&lt;/b&gt;');
  expect(html).toContain('mod@example.com');
  expect(html).toContain('approved');
});

test('queries with status != pending', async () => {
  const db = dbWith([]);
  await onRequestGet({ request: req(), env: { DB: db } });
  const selectCall = db.calls.find((c) => c.sql.includes('SELECT id'));
  expect(selectCall!.sql).toContain("status != 'pending'");
});

test('shows "unknown" moderator when moderated_by is null (e.g. pre-migration rows)', async () => {
  const db = dbWith([
    { id: 'a1', created_at: 1, category: 'Cars', level: 'LOW', title: 'T', status: 'rejected', moderated_by: null, moderated_at: null },
  ]);
  const res = await onRequestGet({ request: req(), env: { DB: db } });
  const html = await res.text();
  expect(html).toContain('unknown');
});

test('only offers a bulk-delete action, not approve/reject', async () => {
  const db = dbWith([
    { id: 'a1', created_at: 1, category: 'Cars', level: 'LOW', title: 'T', status: 'rejected', moderated_by: 'mod@example.com', moderated_at: 1 },
  ]);
  const res = await onRequestGet({ request: req(), env: { DB: db } });
  const html = await res.text();
  expect(html).toContain('formaction="/admin/delete"');
  expect(html).not.toContain('formaction="/admin/approve"');
  expect(html).not.toContain('formaction="/admin/reject"');
});

test('returns 403 when the gate denies', async () => {
  vi.mocked(requireModerator).mockResolvedValue(new Response('Forbidden', { status: 403 }));
  const res = await onRequestGet({ request: req(), env: { DB: dbWith([]) } });
  expect(res.status).toBe(403);
});

test('history rows carry a type badge', async () => {
  const db = dbWith([
    { id: 'h1', created_at: 1, type: 'software', category: 'Network', level: null, title: 'Mullvad', status: 'approved', moderated_by: 'm@x', moderated_at: 1000 },
  ]);
  const res = await onRequestGet({ request: req(), env: { DB: db } });
  const html = await res.text();
  expect(html).toContain('[software]');
});
