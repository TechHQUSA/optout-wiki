// functions/_shared/admin-query.js
// Pure helpers shared by the queue (functions/admin/index.js) and history
// (functions/admin/history.js) routes: parsing the search/filter/sort/page
// query string, building the corresponding SQL WHERE/ORDER fragment, and
// building "?..." links that preserve the current filters when paginating.
// No D1, no Request/Response — kept pure so it unit-tests without mocking.

export const PAGE_SIZE = 25;

/**
 * Escapes SQL LIKE wildcards (%, _) and the escape character itself (\) so a
 * user's search text is matched literally, not as a wildcard pattern.
 * @param {string} s
 * @returns {string}
 */
export function escapeLike(s) {
  return String(s).replace(/[\\%_]/g, '\\$&');
}

/**
 * @param {URL} url
 * @returns {{q: string, category: string, level: string, sort: 'newest'|'oldest', page: number}}
 */
export function parseAdminQuery(url) {
  const q = url.searchParams.get('q') || '';
  const category = url.searchParams.get('category') || '';
  const level = url.searchParams.get('level') || '';
  const sort = url.searchParams.get('sort') === 'oldest' ? 'oldest' : 'newest';
  const pageRaw = parseInt(url.searchParams.get('page') || '1', 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  return { q, category, level, sort, page };
}

/**
 * Builds the WHERE/ORDER SQL fragment (and bound params, in the same order
 * as the `?` placeholders) for a submissions list query. `statusClause` is a
 * literal SQL fragment the caller supplies (e.g. "status = 'pending'" for
 * the queue, "status != 'pending'" for history) — never user input.
 * @param {{q: string, category: string, level: string, sort: string}} query
 * @param {string} statusClause
 * @returns {{whereSql: string, orderSql: string, params: unknown[]}}
 */
export function buildAdminListQuery(query, statusClause) {
  const conditions = [statusClause];
  const params = [];
  if (query.q) {
    conditions.push("(title LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\')");
    const like = `%${escapeLike(query.q)}%`;
    params.push(like, like);
  }
  if (query.category) {
    conditions.push('category = ?');
    params.push(query.category);
  }
  if (query.level) {
    conditions.push('level = ?');
    params.push(query.level);
  }
  const whereSql = conditions.join(' AND ');
  const orderSql = query.sort === 'oldest' ? 'ORDER BY created_at ASC' : 'ORDER BY created_at DESC';
  return { whereSql, orderSql, params };
}

/**
 * A "?..." query-string suffix (or "" if there's nothing to encode) that
 * preserves the current filters while linking to a different page number.
 * @param {{q: string, category: string, level: string, sort: string}} query
 * @param {number} page
 * @returns {string}
 */
export function pageLink(query, page) {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.category) params.set('category', query.category);
  if (query.level) params.set('level', query.level);
  if (query.sort === 'oldest') params.set('sort', 'oldest');
  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/**
 * @param {number} count total matching rows
 * @returns {number} at least 1
 */
export function totalPages(count) {
  return Math.max(1, Math.ceil(count / PAGE_SIZE));
}
