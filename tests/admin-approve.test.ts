// tests/admin-approve.test.ts
import { expect, test, vi, beforeEach } from 'vitest';

vi.mock('../functions/_shared/access.js', () => ({
  requireModerator: vi.fn(async () => null),
  getModeratorEmail: vi.fn(async () => 'mod@example.com'),
}));
import { requireModerator, getModeratorEmail } from '../functions/_shared/access.js';
import { onRequestPost } from '../functions/admin/approve.js';

beforeEach(() => {
  vi.mocked(requireModerator).mockReset().mockResolvedValue(null);
  vi.mocked(getModeratorEmail).mockReset().mockResolvedValue('mod@example.com');
});

function makeDb(rowsById: Record<string, unknown>) {
  const calls: { sql: string; args: unknown[] }[] = [];
  return {
    calls,
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          calls.push({ sql, args });
          return {
            async run() {},
            async first() {
              if (!sql.trim().startsWith('SELECT')) return null;
              const id = args[args.length - 1];
              return rowsById[id as string] ?? null;
            },
          };
        },
      };
    },
  };
}

function form(...ids: string[]) {
  const body = new URLSearchParams();
  for (const id of ids) body.append('id', id);
  return new Request('https://x/admin/approve', { method: 'POST', body });
}

test('approve updates status, writes the audit columns, and returns the generated markdown', async () => {
  const db = makeDb({ a1: { title: 'Opt out of Foo', category: 'Cars', level: 'MED', body: 'steps', sources: '["https://a.example/x"]' } });
  const res = await onRequestPost({ request: form('a1'), env: { DB: db } });
  expect(res.status).toBe(200);
  const updateCall = db.calls.find((c) => c.sql.startsWith("UPDATE submissions SET status = 'approved'"));
  expect(updateCall).toBeDefined();
  expect(updateCall!.args).toEqual(['mod@example.com', expect.any(Number), 'a1']);
  const html = await res.text();
  expect(html).toContain('opt-out-of-foo.md');
  expect(html).toContain('summary: &quot;[ADD SUMMARY]&quot;');
});

test('approve accepts multiple ids and renders one block per approved submission', async () => {
  const db = makeDb({
    a1: { title: 'Guide One', category: 'Cars', level: 'LOW', body: 'b1', sources: '[]' },
    a2: { title: 'Guide Two', category: 'Phones', level: 'MED', body: 'b2', sources: '[]' },
  });
  const res = await onRequestPost({ request: form('a1', 'a2'), env: { DB: db } });
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain('guide-one.md');
  expect(html).toContain('guide-two.md');
  expect(html).toContain('Approved (2)');
});

test('approve skips ids with no matching row but still succeeds for the ones that exist', async () => {
  const db = makeDb({ a1: { title: 'Real Guide', category: 'Cars', level: 'LOW', body: 'b', sources: '[]' } });
  const res = await onRequestPost({ request: form('a1', 'gone'), env: { DB: db } });
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain('real-guide.md');
  expect(html).toContain('Approved (1)');
});

test('approve without any id is a 400', async () => {
  const res = await onRequestPost({ request: form(), env: { DB: makeDb({}) } });
  expect(res.status).toBe(400);
});

test('approve where every id is missing is a 404', async () => {
  const res = await onRequestPost({ request: form('gone'), env: { DB: makeDb({}) } });
  expect(res.status).toBe(404);
});

test('approve returns the 403 when the gate denies, and never touches the DB', async () => {
  vi.mocked(requireModerator).mockResolvedValue(new Response('Forbidden', { status: 403 }));
  const db = makeDb({ a1: { title: 'x', category: 'Cars', level: 'LOW', body: 'b', sources: '[]' } });
  const res = await onRequestPost({ request: form('a1'), env: { DB: db } });
  expect(res.status).toBe(403);
  expect(db.calls).toHaveLength(0);
});
