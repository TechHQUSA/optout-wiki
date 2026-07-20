// tests/migration.test.ts
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

test('migration SQL defines both tables and status index', () => {
  const sql = readFileSync('migrations/0001_submissions.sql', 'utf8');
  expect(sql).toMatch(/CREATE TABLE submissions/);
  expect(sql).toMatch(/CREATE TABLE rate_limits/);
  expect(sql).toMatch(/idx_submissions_status/);
  expect(sql).not.toMatch(/\bip\b\s+TEXT/); // no raw ip column
});

test('submissions table stores no ip_hash (anonymity: no per-submission IP linkage)', () => {
  const sql = readFileSync('migrations/0001_submissions.sql', 'utf8');
  const submissionsBlock = sql.match(/CREATE TABLE submissions \(([\s\S]*?)\);/)?.[1] ?? '';
  expect(submissionsBlock).not.toMatch(/ip_hash/);
  // rate_limits still keys on ip_hash — the rate limiter genuinely needs it.
  expect(sql).toMatch(/CREATE TABLE rate_limits[\s\S]*ip_hash\s+TEXT PRIMARY KEY/);
});

test('spent-altcha migration defines the single-use nonce table', () => {
  const sql = readFileSync('migrations/0002_spent_altcha.sql', 'utf8');
  expect(sql).toMatch(/CREATE TABLE spent_altcha_signatures/);
  expect(sql).toMatch(/signature\s+TEXT\s+PRIMARY KEY/); // enforces single-use via uniqueness
  expect(sql).toMatch(/spent_at\s+INTEGER NOT NULL/);
});

test('moderation-audit migration adds moderated_by/moderated_at columns to submissions', () => {
  const sql = readFileSync('migrations/0003_moderation_audit.sql', 'utf8');
  expect(sql).toMatch(/ALTER TABLE submissions ADD COLUMN moderated_by TEXT/);
  expect(sql).toMatch(/ALTER TABLE submissions ADD COLUMN moderated_at INTEGER/);
});

test('open-review migration defines comments + endorsements and hardening audit columns', () => {
  const sql = readFileSync('migrations/0005_open_review.sql', 'utf8');
  expect(sql).toMatch(/CREATE TABLE comments/);
  expect(sql).toMatch(/idx_comments_submission/);
  expect(sql).toMatch(/CREATE TABLE endorsements/);
  // distinct-editor guarantee lives in the schema: PK over (submission, moderator)
  expect(sql).toMatch(/PRIMARY KEY \(submission_id, moderator\)/);
  expect(sql).toMatch(/ALTER TABLE submissions ADD COLUMN hardened_by TEXT/);
  expect(sql).toMatch(/ALTER TABLE submissions ADD COLUMN hardened_at INTEGER/);
  // comments carry no IP-derived value (anonymity parity with submissions)
  const commentsBlock = sql.match(/CREATE TABLE comments \(([\s\S]*?)\);/)?.[1] ?? '';
  expect(commentsBlock).not.toMatch(/ip/i);
});

test('software-submissions migration adds type/url/tags/summary columns and type index', () => {
  const sql = readFileSync('migrations/0004_software_submissions.sql', 'utf8');
  expect(sql).toMatch(/ALTER TABLE submissions ADD COLUMN type TEXT NOT NULL DEFAULT 'guide'/);
  expect(sql).toMatch(/ALTER TABLE submissions ADD COLUMN url TEXT/);
  expect(sql).toMatch(/ALTER TABLE submissions ADD COLUMN tags TEXT/);
  expect(sql).toMatch(/ALTER TABLE submissions ADD COLUMN summary TEXT/);
  expect(sql).toMatch(/CREATE INDEX idx_submissions_type ON submissions\(type\)/);
  // guides-only column must not sneak in a NOT NULL without default (ALTER would fail on existing rows)
  expect(sql).not.toMatch(/url TEXT NOT NULL/);
});
