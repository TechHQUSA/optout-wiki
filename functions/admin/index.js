// functions/admin/index.js
// GET /admin — server-rendered, searchable/filterable/sortable/paginated
// queue of pending submissions. Every submission field is escaped:
// submission content is untrusted and rendered into this HTML.
import { requireModerator } from '../_shared/access.js';
import { escapeHtml } from '../_shared/html.js';
import { adminHtml } from '../_shared/admin.js';
import { parseAdminQuery, buildAdminListQuery, totalPages, pageLink, PAGE_SIZE } from '../_shared/admin-query.js';
import { renderNav, renderFilterForm, renderPagination } from '../_shared/admin-chrome.js';
import { minApprovals } from './approve.js';

export async function onRequestGet({ request, env }) {
  const denied = await requireModerator(request, env);
  if (denied) return denied;

  const url = new URL(request.url);
  const query = parseAdminQuery(url);
  const { whereSql, orderSql, params } = buildAdminListQuery(query, "status = 'pending'");
  const offset = (query.page - 1) * PAGE_SIZE;

  const { results } = await env.DB.prepare(
    `SELECT id, created_at, type, category, level, title, body, sources, contributor, anonymous, url, tags, summary,
       (SELECT COUNT(*) FROM endorsements e WHERE e.submission_id = submissions.id) AS endorsement_count
     FROM submissions WHERE ${whereSql} ${orderSql} LIMIT ? OFFSET ?`,
  )
    .bind(...params, PAGE_SIZE, offset)
    .all();
  const countRow = await env.DB.prepare(`SELECT COUNT(*) as n FROM submissions WHERE ${whereSql}`)
    .bind(...params)
    .first();

  // Open-review comments for this page of submissions (non-deleted only),
  // grouped by submission for the render below.
  const rows = results || [];
  const commentsBySub = new Map();
  if (rows.length > 0) {
    const placeholders = rows.map(() => '?').join(',');
    const { results: comments } = await env.DB.prepare(
      `SELECT id, submission_id, created_at, author, body, source_flag FROM comments WHERE deleted = 0 AND submission_id IN (${placeholders}) ORDER BY created_at ASC`,
    )
      .bind(...rows.map((r) => r.id))
      .all();
    for (const c of comments || []) {
      if (!commentsBySub.has(c.submission_id)) commentsBySub.set(c.submission_id, []);
      commentsBySub.get(c.submission_id).push(c);
    }
  }

  // Stage-5 staleness: guides due re-verification, from the build-time
  // manifest (a static asset — env.ASSETS is the Pages static binding).
  // Fail-soft: a missing/broken manifest must never take the queue down.
  let staleGuides = [];
  try {
    const assetRes = await env.ASSETS.fetch(new URL('/stale-guides.json', request.url));
    if (assetRes.ok) {
      const manifest = await assetRes.json();
      if (Array.isArray(manifest?.stale)) staleGuides = manifest.stale;
    }
  } catch {
    staleGuides = [];
  }

  return adminHtml(renderQueue(rows, query, countRow?.n ?? 0, minApprovals(env), commentsBySub, staleGuides));
}

// Open-review comments under a queue row: escaped, flag-highlighted, each
// with its own soft-delete form.
function renderComments(comments) {
  if (!comments.length) return '';
  const items = comments
    .map(
      (c) => `<div class="admin-comment${c.source_flag ? ' admin-comment-flag' : ''}">
    ${c.source_flag ? '<span class="flag-tag">no working source</span>' : ''}
    <strong>${escapeHtml(c.author || 'anonymous')}</strong>: ${escapeHtml(c.body)}
    <form method="POST" action="/admin/delete-comment" class="comment-delete"><input type="hidden" name="id" value="${escapeHtml(c.id)}"><button type="submit">Delete comment</button></form>
  </div>`,
    )
    .join('\n');
  return `<div class="admin-comments"><p><strong>Review comments (${comments.length})</strong></p>${items}</div>`;
}

