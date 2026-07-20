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

test('software rows render badge, url/summary/tags, justification and evidence — all escaped', async () => {
  const db = dbWith([
    {
      id: 's1', created_at: 1, type: 'software', category: 'Network', level: null,
      title: 'Mullvad', body: 'why: <b>good</b>', sources: '["https://e.com/audit"]',
      contributor: null, anonymous: 1,
      url: 'https://mullvad.net/"><script>x</script>', tags: '["vpn","<i>"]', summary: 'Sum <script>',
    },
  ]);
  const res = await onRequestGet({ request: req(), env: { DB: db } });
  const html = await res.text();
  expect(html).toContain('[software]');
  expect(html).not.toContain('<script>x</script>');
  expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
  expect(html).toContain('Sum &lt;script&gt;');
  expect(html).toContain('why: &lt;b&gt;good&lt;/b&gt;');
  expect(html).toContain('https://e.com/audit');
  expect(html).toContain('vpn');
});

test('guide rows render a [guide] badge and no software fields', async () => {
  const db = dbWith([
    { id: 'a1', created_at: 1, type: 'guide', category: 'Cars', level: 'MED', title: 'T', body: 'B', sources: '[]', contributor: null, anonymous: 1, url: null, tags: null, summary: null },
  ]);
  const res = await onRequestGet({ request: req(), env: { DB: db } });
  const html = await res.text();
  expect(html).toContain('[guide]');
  expect(html).not.toContain('[software]');
});

test('queue SELECT includes the software columns', async () => {
  const db = dbWith([]);
  await onRequestGet({ request: req(), env: { DB: db } });
  const selectCall = db.calls.find((c) => c.sql.includes('SELECT id'));
  expect(selectCall!.sql).toContain('type');
  expect(selectCall!.sql).toContain('url');
  expect(selectCall!.sql).toContain('tags');
  expect(selectCall!.sql).toContain('summary');
});

test('queue shows endorsement count, hardening checkboxes, and bulk-bar checklist', async () => {
  const db = dbWith([
    { id: 'a1', created_at: 1, type: 'guide', category: 'Cars', level: 'MED', title: 'T', body: 'B', sources: '[]', contributor: null, anonymous: 1, endorsement_count: 1 },
  ]);
  const res = await onRequestGet({ request: req(), env: { DB: db, MIN_APPROVALS: '2' } });
  const html = await res.text();
  expect(html).toContain('endorsements: 1/2');
  expect(html).toContain('name="harden-stripped"');
  expect(html).toContain('name="harden-tradeoffs"');
  expect(html).toContain('name="harden-dated"');
  expect(html).toContain('form="bulk-form" value="on"'); // bulk-bar copies
});

test('queue renders open-review comments escaped, with flag highlight and delete form', async () => {
  const comments = [
    { id: 'c1', submission_id: 'a1', created_at: 1, author: '<b>Evil</b>', body: '<script>x</script>', source_flag: 1 },
  ];
  const db = {
    calls: [] as { sql: string; args: unknown[] }[],
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          (db as any).calls.push({ sql, args });
          return {
            async all() {
              if (sql.includes('FROM comments')) return { results: comments };
              return { results: [{ id: 'a1', created_at: 1, type: 'guide', category: 'Cars', level: 'MED', title: 'T', body: 'B', sources: '[]', contributor: null, anonymous: 1, endorsement_count: 0 }] };
            },
            async first() { return { n: 1 }; },
          };
        },
      };
    },
  };
  const res = await onRequestGet({ request: req(), env: { DB: db } });
  const html = await res.text();
  expect(html).toContain('Review comments (1)');
  expect(html).not.toContain('<script>x</script>');
  expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
  expect(html).toContain('admin-comment-flag');
  expect(html).toContain('action="/admin/delete-comment"');
  const commentSql = (db as any).calls.find((c: any) => c.sql.includes('FROM comments')).sql;
  expect(commentSql).toContain('deleted = 0');
});

test('queue renders the due-re-verification section from stale-guides.json via ASSETS', async () => {
  const db = dbWith([]);
  const env = {
    DB: db,
    ASSETS: {
      async fetch() {
        return new Response(JSON.stringify({ stale: [{ slug: 'old-guide', lastVerified: '2026-01-01', days: 200 }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    },
  };
  const res = await onRequestGet({ request: req(), env });
  const html = await res.text();
  expect(html).toContain('Due re-verification (1)');
  expect(html).toContain('old-guide');
});

test('queue survives a missing/broken ASSETS binding (stale section omitted)', async () => {
  const db = dbWith([]);
  const res = await onRequestGet({ request: req(), env: { DB: db } }); // no ASSETS at all
  expect(res.status).toBe(200);
  expect(await res.text()).not.toContain('Due re-verification');
});
