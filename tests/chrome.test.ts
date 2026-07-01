// tests/chrome.test.ts
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { expect, test } from 'vitest';
import Header from '../src/components/Header.astro';
import Footer from '../src/components/Footer.astro';

test('header renders nav links and theme toggle', async () => {
  const c = await AstroContainer.create();
  const html = await c.renderToString(Header, { props: { current: 'guides' } });
  for (const label of ['Guides', 'Software', 'Blog', 'Contribute'])
    expect(html).toContain(label);
  expect(html).toContain('id="theme-toggle"');
});

test('footer renders', async () => {
  const c = await AstroContainer.create();
  const html = await c.renderToString(Footer);
  expect(html.length).toBeGreaterThan(50);
});
