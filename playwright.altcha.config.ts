// playwright.altcha.config.ts
//
// A SEPARATE Playwright project from playwright.config.ts, because this one
// must run under the REAL production CSP (public/_headers) AND a real Pages
// Functions runtime — neither of which `astro preview` provides. The default
// config serves the static build via `astro preview` (no Functions, no
// _headers), so the ALTCHA widget there can't fetch a challenge or be tested
// against the shipped CSP.
//
// Here we build the site and serve `dist/` with `wrangler pages dev`, which
// (a) applies `dist/_headers` (the copied public/_headers CSP) to every route
// and (b) runs functions/api/* — so /api/altcha-challenge issues a real
// challenge the widget can solve. Secrets are injected via `--binding` so the
// server is self-contained (no .dev.vars needed in CI); locally, a running
// `wrangler pages dev dist` on the same port is reused.
//
// Run: npx playwright test --config playwright.altcha.config.ts
import { defineConfig } from '@playwright/test';

const PORT = 8788;

export default defineConfig({
  testDir: './tests/e2e-csp',
  timeout: 60_000,
  webServer: {
    command:
      `npm run build && npx wrangler pages dev dist --port ${PORT} --ip 127.0.0.1 ` +
      '--binding ALTCHA_HMAC_SECRET=test-hmac-secret ' +
      '--binding ALTCHA_HMAC_KEY_SECRET=test-hmac-key-secret ' +
      '--binding IP_SALT=test-ip-salt',
    url: `http://127.0.0.1:${PORT}/contribute/`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
  use: { baseURL: `http://127.0.0.1:${PORT}` },
});
