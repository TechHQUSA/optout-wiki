// functions/admin/delete.js
// POST /admin/delete — hard-remove one or more rows (obvious spam), back to
// queue. No audit trail: a deleted row has nothing left to audit.
import { requireModerator } from '../_shared/access.js';
import { adminText, adminRedirect, isCrossSiteWrite, parseIds, safeReturnTo } from '../_shared/admin.js';

export async function onRequestPost({ request, env }) {
  const denied = await requireModerator(request, env);
  if (denied) return denied;
  if (isCrossSiteWrite(request)) return adminText('cross-site', 403);

  const form = await request.formData();
  const ids = parseIds(form);
  if (!ids) return adminText('bad-request', 400);

  for (const id of ids) {
    await env.DB.prepare('DELETE FROM submissions WHERE id = ?').bind(id).run();
  }
  return adminRedirect(new URL(safeReturnTo(form), request.url).toString());
}
