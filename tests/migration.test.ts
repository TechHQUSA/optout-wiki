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
