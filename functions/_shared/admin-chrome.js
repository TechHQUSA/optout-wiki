// functions/_shared/admin-chrome.js
// Shared HTML chrome for the admin surface: the Queue/History tab nav, the
// search/filter GET form, and pagination links — used identically by both
// functions/admin/index.js (queue) and functions/admin/history.js.
import { escapeHtml } from './html.js';
import { pageLink } from './admin-query.js';

/**
 * @param {'queue'|'history'} active
 * @returns {string}
 */
export function renderNav(active) {
  const tab = (href, label, key) =>
    `<a href="${href}"${active === key ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<nav class="admin-nav">${tab('/admin', 'Queue', 'queue')}${tab('/admin/history', 'History', 'history')}</nav>`;
}

/**
 * @param {{q: string, category: string, level: string, sort: string}} query
 * @param {string} action e.g. "/admin" or "/admin/history"
 * @returns {string}
 */
export function renderFilterForm(query, action) {
  const levelOption = (value, label) =>
    `<option value="${value}"${query.level === value ? ' selected' : ''}>${label}</option>`;
  return `<form method="GET" action="${action}" class="admin-filters">
  <input type="search" name="q" value="${escapeHtml(query.q)}" placeholder="Search title or category">
  <input type="text" name="category" value="${escapeHtml(query.category)}" placeholder="Category">
  <select name="level">
    <option value=""${query.level === '' ? ' selected' : ''}>Any level</option>
    ${levelOption('LOW', 'LOW')}
    ${levelOption('MED', 'MED')}
    ${levelOption('HIGH', 'HIGH')}
  </select>
  <select name="sort">
    <option value="newest"${query.sort !== 'oldest' ? ' selected' : ''}>Newest first</option>
    <option value="oldest"${query.sort === 'oldest' ? ' selected' : ''}>Oldest first</option>
  </select>
  <button type="submit">Filter</button>
</form>`;
}

/**
 * @param {string} basePath e.g. "/admin" or "/admin/history"
 * @param {{q: string, category: string, level: string, sort: string}} query
 * @param {number} page current page (1-based)
 * @param {number} totalPages
 * @returns {string}
 */
export function renderPagination(basePath, query, page, totalPages) {
  const prev = page > 1 ? `<a href="${basePath}${pageLink(query, page - 1)}">&larr; Prev</a>` : '';
  const next = page < totalPages ? `<a href="${basePath}${pageLink(query, page + 1)}">Next &rarr;</a>` : '';
  return `<nav class="admin-pagination">${prev}<span>Page ${page} of ${totalPages}</span>${next}</nav>`;
}
