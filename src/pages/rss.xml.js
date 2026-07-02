// src/pages/rss.xml.js
// RSS 2.0 feed for the blog, generated from the same non-draft/newest-first
// query as /blog and the home page's "latest dispatch" teaser (see
// src/pages/blog/index.astro and src/pages/index.astro). `context.site`
// comes from `site` in astro.config.mjs; @astrojs/rss uses it to resolve the
// relative `link` on each item and the feed's own `<link>`/`self` refs.
import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

export async function GET(context) {
  const posts = (await getCollection('blog', (p) => !p.data.draft)).sort(
    (a, b) => +b.data.date - +a.data.date,
  );
  return rss({
    title: 'OptOut.wiki Blog',
    description: 'Weekly notes on opting out of data collection.',
    site: context.site,
    items: posts.map((p) => ({
      title: p.data.title,
      description: p.data.summary,
      pubDate: p.data.date,
      link: `/blog/${p.id}`,
    })),
  });
}
