// Server-side HTML escaping for the admin surface. Submission content is
// untrusted; every value interpolated into admin HTML (text or a double-quoted
// attribute) MUST pass through this, or a `<script>`/`"` in a submission is
// stored-XSS against the moderator. Escaping `<` also prevents a `</textarea>`
// breakout when the generated markdown is shown in a <textarea>.

/**
 * @param {unknown} value
 * @returns {string} value with & < > " ' replaced by HTML entities
 */
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
