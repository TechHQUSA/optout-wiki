// tests/admin-list.test.ts
import { expect, test, vi, beforeEach } from 'vitest';

vi.mock('../functions/_shared/access.js', () => ({
  requireModerator: vi.fn(async () => null), // authorized by default
}));
import { requireModerator } from '../functions/_shared/access.js';
import { onRequestGet } from '../functions/admin/index.js';

beforeEach(() => vi.mocked(requireModerator).mockReset().mockResolvedValue(null));

function dbWith(rows: unknown[]) {
  return {
    prepare() {
      return { async all() { return { results: rows }; } };
    },
  };
}
const req = () => new Request('https://x/admin');

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
