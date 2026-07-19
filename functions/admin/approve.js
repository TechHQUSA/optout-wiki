// functions/admin/approve.js
// POST /admin/approve — mark one or more submissions approved, write the
// moderation audit trail (moderated_by/moderated_at), and hand the moderator
// a guide markdown scaffold per submission to commit to git. Each generated
// markdown embeds the untrusted body, so it is HTML-escaped before going
// into its <textarea> (also blocks a </textarea> breakout).
import { requireModerator, getModeratorEmail } from '../_shared/access.js';
import { escapeHtml } from '../_shared/html.js';
import { generateGuideMarkdown } from '../_shared/guide-markdown.js';
import { generateSoftwareEntry } from '../_shared/software-entry.js';
import { adminHtml, adminText, isCrossSiteWrite, parseIds } from '../_shared/admin.js';

function parseSources(s) {
  try {
    const a = JSON.parse(s);
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

export async function onRequestPost({ request, env }) {
  const denied = await requireModerator(request, env);
  if (denied) return denied;

  if (isCrossSiteWrite(request)) return adminText('cross-site', 403);

  const form = await request.formData();
  const ids = parseIds(form);
  if (!ids) return adminText('bad-request', 400);

  const moderatedBy = await getModeratorEmail(request, env);
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);

  const blocks = [];
  for (const id of ids) {
    // Guarded UPDATE: only a still-pending row is approved, so re-moderating
    // an already-moderated id can never overwrite its moderated_by/at audit
    // trail. A 0-changes result (missing OR already moderated) skips the row
    // entirely — no scaffold. An absent meta (non-D1 mock) counts as changed.
    const result = await env.DB.prepare(
      "UPDATE submissions SET status = 'approved', moderated_by = ?, moderated_at = ? WHERE id = ? AND status = 'pending'",
    )
      .bind(moderatedBy, now, id)
      .run();
    if (result?.meta?.changes === 0) continue;
    const row = await env.DB.prepare(
      'SELECT type, title, category, level, body, sources, url, tags, summary FROM submissions WHERE id = ?',
    )
      .bind(id)
      .first();
    if (!row) continue;
    if (row.type === 'software') {
      const { id: entryId, json } = generateSoftwareEntry(row);
      blocks.push({ kind: 'software', entryId, json });
    } else {
      const { filename, markdown } = generateGuideMarkdown({ ...row, sources: parseSources(row.sources) }, today);
      blocks.push({ kind: 'guide', filename, markdown });
    }
  }

  if (blocks.length === 0) return adminText('not-found', 404);

  return adminHtml(renderApprove(blocks));
}

function renderApprove(blocks) {
  const sections = blocks
    .map((b) =>
      b.kind === 'software'
        ? `<section>
  <p>Add this entry (id <code>${escapeHtml(b.entryId)}</code>) to <code>src/content/software/software.json</code>, then commit:</p>
  <textarea readonly rows="12" cols="100">${escapeHtml(b.json)}</textarea>
</section>`
        : `<section>
  <p>Save as <code>src/content/guides/${escapeHtml(b.filename)}</code>, fill the <code>[ADD …]</code> placeholders, then commit:</p>
  <textarea readonly rows="30" cols="100">${escapeHtml(b.markdown)}</textarea>
</section>`,
    )
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><link rel="stylesheet" href="/admin.css"></head><body>
<h1>Approved (${blocks.length}) &mdash; commit ${blocks.length === 1 ? 'this file' : 'these files'}</h1>
${sections}
<p><a href="/admin">Back to queue</a></p>
</body></html>`;
}
