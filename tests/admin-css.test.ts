// tests/admin-css.test.ts
import { readFileSync, existsSync } from 'node:fs';
import { expect, test } from 'vitest';

test('public/admin.css exists and defines the shared color tokens', () => {
  expect(existsSync('public/admin.css')).toBe(true);
  const css = readFileSync('public/admin.css', 'utf8');
  expect(css).toContain('--accent');
  expect(css).toContain('--surface');
  expect(css).toContain('--border');
  expect(css).toContain('--ink');
});
