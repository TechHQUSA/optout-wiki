// tests/csp.test.ts
// Guards the hash-based CSP. script-src drops 'unsafe-inline' and instead
// allow-lists the SHA-256 of the ONE inline script the site ships — the
// no-flash theme block in src/layouts/Base.astro (`is:inline`, emitted
// verbatim, so its source bytes equal the bytes the browser hashes). Every
// other script is bundled to an external /_astro/*.js file (assetsInlineLimit:0
// in astro.config.mjs), covered by 'self'.
//
// This test recomputes that hash from the current Base.astro source and asserts
// public/_headers contains it — so if the inline script ever changes, this
// fails loudly here instead of silently breaking the theme (or the CSP) in
// production.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { expect, test } from 'vitest';

function inlineNoFlashScript(): string {
  const base = readFileSync('src/layouts/Base.astro', 'utf8');
  const m = base.match(/<script is:inline>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('no-flash is:inline script not found in Base.astro');
  return m[1];
}

function sha256Base64(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('base64');
}

test("script-src drops 'unsafe-inline' and pins the no-flash script hash", () => {
  const headers = readFileSync('public/_headers', 'utf8');
  const csp = headers.split('\n').find((l) => l.includes('Content-Security-Policy')) ?? '';
  const scriptSrc = csp.match(/script-src[^;]*/)?.[0] ?? '';

  expect(scriptSrc).not.toContain("'unsafe-inline'");
  const hash = sha256Base64(inlineNoFlashScript());
  expect(scriptSrc).toContain(`'sha256-${hash}'`);
});

test("style-src drops 'unsafe-inline' (all component styles are classes, not style=\"\" attributes)", () => {
  const headers = readFileSync('public/_headers', 'utf8');
  const csp = headers.split('\n').find((l) => l.includes('Content-Security-Policy')) ?? '';
  const styleSrc = csp.match(/style-src[^;]*/)?.[0] ?? '';

  expect(styleSrc).not.toContain("'unsafe-inline'");
  expect(styleSrc).toContain("'self'");
});

test('no inline style="" attribute or <style> tag survives into any built page (style-src has no unsafe-inline to cover them)', () => {
  const dist = 'dist';
  const htmlFiles: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.html')) htmlFiles.push(p);
    }
  };
  walk(dist);
  expect(htmlFiles.length).toBeGreaterThan(0);

  const offenders: string[] = [];
  for (const file of htmlFiles) {
    const html = readFileSync(file, 'utf8');
    if (/\sstyle="/.test(html) || /<style>/.test(html)) offenders.push(file);
  }
  expect(offenders, `pages with inline style: ${offenders.join(', ')}`).toEqual([]);
});
