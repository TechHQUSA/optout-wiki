// tests/admin-shared.test.ts
import { expect, test } from 'vitest';
import { parseIds } from '../functions/_shared/admin.js';

function formWith(...ids: (string | Blob)[]) {
  const form = new FormData();
  for (const id of ids) form.append('id', id);
  return form;
}

test('parseIds returns a single id as a one-element array', () => {
  expect(parseIds(formWith('a1'))).toEqual(['a1']);
});

test('parseIds returns multiple ids in submitted order', () => {
  expect(parseIds(formWith('a1', 'a2', 'a3'))).toEqual(['a1', 'a2', 'a3']);
});

test('parseIds returns null when there are no ids at all', () => {
  expect(parseIds(new FormData())).toBeNull();
});

test('parseIds returns null when any entry is empty', () => {
  expect(parseIds(formWith('a1', ''))).toBeNull();
});

test('parseIds returns null when any entry is a File, not a string', () => {
  const file = new Blob(['x'], { type: 'text/plain' });
  expect(parseIds(formWith('a1', file))).toBeNull();
});

test('parseIds returns null when there are more than 200 ids', () => {
  const many = Array.from({ length: 201 }, (_, i) => `id-${i}`);
  expect(parseIds(formWith(...many))).toBeNull();
});

test('parseIds accepts exactly 200 ids', () => {
  const exactly200 = Array.from({ length: 200 }, (_, i) => `id-${i}`);
  expect(parseIds(formWith(...exactly200))).toHaveLength(200);
});
