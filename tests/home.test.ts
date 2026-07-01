// tests/home.test.ts
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { expect, test } from 'vitest';
import Home from '../src/pages/index.astro';

test('home renders hero, CTAs, blog section', async () => {
  const c = await AstroContainer.create();
  const html = await c.renderToString(Home);
  expect(html).toContain('Opt out');
  expect(html).toContain('/guides');
  expect(html).toContain('/contribute');
  expect(html).toContain('id="blog"');
});

test('home exposes #about and #contributors anchor targets for Header/Footer nav links', async () => {
  const c = await AstroContainer.create();
  const html = await c.renderToString(Home);
  expect(html).toContain('id="about"');
  expect(html).toContain('id="contributors"');
});

test('home shows the latest 3 non-draft blog posts, newest first, linking /blog/{id}', async () => {
  const c = await AstroContainer.create();
  const html = await c.renderToString(Home);
  expect(html).toContain('Welcome to OptOut.wiki');
  expect(html).toContain('href="/blog/welcome"');
});

test('home lists guide categories from the guides collection', async () => {
  const c = await AstroContainer.create();
  const html = await c.renderToString(Home);
  expect(html).toContain('Cars');
});

test('home includes WebSite JSON-LD, safely escaped', async () => {
  const c = await AstroContainer.create();
  const html = await c.renderToString(Home);
  expect(html).toContain('application/ld+json');
  expect(html).toContain('WebSite');
  expect(html).toContain('optout.wiki');
});
