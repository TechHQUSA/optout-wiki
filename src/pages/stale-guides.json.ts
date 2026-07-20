// src/pages/stale-guides.json.ts
// Build-time manifest of published guides due for re-verification (stage 5).
// Static JSON asset: the admin queue Function reads it via env.ASSETS to
// render its "Due re-verification" section, and it's public by design —
// every guide page already displays its own lastVerified date.
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { isStale, daysSince } from '../lib/staleness';

export const GET: APIRoute = async () => {
  const now = Date.now();
  const guides = await getCollection('guides', (g) => g.data.published);
  const stale = guides
    .filter((g) => isStale(g.data.lastVerified, now))
    .map((g) => ({
      slug: g.id,
      title: g.data.title,
      lastVerified: g.data.lastVerified.toISOString().slice(0, 10),
      days: daysSince(g.data.lastVerified, now),
    }))
    .sort((a, b) => b.days - a.days);
  return new Response(JSON.stringify({ generated_at: new Date(now).toISOString(), stale }), {
    headers: { 'content-type': 'application/json' },
  });
};
