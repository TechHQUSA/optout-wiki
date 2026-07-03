// tests/admin-approve.test.ts
import { expect, test, vi, beforeEach } from 'vitest';

vi.mock('../functions/_shared/access.js', () => ({
  requireModerator: vi.fn(async () => null),
}));
import { requireModerator } from '../functions/_shared/access.js';
import { onRequestPost } from '../functions/admin/approve.js';

beforeEach(() => vi.mocked(requireModerator).mockReset().mockResolvedValue(null));

function makeDb(row: unknown) {
  const calls: string[] = [];
  const db = {
    calls,
    prepare(sql: string) {
      calls.push(sql);
      return {
        bind() {
          return {
            async run() {},
            async first() { return row; },
          };
        },
      };
    },
  };
  return db;
}

function form(id: string | null) {
  const body = new URLSearchParams();
  if (id !== null) body.set('id', id);
  return new Request('https://x/admin/approve', { method: 'POST', body });
}

test('approve updates status and returns the generated markdown', async () => {
  const db = makeDb({ title: 'Opt out of Foo', category: 'Cars', level: 'MED', body: 'steps', sources: '["https://a.example/x"]' });
  const res = await onRequestPost({ request: form('a1'), env: { DB: db } });
  expect(res.status).toBe(200);
  expect(db.calls.some((s) => s.startsWith("UPDATE submissions SET status = 'approved'"))).toBe(true);
  const html = await res.text();
  expect(html).toContain('opt-out-of-foo.md');
  expect(html).toContain('summary: &quot;[ADD SUMMARY]&quot;'); // markdown is HTML-escaped in the textarea
});

test('approve without an id is a 400', async () => {
  const res = await onRequestPost({ request: form(null), env: { DB: makeDb(null) } });
  expect(res.status).toBe(400);
});

test('approve of a missing row is a 404', async () => {
  const res = await onRequestPost({ request: form('gone'), env: { DB: makeDb(null) } });
  expect(res.status).toBe(404);
});

test('approve returns the 403 when the gate denies', async () => {
  vi.mocked(requireModerator).mockResolvedValue(new Response('Forbidden', { status: 403 }));
  const res = await onRequestPost({ request: form('a1'), env: { DB: makeDb({ title: 'x', category: 'Cars', level: 'MED', body: 'b', sources: '[]' }) } });
  expect(res.status).toBe(403);
});
