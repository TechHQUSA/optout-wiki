# OptOut.wiki

A consumer-privacy community wiki that helps everyday people opt out of hard
things: car data collection, ID-free phone service, anonymous business
ownership, private browsers/OS, and more.

The site is a fully prerendered [Astro](https://astro.build) static build —
every page ships as real HTML, no client framework runtime. Server code is a
set of Cloudflare Pages Functions: `/api/contribute` accepts anonymous guide
submissions into a moderation queue (guarded by an ALTCHA proof-of-work
challenge, a honeypot field, and a D1-backed rate limit), and `/admin`
lets a moderator review, approve, reject, or delete queued submissions,
gated by Cloudflare Access plus an in-Function JWT check.

**Zero third-party runtime requests.** Every script, font, and style is
same-origin — no analytics, ads, cookies, or external CDNs. See
`public/_headers` for the shipped Content-Security-Policy and other security
headers.

## Stack

- [Astro 5](https://astro.build) (static output, content-layer collections)
- TypeScript
- `@fontsource/*` — self-hosted fonts (Space Grotesk, IBM Plex Sans, IBM Plex Mono)
- `@astrojs/sitemap`, `@astrojs/rss`
- Cloudflare Pages + Pages Functions, Cloudflare D1
- `altcha` (widget) + `altcha-lib` (server-side verification)
- Vitest (unit tests + Astro Container API), Playwright (smoke tests)

## Getting started

```bash
npm install
cp .dev.vars.example .dev.vars   # local secrets for the contribute Function
npm run dev                      # http://localhost:4321
```

### Scripts

| Command             | What it does                                            |
| -------------------- | -------------------------------------------------------- |
| `npm run dev`         | Local dev server with live reload                        |
| `npm run build`       | Prerenders the site to `dist/`                           |
| `npm run preview`     | Serves the built `dist/` locally                         |
| `npm run check`       | Type-checks the project (`astro check`)                  |
| `npm test`            | Runs the Vitest unit/integration suite                   |
| `npm run test:e2e`    | Runs the Playwright smoke suite against a built preview  |
| `npm run publish-approved` | Turns `approved` submissions into committed guide markdown, then builds + deploys (see [Moderating submissions](#moderating-submissions)) |

## Project structure

```
src/
  pages/          # file-based routes (prerendered)
  content/        # guides, software directory, blog (content collections)
  components/     # header, footer, theme toggle, guide filter, etc.
  layouts/        # Base.astro (shared <head>, fonts, no-flash theme script)
  lib/            # shared formatting/helper utilities
functions/
  api/            # Cloudflare Pages Functions (contribute, altcha-challenge)
  admin/          # moderation surface (list, approve, reject, delete)
  _shared/        # security (ip-hash, honeypot, rate-limit), altcha wrapper,
                  # Cloudflare Access JWT verification, admin response helpers
migrations/       # D1 schema (submissions moderation queue)
scripts/          # publish-approved: batch-publishes approved guides
public/           # static assets: _headers, robots.txt, favicon.svg
```

## Environment variables / secrets

Read from the Cloudflare Pages environment (see `.dev.vars.example` for local
dev values):

**Used by `/api/contribute`:**

- `ALTCHA_HMAC_SECRET`: HMAC key used to sign/verify ALTCHA proof-of-work challenges.
- `ALTCHA_HMAC_KEY_SECRET`: reserved for a future `altcha-lib` key-derivation upgrade; unused by the currently pinned version but still provisioned.
- `IP_SALT`: salt used to hash the submitter's IP address before it ever touches D1 (raw IPs are never stored).

**Used by `/admin` (the moderation surface):**

- `CF_ACCESS_TEAM_DOMAIN`: your Cloudflare Zero Trust team domain, e.g. `yourteam.cloudflareaccess.com`.
- `CF_ACCESS_AUD`: the Application Audience (AUD) tag of the Cloudflare Access app protecting `/admin`.

## Deploy

1. `wrangler d1 create optout-wiki` → paste `database_id` into `wrangler.toml`.
2. `wrangler d1 migrations apply optout-wiki --remote`
3. Set secrets: `wrangler pages secret put ALTCHA_HMAC_SECRET` (and `ALTCHA_HMAC_KEY_SECRET`, `IP_SALT`).
4. `npm run build && wrangler pages deploy dist`
5. Add custom domain `optout.wiki` in the Pages dashboard.
6. To enable moderation: create a Cloudflare Access self-hosted application
   scoped to `optout.wiki/admin`, add an Allow policy for your moderators,
   then set `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` and redeploy.

## Moderating submissions

Visit `/admin` (behind Cloudflare Access) to review pending submissions.
Approving one does not publish it directly: the site is static, and
published guides are only ever built from git-committed markdown, never
rendered from D1. Approving marks the row `approved` and generates a guide
markdown scaffold with placeholder `summary`/source-label fields for a
moderator to fill in.

To turn approved rows into live guides:

```bash
npm run publish-approved            # dry run: shows what's ready vs. blocked
npm run publish-approved -- --deploy # commits ready guides, builds, deploys
```

A guide is "blocked" until its `[ADD SUMMARY]`/`[ADD LABEL]` placeholders are
filled in by hand; the script never publishes an incomplete guide.

## License

Content is licensed [CC-BY-SA-4.0](https://creativecommons.org/licenses/by-sa/4.0/).
