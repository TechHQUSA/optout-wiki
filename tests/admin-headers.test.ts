// tests/admin-headers.test.ts
import { expect, test, vi, beforeEach } from 'vitest';

vi.mock('../functions/_shared/access.js', () => ({
  requireModerator: vi.fn(async () => null),
}));
import { requireModerator } from '../functions/_shared/access.js';
import { onRequestGet } from '../functions/admin/index.js';
import { onRequestPost as reject } from '../functions/admin/reject.js';

beforeEach(() => vi.mocked(requireModerator).mockReset().mockResolvedValue(null));

const listDb = { prepare: () => ({ all: async () => ({ results: [] }) }) };
const writeDb = { prepare: () => ({ bind: () => ({ run: async () => {} }) }) };

test('GET /admin response carries CSP + noindex security headers', async () => {
  const res = await onRequestGet({ request: new Request('https://x/admin'), env: { DB: listDb } });
  expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
  expect(res.headers.get('x-robots-tag')).toBe('noindex');
  expect(res.headers.get('x-content-type-options')).toBe('nosniff');
});

test('cross-site POST to /admin/reject is rejected with 403', async () => {
  const body = new URLSearchParams({ id: 'a1' });
  const req = new Request('https://x/admin/reject', {
    method: 'POST',
    headers: { 'sec-fetch-site': 'cross-site' },
    body,
  });
  const res = await reject({ request: req, env: { DB: writeDb } });
  expect(res.status).toBe(403);
});

test('same-origin POST to /admin/reject is allowed (303 redirect)', async () => {
  const body = new URLSearchParams({ id: 'a1' });
  const req = new Request('https://x/admin/reject', {
    method: 'POST',
    headers: { 'sec-fetch-site': 'same-origin' },
    body,
  });
  const res = await reject({ request: req, env: { DB: writeDb } });
  expect(res.status).toBe(303);
});

test('POST with neither sec-fetch-site nor origin header is currently allowed (documents fail-open fallback)', async () => {
  const body = new URLSearchParams({ id: 'a1' });
  const req = new Request('https://x/admin/reject', {
    method: 'POST',
    body,
  });
  const res = await reject({ request: req, env: { DB: writeDb } });
  expect(res.status).toBe(303);
});

test('POST with an origin header pointing to a different host is rejected with 403', async () => {
  const body = new URLSearchParams({ id: 'a1' });
  const req = new Request('https://x/admin/reject', {
    method: 'POST',
    headers: { origin: 'https://evil.example.com' },
    body,
  });
  const res = await reject({ request: req, env: { DB: writeDb } });
  expect(res.status).toBe(403);
});

test('POST with sec-fetch-site: same-site is treated as trusted (allowed)', async () => {
  const body = new URLSearchParams({ id: 'a1' });
  const req = new Request('https://x/admin/reject', {
    method: 'POST',
    headers: { 'sec-fetch-site': 'same-site' },
    body,
  });
  const res = await reject({ request: req, env: { DB: writeDb } });
  expect(res.status).toBe(303);
});

test('GET /admin response CSP allows same-origin script and style, nothing else new', async () => {
  const res = await onRequestGet({ request: new Request('https://x/admin'), env: { DB: listDb } });
  const csp = res.headers.get('content-security-policy') ?? '';
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("style-src 'self'");
  expect(csp).not.toContain('unsafe-inline');
  expect(csp).not.toContain('unsafe-eval');
});
