import { defineCollection, z } from 'astro:content';
import { glob, file } from 'astro/loaders';

const guides = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/guides' }),
  schema: z.object({
    title: z.string(),
    category: z.string(),
    level: z.enum(['LOW', 'MED', 'HIGH']),
    summary: z.string(),
    sources: z.array(z.object({ label: z.string(), url: z.string().url() })).default([]),
    lastVerified: z.coerce.date(),
    published: z.boolean().default(true),
  }),
});

const software = defineCollection({
  loader: file('./src/content/software/software.json'),
  schema: z.object({
    id: z.string(),
    name: z.string(),
    category: z.string(),
    url: z.string().url(),
    summary: z.string(),
    tags: z.array(z.string()).default([]),
  }),
});

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    summary: z.string(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { guides, software, blog };
