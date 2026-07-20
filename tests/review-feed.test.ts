// tests/review-feed.test.ts
// GET /api/review-feed — public open-review feed. The critical assertions
// are about what does NOT leak: software justification (body), anonymous
// contributor names, deleted comments, moderator/endorsement data.
import { expect, test } from 'vitest';
import { handleReviewFeed } from '../functions/api/review-feed.js';

function makeDb(subs: unknown[], comments: unknown[] = []) {
  const calls: { sql: string; args: unknown[] }[] = [];
  return {
    calls,
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          calls.push({ sql, args });
          return {
            async all() {
              if (sql.includes('FROM submissions')) return { results: subs };
              if (sql.includes('FROM comments')) return { results: comments };
              return { results: [] };
            },
          };
        },
      };
    },
  };
}

const guideRow = {
  id: 'g1', created_at: 10, type: 'guide', category: 'Cars', level: 'MED',
  title: 'Opt out of Foo', body: '1. do the thing', sources: '["https://a.example/x"]',
  contributor: 'Pat', anonymous: 0, url: null, tags: null, summary: null,
};
const softwareRow = {
  id: 's1', created_at: 20, type: 'software', category: 'Network', level: null,
  title: 'Mullvad', body: 'SECRET-JUSTIFICATION', sources: '["https://e.com/audit"]',
  contributor: 'Sam', anonymous: 1, url: 'https://mullvad.net', tags: '["vpn"]', summary: 'Anon VPN.',
};

test('guide rows expose draft body + sources; software rows expose url/summary/tags but never justification', async () => {
  const res = await handleReviewFeed({ DB: makeDb([softwareRow, guideRow]) });
  expect(res.status).toBe(200);
  const data = await res.json();
  const text = JSON.stringify(data);
  expect(text).not.toContain('SECRET-JUSTIFICATION');
  const sw = data.submissions.find((s: any) => s.id === 's1');
  expect(sw.url).toBe('https://mullvad.net');
  expect(sw.tags).toEqual(['vpn']);
  expect(sw.body).toBeUndefined();
  const g = data.submissions.find((s: any) => s.id === 'g1');
  expect(g.body).toBe('1. do the thing');
  expect(g.sources).toEqual(['https://a.example/x']);
});

test('anonymous contributor name never appears; non-anonymous does', async () => {
  const res = await handleReviewFeed({ DB: makeDb([softwareRow, guideRow]) });
  const data = await res.json();
  expect(JSON.stringify(data)).not.toContain('Sam'); // anonymous=1
  expect(data.submissions.find((s: any) => s.id === 'g1').contributor).toBe('Pat');
});

test('comments attach to their submission; deleted excluded by query filter', async () => {
  const comments = [
    { id: 'c1', submission_id: 'g1', created_at: 1, author: 'Rev', body: 'Link works.', source_flag: 0 },
    { id: 'c2', submission_id: 'g1', created_at: 2, author: null, body: 'No source for step 2', source_flag: 1 },
  ];
  const db = makeDb([guideRow], comments);
  const res = await handleReviewFeed({ DB: db });
  const data = await res.json();
  expect(data.submissions[0].comments).toHaveLength(2);
  expect(data.submissions[0].comments[1].source_flag).toBe(1);
  const commentSql = db.calls.find((c) => c.sql.includes('FROM comments'))!.sql;
  expect(commentSql).toContain('deleted = 0');
});

test('only pending status queried, LIMIT bound, cache-control no-store', async () => {
  const db = makeDb([]);
  const res = await handleReviewFeed({ DB: db });
  expect(res.headers.get('cache-control')).toBe('no-store');
  const subSql = db.calls.find((c) => c.sql.includes('FROM submissions'))!;
  expect(subSql.sql).toContain("status = 'pending'");
  expect(subSql.args).toContain(50);
  expect((await res.json()).submissions).toEqual([]);
});

test('malformed sources/tags JSON degrade to [] instead of throwing', async () => {
  const res = await handleReviewFeed({ DB: makeDb([{ ...guideRow, sources: 'not-json' }]) });
  const data = await res.json();
  expect(data.submissions[0].sources).toEqual([]);
});

test('D1 throw -> structured 503', async () => {
  const res = await handleReviewFeed({ DB: { prepare() { throw new Error('boom'); } } });
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ ok: false, error: 'unavailable' });
});
