// functions/admin/reject.js
// POST /admin/reject — mark one or more submissions rejected (rows retained
// for audit), write who/when, back to queue.
import { requireModerator, getModeratorEmail } from '../_shared/access.js';
import { adminText, adminRedirect, isCrossSiteWrite, parseIds } from '../_shared/admin.js';

export async function onRequestPost({ request, env }) {
  const denied = await requireModerator(request, env);
  if (denied) return denied;
  if (isCrossSiteWrite(request)) return adminText('cross-site', 403);

  const form = await request.formData();
  const ids = parseIds(form);
  if (!ids) return adminText('bad-request', 400);

  const moderatedBy = await getModeratorEmail(request, env);
  const now = Date.now();
  for (const id of ids) {
    await env.DB.prepare(
      "UPDATE submissions SET status = 'rejected', moderated_by = ?, moderated_at = ? WHERE id = ?",
    )
      .bind(moderatedBy, now, id)
      .run();
  }
  return adminRedirect(new URL('/admin', request.url).toString());
}
