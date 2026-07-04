// tests/publish-lib.test.ts
import { expect, test } from 'vitest';
import { hasUnfilledPlaceholders, parseApprovedRows } from '../scripts/publish-lib.mjs';

test('hasUnfilledPlaceholders detects the generator placeholders', () => {
  expect(hasUnfilledPlaceholders('summary: "[ADD SUMMARY]"')).toBe(true);
  expect(hasUnfilledPlaceholders('  - { label: "[ADD LABEL]", url: "https://x" }')).toBe(true);
});

test('hasUnfilledPlaceholders is false once real content replaces them', () => {
  const filled = 'summary: "Stop LinkedIn training on your data."\nlabel: "LinkedIn setting"';
  expect(hasUnfilledPlaceholders(filled)).toBe(false);
});

test('parseApprovedRows flattens D1 --json output and parses sources to an array', () => {
  const stdout = JSON.stringify([
    {
      results: [
        {
          id: 'a1',
          title: 'A guide',
          category: 'Social Media',
          level: 'LOW',
          body: 'body',
          sources: '["https://example.com/x"]',
        },
      ],
      success: true,
      meta: {},
    },
  ]);
  const rows = parseApprovedRows(stdout);
  expect(rows).toHaveLength(1);
  expect(rows[0].sources).toEqual(['https://example.com/x']);
  expect(rows[0].title).toBe('A guide');
});

test('parseApprovedRows tolerates missing/invalid sources by yielding an empty array', () => {
  const stdout = JSON.stringify([
    { results: [{ id: 'b2', title: 'No sources', sources: null }], success: true, meta: {} },
  ]);
  expect(parseApprovedRows(stdout)[0].sources).toEqual([]);
});

test('parseApprovedRows returns [] for empty result sets', () => {
  const stdout = JSON.stringify([{ results: [], success: true, meta: {} }]);
  expect(parseApprovedRows(stdout)).toEqual([]);
});
