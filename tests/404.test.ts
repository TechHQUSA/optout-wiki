// tests/404.test.ts
//
// Cloudflare Pages natively recognizes a `404.html` at any directory level
// and serves it (with a real HTTP 404 status) for any unmatched static
// asset path — no _redirects rule needed. Without this file the platform
// falls back to serving the site's actual homepage content for a typo'd or
// stale URL (a soft-404: 200 OK with the wrong page), which is what this
// guards against.
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { expect, test } from 'vitest';
import NotFound from '../src/pages/404.astro';

test('404 page renders a clear not-found message and a way back', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(NotFound);
  expect(html).toContain('404');
  expect(html.toLowerCase()).toContain('not found');
  // A real escape hatch, not a dead end.
  expect(html).toMatch(/href="\/guides/);
  expect(html).toContain('href="/"');
});

test('astro build emits dist/404.html (the file Cloudflare Pages looks for)', () => {
  // Vitest doesn't guarantee cross-file execution order, so this can't rely
  // on build.test.ts's build having already run — build here too, matching
  // that file's own pattern, so this guard is correct in isolation.
  execSync('npm run build', { stdio: 'inherit' });
  expect(existsSync('dist/404.html')).toBe(true);
});
