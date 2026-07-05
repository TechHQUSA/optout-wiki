// functions/admin/history.js
// GET /admin/history — server-rendered, searchable/filterable/sortable/
// paginated view of already-moderated (approved/rejected) submissions, with
// who moderated each and when. Read-only except a bulk-delete for purging
// old rejected spam — approve/reject aren't offered here, those rows are
// already moderated.
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
  const { whereSql, orderSql, params } = buildAdminListQuery(query, "status != 'pending'");
  const offset = (query.page - 1) * PAGE_SIZE;

  const { results } = await env.DB.prepare(
    `SELECT id, created_at, category, level, title, status, moderated_by, moderated_at FROM submissions WHERE ${whereSql} ${orderSql} LIMIT ? OFFSET ?`,
  )
    .bind(...params, PAGE_SIZE, offset)
    .all();
  const countRow = await env.DB.prepare(`SELECT COUNT(*) as n FROM submissions WHERE ${whereSql}`)
    .bind(...params)
    .first();

  return adminHtml(renderHistory(results || [], query, countRow?.n ?? 0));
}

function renderHistory(rows, query, count) {
  const pages = totalPages(count);
  const items = rows
    .map((r) => {
      const when = r.moderated_at ? new Date(r.moderated_at).toISOString().slice(0, 10) : null;
      return `<article>
  <input type="checkbox" name="id" value="${escapeHtml(r.id)}" form="bulk-form">
  <h2>${escapeHtml(r.title)}</h2>
  <p><strong>${escapeHtml(r.category)}</strong> &middot; ${escapeHtml(r.level || '')} &middot; ${escapeHtml(r.status)}</p>
  <p>moderated by ${escapeHtml(r.moderated_by || 'unknown')}${when ? ` on ${escapeHtml(when)}` : ''}</p>
</article>`;
    })
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Moderation history</title><link rel="stylesheet" href="/admin.css"></head><body>
${renderNav('history')}
${renderFilterForm(query, '/admin/history')}
<form id="bulk-form" method="POST"></form>
<h1>History (${count})</h1>
${items || '<p>No history yet.</p>'}
<div class="admin-bulk-actions">
  <span><span data-selected-count>0</span> selected</span>
  <button type="submit" form="bulk-form" formaction="/admin/delete" data-confirm="delete">Delete selected</button>
</div>
${renderPagination('/admin/history', query, query.page, pages)}
<script type="module" src="/admin.js"></script>
</body></html>`;
}
