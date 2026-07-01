// tests/content.test.ts
import { expect, test } from 'vitest';
import { getCollection } from 'astro:content';

test('guides collection loads the seed guide', async () => {
  const guides = await getCollection('guides');
  expect(guides.length).toBeGreaterThan(0);
  const t = guides.find((g) => g.id === 'toyota-connected-services');
  expect(t?.data.category).toBe('Cars');
  expect(t?.data.level).toBe('MED');
});

test('software collection loads seed entries', async () => {
  const sw = await getCollection('software');
  expect(sw.length).toBeGreaterThanOrEqual(2);
});

test('blog collection loads the welcome post', async () => {
  const posts = await getCollection('blog');
  expect(posts.length).toBeGreaterThan(0);
  const welcome = posts.find((p) => p.data.title.includes('Welcome'));
  expect(welcome).toBeDefined();
});
