/// <reference types="vitest" />
import { getViteConfig } from 'astro/config';

export default getViteConfig({
  test: {
    // Populate the dev-mode content-layer data store before any test file
    // runs, so `astro:content` (getCollection/getEntry) resolves under
    // Vitest. See tests/setup/sync-content.ts for why this is needed.
    globalSetup: ['./tests/setup/sync-content.ts'],
  },
});
