// tests/admin-query.test.ts
import { expect, test } from 'vitest';
import {
  PAGE_SIZE,
  escapeLike,
  parseAdminQuery,
  buildAdminListQuery,
  pageLink,
  totalPages,
} from '../functions/_shared/admin-query.js';

test('PAGE_SIZE is 25', () => {
  expect(PAGE_SIZE).toBe(25);
});

test('escapeLike escapes %, _, and backslash so search text is treated literally', () => {
  expect(escapeLike('50% off')).toBe('50\\% off');
  expect(escapeLike('a_b')).toBe('a\\_b');
  expect(escapeLike('a\\b')).toBe('a\\\\b');
});

test('parseAdminQuery defaults every field when the URL has no query params', () => {
  const query = parseAdminQuery(new URL('https://x/admin'));
  expect(query).toEqual({ q: '', category: '', level: '', sort: 'newest', page: 1 });
});

test('parseAdminQuery reads q/category/level/sort/page from the URL', () => {
  const query = parseAdminQuery(new URL('https://x/admin?q=foo&category=Cars&level=LOW&sort=oldest&page=3'));
  expect(query).toEqual({ q: 'foo', category: 'Cars', level: 'LOW', sort: 'oldest', page: 3 });
});

test('parseAdminQuery falls back to page 1 for garbage/negative/zero page values', () => {
  expect(parseAdminQuery(new URL('https://x/admin?page=abc')).page).toBe(1);
  expect(parseAdminQuery(new URL('https://x/admin?page=-5')).page).toBe(1);
  expect(parseAdminQuery(new URL('https://x/admin?page=0')).page).toBe(1);
});

test('parseAdminQuery falls back to sort=newest for anything other than "oldest"', () => {
  expect(parseAdminQuery(new URL('https://x/admin?sort=bogus')).sort).toBe('newest');
});

test('buildAdminListQuery with no filters just applies the status clause', () => {
  const { whereSql, orderSql, params } = buildAdminListQuery(
    { q: '', category: '', level: '', sort: 'newest', page: 1 },
    "status = 'pending'",
  );
  expect(whereSql).toBe("status = 'pending'");
  expect(orderSql).toBe('ORDER BY created_at DESC');
  expect(params).toEqual([]);
});

test('buildAdminListQuery adds a LIKE condition (escaped) for q, and equality for category/level', () => {
  const { whereSql, params } = buildAdminListQuery(
    { q: '50%', category: 'Cars', level: 'LOW', sort: 'newest', page: 1 },
    "status = 'pending'",
  );
  expect(whereSql).toBe(
    "status = 'pending' AND (title LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\') AND category = ? AND level = ?",
  );
  expect(params).toEqual(['%50\\%%', '%50\\%%', 'Cars', 'LOW']);
});

test('buildAdminListQuery orders oldest-first when sort is "oldest"', () => {
  const { orderSql } = buildAdminListQuery({ q: '', category: '', level: '', sort: 'oldest', page: 1 }, "status = 'pending'");
  expect(orderSql).toBe('ORDER BY created_at ASC');
});

test('pageLink preserves q/category/level/sort and only adds page when > 1', () => {
  const query = { q: 'foo', category: 'Cars', level: 'LOW', sort: 'oldest' };
  expect(pageLink(query, 1)).toBe('?q=foo&category=Cars&level=LOW&sort=oldest');
  expect(pageLink(query, 2)).toBe('?q=foo&category=Cars&level=LOW&sort=oldest&page=2');
});

test('pageLink returns an empty string when there are no filters and page is 1', () => {
  expect(pageLink({ q: '', category: '', level: '', sort: 'newest' }, 1)).toBe('');
});

test('totalPages is at least 1 and rounds up', () => {
  expect(totalPages(0)).toBe(1);
  expect(totalPages(25)).toBe(1);
  expect(totalPages(26)).toBe(2);
  expect(totalPages(50)).toBe(2);
});
