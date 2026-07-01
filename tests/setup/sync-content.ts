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
//
// --- Reliance on undocumented Astro internals (read before touching this) ---
// This script hard-codes two paths that are NOT part of Astro's public API:
//   1. `node_modules/.astro/data-store.json` — Astro's internal "cacheDir"
//      store, written by `astro sync` / `astro build`.
//   2. `<project-root>/.astro/data-store.json` — Astro's internal
//      "dotAstroDir" store, read by the content virtual module when Vite's
//      `command === 'serve'` (i.e. dev-mode / Vitest via `getViteConfig()`).
// Both the exact filenames and the serve-vs-build branch that picks between
// them are Astro internals, not a documented contract. A future Astro
// version could rename the file, change the branch condition, or stop
// writing `cacheStore` at all — and this copy step would then silently
// succeed while copying nothing, leaving tests to run against stale or
// missing content. The guard immediately below exists specifically to turn
// that silent failure mode into a loud, diagnosable one: keep it in sync
// with the two paths above if either ever changes. Do NOT loosen or remove
// the guard to make a red run pass — a throw here means the mirror step
// itself is broken and needs investigation, not suppression.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
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

  // Fail loud: if a future Astro release changes the cacheDir/dotAstroDir
  // filenames or the serve-vs-build branching described above, we want
  // Vitest's globalSetup to blow up immediately with a clear diagnostic
  // instead of letting every test quietly run against stale or empty
  // content-collection data.
  if (!existsSync(devStore)) {
    throw new Error(
      `[tests/setup/sync-content.ts] Expected the Astro content-layer data store to exist at ` +
        `"${devStore}" after mirroring from "${cacheStore}", but it is missing.\n` +
        `This setup relies on undocumented Astro internals (the "cacheDir" store written by ` +
        `\`astro sync\`/\`astro build\` at node_modules/.astro/data-store.json, mirrored into the ` +
        `"dotAstroDir" store the dev-mode content virtual module reads at <root>/.astro/data-store.json ` +
        `when Vite's command === 'serve'). Either \`astro sync\` did not produce "${cacheStore}", or a ` +
        `newer Astro version changed these paths/behavior. Investigate before touching the guard.`,
    );
  }

  // The store is Astro's internal devalue-serialized format, not plain JSON,
  // so we can't just parse it and check `Object.keys(...).length`. Instead we
  // check for the presence of every configured collection name (from
  // src/content.config.ts) as a string in the raw contents — a cheap proxy
  // for "the entries getCollection() needs are actually in here."
  const devStoreContents = readFileSync(devStore, 'utf-8').trim();
  const expectedCollections = ['guides', 'software', 'blog'];
  const missingCollections = expectedCollections.filter(
    (name) => !devStoreContents.includes(`"${name}"`),
  );
  if (devStoreContents.length === 0 || missingCollections.length > 0) {
    throw new Error(
      `[tests/setup/sync-content.ts] The Astro content-layer data store at "${devStore}" exists but ` +
        (devStoreContents.length === 0
          ? 'is empty'
          : `is missing expected collection(s): ${missingCollections.join(', ')}`) +
        ` (mirrored from "${cacheStore}"). This means \`astro sync\` produced no/incomplete collection ` +
        `entries, or a newer Astro version changed the internal store format/paths this setup depends on ` +
        `(see the "Reliance on undocumented Astro internals" comment above). Tests would otherwise pass ` +
        `silently against empty or partial content collections — investigate rather than removing this guard.`,
    );
  }
}
