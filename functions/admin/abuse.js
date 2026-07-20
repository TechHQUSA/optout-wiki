// functions/admin/abuse.js
// GET /admin/abuse — Project B: a passive dashboard of bot/abuse-signal
// counts (honeypot trips, failed ALTCHA solves, rate-limit 429s) over the
// last 14 days. Observability only — never changes any abuse-mitigation
// threshold. Opportunistically sweeps rows older than 90 days on load (no
// Cron Trigger wired for this project — same piggyback pattern as
// security.js's sweepStaleRateLimits / the stale-guides manifest read).
import { requireModerator } from '../_shared/access.js';
import { escapeHtml } from '../_shared/html.js';
import { adminHtml } from '../_shared/admin.js';
import { renderNav } from '../_shared/admin-chrome.js';
import { sweepStaleAbuseEvents, pivotAbuseEvents } from '../_shared/abuse.js';

const DAYS_SHOWN = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function onRequestGet({ request, env }) {
  const denied = await requireModerator(request, env);
  if (denied) return denied;

  const now = Date.now();
  await sweepStaleAbuseEvents(env.DB, now);

  const cutoff = now - DAYS_SHOWN * DAY_MS;
  const { results } = await env.DB.prepare(
    `SELECT date(created_at/1000, 'unixepoch') AS day, type, COUNT(*) AS n FROM abuse_events WHERE created_at >= ? GROUP BY day, type ORDER BY day DESC`,
  )
    .bind(cutoff)
    .all();

  const rows = pivotAbuseEvents(results || []);
  return adminHtml(renderAbuse(rows));
}

function renderAbuse(rows) {
  const body = rows.length
    ? rows
        .map(
          (r) =>
            `<tr><td>${escapeHtml(r.day)}</td><td>${r.honeypot}</td><td>${r.altcha}</td><td>${r.rate}</td><td>${r.total}</td></tr>`,
        )
        .join('\n')
    : '<tr><td colspan="5">No abuse events in the last 14 days.</td></tr>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Abuse dashboard</title><link rel="stylesheet" href="/admin.css"></head><body>
${renderNav('abuse')}
<h1>Abuse events (last ${DAYS_SHOWN} days)</h1>
<table>
<thead><tr><th>Day</th><th>Honeypot</th><th>ALTCHA fail</th><th>Rate limit</th><th>Total</th></tr></thead>
<tbody>
${body}
</tbody>
</table>
</body></html>`;
}
