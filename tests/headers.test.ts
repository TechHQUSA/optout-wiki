// tests/headers.test.ts
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

test('_headers ships the exact CSP and no external hosts', () => {
  const h = readFileSync('public/_headers', 'utf8');
  expect(h).toContain("default-src 'self'");
  expect(h).toContain("font-src 'self'");
  // ALTCHA solves its proof-of-work in a Web Worker. We serve its worker
  // script same-origin (public/altcha-worker.js via the external build), so
  // worker-src must allow 'self' — without it the widget can never solve and
  // the contribute form silently rejects every submission.
  expect(h).toContain("worker-src 'self'");
  expect(h).not.toContain('worker-src \'self\' blob:'); // strict: no blob: needed with external worker
  expect(h).not.toContain('fonts.googleapis.com'); // fonts self-hosted
  expect(h).toContain('interest-cohort=()');       // no-FLoC
});
