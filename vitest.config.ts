/// <reference types="vitest" />
import { getViteConfig } from 'astro/config';
import { configDefaults } from 'vitest/config';

export default getViteConfig({
  test: {
    // Populate the dev-mode content-layer data store before any test file
    // runs, so `astro:content` (getCollection/getEntry) resolves under
    // Vitest. See tests/setup/sync-content.ts for why this is needed.
    globalSetup: ['./tests/setup/sync-content.ts'],
    // tests/e2e/** are Playwright specs (run via `npm run test:e2e`), not
    // Vitest tests — exclude them, since Vitest's default include glob
    // (`**/*.spec.ts`) would otherwise also pick up `*.spec.ts` files and
    // fail trying to load `@playwright/test`'s `test()` outside a Playwright
    // runner. Extend (not replace) Vitest's own default excludes
    // (node_modules, dist, .git, etc.) so we don't silently lose those.
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
  },
});
