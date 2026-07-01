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
