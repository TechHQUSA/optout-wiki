// tests/headers.test.ts
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

test('_headers ships the exact CSP and no external hosts', () => {
  const h = readFileSync('public/_headers', 'utf8');
  expect(h).toContain("default-src 'self'");
  expect(h).toContain("font-src 'self'");
  expect(h).not.toContain('fonts.googleapis.com'); // fonts self-hosted
  expect(h).toContain('interest-cohort=()');       // no-FLoC
});
