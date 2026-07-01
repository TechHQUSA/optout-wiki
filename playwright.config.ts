// playwright.config.ts
//
// Smoke coverage for the static islands (theme toggle, guide filter) — see
// tests/e2e/smoke.spec.ts. The `/api/contribute` happy path is NOT covered
// here: Pages Functions (functions/api/*.js) don't run under `astro
// preview`, which serves the static build only. That endpoint's behavior is
// covered by the unit test in tests/contribute.test.ts (Task 14). Full
// function e2e against a real Functions runtime is an optional follow-up
// via `wrangler pages dev`.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4321',
    reuseExistingServer: !process.env.CI,
  },
  use: { baseURL: 'http://localhost:4321' },
});
