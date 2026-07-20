// functions/api/review-feed.js
//
// GET /api/review-feed — public, read-only JSON feed of pending submissions
// and their open-review comments (pipeline stage 2). No auth: openness is
// the point. What it exposes is strictly the subset intended for eventual
// publication plus review artifacts:
//
//   - guide rows: title/category/level/body (the draft steps)/sources
//   - software rows: name/category/url/summary/tags/evidence sources —
//     but NOT the body: for software submissions `body` holds the
//     contributor's justification, which the form promises is "seen by
//     moderators only".
//   - contributor name only when the contributor chose non-anonymous.
//   - comments: non-deleted only, ascending.
//
// Never exposed here: moderator emails, endorsement state, justification,
// rate-limit or ALTCHA artifacts.
const HEADERS = {
  'content-type': 'application/json',
  // the queue changes as people submit/comment/moderate — don't let a CDN
  // or browser cache pin a stale view of an "open" review
  'cache-control': 'no-store',
};

const FEED_LIMIT = 50;

const json = (obj, status) => new Response(JSON.stringify(obj), { status, headers: HEADERS });

function parseJsonArray(s) {
  try {
    const a = JSON.parse(s);
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

/**
 * Testable core.
 * @param {{DB: unknown}} env
 * @returns {Promise<Response>}
 */
export async function handleReviewFeed(env) {
  try {
    const { results: subs } = await env.DB.prepare(
      `SELECT id, created_at, type, category, level, title, body, sources, contributor, anonymous, url, tags, summary
       FROM submissions WHERE status = 'pending' ORDER BY created_at DESC LIMIT ?`,
    )
      .bind(FEED_LIMIT)
      .all();

    const list = subs || [];
    // One comments query for the whole page of ids (bounded by FEED_LIMIT).
    let commentsBySub = new Map();
    if (list.length > 0) {
      const placeholders = list.map(() => '?').join(',');
      const { results: comments } = await env.DB.prepare(
        `SELECT id, submission_id, created_at, author, body, source_flag
         FROM comments WHERE deleted = 0 AND submission_id IN (${placeholders}) ORDER BY created_at ASC`,
      )
        .bind(...list.map((s) => s.id))
        .all();
      for (const c of comments || []) {
        if (!commentsBySub.has(c.submission_id)) commentsBySub.set(c.submission_id, []);
        commentsBySub.get(c.submission_id).push({
          id: c.id,
          created_at: c.created_at,
          author: c.author || null,
          body: c.body,
          source_flag: c.source_flag ? 1 : 0,
        });
      }
    }

    const submissions = list.map((s) => {
      const base = {
        id: s.id,
        type: s.type || 'guide',
        created_at: s.created_at,
        category: s.category,
        title: s.title,
        contributor: s.anonymous ? null : s.contributor || null,
        sources: parseJsonArray(s.sources),
        comments: commentsBySub.get(s.id) || [],
      };
      if ((s.type || 'guide') === 'software') {
        // body = justification: moderator-only by promise — omitted.
        return { ...base, url: s.url, summary: s.summary, tags: parseJsonArray(s.tags) };
      }
      return { ...base, level: s.level, body: s.body };
    });

    return json({ ok: true, submissions }, 200);
  } catch {
    return json({ ok: false, error: 'unavailable' }, 503);
  }
}

export async function onRequestGet({ env }) {
  return handleReviewFeed(env);
}
