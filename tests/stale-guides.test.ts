// tests/stale-guides.test.ts
// Stage-5 quarterly re-verification loop.
// - policy unit tests (staleness math)
// - built manifest shape (dist/stale-guides.json exists post-build)
// - HARD CEILING: no published guide may be >180 days stale at build/test
//   time. This test going red IS the quarterly loop's enforcement teeth:
//   re-verify the guide and bump lastVerified in git to green it.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { expect, test } from 'vitest';
import { isStale, daysSince, STALE_AFTER_DAYS, HARD_CEILING_DAYS } from '../src/lib/staleness';

const DAY = 24 * 60 * 60 * 1000;

test('staleness policy: 90-day boundary, floor days, negative clamps to 0', () => {
  const now = Date.parse('2026-07-20T00:00:00Z');
  expect(STALE_AFTER_DAYS).toBe(90);
  expect(isStale(new Date(now - 90 * DAY), now)).toBe(false); // exactly 90 = not yet
  expect(isStale(new Date(now - 91 * DAY), now)).toBe(true);
  expect(daysSince(new Date(now + 5 * DAY), now)).toBe(0);
});

test('built stale-guides.json exists with the manifest shape', () => {
  const manifest = JSON.parse(readFileSync('dist/stale-guides.json', 'utf8'));
  expect(typeof manifest.generated_at).toBe('string');
  expect(Array.isArray(manifest.stale)).toBe(true);
  for (const g of manifest.stale) {
    expect(typeof g.slug).toBe('string');
    expect(typeof g.lastVerified).toBe('string');
    expect(typeof g.days).toBe('number');
    expect(g.days).toBeGreaterThan(STALE_AFTER_DAYS);
  }
});

test(`hard ceiling: no published guide is more than ${HARD_CEILING_DAYS} days stale`, () => {
  const dir = 'src/content/guides';
  const now = Date.now();
  const offenders: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const raw = readFileSync(`${dir}/${file}`, 'utf8');
    const fm = raw.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
    if (/^published:\s*false/m.test(fm)) continue;
    const dateStr = fm.match(/^lastVerified:\s*["']?(\d{4}-\d{2}-\d{2})/m)?.[1];
    if (!dateStr) continue; // schema enforces presence; content tests cover it
    if (daysSince(new Date(`${dateStr}T00:00:00Z`), now) > HARD_CEILING_DAYS) {
      offenders.push(`${file} (lastVerified ${dateStr})`);
    }
  }
  expect(offenders, `Guides overdue for re-verification — re-test and bump lastVerified: ${offenders.join(', ')}`).toEqual([]);
});

test('guide template renders the stale badge only for stale guides (source pin)', () => {
  const tpl = readFileSync('src/pages/guides/[slug].astro', 'utf8');
  expect(tpl).toContain('isStale(entry.data.lastVerified');
  expect(tpl).toContain('stale-badge');
  // dist spot-check: badge text appears in a built guide iff stale exists
  if (existsSync('dist/stale-guides.json')) {
    const manifest = JSON.parse(readFileSync('dist/stale-guides.json', 'utf8'));
    const staleSlugs = new Set(manifest.stale.map((g: { slug: string }) => g.slug));
    for (const g of manifest.stale) {
      const page = readFileSync(`dist/guides/${g.slug}/index.html`, 'utf8');
      expect(page).toContain('Due for re-verification');
    }
    // non-stale branch: built guides NOT in the manifest carry no badge
    for (const slug of readdirSync('dist/guides', { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)) {
      if (staleSlugs.has(slug)) continue;
      const page = readFileSync(`dist/guides/${slug}/index.html`, 'utf8');
      expect(page, `unexpected stale badge on fresh guide ${slug}`).not.toContain('Due for re-verification');
    }
  }
});

test('manifest is COMPLETE: every published guide stale at generated_at is listed', () => {
  const manifest = JSON.parse(readFileSync('dist/stale-guides.json', 'utf8'));
  const asOf = Date.parse(manifest.generated_at); // deterministic vs test-time clock
  const listed = new Set(manifest.stale.map((g: { slug: string }) => g.slug));
  const dir = 'src/content/guides';
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const fm = readFileSync(`${dir}/${file}`, 'utf8').match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
    if (/^published:\s*false/m.test(fm)) continue;
    const dateStr = fm.match(/^lastVerified:\s*["']?(\d{4}-\d{2}-\d{2})/m)?.[1];
    if (!dateStr) continue;
    const slug = file.replace(/\.md$/, '');
    const stale = isStale(new Date(`${dateStr}T00:00:00Z`), asOf);
    expect(listed.has(slug), `${slug}: manifest says ${listed.has(slug)}, content says stale=${stale}`).toBe(stale);
  }
});
