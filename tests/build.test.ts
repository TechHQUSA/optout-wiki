// tests/build.test.ts
import { existsSync } from 'node:fs';
import { expect, test } from 'vitest';

// The build itself runs once in globalSetup (tests/setup/sync-content.ts),
// before the parallel test phase — so these are pure assertions on its output,
// not their own builds. That keeps the build from racing the Container-API
// tests that read the content store while `astro build` re-syncs it.
test('astro build produces dist/index.html', () => {
  expect(existsSync('dist/index.html')).toBe(true);
});

test('astro build emits dist/404.html (the file Cloudflare Pages looks for)', () => {
  // Cloudflare Pages serves a top-level 404.html (with a real 404 status) for
  // any unmatched path; without it the platform soft-404s to the homepage.
  expect(existsSync('dist/404.html')).toBe(true);
});
