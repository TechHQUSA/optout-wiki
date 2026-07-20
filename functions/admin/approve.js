// functions/admin/approve.js
// POST /admin/approve — pipeline stages 3 + 4.
//
// An approve POST is an ENDORSEMENT, not an immediate approval. Each
// still-pending id gets an endorsement row for the posting moderator
// (INSERT OR IGNORE onto a (submission, moderator) PK — the same editor can
// never count twice). A submission only FINALIZES (status -> approved,
// scaffold rendered) once distinct endorsers reach MIN_APPROVALS (env,
// default 2 to match the public "two editors" promise; production can run 1
// until a second Access moderator exists — flipping the var later activates
// dual review with no redeploy).
//
// The finalizing POST must also carry the stage-4 hardening checklist (all
// three `harden-*` checkboxes). A finalize attempt without them is refused
// (400) — but the endorsement itself is kept: the editor's source-check
// vote stands even when the hardening confirmation is missing.
//
// Audit: moderated_by/at = the finalizing moderator; hardened_by/at = same
// (the finalizer is the one confirming the checklist). The UPDATE keeps the
// `AND status = 'pending'` guard so re-moderation can't overwrite audit.
import { requireModerator, getModeratorEmail } from '../_shared/access.js';
import { escapeHtml } from '../_shared/html.js';
import { generateGuideMarkdown } from '../_shared/guide-markdown.js';
import { generateSoftwareEntry } from '../_shared/software-entry.js';
import { adminHtml, adminText, isCrossSiteWrite, parseIds } from '../_shared/admin.js';

const HARDEN_FIELDS = ['harden-stripped', 'harden-tradeoffs', 'harden-dated'];

/** MIN_APPROVALS env parse: default 2, garbage/0 -> 2. */
export function minApprovals(env) {
  const n = parseInt(env?.MIN_APPROVALS ?? '2', 10);
  return Number.isFinite(n) && n > 0 ? n : 2;
}

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
  const min = minApprovals(env);
  const hardened = HARDEN_FIELDS.every((f) => form.get(f) === 'on');

  const blocks = []; // finalized scaffolds
  const awaiting = []; // {id, count} endorsed but below threshold
  const hardeningBlocked = []; // at threshold but checklist missing

  for (const id of ids) {
    // Endorsements attach only to still-pending submissions.
    const current = await env.DB.prepare('SELECT status FROM submissions WHERE id = ?').bind(id).first();
    if (!current || current.status !== 'pending') continue;

    await env.DB.prepare(
      'INSERT OR IGNORE INTO endorsements (submission_id, moderator, endorsed_at) VALUES (?,?,?)',
    )
      .bind(id, moderatedBy, now)
      .run();
    const countRow = await env.DB.prepare('SELECT COUNT(*) AS n FROM endorsements WHERE submission_id = ?')
      .bind(id)
      .first();
    const count = countRow?.n ?? 0;

    if (count < min) {
      awaiting.push({ id, count });
      continue;
    }
    if (!hardened) {
      hardeningBlocked.push(id);
      continue;
    }

    // Finalize (guarded; see header).
    const result = await env.DB.prepare(
      "UPDATE submissions SET status = 'approved', moderated_by = ?, moderated_at = ?, hardened_by = ?, hardened_at = ? WHERE id = ? AND status = 'pending'",
    )
      .bind(moderatedBy, now, moderatedBy, now, id)
      .run();
    if (result?.meta?.changes === 0) continue;
    const row = await env.DB.prepare(
      'SELECT type, title, category, level, body, sources, url, tags, summary FROM submissions WHERE id = ?',
    )
      .bind(id)
      .first();
    if (!row) continue;
    if (row.type === 'software') {
      const { id: entryId, json } = generateSoftwareEntry(row);
      blocks.push({ kind: 'software', entryId, json });
    } else {
      const { filename, markdown } = generateGuideMarkdown({ ...row, sources: parseSources(row.sources) }, today);
      blocks.push({ kind: 'guide', filename, markdown });
    }
  }

  if (blocks.length === 0 && awaiting.length === 0 && hardeningBlocked.length === 0) {
    return adminText('not-found', 404);
  }
  // A pure hardening refusal is an error the moderator must act on; any mix
  // that produced real output renders as a normal page with warnings.
  const status = blocks.length === 0 && awaiting.length === 0 && hardeningBlocked.length > 0 ? 400 : 200;
  return adminHtml(renderApprove(blocks, awaiting, hardeningBlocked, min), status);
}

function renderApprove(blocks, awaiting, hardeningBlocked, min) {
  const sections = blocks
    .map((b) =>
      b.kind === 'software'
        ? `<section>
  <p>Add this entry (id <code>${escapeHtml(b.entryId)}</code>) to <code>src/content/software/software.json</code>, then commit:</p>
  <textarea readonly rows="12" cols="100">${escapeHtml(b.json)}</textarea>
</section>`
        : `<section>
  <p>Save as <code>src/content/guides/${escapeHtml(b.filename)}</code>, fill the <code>[ADD …]</code> placeholders, then commit:</p>
  <textarea readonly rows="30" cols="100">${escapeHtml(b.markdown)}</textarea>
</section>`,
    )
    .join('\n');
  const awaitingHtml = awaiting.length
    ? `<section class="awaiting">
  <h2>Endorsed — awaiting another editor</h2>
  ${awaiting
    .map(
      (a) =>
        `<p>Submission <code>${escapeHtml(a.id)}</code>: endorsed ${a.count}/${min} — a second editor must approve before it finalizes.</p>`,
    )
    .join('\n')}
</section>`
    : '';
  const hardeningHtml = hardeningBlocked.length
    ? `<section class="hardening-blocked">
  <h2>Hardening checklist required</h2>
  <p>These submissions have enough endorsements but were NOT approved — the finalizing approval must confirm all three hardening checks (risky content stripped, trade-offs stated, steps dated):</p>
  ${hardeningBlocked.map((id) => `<p><code>${escapeHtml(id)}</code></p>`).join('\n')}
</section>`
    : '';
  const heading =
    blocks.length > 0
      ? `Approved (${blocks.length}) &mdash; commit ${blocks.length === 1 ? 'this file' : 'these files'}`
      : 'No submissions finalized';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Approve result</title><link rel="stylesheet" href="/admin.css"></head><body>
<h1>${heading}</h1>
${sections}
${awaitingHtml}
${hardeningHtml}
<p><a href="/admin">Back to queue</a></p>
</body></html>`;
}
