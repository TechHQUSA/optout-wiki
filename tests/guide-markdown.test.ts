import { expect, test } from 'vitest';
import { slugify, generateGuideMarkdown } from '../functions/_shared/guide-markdown.js';

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
