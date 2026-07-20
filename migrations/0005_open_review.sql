-- migrations/0005_open_review.sql
-- Open-review surface (pipeline stage 2) + two-editor endorsement (stage 3)
-- + hardening audit (stage 4).
--
-- comments: public comments/flags on pending submissions, posted through the
-- same ALTCHA/honeypot/rate-limit gates as submissions. Deliberately NO
-- ip-derived column (same anonymity stance as submissions — see
-- 0001_submissions.sql): the salted IP hash is used only for rate-limiting
-- in rate_limits, under a 'c:'-prefixed bucket key. Soft-delete via
-- `deleted` so moderation removes a comment from every render without
-- destroying the audit trail.
CREATE TABLE comments (
  id            TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  author        TEXT,
  body          TEXT NOT NULL,
  source_flag   INTEGER NOT NULL DEFAULT 0,
  deleted       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_comments_submission ON comments(submission_id, created_at);

-- endorsements: one row per (submission, moderator email) — the PRIMARY KEY
-- makes "the same editor endorsing twice" a no-op at the schema level, so
-- MIN_APPROVALS counts distinct editors by construction.
CREATE TABLE endorsements (
  submission_id TEXT NOT NULL,
  moderator     TEXT NOT NULL,
  endorsed_at   INTEGER NOT NULL,
  PRIMARY KEY (submission_id, moderator)
);

-- Hardening gate audit (stage 4): who confirmed the hardening checklist on
-- the finalizing approval, and when.
ALTER TABLE submissions ADD COLUMN hardened_by TEXT;
ALTER TABLE submissions ADD COLUMN hardened_at INTEGER;
