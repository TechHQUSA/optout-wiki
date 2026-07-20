// functions/_shared/abuse.js
// Bot/abuse-signal event log (Project B backlog item) + the pivot the
// /admin/abuse dashboard renders. Deliberately narrow: only the 3 rejection
// reasons that actually indicate automated/malicious traffic get logged
// (honeypot trip, failed ALTCHA solve, rate-limit 429) — plain validation
// errors (bad-json, invalid, too-long, bad-source) are noise from confused
// humans or minor client bugs, not attacks, and aren't logged here. No
// ip_hash: same anonymity stance as submissions/comments (see
// 0001_submissions.sql, 0005_open_review.sql) — this answers "is abuse
// happening and how much," not "who".

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

/**
 * Records one abuse-signal event. Fail-soft: a logging failure must never
 * surface to, or block, the caller's actual reject response.
 * @param {{prepare: (sql: string) => {bind: (...args: unknown[]) => {run: () => Promise<any>}}}} db D1-like binding
 * @param {'honeypot'|'altcha'|'rate'} type
 * @param {number} now current time in ms
 * @returns {Promise<void>}
 */
export async function recordAbuseEvent(db, type, now) {
  try {
    await db.prepare('INSERT INTO abuse_events (type, created_at) VALUES (?, ?)').bind(type, now).run();
  } catch {
    // best-effort only — never throws
  }
}

/**
 * Deletes abuse_events rows older than `staleMs` (default 90 days). Exported
 * separately so it's directly unit-testable — same pattern as
 * security.js's sweepStaleRateLimits. Fail-soft: a failed sweep must not
 * block rendering the /admin/abuse dashboard.
 * @param {{prepare: (sql: string) => {bind: (...args: unknown[]) => {run: () => Promise<any>}}}} db
 * @param {number} now
 * @param {number} [staleMs]
 * @returns {Promise<void>}
 */
export async function sweepStaleAbuseEvents(db, now, staleMs = RETENTION_MS) {
  try {
    await db.prepare('DELETE FROM abuse_events WHERE created_at < ?').bind(now - staleMs).run();
  } catch {
    // best-effort only — never throws
  }
}

/**
 * Pivots flat {day, type, n} rows (as returned by the grouped SQL query in
 * functions/admin/abuse.js) into one entry per day. Pure function — no D1,
 * unit-tests without a mock. An unrecognized `type` is ignored rather than
 * thrown on, so a future/unknown row shape can't 500 the dashboard.
 * @param {{day: string, type: string, n: number}[]} rows
 * @returns {{day: string, honeypot: number, altcha: number, rate: number, total: number}[]}
 */
export function pivotAbuseEvents(rows) {
  const byDay = new Map();
  for (const row of rows) {
    if (!byDay.has(row.day)) byDay.set(row.day, { day: row.day, honeypot: 0, altcha: 0, rate: 0, total: 0 });
    const entry = byDay.get(row.day);
    if (row.type === 'honeypot' || row.type === 'altcha' || row.type === 'rate') {
      entry[row.type] = row.n;
      entry.total += row.n;
    }
  }
  return [...byDay.values()];
}
