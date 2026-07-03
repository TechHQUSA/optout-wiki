// functions/admin/reject.js
// POST /admin/reject — mark rejected (row retained for audit), back to queue.
import { requireModerator } from '../_shared/access.js';

export async function onRequestPost({ request, env }) {
  const denied = await requireModerator(request, env);
  if (denied) return denied;
  const form = await request.formData();
  const id = form.get('id');
  if (!id) return new Response('bad-request', { status: 400 });
  await env.DB.prepare("UPDATE submissions SET status = 'rejected' WHERE id = ?").bind(id).run();
  return Response.redirect(new URL('/admin', request.url), 303);
}
