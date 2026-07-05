// tests/privacy.test.ts
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { expect, test } from 'vitest';
import Privacy from '../src/pages/privacy.astro';

test('privacy page renders the core data-practice sections', async () => {
  const c = await AstroContainer.create();
  const html = await c.renderToString(Privacy);
  expect(html).toContain('Privacy policy');
  expect(html).toContain('rate limit');
  expect(html).toContain('CC BY-SA');
});

test('privacy page states the submission IP is hashed, not stored raw', async () => {
  const c = await AstroContainer.create();
  const html = await c.renderToString(Privacy);
  expect(html.toLowerCase()).toContain('salted hash');
  expect(html.toLowerCase()).not.toContain('we store your ip');
});
