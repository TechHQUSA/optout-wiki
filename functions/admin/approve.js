// functions/admin/approve.js
// POST /admin/approve — mark approved and hand the moderator a guide markdown
// scaffold to commit to git. The generated markdown embeds the untrusted body,
// so it is HTML-escaped before going into the <textarea> (also blocks a
// </textarea> breakout).
import { requireModerator } from '../_shared/access.js';
import { escapeHtml } from '../_shared/html.js';
import { generateGuideMarkdown } from '../_shared/guide-markdown.js';
import { adminHtml, adminText, isCrossSiteWrite } from '../_shared/admin.js';

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
  const id = form.get('id');
  if (typeof id !== 'string' || !id) return adminText('bad-request', 400);

  await env.DB.prepare("UPDATE submissions SET status = 'approved' WHERE id = ?").bind(id).run();
  const row = await env.DB.prepare(
    'SELECT title, category, level, body, sources FROM submissions WHERE id = ?',
  )
    .bind(id)
    .first();
  if (!row) return adminText('not-found', 404);

  const today = new Date().toISOString().slice(0, 10);
  const { filename, markdown } = generateGuideMarkdown({ ...row, sources: parseSources(row.sources) }, today);

  return adminHtml(renderApprove(filename, markdown));
}

function renderApprove(filename, markdown) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Approved</title></head><body>
<h1>Approved &mdash; commit this file</h1>
<p>Save as <code>src/content/guides/${escapeHtml(filename)}</code>, fill the <code>[ADD …]</code> placeholders, then commit:</p>
<textarea readonly rows="30" cols="100">${escapeHtml(markdown)}</textarea>
<p><a href="/admin">Back to queue</a></p>
</body></html>`;
}
