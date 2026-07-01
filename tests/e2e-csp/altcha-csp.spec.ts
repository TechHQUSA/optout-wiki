// tests/e2e-csp/altcha-csp.spec.ts
//
// Regression guard for the "shipped CSP kills the contribute form" bug: the
// default `altcha` build solves its proof-of-work in a Web Worker created from
// a blob:/data: URL, which our strict CSP (script-src/worker-src have no
// blob:/data:) blocks — so the widget never produced a solution and the form
// rejected every real submission. Unit tests never exercised the widget under
// the CSP, so the bug was invisible.
//
// The fix uses ALTCHA's external build (`altcha/altcha.ext`) with a
// same-origin worker (public/altcha-worker.js) referenced via `workerurl`,
// plus `worker-src 'self'` in the CSP. This test proves, in a real browser
// under the real _headers CSP served by `wrangler pages dev`, that the widget
// solves with NO worker/blob CSP violation. See playwright.altcha.config.ts.
import { test, expect } from '@playwright/test';

test('ALTCHA widget solves its PoW under the production CSP with no worker/blob violation', async ({ page }) => {
  // 1. Collect any CSP violation the browser reports — both via console
  //    messages and via the in-page `securitypolicyviolation` event (the
  //    authoritative signal; console text is browser-version-dependent).
  const consoleCsp: string[] = [];
  page.on('console', (msg) => {
    const t = msg.text();
    if (/refused to create a worker|worker-src|blob:|content security policy|securitypolicyviolation/i.test(t)) {
      consoleCsp.push(`[${msg.type()}] ${t}`);
    }
  });
  await page.addInitScript(() => {
    (window as unknown as { __csp: unknown[] }).__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      (window as unknown as { __csp: unknown[] }).__csp.push({
        directive: e.violatedDirective,
        blockedURI: e.blockedURI,
        source: e.sourceFile,
      });
    });
  });

  await page.goto('/contribute/');

  // 2. The external build renders in light DOM (no shadow root), so the
  //    checkbox is a plain descendant of <altcha-widget>. Click it to start
  //    the proof-of-work.
  const checkbox = page.locator('altcha-widget input[type="checkbox"]');
  await checkbox.waitFor({ state: 'visible', timeout: 20_000 });
  await checkbox.click();

  // 3. Widget solved <=> it injects a non-empty hidden <input name="altcha">
  //    into the form (that's what the form handler reads before POSTing).
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const el = document.querySelector('#contribute-form input[name="altcha"]') as HTMLInputElement | null;
          return el?.value?.length ?? 0;
        }),
      { timeout: 30_000, message: 'widget never produced a solution (hidden altcha input stayed empty)' },
    )
    .toBeGreaterThan(0);

  // 4. Widget reports its verified state.
  const verified = await page.locator('altcha-widget [data-state="verified"], altcha-widget[data-state="verified"]').count();
  expect(verified, 'widget did not reach data-state="verified"').toBeGreaterThan(0);

  // 5. No worker/blob CSP violation occurred (the whole point of the fix).
  const inPage = (await page.evaluate(() => (window as unknown as { __csp: unknown[] }).__csp)) as Array<{
    directive: string;
    blockedURI: string;
  }>;
  const workerViolations = inPage.filter(
    (v) => /worker|script|default/i.test(v.directive) || /blob|data/i.test(v.blockedURI),
  );
  expect(workerViolations, `in-page CSP violations: ${JSON.stringify(inPage)}`).toEqual([]);
  expect(consoleCsp, `console CSP violations:\n${consoleCsp.join('\n')}`).toEqual([]);
});
