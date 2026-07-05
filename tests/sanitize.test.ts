// tests/sanitize.test.ts
// Proves the markdown pipeline neutralizes raw HTML and dangerous markdown
// syntax embedded in a guide body. The threat: a moderator commits an
// anonymous submission verbatim as a .md file; without sanitization its
// <script>/onerror/javascript:/CSS-injection markup would render live.
// Each fixture below is `published:false` (never on the live site, excluded
// from getStaticPaths) and carries one payload family. See astro.config.mjs
// for the exact rehype-sanitize schema these payloads are checked against.
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { expect, test } from 'vitest';
import { getCollection } from 'astro:content';
import * as Article from '../src/pages/guides/[slug].astro';

async function renderGuide(id: string) {
  const all = await getCollection('guides');
  const entry = all.find((g) => g.id === id);
  expect(entry).toBeDefined();
  const c = await AstroContainer.create();
  return c.renderToString(Article.default, { props: { entry: entry! } });
}

// The rendered page includes legitimate chrome around the guide body: Base's
// hashed no-flash <script>, the vetting banner's own decorative <svg> icon,
// and Footer's inline style="" attributes. A blanket "no <script>/<svg>/
// style=" check against the *whole page* would false-positive on all of
// that. Scope broad structural checks to just the markdown-rendered
// <Content /> output by slicing between two stable, always-present anchors:
// the vetting banner's closing `</strong></span></div>` (unconditional,
// regardless of entry.data.sources — every fixture here has sources: []) and
// the "Improve this guide" CTA that immediately follows <Content />.
function extractGuideBody(html: string): string {
  const afterStrong = html.indexOf('</strong>');
  expect(afterStrong).toBeGreaterThan(-1);
  const divClose = html.indexOf('</div>', afterStrong);
  expect(divClose).toBeGreaterThan(-1);
  const start = divClose + '</div>'.length;
  const end = html.indexOf('improve-cta', start);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

// Shared assertion: no live XSS vector survived in the rendered guide body.
// - no <script tag (any case; the sanitize schema strips script's *content*
//   too, unlike other disallowed tags which are merely unwrapped)
// - no on\w+= inline event-handler attribute
// - no javascript:/vbscript: URL in any surviving href/src
// - if style survives at all (attribute or <style> block), it must not
//   carry expression()/url(javascript:)/@import
function expectNoLiveVector(html: string) {
  const body = extractGuideBody(html);
  expect(body).not.toMatch(/<script/i);
  expect(body).not.toMatch(/\bon\w+=/i);
  expect(body).not.toMatch(/(?:href|src)\s*=\s*["']?\s*(?:javascript|vbscript):/i);
  const styleBlocks = body.match(/<style[\s\S]*?<\/style>/gi) ?? [];
  const styleAttrs = body.match(/\bstyle\s*=\s*"[^"]*"/gi) ?? [];
  for (const block of [...styleBlocks, ...styleAttrs]) {
    expect(block).not.toMatch(/expression\(/i);
    expect(block).not.toMatch(/url\(\s*javascript:/i);
    expect(block).not.toMatch(/@import/i);
  }
}

test('rendered guide HTML contains no <script> from the body', async () => {
  const html = await renderGuide('xss-sanitize-fixture');
  expect(html).not.toContain('window.__xss');
  expect(html).not.toMatch(/<script>[^<]*window/);
});

test('rendered guide HTML strips inline event handlers and javascript: hrefs', async () => {
  const html = await renderGuide('xss-sanitize-fixture');
  expect(html).not.toContain('onerror');
  expect(html).not.toContain('javascript:alert');
});

test('legitimate markdown still renders (headings, bold)', async () => {
  const html = await renderGuide('xss-sanitize-fixture');
  expect(html).toContain('A real heading');
  expect(html).toContain('<strong>markdown</strong>');
});

// --- HTML tag vectors (OWASP XSS Filter Evasion: SVG/BODY event handlers,
// iframe javascript: URL, iframe srcdoc) ---------------------------------
test('strips <svg onload>, <body onload>, and <iframe> (src=javascript:/srcdoc)', async () => {
  const html = await renderGuide('xss-fixture-tags');
  expectNoLiveVector(html);
  const body = extractGuideBody(html);
  expect(html).not.toContain('__xss_svg');
  expect(html).not.toContain('__xss_body');
  expect(html).not.toContain('__xss_srcdoc');
  expect(body).not.toMatch(/<iframe/i);
  expect(body).not.toMatch(/<svg/i);
  expect(body).not.toMatch(/<body/i);
  // benign surrounding content still renders
  expect(body).toContain('Normal paragraph.');
});

// --- Markdown-native link/image syntax with dangerous URLs (distinct code
// path from raw HTML: goes through remark-rehype's own link/image handlers,
// so the schema's `protocols` allow-list is what strips these, not the
// raw-HTML deletion documented below). The third case URL-encodes its
// <script> payload (data:text/html,%3Cscript%3E...) rather than embedding it
// literally, because CommonMark's bare-link-destination grammar rejects
// unescaped `<`/`>` in the URL outright — a literal `<script>` there just
// fails to parse as a link at all (falls back to plain paragraph text with
// the tag independently stripped as inline HTML), which is a different,
// already-covered code path, not the protocols-allow-list one this test
// targets. ------------------------------------------------------------------
test('markdown link/image syntax drops javascript:/data: URLs but keeps the tag', async () => {
  const html = await renderGuide('xss-fixture-markdown-links');
  expectNoLiveVector(html);
  expect(html).not.toContain('__xss_datauri');
  expect(html).toContain('click me');
  expect(html).toContain('alt="alt text"');
  expect(html).toContain('data uri');
});

// --- CSS injection: style attribute (legacy IE expression(), url(javascript:))
// and a raw <style> block with @import. `style` is deliberately absent from
// the sanitize schema's attribute allow-list (see astro.config.mjs comment),
// and `style` is not in tagNames either. Unlike the mutation-XSS fixture
// below, `div`, `p`, and `style` are all CommonMark "HTML block" tags, so
// each entire line here (open tag through close tag, including the enclosed
// benign text) is captured as a single atomic raw node and deleted wholesale
// by rehype-sanitize before rehype-raw ever gets to parse it — see the
// pipeline-ordering pin test at the bottom of this file. That means even the
// harmless "styled div"/"expression paragraph" text does not survive; this
// test only asserts that nothing dangerous does. ---------------------------
test('strips style attributes and <style> blocks (expression/url(javascript:)/@import)', async () => {
  const html = await renderGuide('xss-fixture-css-injection');
  expectNoLiveVector(html);
  const body = extractGuideBody(html);
  expect(body).not.toMatch(/<style/i);
  expect(body).not.toMatch(/style\s*=/i);
  expect(body).not.toContain('expression(alert');
  expect(body).not.toContain('url(javascript:');
  expect(body).not.toContain('@import');
});

// --- Mutation-XSS classics: noscript/title parser-differential trick, and
// the math/mglyph/style foster-parenting trick (Bentkowski-style DOMPurify
// bypass). Both rely on a live browser DOM serialize/reparse (innerHTML)
// round-trip that never happens here — this is server-rendered static HTML
// written into the page once — so neither applies architecturally; this
// test proves the *rendered string itself* also carries no residue of
// either payload. ----------------------------------------------------------
test('neutralizes noscript/title and math/mglyph/style mutation-XSS payloads', async () => {
  const html = await renderGuide('xss-fixture-mutation');
  expectNoLiveVector(html);
  expect(html).not.toContain('onerror=alert');
  expect(html).not.toMatch(/<noscript/i);
  expect(html).not.toMatch(/<math/i);
  expect(html).not.toMatch(/<mglyph/i);
  expect(html).not.toMatch(/<form/i);
  expect(html).toContain('noscript text');
});

// --- Obfuscation: mixed-case tag name, HTML-entity-encoded tag, and an
// HTML-comment-wrapped tag — all classic attempts to bypass naive
// string/regex-based "strip <script>" filters. Each payload sits on its own
// line: CommonMark's HTML-block start condition for `<script>` matches
// case-insensitively, so `<ScRiPt>` on its own line is still swallowed
// wholesale (tag *and* content) exactly like lowercase `<script>` — neither
// survives even as leftover text. The entity-encoded case never begins with
// a literal `<` at all (it starts with the literal characters "&lt;"), so it
// is never HTML-block-eligible; CommonMark decodes the entity to a literal
// `<` character in a text node, which then gets safely re-escaped on output
// — it survives, but only as inert, escaped text, never as a real tag. -----
test('neutralizes mixed-case, entity-encoded, and comment-wrapped <script>', async () => {
  const html = await renderGuide('xss-fixture-obfuscation');
  expectNoLiveVector(html);
  expect(html).not.toContain('__xss_mixedcase');
  expect(html).not.toContain('__xss_comment');
  const body = extractGuideBody(html);
  // the entity-encoded case survives only as escaped text, never a live tag
  expect(body).toContain('&#x3C;script');
  expect(body).not.toMatch(/<script>window\.__xss_entity/i);
});

// --- Null-byte tag-name split, a legacy trick against sanitizers that used
// a literal-string match for "<script>" (old lenient HTML parsers ignored
// NUL bytes inside tag names). Represented with a real NUL byte in the
// fixture file (see src/content/guides/xss-fixture-null-byte.md) rather than
// as a JS string, since the payload only matters once it has gone through
// the actual markdown/HTML parser Astro uses in production. ---------------
test('neutralizes a null-byte-split <scr\\0ipt> tag', async () => {
  const html = await renderGuide('xss-fixture-null-byte');
  expectNoLiveVector(html);
  expect(html).not.toContain('alert(1)</scr');
});

// --- Pipeline-ordering pin (not a payload; a load-bearing implementation
// fact) -------------------------------------------------------------------
// Astro's markdown pipeline (`@astrojs/markdown-remark`) runs the
// `markdown.rehypePlugins` array — which is where astro.config.mjs installs
// rehype-sanitize — BEFORE it internally applies `rehype-raw`. `rehype-raw`
// is the step that turns literal raw HTML written in a markdown body (a
// hast `raw` node, produced by remark-rehype with `allowDangerousHtml`) into
// real, inspectable `element` nodes. Because rehype-sanitize runs first, it
// never sees those `raw` nodes as elements at all — hast-util-sanitize's
// `transform()` only recognizes `comment`/`doctype`/`element`/`root`/`text`,
// so an unrecognized `raw` node is simply dropped wholesale, tag AND
// contents together (confirmed empirically below with a *benign* allowed
// tag, <sup>, which is in the schema's tagNames — if sanitize were doing
// selective attribute/tag filtering against a real parsed element here, an
// allowed tag like <sup> would survive; instead the wrapping tag vanishes
// entirely and only its already-tokenized-separately inner text remains).
//
// Net effect: every XSS payload in this file that uses literal raw HTML is
// neutralized by wholesale deletion, not by the schema's tag/attribute/
// protocol allow-list actually being exercised against it. That allow-list
// *is* exercised, and does the real work, for markdown-native constructs
// (see the markdown-link/image test above). This test exists so that if a
// future Astro version reorders its internal pipeline (e.g. runs
// `rehype-raw` before user `rehypePlugins`), this test goes red immediately
// — the moment raw HTML in guide bodies starts actually reaching the
// sanitizer as real elements, the schema above needs to be re-audited
// against it, since today it never has been.
test('pin: raw HTML tags (even benign, allow-listed ones) are unwrapped, not selectively filtered', async () => {
  const html = await renderGuide('xss-fixture-raw-html-pin');
  expect(html).not.toMatch(/<sup/i);
  expect(html).not.toMatch(/<kbd/i);
  expect(html).toContain('Benign raw tag: 2 and Ctrl.');
});
