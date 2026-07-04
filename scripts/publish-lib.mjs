// scripts/publish-lib.mjs
// Pure helpers for the batch publisher (scripts/publish-approved.mjs). Kept
// separate and I/O-free so they unit-test cleanly.

/**
 * True if the text still contains a generator placeholder (`[ADD SUMMARY]`,
 * `[ADD LABEL]`, or any `[ADD …]`). Guards against publishing an incomplete
 * guide whose summary/source-labels a moderator has not filled in yet.
 * @param {string} text
 * @returns {boolean}
 */
export function hasUnfilledPlaceholders(text) {
  return /\[ADD [^\]]*\]/.test(String(text));
}

/**
 * Parse `wrangler d1 execute --json` stdout into a flat list of submission
 * rows, decoding each row's `sources` (stored as a JSON string) into an array.
 * A row whose `sources` is null/absent/invalid yields `[]` rather than throwing.
 * @param {string} stdout
 * @returns {Array<{id:string,title:string,category:string,level:string,body:string,sources:string[]}>}
 */
export function parseApprovedRows(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  const blocks = Array.isArray(parsed) ? parsed : [parsed];
  const rows = blocks.flatMap((b) => (b && Array.isArray(b.results) ? b.results : []));
  return rows.map((r) => ({ ...r, sources: normalizeSources(r.sources) }));
}

function normalizeSources(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((s) => typeof s === 'string') : [];
  } catch {
    return [];
  }
}
