import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://optout.wiki',
  output: 'static',
  integrations: [sitemap()],
  build: { format: 'directory' }, // clean URLs: /guides/ -> guides/index.html
});
