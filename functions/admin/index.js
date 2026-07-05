// functions/admin/index.js
// GET /admin — server-rendered, searchable/filterable/sortable/paginated
// queue of pending submissions. Every submission field is escaped:
// submission content is untrusted and rendered into this HTML.
import { requireModerator } from '../_shared/access.js';
import { escapeHtml } from '../_shared/html.js';
import { adminHtml } from '../_shared/admin.js';
import { parseAdminQuery, buildAdminListQuery, totalPages, PAGE_SIZE } from '../_shared/admin-query.js';
import { renderNav, renderFilterForm, renderPagination } from '../_shared/admin-chrome.js';

export async function onRequestGet({ request, env }) {
  const denied = await requireModerator(request, env);
  if (denied) return denied;

  const url = new URL(request.url);
  const query = parseAdminQuery(url);
  const { whereSql, orderSql, params } = buildAdminListQuery(query, "status = 'pending'");
  const offset = (query.page - 1) * PAGE_SIZE;

  const { results } = await env.DB.prepare(
    `SELECT id, created_at, category, level, title, body, sources, contributor, anonymous FROM submissions WHERE ${whereSql} ${orderSql} LIMIT ? OFFSET ?`,
  )
    .bind(...params, PAGE_SIZE, offset)
    .all();
  const countRow = await env.DB.prepare(`SELECT COUNT(*) as n FROM submissions WHERE ${whereSql}`)
    .bind(...params)
    .first();

  return adminHtml(renderQueue(results || [], query, countRow?.n ?? 0));
}

function actionForm(id, action, label) {
  return `<form method="POST" action="/admin/${action}"><input type="hidden" name="id" value="${escapeHtml(id)}"><button type="submit">${label}</button></form>`;
}

function renderQueue(rows, query, count) {
  const pages = totalPages(count);
  const items = rows
    .map(
      (r) => `<article>
  <input type="checkbox" name="id" value="${escapeHtml(r.id)}" form="bulk-form">
  <h2>${escapeHtml(r.title)}</h2>
  <p><strong>${escapeHtml(r.category)}</strong> &middot; ${escapeHtml(r.level || '')} &middot; by ${escapeHtml(r.anonymous ? 'anonymous' : r.contributor || '')}</p>
  <pre>${escapeHtml(r.body)}</pre>
  <p>sources: ${escapeHtml(r.sources || '[]')}</p>
  ${actionForm(r.id, 'approve', 'Approve')}
  ${actionForm(r.id, 'reject', 'Reject')}
  ${actionForm(r.id, 'delete', 'Delete')}
</article>`,
    )
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Moderation queue</title><link rel="stylesheet" href="/admin.css"></head><body>
${renderNav('queue')}
${renderFilterForm(query, '/admin')}
<form id="bulk-form" method="POST"></form>
<h1>Pending submissions (${count})</h1>
${items || '<p>Nothing pending.</p>'}
<div class="admin-bulk-actions">
  <span><span data-selected-count>0</span> selected</span>
  <button type="submit" form="bulk-form" formaction="/admin/approve">Approve selected</button>
  <button type="submit" form="bulk-form" formaction="/admin/reject">Reject selected</button>
  <button type="submit" form="bulk-form" formaction="/admin/delete" data-confirm="delete">Delete selected</button>
</div>
${renderPagination('/admin', query, query.page, pages)}
<script type="module" src="/admin.js"></script>
</body></html>`;
}
