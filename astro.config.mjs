import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';

// Sanitize schema for markdown-rendered guide bodies. Guides can originate from
// anonymous submissions that a moderator commits verbatim, so raw HTML in a
// body is untrusted: rehype-sanitize strips <script>/<style>/<iframe>, inline
// event handlers (onerror=...), and javascript:/data: hrefs — the stored-XSS,
// CSS-injection, and malware-link vectors. Two deliberate allowances over the
// GitHub default:
//   - `id` on headings is preserved (and the DOM-clobber prefix cleared) so the
//     on-this-page TOC anchors (#slug) still resolve. Heading ids come from
//     Astro's slugger, derived from heading text.
//   - `class`/`style` are NOT added to the schema; instead syntax highlighting
//     is disabled below so no Shiki-generated style/class needs allow-listing —
//     that keeps `style` fully banned in body HTML, closing CSS injection.
const sanitizeSchema = {
  ...defaultSchema,
  clobberPrefix: '',
  clobber: [],
  attributes: {
    ...defaultSchema.attributes,
    h1: [...(defaultSchema.attributes?.h1 ?? []), 'id'],
    h2: [...(defaultSchema.attributes?.h2 ?? []), 'id'],
    h3: [...(defaultSchema.attributes?.h3 ?? []), 'id'],
    h4: [...(defaultSchema.attributes?.h4 ?? []), 'id'],
    h5: [...(defaultSchema.attributes?.h5 ?? []), 'id'],
    h6: [...(defaultSchema.attributes?.h6 ?? []), 'id'],
  },
};

export default defineConfig({
  site: 'https://optout.wiki',
  output: 'static',
  integrations: [sitemap()],
  build: { format: 'directory' }, // clean URLs: /guides/ -> guides/index.html
  vite: { build: { assetsInlineLimit: 0 } },
  markdown: {
    // No Shiki: article prose CSS styles <pre>/<code> itself, and disabling it
    // means the sanitize schema never has to allow style/class on code spans.
    syntaxHighlight: false,
    rehypePlugins: [[rehypeSanitize, sanitizeSchema]],
  },
});
