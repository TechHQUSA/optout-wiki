// functions/admin/approve.js
// POST /admin/approve — mark one or more submissions approved, write the
// moderation audit trail (moderated_by/moderated_at), and hand the moderator
// a guide markdown scaffold per submission to commit to git. Each generated
// markdown embeds the untrusted body, so it is HTML-escaped before going
// into its <textarea> (also blocks a </textarea> breakout).
import { requireModerator, getModeratorEmail } from '../_shared/access.js';
import { escapeHtml } from '../_shared/html.js';
import { generateGuideMarkdown } from '../_shared/guide-markdown.js';
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
    await env.DB.prepare(
      "UPDATE submissions SET status = 'approved', moderated_by = ?, moderated_at = ? WHERE id = ?",
    )
      .bind(moderatedBy, now, id)
      .run();
    const row = await env.DB.prepare(
      'SELECT title, category, level, body, sources FROM submissions WHERE id = ?',
    )
      .bind(id)
      .first();
    if (!row) continue;
    const { filename, markdown } = generateGuideMarkdown({ ...row, sources: parseSources(row.sources) }, today);
    blocks.push({ filename, markdown });
  }

  if (blocks.length === 0) return adminText('not-found', 404);

  return adminHtml(renderApprove(blocks));
}

function renderApprove(blocks) {
  const sections = blocks
    .map(
      ({ filename, markdown }) => `<section>
  <p>Save as <code>src/content/guides/${escapeHtml(filename)}</code>, fill the <code>[ADD …]</code> placeholders, then commit:</p>
  <textarea readonly rows="30" cols="100">${escapeHtml(markdown)}</textarea>
</section>`,
    )
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><link rel="stylesheet" href="/admin.css"></head><body>
<h1>Approved (${blocks.length}) &mdash; commit ${blocks.length === 1 ? 'this file' : 'these files'}</h1>
${sections}
<p><a href="/admin">Back to queue</a></p>
</body></html>`;
}
