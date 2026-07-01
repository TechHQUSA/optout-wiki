// tests/setup/sync-content.ts
//
// Vitest global setup for `astro:content`.
//
// `getViteConfig()` (used in vitest.config.ts) resolves the Vite config with
// `command: 'serve'`, which Astro's content virtual-module plugin treats as
// "dev mode": it reads the content layer's data store from
// `.astro/data-store.json` at the project root. That file is only populated
// by Astro's own dev server — `astro sync` (and `astro build`) instead write
// to the build cache at `node_modules/.astro/data-store.json`. Without this
// step, `getCollection()` resolves every collection to an empty array under
// Vitest even though the config and content files are valid.
//
// To make `astro:content` usable in tests without spinning up a real dev
// server, run `astro sync` to (re)generate the cache-dir data store, then
// mirror it into the project-root `.astro/` directory that the dev-mode
// content virtual module reads from.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export default function setup() {
  const root = process.cwd();
  execFileSync('npx', ['astro', 'sync'], { stdio: 'inherit', cwd: root });

  const cacheStore = join(root, 'node_modules', '.astro', 'data-store.json');
  const devAstroDir = join(root, '.astro');
  const devStore = join(devAstroDir, 'data-store.json');

  if (existsSync(cacheStore)) {
    mkdirSync(devAstroDir, { recursive: true });
    copyFileSync(cacheStore, devStore);
  }
}
