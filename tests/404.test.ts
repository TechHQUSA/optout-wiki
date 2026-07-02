// tests/404.test.ts
//
// Cloudflare Pages natively recognizes a `404.html` at any directory level
// and serves it (with a real HTTP 404 status) for any unmatched static
// asset path — no _redirects rule needed. Without this file the platform
// falls back to serving the site's actual homepage content for a typo'd or
// stale URL (a soft-404: 200 OK with the wrong page), which is what this
// guards against.
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

// The dist/404.html build-output guard lives in tests/build.test.ts (the build
// runs once in globalSetup; this file no longer shells out its own build).
