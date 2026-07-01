-- migrations/0001_submissions.sql
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
  status      TEXT NOT NULL DEFAULT 'pending',
  ip_hash     TEXT
);
CREATE INDEX idx_submissions_status ON submissions(status);

CREATE TABLE rate_limits (
  ip_hash      TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL
);
