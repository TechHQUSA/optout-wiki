// functions/admin/reject.js
// POST /admin/reject — mark rejected (row retained for audit), back to queue.
import { requireModerator } from '../_shared/access.js';
import { adminText, adminRedirect, isCrossSiteWrite } from '../_shared/admin.js';

export async function onRequestPost({ request, env }) {
  const denied = await requireModerator(request, env);
  if (denied) return denied;
  if (isCrossSiteWrite(request)) return adminText('cross-site', 403);
  const form = await request.formData();
  const id = form.get('id');
  if (typeof id !== 'string' || !id) return adminText('bad-request', 400);
  await env.DB.prepare("UPDATE submissions SET status = 'rejected' WHERE id = ?").bind(id).run();
  return adminRedirect(new URL('/admin', request.url).toString());
}
