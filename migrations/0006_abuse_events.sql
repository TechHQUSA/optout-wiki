-- migrations/0006_abuse_events.sql
-- Bot/abuse-signal event log (Project B backlog item). Deliberately narrow:
-- only the 3 rejection reasons that actually indicate automated/malicious
-- traffic get a row (honeypot trip, failed ALTCHA solve, rate-limit 429) —
-- plain validation errors are noise, not attacks, and are never logged. No
-- ip_hash column: same anonymity stance as submissions/comments (see
-- 0001_submissions.sql, 0005_open_review.sql) — this answers "is abuse
-- happening and how much," not "who". Retention: /admin/abuse opportunistically
-- deletes rows older than 90 days on load (see sweepStaleAbuseEvents in
-- functions/_shared/abuse.js) — no Cron Trigger wired for this project.
CREATE TABLE abuse_events (
  type       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_abuse_events_created_at ON abuse_events(created_at);
