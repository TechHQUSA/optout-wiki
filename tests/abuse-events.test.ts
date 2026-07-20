// tests/abuse-events.test.ts
import { expect, test } from 'vitest';
import { recordAbuseEvent, sweepStaleAbuseEvents, pivotAbuseEvents } from '../functions/_shared/abuse.js';

function trackingDb() {
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

function throwingDb() {
  return {
    prepare() {
      return {
        bind() {
          return {
            async run() {
              throw new Error('d1 down');
            },
          };
        },
      };
    },
  };
}

test('recordAbuseEvent inserts type and created_at', async () => {
  const db = trackingDb();
  await recordAbuseEvent(db, 'honeypot', 1000);
  expect(db.calls).toHaveLength(1);
  expect(db.calls[0].sql).toContain('INSERT INTO abuse_events');
  expect(db.calls[0].args).toEqual(['honeypot', 1000]);
});

test('recordAbuseEvent swallows a D1 failure without throwing', async () => {
  await expect(recordAbuseEvent(throwingDb(), 'rate', 1000)).resolves.toBeUndefined();
});

test('sweepStaleAbuseEvents deletes rows older than the default 90-day cutoff', async () => {
  const db = trackingDb();
  const now = 1_000_000_000_000;
  await sweepStaleAbuseEvents(db, now);
  expect(db.calls).toHaveLength(1);
  expect(db.calls[0].sql).toContain('DELETE FROM abuse_events WHERE created_at < ?');
  expect(db.calls[0].args).toEqual([now - 90 * 24 * 60 * 60 * 1000]);
});

test('sweepStaleAbuseEvents accepts a custom staleMs', async () => {
  const db = trackingDb();
  await sweepStaleAbuseEvents(db, 10_000, 1_000);
  expect(db.calls[0].args).toEqual([9_000]);
});

test('sweepStaleAbuseEvents swallows a D1 failure without throwing', async () => {
  await expect(sweepStaleAbuseEvents(throwingDb(), 1000)).resolves.toBeUndefined();
});

test('pivotAbuseEvents groups flat rows by day into honeypot/altcha/rate/total', () => {
  const rows = [
    { day: '2026-07-20', type: 'honeypot', n: 3 },
    { day: '2026-07-20', type: 'rate', n: 2 },
    { day: '2026-07-19', type: 'rate', n: 5 },
  ];
  expect(pivotAbuseEvents(rows)).toEqual([
    { day: '2026-07-20', honeypot: 3, altcha: 0, rate: 2, total: 5 },
    { day: '2026-07-19', honeypot: 0, altcha: 0, rate: 5, total: 5 },
  ]);
});

test('pivotAbuseEvents returns an empty array for no rows', () => {
  expect(pivotAbuseEvents([])).toEqual([]);
});

test('pivotAbuseEvents ignores an unrecognized type rather than throwing', () => {
  const rows = [{ day: '2026-07-20', type: 'unexpected', n: 9 }];
  expect(pivotAbuseEvents(rows)).toEqual([{ day: '2026-07-20', honeypot: 0, altcha: 0, rate: 0, total: 0 }]);
});
