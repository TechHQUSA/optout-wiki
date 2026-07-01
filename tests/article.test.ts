// tests/article.test.ts
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { expect, test } from 'vitest';
import * as Article from '../src/pages/guides/[slug].astro';

test('article renders title, last-verified banner, sources', async () => {
  const paths = await Article.getStaticPaths();
  const toyota = paths.find((p) => p.params.slug === 'toyota-connected-services');
  expect(toyota).toBeDefined();
  const c = await AstroContainer.create();
  const html = await c.renderToString(Article.default, { props: toyota!.props });
  expect(html).toContain('Toyota');
  expect(html).toContain('Last verified');
  expect(html).toContain('application/ld+json');
});
