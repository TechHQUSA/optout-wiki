// tests/admin-approve.test.ts
// POST /admin/approve — endorse-then-finalize (stages 3+4).
// makeDb simulates the endorsement ledger (a Set per submission, mirroring
// the (submission, moderator) PRIMARY KEY's distinct-editor guarantee) so
// threshold behavior is exercised without a real D1.
import { expect, test, vi, beforeEach } from 'vitest';

vi.mock('../functions/_shared/access.js', () => ({
  requireModerator: vi.fn(async () => null),
  getModeratorEmail: vi.fn(async () => 'mod@example.com'),
}));
import { requireModerator, getModeratorEmail } from '../functions/_shared/access.js';
import { onRequestPost, minApprovals } from '../functions/admin/approve.js';

beforeEach(() => {
  vi.mocked(requireModerator).mockReset().mockResolvedValue(null);
  vi.mocked(getModeratorEmail).mockReset().mockResolvedValue('mod@example.com');
});

type Row = Record<string, unknown> & { status?: string };

function makeDb(rowsById: Record<string, Row>) {
  const calls: { sql: string; args: unknown[] }[] = [];
  const ledger = new Map<string, Set<string>>();
  return {
    calls,
    ledger,
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          calls.push({ sql, args });
          return {
            async run() {
              if (sql.startsWith('INSERT OR IGNORE INTO endorsements')) {
                const [subId, moderator] = args as [string, string];
                if (!ledger.has(subId)) ledger.set(subId, new Set());
                ledger.get(subId)!.add(moderator);
                return { meta: { changes: 1 } };
              }
              if (sql.startsWith('UPDATE submissions')) {
                const id = args[args.length - 1] as string;
                const row = rowsById[id];
                if (!row || (row.status ?? 'pending') !== 'pending') return { meta: { changes: 0 } };
                row.status = 'approved';
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 1 } };
            },
            async first() {
              const id = args[args.length - 1] as string;
              if (sql.startsWith('SELECT status FROM submissions')) {
                const row = rowsById[id];
                return row ? { status: row.status ?? 'pending' } : null;
              }
              if (sql.startsWith('SELECT COUNT(*) AS n FROM endorsements')) {
                return { n: ledger.get(id)?.size ?? 0 };
              }
              if (sql.trim().startsWith('SELECT')) return rowsById[id] ?? null;
              return null;
            },
          };
        },
      };
    },
  };
}

// Default form: ids + full hardening checklist (the common finalize case).
function form(...ids: string[]) {
  const body = new URLSearchParams();
  for (const id of ids) body.append('id', id);
  for (const f of ['harden-stripped', 'harden-tradeoffs', 'harden-dated']) body.append(f, 'on');
  return new Request('https://x/admin/approve', { method: 'POST', body });
}

// Endorse-only form: no hardening checklist.
function bareForm(...ids: string[]) {
  const body = new URLSearchParams();
  for (const id of ids) body.append('id', id);
  return new Request('https://x/admin/approve', { method: 'POST', body });
}

// MIN_APPROVALS='1': single-moderator finalize (production's initial mode).
const env1 = (db: unknown) => ({ DB: db, MIN_APPROVALS: '1' });

test('minApprovals: default 2, env override, garbage falls back to 2', () => {
  expect(minApprovals({})).toBe(2);
  expect(minApprovals({ MIN_APPROVALS: '1' })).toBe(1);
  expect(minApprovals({ MIN_APPROVALS: '3' })).toBe(3);
  expect(minApprovals({ MIN_APPROVALS: '0' })).toBe(2);
  expect(minApprovals({ MIN_APPROVALS: 'lots' })).toBe(2);
});

test('MIN_APPROVALS=1: approve finalizes, writes audit + hardening columns, returns markdown', async () => {
  const db = makeDb({ a1: { title: 'Opt out of Foo', category: 'Cars', level: 'MED', body: 'steps', sources: '["https://a.example/x"]' } });
  const res = await onRequestPost({ request: form('a1'), env: env1(db) });
  expect(res.status).toBe(200);
  const updateCall = db.calls.find((c) => c.sql.startsWith('UPDATE submissions'));
  expect(updateCall!.sql).toContain("AND status = 'pending'");
  expect(updateCall!.sql).toContain('hardened_by');
  expect(updateCall!.args).toEqual(['mod@example.com', expect.any(Number), 'mod@example.com', expect.any(Number), 'a1']);
  const html = await res.text();
  expect(html).toContain('opt-out-of-foo.md');
  expect(html).toContain('summary: &quot;[ADD SUMMARY]&quot;');
});

test('default threshold (2): first approve endorses but does NOT finalize', async () => {
  const db = makeDb({ a1: { title: 'G', category: 'Cars', level: 'LOW', body: 'b', sources: '[]' } });
  const res = await onRequestPost({ request: form('a1'), env: { DB: db } });
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain('endorsed 1/2');
  expect(html).not.toContain('.md'); // no scaffold yet
  expect(db.calls.some((c) => c.sql.startsWith('UPDATE submissions'))).toBe(false);
});

test('same editor approving twice never double-counts (ledger PK semantics)', async () => {
  const db = makeDb({ a1: { title: 'G', category: 'Cars', level: 'LOW', body: 'b', sources: '[]' } });
  await onRequestPost({ request: form('a1'), env: { DB: db } });
  const res = await onRequestPost({ request: form('a1'), env: { DB: db } });
  const html = await res.text();
  expect(html).toContain('endorsed 1/2'); // still 1, not 2
});

