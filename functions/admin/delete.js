// functions/admin/delete.js
// POST /admin/delete — hard-remove a row (obvious spam), back to queue.
import { requireModerator } from '../_shared/access.js';

export async function onRequestPost({ request, env }) {
  const denied = await requireModerator(request, env);
  if (denied) return denied;
  const form = await request.formData();
  const id = form.get('id');
  if (!id) return new Response('bad-request', { status: 400 });
  await env.DB.prepare('DELETE FROM submissions WHERE id = ?').bind(id).run();
  return Response.redirect(new URL('/admin', request.url), 303);
}
