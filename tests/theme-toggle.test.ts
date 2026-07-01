import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { expect, test } from 'vitest';
import ThemeToggle from '../src/components/ThemeToggle.astro';

test('theme toggle renders an accessible button', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(ThemeToggle);
  expect(html).toContain('id="theme-toggle"');
  expect(html).toContain('aria-label="Toggle theme"');
});
