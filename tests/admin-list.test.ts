// tests/admin-list.test.ts
import { expect, test, vi, beforeEach } from 'vitest';

vi.mock('../functions/_shared/access.js', () => ({
  requireModerator: vi.fn(async () => null), // authorized by default
}));
import { requireModerator } from '../functions/_shared/access.js';
import { onRequestGet } from '../functions/admin/index.js';

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
const req = (path = 'https://x/admin') => new Request(path);

test('lists pending submissions and escapes untrusted fields', async () => {
  const db = dbWith([
    { id: 'a1', created_at: 1, category: 'Cars', level: 'MED', title: '<script>alert(1)</script>', body: 'hi', sources: '[]', contributor: null, anonymous: 1 },
  ]);
  const res = await onRequestGet({ request: req(), env: { DB: db } });
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).not.toContain('<script>alert(1)</script>');
  expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  expect(html).toContain('action="/admin/approve"');
  expect(html).toContain('value="a1"');
});

test.each([
  ['null', null],
  ['undefined', undefined],
  ['empty string', ''],
])('renders a %s level as an empty value, not the literal string "null"', async (_label, level) => {
  const db = dbWith([
    { id: 'a2', created_at: 1, category: 'Cars', level, title: 'Title', body: 'hi', sources: '[]', contributor: 'Bob', anonymous: 0 },
  ]);
  const res = await onRequestGet({ request: req(), env: { DB: db } });
  const html = await res.text();
  expect(html).not.toContain('null');
  expect(html).toContain('<p><strong>Cars</strong> &middot;  &middot; by Bob</p>');
});

test('returns 403 when the gate denies', async () => {
  vi.mocked(requireModerator).mockResolvedValue(new Response('Forbidden', { status: 403 }));
  const res = await onRequestGet({ request: req(), env: { DB: dbWith([]) } });
  expect(res.status).toBe(403);
});

test('search/filter query params are bound into the WHERE clause with pending status', async () => {
  const db = dbWith([]);
  await onRequestGet({ request: req('https://x/admin?q=foo&category=Cars&level=LOW&sort=oldest'), env: { DB: db } });
  const selectCall = db.calls.find((c) => c.sql.includes('SELECT id'));
  expect(selectCall!.sql).toContain("status = 'pending'");
  expect(selectCall!.sql).toContain('LIKE');
  expect(selectCall!.sql).toContain('ORDER BY created_at ASC');
  expect(selectCall!.args).toEqual(['%foo%', '%foo%', 'Cars', 'LOW', 25, 0]);
});

test('the queue page includes the nav, filter form, checkboxes, and bulk-action buttons', async () => {
  const db = dbWith([
    { id: 'a1', created_at: 1, category: 'Cars', level: 'LOW', title: 'T', body: 'b', sources: '[]', contributor: null, anonymous: 1 },
  ]);
  const res = await onRequestGet({ request: req(), env: { DB: db } });
  const html = await res.text();
  expect(html).toContain('aria-current="page"'); // nav
  expect(html).toContain('class="admin-filters"');
  expect(html).toContain('type="checkbox" name="id" value="a1" form="bulk-form"');
  expect(html).toContain('formaction="/admin/approve"');
  expect(html).toContain('formaction="/admin/reject"');
  expect(html).toContain('formaction="/admin/delete"');
  expect(html).toContain('<link rel="stylesheet" href="/admin.css">');
  expect(html).toContain('<script type="module" src="/admin.js"></script>');
});
