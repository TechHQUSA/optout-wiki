// tests/admin-chrome.test.ts
import { expect, test } from 'vitest';
import { renderNav, renderFilterForm, renderPagination } from '../functions/_shared/admin-chrome.js';

test('renderNav marks the active tab', () => {
  const html = renderNav('queue');
  expect(html).toContain('href="/admin"');
  expect(html).toContain('href="/admin/history"');
  expect(html).toMatch(/href="\/admin"[^>]*aria-current="page"/);
});

test('renderNav marks history as active when given "history"', () => {
  const html = renderNav('history');
  expect(html).toMatch(/href="\/admin\/history"[^>]*aria-current="page"/);
});

test('renderFilterForm escapes the current query values and points at the given action', () => {
  const html = renderFilterForm({ q: '<script>', category: 'Cars"', level: 'LOW', sort: 'oldest' }, '/admin/history');
  expect(html).toContain('action="/admin/history"');
  expect(html).not.toContain('<script>');
  expect(html).toContain('&lt;script&gt;');
  expect(html).toContain('&quot;');
  expect(html).toContain('value="LOW" selected');
  expect(html).toContain('value="oldest" selected');
});

test('renderPagination shows Prev only past page 1, and Next only before the last page', () => {
  const query = { q: '', category: '', level: '', sort: 'newest' };
  const middle = renderPagination('/admin', query, 2, 3);
  expect(middle).toContain('Prev');
  expect(middle).toContain('Next');
  const first = renderPagination('/admin', query, 1, 3);
  expect(first).not.toContain('Prev');
  expect(first).toContain('Next');
  const last = renderPagination('/admin', query, 3, 3);
  expect(last).toContain('Prev');
  expect(last).not.toContain('Next');
});

test('renderPagination links preserve filters via pageLink', () => {
  const query = { q: 'foo', category: '', level: '', sort: 'newest' };
  const html = renderPagination('/admin', query, 1, 2);
  expect(html).toContain('/admin?q=foo&page=2');
});
