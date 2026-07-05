# OptOut.wiki Admin Rebuild — Design

**Status:** approved (brainstorm), pending implementation plan
**Date:** 2026-07-05
**Depends on:** `docs/superpowers/specs/2026-07-02-moderation-surface-design.md` (base admin surface)

## Goal

The `/admin` moderation surface (list/approve/reject/delete pending submissions)
works but is bare: unstyled HTML forms, no way to search/filter/sort/page
through the queue, no bulk actions (one row at a time), and no view of
already-approved/rejected submissions or who moderated them.

This is **Project A of a two-project split**. A second, related ask — an
internal dashboard for ALTCHA/anti-abuse activity (solve attempts, replay
rejections, rate-limit blocks, honeypot trips) — is deliberately deferred to
its own spec (**Project B**), to be brainstormed once this rebuild ships. Its
dashboard page will slot into the shell this project builds.

## Locked decisions

1. **JS + relaxed CSP, scoped to `/admin` only.** The base admin surface was
   deliberately zero-client-JS to avoid touching the public site's strict CSP.
   Admin is already gated by Cloudflare Access + CSRF checks and used by a
   small trusted team — a same-origin-only JS/CSS carve-out for this one
   surface is an acceptable, narrow trade for real UX. The public pages' CSP
   is untouched.
2. **Zero-JS remains the functional floor.** Every feature (search, filter,
   sort, pagination, bulk actions) must work via plain GET links and POST
   forms with JS disabled. `public/admin.js` only *enhances* — select-all,
   live "N selected" count, `confirm()` before bulk-delete. No fetch/XHR
   anywhere; everything stays server-rendered, JS never fetches or renders.
3. **Visual design reuses the public site's color/spacing tokens** (same
   `--accent`/`--surface`/`--border`/`--ink` palette, pill eyebrows, spacing
   language) but uses a **system font stack**, not the self-hosted webfonts —
   those get hashed filenames from Astro's build pipeline that a hand-written
   static `admin.css` can't reliably reference.
4. **Bulk actions extend the existing routes**, not new ones. `/admin/approve`,
   `/admin/reject`, `/admin/delete` already take an `id` from form data; they
   now accept **one or more** `id` values (checkboxes sharing `name="id"`,
   read via `form.getAll('id')`). A single-id submit is just the N=1 case —
   today's behavior is unchanged.
5. **History is the existing retained data**, not a new table. `reject` already
   keeps its row (`status='rejected'`); `delete` already removes it. A new
   `GET /admin/history` route just queries `WHERE status != 'pending'`. The
   only new schema is two nullable audit columns.

## Data model

New migration `migrations/0003_moderation_audit.sql`:

```sql
ALTER TABLE submissions ADD COLUMN moderated_by TEXT;
ALTER TABLE submissions ADD COLUMN moderated_at INTEGER;
```

Populated on **approve** and **reject** only (`delete` removes the row — no
audit trail needed for a removed row, matches the site's minimal-data
philosophy: don't retain more than the feature needs). `moderated_by` is the
moderator's email, read from the `email` claim on the already-verified
Cloudflare Access JWT payload (`verifyAccessJwt`'s return value) — `email` is
a standard field on Cloudflare Access identity tokens.

## Routes

| Method | Path | Change |
|--------|------|--------|
| GET | `/admin` | Pending queue. New query params: `q` (search title+category), `category`, `level`, `sort` (`newest`\|`oldest`), `page`. Adds a checkbox per row + bulk-action buttons (Approve/Reject/Delete selected). |
| GET | `/admin/history` | **New.** Same search/filter/sort/pagination shape, `WHERE status != 'pending'`. Shows `moderated_by`/`moderated_at`. Read-only except a per-row Delete (reuses `/admin/delete`) for purging old rejected spam. |
| POST | `/admin/approve` | Now accepts 1+ `id`s. Response page renders one filename+markdown block **per** approved submission, not just one. |
| POST | `/admin/reject` | Now accepts 1+ `id`s. |
| POST | `/admin/delete` | Now accepts 1+ `id`s. |

Simple two-tab nav (Queue | History) at the top of both pages.

**Bulk id validation:** `form.getAll('id')` returns `(string | File)[]`. Reject
the whole batch with 400 if any entry isn't a non-empty string (this closes
an existing backlog item — File-typed id previously only had a 400 test for
the `null` case, not an array containing one). A sanity cap (200 ids/request)
guards against a fat-fingered oversized submit — not a real attacker concern
given the existing Access + CSRF gates, just defensive.

**Search correctness:** the `q` param feeds a SQL `LIKE` against title and
category. Already parameterized (no injection risk), but `%`/`_` in the raw
search text act as LIKE wildcards unless escaped — escape both before binding
so a search for e.g. `50% off` behaves as literal text, not a wildcard.

## Visual design

`public/admin.css`, loaded via `<link rel="stylesheet" href="/admin.css">`.
Recreates the public site's color tokens (duplicated as a `:root{}` block,
since a hand-written static file can't share Astro's build-time token
pipeline) and general layout language — but with a system font stack, and a
data-dense layout (table/list rows, not a marketing page) suited to scanning
many submissions at once.

## Security

CSP for all `/admin*` responses becomes:

```
default-src 'none'; script-src 'self'; style-src 'self';
form-action 'self'; base-uri 'none'; frame-ancestors 'none'
```

`default-src 'none'` still blocks everything else (images, fetch/XHR, fonts) —
only script and style get a same-origin carve-out. No `'unsafe-inline'`
anywhere, for either directive.

`public/admin.js` scope, kept deliberately small: select-all checkbox toggle,
live selected-count badge, disabling bulk-submit buttons at zero selected,
and a `confirm()` prompt before bulk-delete specifically (not approve/reject —
those are reversible/retained). No fetch/XHR — every action is still a plain
link or form submit that JS only enhances. If `admin.js` fails to load, every
feature still works natively, just without the live count/confirm dialog.

## Testing

- Migration 0003: schema test confirms the two new nullable columns exist.
- Bulk actions: single-id (backward-compat), multi-id, mixed valid/invalid
  ids, a File-typed entry inside the array rejected, empty array rejected,
  over-cap (>200) rejected. Extends `tests/admin-actions.test.ts` /
  `tests/admin-approve.test.ts`.
- `moderated_by`/`moderated_at` populated correctly on approve/reject, absent
  on pending rows.
- Search/filter/sort/pagination: query-param parsing, and `%`/`_` escaping
  before the value hits the SQL `LIKE`.
- `/admin/history`: same escaping/CSRF/gate coverage the queue route already
  has, plus moderator/timestamp rendering.
- `tests/csp.test.ts`/`tests/admin-headers.test.ts` extended to assert
  `script-src 'self'; style-src 'self'` on admin responses.
- `public/admin.js`: the actual logic (selected-count calculation,
  enable/disable decision) lives in small pure functions so it's directly
  unit-testable; the DOM-wiring glue itself gets informal manual verification
  only — matches how this project already handles `ThemeToggle`'s inline
  script (no framework here for testing wired-up DOM behavior).

## Out of scope (deferred)

- **Abuse/PoW dashboard** — Project B, its own spec, once this ships.
- **Full-text search** — a `LIKE` match on title+category is sufficient at
  this scale; add real FTS only if volume ever demands it.
- **Deletion audit log** — `delete` stays unlogged, matching the site's
  minimal-data philosophy (spam rows just disappear, no trace kept).
- **Editing submissions in the admin** — still decided against per the
  original moderation-surface spec; polishing happens in git at publish time.
