import { expect, test } from 'vitest';
import { join, relative } from 'node:path';
// js-yaml is a transitive dep (pulled in by astro's markdown pipeline) with
// no bundled/published type declarations — suppress the missing-types error
// rather than adding an ambient .d.ts just for this one test import.
// @ts-expect-error js-yaml has no bundled/published type declarations
import yaml from 'js-yaml';
import { slugify, generateGuideMarkdown } from '../functions/_shared/guide-markdown.js';

const GUIDES_DIR = 'src/content/guides';

/** Extract the frontmatter block (between the first two `---` lines) as raw text. */
function extractFrontmatter(markdown: string): { raw: string; full: string } {
  const m = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) throw new Error('no frontmatter block found');
  return { raw: m[1], full: m[0] };
}

test('slugify makes a kebab slug and never returns empty', () => {
  expect(slugify('Stop your Toyota selling data!')).toBe('stop-your-toyota-selling-data');
  expect(slugify('  ***  ')).toBe('guide');
});

test('generateGuideMarkdown emits schema-valid frontmatter with placeholders', () => {
  const { filename, markdown } = generateGuideMarkdown(
    { title: 'Opt out of Foo', category: 'Cars', level: 'MED', body: '1. Do a thing.', sources: ['https://a.example/x'] },
    '2026-07-02',
  );
  expect(filename).toBe('opt-out-of-foo.md');
  expect(markdown).toContain('title: "Opt out of Foo"');
  expect(markdown).toContain('category: "Cars"');
  expect(markdown).toContain('level: MED');
  expect(markdown).toContain('summary: "[ADD SUMMARY]"');
  expect(markdown).toContain('sources:');
  expect(markdown).toContain('- { label: "[ADD LABEL]", url: "https://a.example/x" }');
  expect(markdown).toContain('lastVerified: 2026-07-02');
  expect(markdown).toContain('published: true');
  expect(markdown.trimEnd().endsWith('1. Do a thing.')).toBe(true);
});

test('generateGuideMarkdown handles no sources and escapes quotes in the title', () => {
  const { markdown } = generateGuideMarkdown(
    { title: 'A "quoted" title', category: 'OS', level: 'LOW', body: 'x', sources: [] },
    '2026-07-02',
  );
  expect(markdown).toContain('title: "A \\"quoted\\" title"');
  expect(markdown).toContain('sources: []');
});

// --- CR/LF escaping regression (yamlQuote also escapes \r and \n so a title
// or body can't break out of a YAML double-quoted scalar and inject a fake
// extra frontmatter key) -------------------------------------------------

test('yamlQuote escapes an embedded newline so a title cannot inject a fake frontmatter key', () => {
  const evilTitle = 'Evil\ntitle: "injected"';
  const { markdown } = generateGuideMarkdown(
    { title: evilTitle, category: 'OS', level: 'LOW', body: 'x', sources: [] },
    '2026-07-04',
  );
  const titleLine = markdown.split('\n').find((l) => l.startsWith('title: '));
  // Literal two-char sequence `\n` (backslash + n) in the raw output, never a
  // real newline byte inside the quoted scalar.
  expect(titleLine).toBe('title: "Evil\\ntitle: \\"injected\\""');

  const { raw } = extractFrontmatter(markdown);
  const parsed = yaml.load(raw) as Record<string, unknown>;
  // A real YAML parser sees exactly one `title` key holding the full,
  // unmangled string — not a second/overriding `injected` key.
  expect(parsed.title).toBe(evilTitle);
  expect(Object.keys(parsed).sort()).toEqual(
    ['category', 'lastVerified', 'level', 'published', 'sources', 'summary', 'title'].sort(),
  );
});

test('yamlQuote escapes an embedded carriage return the same way', () => {
  const evilTitle = 'Evil\rtitle: "injected"';
  const { markdown } = generateGuideMarkdown(
    { title: evilTitle, category: 'OS', level: 'LOW', body: 'x', sources: [] },
    '2026-07-04',
  );
  const titleLine = markdown.split('\n').find((l) => l.startsWith('title: '));
  expect(titleLine).toBe('title: "Evil\\rtitle: \\"injected\\""');

  const { raw } = extractFrontmatter(markdown);
  const parsed = yaml.load(raw) as Record<string, unknown>;
  expect(parsed.title).toBe(evilTitle);
});

test('yamlQuote escapes a title with both a literal quote and a literal backslash together', () => {
  const title = 'Title with "quotes" and \\backslash\\';
  const { markdown } = generateGuideMarkdown(
    { title, category: 'OS', level: 'LOW', body: 'x', sources: [] },
    '2026-07-04',
  );
  const titleLine = markdown.split('\n').find((l) => l.startsWith('title: '));
  expect(titleLine).toBe('title: "Title with \\"quotes\\" and \\\\backslash\\\\"');

  const { raw } = extractFrontmatter(markdown);
  const parsed = yaml.load(raw) as Record<string, unknown>;
  expect(parsed.title).toBe(title);
});

