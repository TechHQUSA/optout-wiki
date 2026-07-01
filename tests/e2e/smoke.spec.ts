// tests/e2e/smoke.spec.ts
//
// Smoke coverage for the static, JS-driven islands that unit/Container
// tests can't exercise (no real browser/DOM event loop there): the theme
// toggle (localStorage persistence) and the guide filter (DOM narrowing on
// input). See playwright.config.ts for why the contribute form's actual
// POST /api/contribute happy path is out of scope here.
import { test, expect } from '@playwright/test';

test('theme toggle persists across reload', async ({ page }) => {
  await page.goto('/guides');
  await page.click('#theme-toggle');
  const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await page.reload();
  const after = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  expect(after).toBe(theme);
});

test('guide filter narrows cards', async ({ page }) => {
  await page.goto('/guides');
  const total = await page.locator('.guide-card').count();
  await page.fill('#guide-search', 'zzzznomatch');
  const visible = await page.locator('.guide-card:visible').count();
  expect(visible).toBeLessThan(total || 1);
});
