// src/lib/url.ts
// A Zod string schema that accepts a URL only if it parses AND uses an
// http(s) scheme. `z.string().url()` alone accepts `javascript:` and `data:`
// URLs, which — once rendered as `<a href>` on a guide or software card — are
// stored-XSS / malware-link vectors. Use this for every URL that originates
// from user-submitted or externally-imported content.
//
// The server endpoint (functions/api/contribute.js `isHttpUrl`) enforces the
// same rule independently; it runs in the Workers runtime and can't share this
// Astro-build module, so the check is intentionally duplicated across the
// runtime boundary. Keep the two in sync.
import { z } from 'astro:content';

export const httpUrl = z.string().refine(
  (value) => {
    let u;
    try {
      u = new URL(value);
    } catch {
      return false;
    }
    return u.protocol === 'http:' || u.protocol === 'https:';
  },
  { message: 'Must be an http(s) URL' },
);
