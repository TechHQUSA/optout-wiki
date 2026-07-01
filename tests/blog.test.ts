// tests/blog.test.ts
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { expect, test } from 'vitest';
import BlogIndex from '../src/pages/blog/index.astro';
import { GET as rssGet } from '../src/pages/rss.xml.js';

test('blog index lists the seed post', async () => {
  const c = await AstroContainer.create();
  const html = await c.renderToString(BlogIndex);
  expect(html).toContain('Welcome');
});

test('rss feed contains the seed post', async () => {
  const res = await rssGet({ site: new URL('https://optout.wiki') });
  const xml = await res.text();
  expect(xml).toContain('<rss');
  expect(xml).toContain('OptOut.wiki Blog');
});
