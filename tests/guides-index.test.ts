// tests/guides-index.test.ts
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { expect, test } from 'vitest';
import GuidesIndex from '../src/pages/guides/index.astro';

test('guides index renders a card with filter data-attributes', async () => {
  const c = await AstroContainer.create();
  const html = await c.renderToString(GuidesIndex);
  expect(html).toContain('class="guide-card"');
  expect(html).toContain('data-category="Cars"');
  expect(html).toContain('id="guide-search"');
});
