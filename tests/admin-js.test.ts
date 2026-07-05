// tests/admin-js.test.ts
import { expect, test } from 'vitest';
import { computeSelectedCount } from '../public/admin.js';

test('computeSelectedCount counts only the checked boxes', () => {
  expect(computeSelectedCount([{ checked: true }, { checked: false }, { checked: true }])).toBe(2);
});

test('computeSelectedCount returns 0 for an empty list', () => {
  expect(computeSelectedCount([])).toBe(0);
});

test('computeSelectedCount returns 0 when none are checked', () => {
  expect(computeSelectedCount([{ checked: false }, { checked: false }])).toBe(0);
});
