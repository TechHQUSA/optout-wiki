// tests/review-page.test.ts
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { expect, test } from 'vitest';
import Review from '../src/pages/review.astro';
import Contribute from '../src/pages/contribute.astro';

test('review page shell: list container, comment form, honeypot, altcha widget, no inline handlers', async () => {
  const c = await AstroContainer.create();
  const html = await c.renderToString(Review);
  expect(html).toContain('id="review-list"');
  expect(html).toContain('id="comment-form"');
  expect(html).toContain('name="website"'); // honeypot
  expect(html).toContain('altcha-widget');
  expect(html).toContain('id="comment-submission-id"');
  // CSP: no inline event handlers anywhere in the shell
  expect(html).not.toMatch(/\son[a-z]+="/i);
});

test('review page renders no feed content at build time (client-side only)', async () => {
  const c = await AstroContainer.create();
  const html = await c.renderToString(Review);
  expect(html).toContain('Loading the review queue');
});

test('contribute pipeline stage 2 links to /review', async () => {
  const c = await AstroContainer.create();
  const html = await c.renderToString(Contribute);
  expect(html).toContain('href="/review"');
});
