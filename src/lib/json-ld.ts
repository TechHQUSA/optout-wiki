// src/lib/json-ld.ts
// Shared helper for embedding JSON-LD into a page's <script type="application/ld+json">
// via Astro's `set:html`. `JSON.stringify` does not escape the literal
// substring `</script>` (or `<!--`) inside string values, so embedding it
// raw lets a `<` in any field (e.g. a user-influenced title/summary) close
// the script tag early and inject HTML/script into <head>. Replacing every
// `<` with its JSON/JS-safe escape `<` neutralizes that without
// changing the JSON's parsed meaning.

/**
 * Serializes a JSON-LD object for safe embedding in a `<script set:html>` tag.
 */
export function safeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
