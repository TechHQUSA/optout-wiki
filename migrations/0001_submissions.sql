-- migrations/0001_submissions.sql
-- Deliberately NO ip_hash column on submissions: an IP-derived value stored on
-- every row (including "anonymous" ones) would let submissions be clustered by
-- origin, partially de-anonymizing contributors, and reverses to a real IP if
-- IP_SALT ever leaks (IPv4 is brute-forceable). The salted IP hash lives only
-- in rate_limits (below), where it's genuinely needed; it is never persisted
-- alongside submission content.
CREATE TABLE submissions (
  id          TEXT PRIMARY KEY,
  created_at  INTEGER NOT NULL,
  category    TEXT NOT NULL,
  level       TEXT,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  sources     TEXT,
  contributor TEXT,
  anonymous   INTEGER NOT NULL DEFAULT 1,
  status      TEXT NOT NULL DEFAULT 'pending'
);
CREATE INDEX idx_submissions_status ON submissions(status);

CREATE TABLE rate_limits (
  ip_hash      TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL
);
