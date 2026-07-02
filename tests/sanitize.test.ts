// tests/sanitize.test.ts
// Proves the markdown pipeline neutralizes raw HTML embedded in a guide body.
// The threat: a moderator commits an anonymous submission verbatim as a .md;
// without sanitization its <script>/onerror/javascript: markup renders live.
// Fixture guide `xss-sanitize-fixture` (published:false, never on the live
// site) carries exactly that markup; here we render it and assert it's inert.
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { expect, test } from 'vitest';
import { getCollection } from 'astro:content';
import * as Article from '../src/pages/guides/[slug].astro';

async function renderFixture() {
  const all = await getCollection('guides');
  const entry = all.find((g) => g.id === 'xss-sanitize-fixture');
  expect(entry).toBeDefined();
  const c = await AstroContainer.create();
  return c.renderToString(Article.default, { props: { entry: entry! } });
}

test('rendered guide HTML contains no <script> from the body', async () => {
  const html = await renderFixture();
  expect(html).not.toContain('window.__xss');
  expect(html).not.toMatch(/<script>[^<]*window/);
});

test('rendered guide HTML strips inline event handlers and javascript: hrefs', async () => {
  const html = await renderFixture();
  expect(html).not.toContain('onerror');
  expect(html).not.toContain('javascript:alert');
});

test('legitimate markdown still renders (headings, bold)', async () => {
  const html = await renderFixture();
  expect(html).toContain('A real heading');
  expect(html).toContain('<strong>markdown</strong>');
});
