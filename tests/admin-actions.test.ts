// tests/admin-actions.test.ts
import { expect, test, vi, beforeEach } from 'vitest';

vi.mock('../functions/_shared/access.js', () => ({
  requireModerator: vi.fn(async () => null),
  getModeratorEmail: vi.fn(async () => 'mod@example.com'),
}));
import { requireModerator, getModeratorEmail } from '../functions/_shared/access.js';
import { onRequestPost as reject } from '../functions/admin/reject.js';
import { onRequestPost as del } from '../functions/admin/delete.js';

beforeEach(() => {
  vi.mocked(requireModerator).mockReset().mockResolvedValue(null);
  vi.mocked(getModeratorEmail).mockReset().mockResolvedValue('mod@example.com');
});

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
function form(ids: string[], path: string) {
  const body = new URLSearchParams();
  for (const id of ids) body.append('id', id);
  return new Request(`https://x${path}`, { method: 'POST', body });
}

test('reject sets status=rejected, writes the audit columns, and 303-redirects to /admin', async () => {
  const db = makeDb();
  const res = await reject({ request: form(['a1'], '/admin/reject'), env: { DB: db } });
  expect(res.status).toBe(303);
  expect(res.headers.get('location')).toBe('https://x/admin');
  const call = db.calls.find((c) => c.sql.startsWith("UPDATE submissions SET status = 'rejected'"));
  expect(call).toBeDefined();
  expect(call!.args).toEqual(['mod@example.com', expect.any(Number), 'a1']);
});

test('reject accepts multiple ids and updates every one', async () => {
  const db = makeDb();
  const res = await reject({ request: form(['a1', 'a2', 'a3'], '/admin/reject'), env: { DB: db } });
  expect(res.status).toBe(303);
  const updates = db.calls.filter((c) => c.sql.startsWith("UPDATE submissions SET status = 'rejected'"));
  expect(updates).toHaveLength(3);
  expect(updates.map((c) => c.args[2])).toEqual(['a1', 'a2', 'a3']);
});

test('delete hard-removes multiple rows and 303-redirects to /admin', async () => {
  const db = makeDb();
  const res = await del({ request: form(['a1', 'a2'], '/admin/delete'), env: { DB: db } });
  expect(res.status).toBe(303);
  const deletes = db.calls.filter((c) => c.sql.startsWith('DELETE FROM submissions'));
  expect(deletes).toHaveLength(2);
});

test('delete never writes moderated_by/moderated_at (no audit trail for deletions)', async () => {
  const db = makeDb();
  await del({ request: form(['a1'], '/admin/delete'), env: { DB: db } });
  expect(db.calls.some((c) => c.sql.includes('moderated_by'))).toBe(false);
});

test('both reject and delete are 400 with no ids at all', async () => {
  expect((await reject({ request: form([], '/admin/reject'), env: { DB: makeDb() } })).status).toBe(400);
  expect((await del({ request: form([], '/admin/delete'), env: { DB: makeDb() } })).status).toBe(400);
});

test('reject and delete return the 403 when the gate denies, and never touch the DB', async () => {
  vi.mocked(requireModerator).mockResolvedValue(new Response('Forbidden', { status: 403 }));
  const rejectDb = makeDb();
  const deleteDb = makeDb();
  expect((await reject({ request: form(['a1'], '/admin/reject'), env: { DB: rejectDb } })).status).toBe(403);
  expect((await del({ request: form(['a1'], '/admin/delete'), env: { DB: deleteDb } })).status).toBe(403);
  expect(rejectDb.calls).toHaveLength(0);
  expect(deleteDb.calls).toHaveLength(0);
});

test('reject UPDATE carries AND status = pending (audit columns cannot be overwritten by re-moderation)', async () => {
  const db = makeDb();
  await reject({ request: form(['r1'], '/admin/reject'), env: { DB: db } });
  const updateCall = db.calls.find((c) => c.sql.startsWith('UPDATE submissions'));
  expect(updateCall!.sql).toContain("AND status = 'pending'");
});
