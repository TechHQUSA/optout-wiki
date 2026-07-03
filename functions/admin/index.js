// functions/admin/index.js
// GET /admin — server-rendered list of pending submissions. Form-only (no client
// JS, so the strict CSP is unchanged). Every submission field is escaped:
// submission content is untrusted and rendered into this HTML.
import { requireModerator } from '../_shared/access.js';
import { escapeHtml } from '../_shared/html.js';

export async function onRequestGet({ request, env }) {
  const denied = await requireModerator(request, env);
  if (denied) return denied;

  const { results } = await env.DB.prepare(
    "SELECT id, created_at, category, level, title, body, sources, contributor, anonymous FROM submissions WHERE status = 'pending' ORDER BY created_at DESC",
  ).all();

  return new Response(renderList(results || []), {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function actionForm(id, action, label) {
  return `<form method="POST" action="/admin/${action}"><input type="hidden" name="id" value="${escapeHtml(id)}"><button type="submit">${label}</button></form>`;
}

function renderList(rows) {
  const items = rows
    .map(
      (r) => `<article>
  <h2>${escapeHtml(r.title)}</h2>
  <p><strong>${escapeHtml(r.category)}</strong> &middot; ${escapeHtml(r.level)} &middot; by ${escapeHtml(r.anonymous ? 'anonymous' : r.contributor || '')}</p>
  <pre>${escapeHtml(r.body)}</pre>
  <p>sources: ${escapeHtml(r.sources || '[]')}</p>
  ${actionForm(r.id, 'approve', 'Approve')}
  ${actionForm(r.id, 'reject', 'Reject')}
  ${actionForm(r.id, 'delete', 'Delete')}
</article>`,
    )
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Moderation queue</title></head><body>
<h1>Pending submissions (${rows.length})</h1>
${items || '<p>Nothing pending.</p>'}
</body></html>`;
}
