// tests/software.test.ts
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { expect, test } from 'vitest';
import Software from '../src/pages/software.astro';

test('software page lists seed entries grouped by category', async () => {
  const c = await AstroContainer.create();
  const html = await c.renderToString(Software);
  expect(html).toContain('Mullvad VPN');
  expect(html).toContain('GrapheneOS');
  expect(html).toContain('Network');
  expect(html).toContain('application/ld+json');
  expect(html).toContain('CollectionPage');
  expect(html).toContain('BreadcrumbList');
});

test('software page links each entry to its url with rel="noopener"', async () => {
  const c = await AstroContainer.create();
  const html = await c.renderToString(Software);
  expect(html).toContain('href="https://mullvad.net"');
  expect(html).toMatch(/href="https:\/\/mullvad\.net"[^>]*rel="noopener/);
});
