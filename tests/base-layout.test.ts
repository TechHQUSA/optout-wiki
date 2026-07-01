// tests/base-layout.test.ts
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { expect, test } from 'vitest';
import Base from '../src/layouts/Base.astro';

test('Base renders title, description meta, canonical, and no-flash script', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(Base, {
    props: { title: 'T', description: 'D' },
    slots: { default: '<main id="x">hi</main>' },
  });
  expect(html).toContain('<title>T</title>');
  expect(html).toContain('content="D"');
  expect(html).toContain('rel="canonical"');
  expect(html).toContain("localStorage.getItem('theme')");
  expect(html).toContain('<main id="x">hi</main>');
});