// Guides overdue for re-verification (stage 5), from stale-guides.json.
function renderStaleSection(staleGuides) {
  if (!staleGuides.length) return '';
  const items = staleGuides
    .map(
      (g) =>
        `<li><code>${escapeHtml(String(g.slug || ''))}</code> — last verified ${escapeHtml(String(g.lastVerified || '?'))} (${Number(g.days) || '?'} days ago)</li>`,
    )
    .join('\n');
  return `<section class="stale-section">
<h2>Due re-verification (${staleGuides.length})</h2>
<p>Re-test these guides, then bump <code>lastVerified</code> in git:</p>
<ul>${items}</ul>
</section>`;
}

function actionForm(id, action, label, extra = '') {
  return `<form method="POST" action="/admin/${action}"><input type="hidden" name="id" value="${escapeHtml(id)}">${extra}<button type="submit">${label}</button></form>`;
}

// Stage-4 hardening checklist. Rendered inside each per-row approve form and
// once on the bulk bar (with form="bulk-form" so the inputs submit with it).
// approve.js refuses to FINALIZE without all three — endorsing below the
// threshold works without them.
function hardenChecklist(formAttr = '') {
  const box = (name, label) =>
    `<label class="harden-check"><input type="checkbox" name="${name}"${formAttr} value="on"> ${label}</label>`;
  return `<span class="harden-checks">${box('harden-stripped', 'risky content stripped')}${box('harden-tradeoffs', 'trade-offs stated')}${box('harden-dated', 'steps dated')}</span>`;
}

function renderQueue(rows, query, count, min, commentsBySub, staleGuides) {
  const pages = totalPages(count);
  const items = rows
    .map((r) => {
      const badge = `<span class="type-badge">[${escapeHtml(r.type || 'guide')}]</span>`;
      // Software rows: url/summary/tags are the would-be-published fields, the
      // body is the contributor's justification (moderator-only) and sources
      // are their evidence links — all untrusted, all escaped. Rendered as
      // text, never as live <a href> (a hostile submitted URL stays inert).
      const softwareBlock =
        r.type === 'software'
          ? `<p>url: ${escapeHtml(r.url || '')}</p>
  <p>summary: ${escapeHtml(r.summary || '')}</p>
  <p>tags: ${escapeHtml(r.tags || '[]')}</p>
  <p>justification:</p>
  <pre>${escapeHtml(r.body)}</pre>
  <p>evidence: ${escapeHtml(r.sources || '[]')}</p>`
          : `<pre>${escapeHtml(r.body)}</pre>
  <p>sources: ${escapeHtml(r.sources || '[]')}</p>`;
      const endorsements = `<p class="endorsement-count">endorsements: ${Number(r.endorsement_count) || 0}/${min}</p>`;
      return `<article>
  <input type="checkbox" name="id" value="${escapeHtml(r.id)}" form="bulk-form">
  <h2>${badge} ${escapeHtml(r.title)}</h2>
  <p><strong>${escapeHtml(r.category)}</strong> &middot; ${escapeHtml(r.level || '')} &middot; by ${escapeHtml(r.anonymous ? 'anonymous' : r.contributor || '')}</p>
  ${softwareBlock}
  ${renderComments(commentsBySub.get(r.id) || [])}
  ${endorsements}
  <div class="admin-actions">
    ${actionForm(r.id, 'approve', 'Approve', hardenChecklist())}
    ${actionForm(r.id, 'reject', 'Reject')}
    ${actionForm(r.id, 'delete', 'Delete')}
  </div>
</article>`;
    })
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Moderation queue</title><link rel="stylesheet" href="/admin.css"></head><body>
${renderNav('queue')}
${renderFilterForm(query, '/admin')}
<form id="bulk-form" method="POST"><input type="hidden" name="return_to" value="${escapeHtml(`/admin${pageLink(query, query.page)}`)}"></form>
<h1>Pending submissions (${count})</h1>
${renderStaleSection(staleGuides)}
${items || '<p>Nothing pending.</p>'}
<div class="admin-bulk-actions">
  <span><span data-selected-count>0</span> selected</span>
  ${hardenChecklist(' form="bulk-form"')}
  <button type="submit" form="bulk-form" formaction="/admin/approve">Approve selected</button>
  <button type="submit" form="bulk-form" formaction="/admin/reject">Reject selected</button>
  <button type="submit" form="bulk-form" formaction="/admin/delete" data-confirm="delete">Delete selected</button>
</div>
${renderPagination('/admin', query, query.page, pages)}
<script type="module" src="/admin.js"></script>
</body></html>`;
}
