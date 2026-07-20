// functions/admin/delete-comment.js
// POST /admin/delete-comment — moderator removal of an open-review comment
// (spam, abuse, off-topic). SOFT delete (`deleted = 1`): the comment leaves
// every public/admin render (both query on deleted = 0) but the row stays
// for audit. Same auth + CSRF + bulk-id plumbing as the other admin writes.
import { requireModerator } from '../_shared/access.js';
import { adminText, adminRedirect, isCrossSiteWrite, parseIds } from '../_shared/admin.js';

export async function onRequestPost({ request, env }) {
  const denied = await requireModerator(request, env);
  if (denied) return denied;
  if (isCrossSiteWrite(request)) return adminText('cross-site', 403);

  const form = await request.formData();
  const ids = parseIds(form);
  if (!ids) return adminText('bad-request', 400);

  for (const id of ids) {
    await env.DB.prepare('UPDATE comments SET deleted = 1 WHERE id = ?').bind(id).run();
  }
  return adminRedirect(new URL('/admin', request.url).toString());
}