test('escape order keeps the backslash introduced by \\n-substitution from being re-escaped', () => {
  // yamlQuote escapes backslashes FIRST, then quotes, then \r, then \n. If
  // the \r/\n substitution ran before the backslash-escaping step, the
  // backslash it introduces would itself get doubled — corrupting a real
  // embedded newline into the literal text `\\n` instead of the intended
  // `\n` escape sequence. This is a regression guard on that ordering.
  const title = 'Slash\\path and a real\nnewline';
  const { markdown } = generateGuideMarkdown(
    { title, category: 'OS', level: 'LOW', body: 'x', sources: [] },
    '2026-07-04',
  );
  const titleLine = markdown.split('\n').find((l) => l.startsWith('title: '));
  expect(titleLine).toBe('title: "Slash\\\\path and a real\\nnewline"');

  const { raw } = extractFrontmatter(markdown);
  const parsed = yaml.load(raw) as Record<string, unknown>;
  expect(parsed.title).toBe(title);
});

// --- Frontmatter-injection / breakout via body ---------------------------

test('a body containing an embedded "---" block cannot inject or override frontmatter', () => {
  // Simulates an attacker trying to smuggle a second frontmatter block into
  // the body, hoping a YAML-frontmatter parser treats the second `---...---`
  // pair as additional/overriding frontmatter (e.g. published: false).
  const body = 'Real content.\n\n---\n\ntitle: fake\npublished: false\n\nMore content.';
  const submission = { title: 'Legit Title', category: 'Cars', level: 'MED', body, sources: ['https://a.example/x'] };
  const { markdown } = generateGuideMarkdown(submission, '2026-07-04');

  const { raw, full } = extractFrontmatter(markdown);
  const parsed = yaml.load(raw) as Record<string, unknown>;

  // The legitimate frontmatter block parses to exactly the real submitted
  // values — nothing attacker-controlled leaked in.
  expect(parsed).toEqual({
    title: 'Legit Title',
    category: 'Cars',
    level: 'MED',
    summary: '[ADD SUMMARY]',
    sources: [{ label: '[ADD LABEL]', url: 'https://a.example/x' }],
    lastVerified: new Date('2026-07-04'),
    published: true, // the real value, not the attacker's `false`
  });

  // Everything after the closing `---` — including the attacker's embedded
  // `---`, `title:`, and `published:` lines — is body text, never re-parsed.
  // (`full` ends right after the closing `---\n`; the generator then adds
  // one more blank line before the body.)
  const rest = markdown.slice(full.length);
  expect(rest).toBe(`\n${body}\n`);
  expect(rest).toContain('title: fake');
  expect(rest).toContain('published: false');

  // Structural sanity: the first two `---` occurrences bound the legitimate
  // block; the attacker's `---` is strictly a third, later occurrence.
  const dashIndices: number[] = [];
  for (let i = markdown.indexOf('---'); i !== -1; i = markdown.indexOf('---', i + 1)) dashIndices.push(i);
  expect(dashIndices.length).toBe(3);
  expect(dashIndices[2]).toBeGreaterThan(full.length);
});

// --- Path-traversal fuzz on slugify ---------------------------------------
// (structural approach for both injection tests above and the fuzz below —
// see report for why the real Astro content-collection loader wasn't used.)

const pathTraversalCases = [
  { label: 'posix dot-dot traversal', title: '../../../etc/passwd' },
  { label: 'windows dot-dot traversal', title: '..\\..\\windows\\system32' },
  { label: 'URL-encoded traversal', title: '..%2f..%2fetc%2fpasswd' },
  { label: 'bare dot-dot', title: '..' },
  { label: 'bare dot', title: '.' },
  { label: 'embedded null byte', title: 'evil\x00.md' },
  { label: 'fullwidth-slash homoglyph (U+FF0F)', title: 'evil／title' },
  { label: 'empty string', title: '' },
  { label: 'only special characters', title: '!!!///...' },
];

test.each(pathTraversalCases)('slugify keeps "$label" from escaping the guides directory', ({ title }) => {
  const slug = slugify(title);
  expect(slug).not.toContain('/');
  expect(slug).not.toContain('\\');
  expect(slug.startsWith('.')).toBe(false);
  expect(slug.length).toBeGreaterThan(0);

  const resolved = join(GUIDES_DIR, `${slug}.md`);
  expect(resolved.startsWith(GUIDES_DIR)).toBe(true);
  // Stronger containment check than startsWith (which a sibling directory
  // like `src/content/guides-evil` could otherwise satisfy): the resolved
  // path, relative to the guides dir, must never climb back out via `..`.
  expect(relative(GUIDES_DIR, resolved).startsWith('..')).toBe(false);
});

test('slugify falls back to "guide" when the input sanitizes to nothing', () => {
  expect(slugify('')).toBe('guide');
  expect(slugify('!!!///...')).toBe('guide');
  expect(slugify('..')).toBe('guide');
  expect(slugify('.')).toBe('guide');
});
