//
// Pure transform: a moderation submission row -> a guide markdown scaffold that
// matches the content schema in src/content.config.ts. The submissions table has
// no `summary` and its sources are bare URLs (no labels), while the guide schema
// requires both, so those are emitted as `[ADD …]` placeholders the moderator
// fills in when they commit the file to git. No I/O, no clock — `today` is
// passed in — so it unit-tests cleanly.

/** Double-quoted YAML scalar with backslash/quote escaping. */
function yamlQuote(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * @param {string} title
 * @returns {string} kebab-case slug, non-empty, <=80 chars
 */
export function slugify(title) {
  const s = String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return s || 'guide';
}

/**
 * @param {{title: string, category: string, level: string, body: string, sources?: string[]}} submission
 * @param {string} today YYYY-MM-DD
 * @returns {{filename: string, markdown: string}}
 */
export function generateGuideMarkdown(submission, today) {
  const { title, category, level, body, sources = [] } = submission;
  const lines = [
    '---',
    `title: ${yamlQuote(title)}`,
    `category: ${yamlQuote(category)}`,
    `level: ${level}`,
    'summary: "[ADD SUMMARY]"',
  ];
  if (sources.length) {
    lines.push('sources:');
    for (const url of sources) lines.push(`  - { label: "[ADD LABEL]", url: ${yamlQuote(url)} }`);
  } else {
    lines.push('sources: []');
  }
  lines.push(`lastVerified: ${today}`, 'published: true', '---');
  return { filename: `${slugify(title)}.md`, markdown: `${lines.join('\n')}\n\n${body}\n` };
}
