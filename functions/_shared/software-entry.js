// functions/_shared/software-entry.js
// Pure transform: a moderation submission row (type='software') -> the JSON
// object entry a moderator pastes into src/content/software/software.json.
// Software analog of guide-markdown.js: no I/O, no clock, unit-tests cleanly.
// The row's `tags` column is a JSON string (as stored by the contribute
// endpoint) but an already-parsed array is accepted too; anything malformed
// degrades to [] rather than throwing (same fail-soft stance as
// generateGuideMarkdown's sources guard).
import { slugify } from './guide-markdown.js';

function parseTags(tags) {
  if (Array.isArray(tags)) return tags.filter((t) => typeof t === 'string');
  if (typeof tags !== 'string') return [];
  try {
    const a = JSON.parse(tags);
    return Array.isArray(a) ? a.filter((t) => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * @param {{title: string, category: string, url: string, summary: string, tags?: unknown}} row
 * @returns {{id: string, json: string}} `json` is the pretty-printed entry object
 */
export function generateSoftwareEntry(row) {
  const id = slugify(row.title);
  const entry = {
    id,
    name: String(row.title),
    category: String(row.category),
    url: String(row.url),
    summary: String(row.summary),
    tags: parseTags(row.tags),
  };
  return { id, json: JSON.stringify(entry, null, 2) };
}
