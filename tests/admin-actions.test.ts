// tests/admin-actions.test.ts
import { expect, test, vi, beforeEach } from 'vitest';

vi.mock('../functions/_shared/access.js', () => ({
  requireModerator: vi.fn(async () => null),
}));
import { requireModerator } from '../functions/_shared/access.js';
import { onRequestPost as reject } from '../functions/admin/reject.js';
import { onRequestPost as del } from '../functions/admin/delete.js';

beforeEach(() => vi.mocked(requireModerator).mockReset().mockResolvedValue(null));

function makeDb() {
  const calls: string[] = [];
  return {
    calls,
    prepare(sql: string) {
      calls.push(sql);
      return { bind() { return { async run() {} }; } };
    },
  };
}
function form(id: string | null, path: string) {
  const body = new URLSearchParams();
  if (id !== null) body.set('id', id);
  return new Request(`https://x${path}`, { method: 'POST', body });
}

test('reject sets status=rejected and 303-redirects to /admin', async () => {
  const db = makeDb();
  const res = await reject({ request: form('a1', '/admin/reject'), env: { DB: db } });
  expect(res.status).toBe(303);
  expect(res.headers.get('location')).toBe('https://x/admin');
  expect(db.calls.some((s) => s.startsWith("UPDATE submissions SET status = 'rejected'"))).toBe(true);
});

test('delete hard-removes the row and 303-redirects to /admin', async () => {
  const db = makeDb();
  const res = await del({ request: form('a1', '/admin/delete'), env: { DB: db } });
  expect(res.status).toBe(303);
  expect(db.calls.some((s) => s.startsWith('DELETE FROM submissions'))).toBe(true);
});

test('both reject and delete 400 without an id', async () => {
  expect((await reject({ request: form(null, '/admin/reject'), env: { DB: makeDb() } })).status).toBe(400);
  expect((await del({ request: form(null, '/admin/delete'), env: { DB: makeDb() } })).status).toBe(400);
});

test('reject and delete return the 403 when the gate denies', async () => {
  vi.mocked(requireModerator).mockResolvedValue(new Response('Forbidden', { status: 403 }));
  expect((await reject({ request: form('a1', '/admin/reject'), env: { DB: makeDb() } })).status).toBe(403);
  expect((await del({ request: form('a1', '/admin/delete'), env: { DB: makeDb() } })).status).toBe(403);
});
