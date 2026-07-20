// tests/admin-delete-comment.test.ts
import { expect, test, vi, beforeEach } from 'vitest';

vi.mock('../functions/_shared/access.js', () => ({
  requireModerator: vi.fn(async () => null),
}));
import { requireModerator } from '../functions/_shared/access.js';
import { onRequestPost } from '../functions/admin/delete-comment.js';

beforeEach(() => vi.mocked(requireModerator).mockReset().mockResolvedValue(null));

function makeDb() {
  const calls: { sql: string; args: unknown[] }[] = [];
  return {
    calls,
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          calls.push({ sql, args });
          return { async run() {} };
        },
      };
    },
  };
}

function form(ids: string[]) {
  const body = new URLSearchParams();
  for (const id of ids) body.append('id', id);
  return new Request('https://x/admin/delete-comment', { method: 'POST', body });
}

test('soft-deletes each id and 303s back to /admin', async () => {
  const db = makeDb();
  const res = await onRequestPost({ request: form(['c1', 'c2']), env: { DB: db } });
  expect(res.status).toBe(303);
  expect(res.headers.get('location')).toBe('https://x/admin');
  const updates = db.calls.filter((c) => c.sql === 'UPDATE comments SET deleted = 1 WHERE id = ?');
  expect(updates.map((c) => c.args[0])).toEqual(['c1', 'c2']);
  // soft delete only — never a DELETE statement
  expect(db.calls.some((c) => c.sql.startsWith('DELETE'))).toBe(false);
});

test('no ids -> 400, DB untouched', async () => {
  const db = makeDb();
  const res = await onRequestPost({ request: form([]), env: { DB: db } });
  expect(res.status).toBe(400);
  expect(db.calls.length).toBe(0);
});

test('gate denial -> 403, DB untouched', async () => {
  vi.mocked(requireModerator).mockResolvedValue(new Response('Forbidden', { status: 403 }));
  const db = makeDb();
  const res = await onRequestPost({ request: form(['c1']), env: { DB: db } });
  expect(res.status).toBe(403);
  expect(db.calls.length).toBe(0);
});

test('cross-site write -> 403', async () => {
  const body = new URLSearchParams({ id: 'c1' });
  const req = new Request('https://x/admin/delete-comment', {
    method: 'POST',
    body,
    headers: { 'sec-fetch-site': 'cross-site' },
  });
  const db = makeDb();
  const res = await onRequestPost({ request: req, env: { DB: db } });
  expect(res.status).toBe(403);
  expect(db.calls.length).toBe(0);
});