test('second distinct editor finalizes at threshold 2', async () => {
  const db = makeDb({ a1: { title: 'Two Editor Guide', category: 'Cars', level: 'LOW', body: 'b', sources: '[]' } });
  await onRequestPost({ request: form('a1'), env: { DB: db } });
  vi.mocked(getModeratorEmail).mockResolvedValue('second@example.com');
  const res = await onRequestPost({ request: form('a1'), env: { DB: db } });
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain('two-editor-guide.md');
});

test('hardening gate: at threshold without the checklist -> 400, endorsement kept, not approved', async () => {
  const db = makeDb({ a1: { title: 'G', category: 'Cars', level: 'LOW', body: 'b', sources: '[]' } });
  const res = await onRequestPost({ request: bareForm('a1'), env: env1(db) });
  expect(res.status).toBe(400);
  const html = await res.text();
  expect(html).toContain('Hardening checklist required');
  expect(db.ledger.get('a1')?.size).toBe(1); // endorsement recorded anyway
  expect(db.calls.some((c) => c.sql.startsWith('UPDATE submissions'))).toBe(false);
});

test('hardening gate not required for a below-threshold endorsement', async () => {
  const db = makeDb({ a1: { title: 'G', category: 'Cars', level: 'LOW', body: 'b', sources: '[]' } });
  const res = await onRequestPost({ request: bareForm('a1'), env: { DB: db } }); // default min 2
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('endorsed 1/2');
});

test('approve accepts multiple ids and renders one block per finalized submission', async () => {
  const db = makeDb({
    a1: { title: 'Guide One', category: 'Cars', level: 'LOW', body: 'b1', sources: '[]' },
    a2: { title: 'Guide Two', category: 'Phones', level: 'MED', body: 'b2', sources: '[]' },
  });
  const res = await onRequestPost({ request: form('a1', 'a2'), env: env1(db) });
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain('guide-one.md');
  expect(html).toContain('guide-two.md');
  expect(html).toContain('Approved (2)');
});

test('approve skips ids with no matching row but still succeeds for the ones that exist', async () => {
  const db = makeDb({ a1: { title: 'Real Guide', category: 'Cars', level: 'LOW', body: 'b', sources: '[]' } });
  const res = await onRequestPost({ request: form('a1', 'gone'), env: env1(db) });
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain('real-guide.md');
  expect(html).toContain('Approved (1)');
});

test('approve without any id is a 400', async () => {
  const res = await onRequestPost({ request: form(), env: env1(makeDb({})) });
  expect(res.status).toBe(400);
});

test('approve where every id is missing is a 404', async () => {
  const res = await onRequestPost({ request: form('nope'), env: env1(makeDb({})) });
  expect(res.status).toBe(404);
});

test('approve returns the 403 when the gate denies, and never touches the DB', async () => {
  vi.mocked(requireModerator).mockResolvedValue(new Response('Forbidden', { status: 403 }));
  const db = makeDb({});
  const res = await onRequestPost({ request: form('a1'), env: env1(db) });
  expect(res.status).toBe(403);
  expect(db.calls.length).toBe(0);
});

test('approving an already-moderated id endorses nothing and 404s when nothing else', async () => {
  const db = makeDb({ a1: { status: 'approved', title: 'G', category: 'Cars', level: 'LOW', body: 'b', sources: '[]' } });
  const res = await onRequestPost({ request: form('a1'), env: env1(db) });
  expect(res.status).toBe(404);
  expect(db.ledger.has('a1')).toBe(false); // no endorsement for a moderated row
});

test('approving a software submission renders a commit-ready software.json entry', async () => {
  const db = makeDb({
    s1: {
      type: 'software', title: 'Mullvad VPN', category: 'Network', level: null, body: 'why',
      sources: '["https://e.com/audit"]', url: 'https://mullvad.net', tags: '["vpn"]', summary: 'Anon VPN.',
    },
  });
  const res = await onRequestPost({ request: form('s1'), env: env1(db) });
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain('src/content/software/software.json');
  expect(html).toContain('&quot;id&quot;: &quot;mullvad-vpn&quot;');
  expect(html).not.toContain('mullvad-vpn.md');
});

test('mixed bulk approve renders a markdown block for the guide and a JSON block for the software row', async () => {
  const db = makeDb({
    a1: { type: 'guide', title: 'Guide One', category: 'Cars', level: 'LOW', body: 'b1', sources: '[]' },
    s1: { type: 'software', title: 'Tool One', category: 'OS', level: null, body: 'j', sources: '[]', url: 'https://t.one', tags: '[]', summary: 'S.' },
  });
  const res = await onRequestPost({ request: form('a1', 's1'), env: env1(db) });
  const html = await res.text();
  expect(html).toContain('guide-one.md');
  expect(html).toContain('src/content/software/software.json');
  expect(html).toContain('Approved (2)');
});

test('approve result page carries a <title>', async () => {
  const db = makeDb({ a1: { title: 'G', category: 'Cars', level: 'LOW', body: 'b', sources: '[]' } });
  const res = await onRequestPost({ request: form('a1'), env: env1(db) });
  expect(await res.text()).toContain('<title>Approve result</title>');
});
