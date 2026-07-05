# Admin Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the `/admin` moderation surface: real visual design, search/filter/sort/pagination, bulk approve/reject/delete, and a moderation-history/audit view — while keeping every feature usable with JS disabled.

**Architecture:** Existing Cloudflare Pages Functions (`functions/admin/*`) are extended, not replaced. Shared pure helpers (query-string parsing, SQL-building, HTML chrome) live in new `functions/_shared/*` modules so the queue and the new history route share logic without duplicating it. `/admin` gets a scoped CSP relaxation (`script-src 'self'; style-src 'self'`) so one static `public/admin.css` and one static `public/admin.js` can ship — the public site's CSP is untouched.

**Tech Stack:** Cloudflare Pages Functions, D1, Vitest (Astro Container API where relevant, plain unit tests elsewhere), vanilla JS (no framework, no build step for `public/admin.js`).

## Global Constraints

- CSP relaxation (`script-src 'self'; style-src 'self'`) is scoped to `/admin*` responses only — `public/_headers` (the public site's CSP) is not touched.
- Zero-JS floor: every feature (search, filter, sort, pagination, bulk actions) must work via plain GET links / POST forms with JS disabled. `public/admin.js` only enhances (select-all/live-count via `computeSelectedCount`, `confirm()` before bulk-delete). No `fetch`/`XHR` anywhere in `admin.js`.
- Bulk `id` validation (`parseIds`): reject the whole batch with 400 if the submitted `id` values are empty (0 ids), exceed 200 ids, or any single entry isn't a non-empty string (a `File` entry from a stray multipart field must 400, not crash).
- `moderated_by`/`moderated_at` are populated on **approve** and **reject** only — never on **delete** (a deleted row has nothing to audit).
- Visual design reuses the exact color tokens from `src/styles/tokens.css` (values copied into `public/admin.css`, which cannot share Astro's build-time CSS pipeline) but a system font stack, not the self-hosted webfonts.
- TDD throughout: write the failing test, watch it fail for the right reason, write minimal code, watch it pass. Every task ends with `npx vitest run` (targeted, then full suite), `npm run check`, and `npm run build` all green before committing.
- No Claude/Anthropic/AI attribution anywhere (commit messages, comments, docs) — standing project rule.
- Conventional Commit messages, one commit per task (or per logical step within a task if the task has multiple commits called out below).

---

### Task 1: Migration 0003 — moderation audit columns

**Files:**
- Create: `migrations/0003_moderation_audit.sql`
- Test: `tests/migration.test.ts` (extend)

**Interfaces:**
- Produces: `submissions.moderated_by TEXT` (nullable), `submissions.moderated_at INTEGER` (nullable, epoch ms) — consumed by Task 4 (approve) and Task 5 (reject) writes, and Task 8 (history) reads.

- [ ] **Step 1: Write the failing test**

Append to `tests/migration.test.ts`:

```ts
test('moderation-audit migration adds moderated_by/moderated_at columns to submissions', () => {
  const sql = readFileSync('migrations/0003_moderation_audit.sql', 'utf8');
  expect(sql).toMatch(/ALTER TABLE submissions ADD COLUMN moderated_by TEXT/);
  expect(sql).toMatch(/ALTER TABLE submissions ADD COLUMN moderated_at INTEGER/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/migration.test.ts -t "moderation-audit"`
Expected: FAIL — `ENOENT: no such file or directory, open 'migrations/0003_moderation_audit.sql'`

- [ ] **Step 3: Write the migration**

Create `migrations/0003_moderation_audit.sql`:

```sql
-- migrations/0003_moderation_audit.sql
-- Adds a lightweight audit trail for moderation decisions: who approved or
-- rejected a submission, and when. Populated only on approve/reject — a
-- deleted row has nothing to audit (matches the site's minimal-data
-- philosophy: don't retain more than the feature needs).
ALTER TABLE submissions ADD COLUMN moderated_by TEXT;
ALTER TABLE submissions ADD COLUMN moderated_at INTEGER;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/migration.test.ts`
Expected: PASS (all tests in the file, not just the new one)

- [ ] **Step 5: Apply locally and commit**

This migration is applied to the real D1 databases (local dev + remote) as part of deployment, not by the test suite. For now, just commit the SQL file and test:

```bash
git add migrations/0003_moderation_audit.sql tests/migration.test.ts
git commit -m "feat: add moderation audit columns migration"
```

---

### Task 2: Query-string parsing and SQL-building — `functions/_shared/admin-query.js`

**Files:**
- Create: `functions/_shared/admin-query.js`
- Test: `tests/admin-query.test.ts`

**Interfaces:**
- Produces:
  - `PAGE_SIZE: number` (25)
  - `escapeLike(s: string): string`
  - `parseAdminQuery(url: URL): {q: string, category: string, level: string, sort: 'newest'|'oldest', page: number}`
  - `buildAdminListQuery(query, statusClause: string): {whereSql: string, orderSql: string, params: unknown[]}`
  - `pageLink(query: {q,category,level,sort}, page: number): string` (a `"?..."` suffix, or `""`)
  - `totalPages(count: number): number`
- Consumed by: Task 6 (`admin-chrome.js`'s `renderPagination`/`renderFilterForm`), Task 8 (`index.js`), Task 9 (`history.js`).

- [ ] **Step 1: Write the failing tests**

Create `tests/admin-query.test.ts`:

```ts
// tests/admin-query.test.ts
import { expect, test } from 'vitest';
import {
  PAGE_SIZE,
  escapeLike,
  parseAdminQuery,
  buildAdminListQuery,
  pageLink,
  totalPages,
} from '../functions/_shared/admin-query.js';

test('PAGE_SIZE is 25', () => {
  expect(PAGE_SIZE).toBe(25);
});

test('escapeLike escapes %, _, and backslash so search text is treated literally', () => {
  expect(escapeLike('50% off')).toBe('50\\% off');
  expect(escapeLike('a_b')).toBe('a\\_b');
  expect(escapeLike('a\\b')).toBe('a\\\\b');
});

test('parseAdminQuery defaults every field when the URL has no query params', () => {
  const query = parseAdminQuery(new URL('https://x/admin'));
  expect(query).toEqual({ q: '', category: '', level: '', sort: 'newest', page: 1 });
});

test('parseAdminQuery reads q/category/level/sort/page from the URL', () => {
  const query = parseAdminQuery(new URL('https://x/admin?q=foo&category=Cars&level=LOW&sort=oldest&page=3'));
  expect(query).toEqual({ q: 'foo', category: 'Cars', level: 'LOW', sort: 'oldest', page: 3 });
});

test('parseAdminQuery falls back to page 1 for garbage/negative/zero page values', () => {
  expect(parseAdminQuery(new URL('https://x/admin?page=abc')).page).toBe(1);
  expect(parseAdminQuery(new URL('https://x/admin?page=-5')).page).toBe(1);
  expect(parseAdminQuery(new URL('https://x/admin?page=0')).page).toBe(1);
});

test('parseAdminQuery falls back to sort=newest for anything other than "oldest"', () => {
  expect(parseAdminQuery(new URL('https://x/admin?sort=bogus')).sort).toBe('newest');
});

test('buildAdminListQuery with no filters just applies the status clause', () => {
  const { whereSql, orderSql, params } = buildAdminListQuery(
    { q: '', category: '', level: '', sort: 'newest', page: 1 },
    "status = 'pending'",
  );
  expect(whereSql).toBe("status = 'pending'");
  expect(orderSql).toBe('ORDER BY created_at DESC');
  expect(params).toEqual([]);
});

test('buildAdminListQuery adds a LIKE condition (escaped) for q, and equality for category/level', () => {
  const { whereSql, params } = buildAdminListQuery(
    { q: '50%', category: 'Cars', level: 'LOW', sort: 'newest', page: 1 },
    "status = 'pending'",
  );
  expect(whereSql).toBe(
    "status = 'pending' AND (title LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\') AND category = ? AND level = ?",
  );
  expect(params).toEqual(['%50\\%%', '%50\\%%', 'Cars', 'LOW']);
});

test('buildAdminListQuery orders oldest-first when sort is "oldest"', () => {
  const { orderSql } = buildAdminListQuery({ q: '', category: '', level: '', sort: 'oldest', page: 1 }, "status = 'pending'");
  expect(orderSql).toBe('ORDER BY created_at ASC');
});

test('pageLink preserves q/category/level/sort and only adds page when > 1', () => {
  const query = { q: 'foo', category: 'Cars', level: 'LOW', sort: 'oldest' };
  expect(pageLink(query, 1)).toBe('?q=foo&category=Cars&level=LOW&sort=oldest');
  expect(pageLink(query, 2)).toBe('?q=foo&category=Cars&level=LOW&sort=oldest&page=2');
});

test('pageLink returns an empty string when there are no filters and page is 1', () => {
  expect(pageLink({ q: '', category: '', level: '', sort: 'newest' }, 1)).toBe('');
});

test('totalPages is at least 1 and rounds up', () => {
  expect(totalPages(0)).toBe(1);
  expect(totalPages(25)).toBe(1);
  expect(totalPages(26)).toBe(2);
  expect(totalPages(50)).toBe(2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/admin-query.test.ts`
Expected: FAIL — `Cannot find module '../functions/_shared/admin-query.js'`

- [ ] **Step 3: Write the implementation**

Create `functions/_shared/admin-query.js`:

```js
// functions/_shared/admin-query.js
// Pure helpers shared by the queue (functions/admin/index.js) and history
// (functions/admin/history.js) routes: parsing the search/filter/sort/page
// query string, building the corresponding SQL WHERE/ORDER fragment, and
// building "?..." links that preserve the current filters when paginating.
// No D1, no Request/Response — kept pure so it unit-tests without mocking.

export const PAGE_SIZE = 25;

/**
 * Escapes SQL LIKE wildcards (%, _) and the escape character itself (\) so a
 * user's search text is matched literally, not as a wildcard pattern.
 * @param {string} s
 * @returns {string}
 */
export function escapeLike(s) {
  return String(s).replace(/[\\%_]/g, '\\$&');
}

/**
 * @param {URL} url
 * @returns {{q: string, category: string, level: string, sort: 'newest'|'oldest', page: number}}
 */
export function parseAdminQuery(url) {
  const q = url.searchParams.get('q') || '';
  const category = url.searchParams.get('category') || '';
  const level = url.searchParams.get('level') || '';
  const sort = url.searchParams.get('sort') === 'oldest' ? 'oldest' : 'newest';
  const pageRaw = parseInt(url.searchParams.get('page') || '1', 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  return { q, category, level, sort, page };
}

/**
 * Builds the WHERE/ORDER SQL fragment (and bound params, in the same order
 * as the `?` placeholders) for a submissions list query. `statusClause` is a
 * literal SQL fragment the caller supplies (e.g. "status = 'pending'" for
 * the queue, "status != 'pending'" for history) — never user input.
 * @param {{q: string, category: string, level: string, sort: string}} query
 * @param {string} statusClause
 * @returns {{whereSql: string, orderSql: string, params: unknown[]}}
 */
export function buildAdminListQuery(query, statusClause) {
  const conditions = [statusClause];
  const params = [];
  if (query.q) {
    conditions.push("(title LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\')");
    const like = `%${escapeLike(query.q)}%`;
    params.push(like, like);
  }
  if (query.category) {
    conditions.push('category = ?');
    params.push(query.category);
  }
  if (query.level) {
    conditions.push('level = ?');
    params.push(query.level);
  }
  const whereSql = conditions.join(' AND ');
  const orderSql = query.sort === 'oldest' ? 'ORDER BY created_at ASC' : 'ORDER BY created_at DESC';
  return { whereSql, orderSql, params };
}

/**
 * A "?..." query-string suffix (or "" if there's nothing to encode) that
 * preserves the current filters while linking to a different page number.
 * @param {{q: string, category: string, level: string, sort: string}} query
 * @param {number} page
 * @returns {string}
 */
export function pageLink(query, page) {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.category) params.set('category', query.category);
  if (query.level) params.set('level', query.level);
  if (query.sort === 'oldest') params.set('sort', 'oldest');
  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/**
 * @param {number} count total matching rows
 * @returns {number} at least 1
 */
export function totalPages(count) {
  return Math.max(1, Math.ceil(count / PAGE_SIZE));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/admin-query.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 5: Commit**

```bash
git add functions/_shared/admin-query.js tests/admin-query.test.ts
git commit -m "feat: add admin query-string parsing and SQL-building helpers"
```

---

### Task 3: Moderator identity — `getModeratorEmail` in `functions/_shared/access.js`

**Files:**
- Modify: `functions/_shared/access.js`
- Test: `tests/access.test.ts` (extend)

**Interfaces:**
- Consumes: `verifyAccessJwt(request, env, now, fetchImpl)` (already exists in this file).
- Produces: `getModeratorEmail(request, env, now?): Promise<string|null>` — consumed by Task 4 (approve) and Task 5 (reject).

- [ ] **Step 1: Write the failing tests**

Append to `tests/access.test.ts` (reuses the file's existing `signToken`/`publicJwk`/`TEAM`/`AUD` helpers — read the top of the file first if you haven't, don't redefine them):

```ts
test('getModeratorEmail returns the email claim from a valid Access token', async () => {
  const token = await signToken({ aud: AUD, exp: future(), iss: `https://${TEAM}`, email: 'mod@example.com' });
  const fetchImpl = async () => new Response(JSON.stringify({ keys: [publicJwk] }));
  const env = { CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD };
  const req = new Request('https://x/admin/approve', { headers: { 'cf-access-jwt-assertion': token } });
  expect(await getModeratorEmail(req, env, Date.now(), fetchImpl)).toBe('mod@example.com');
});

test('getModeratorEmail returns null when there is no valid token', async () => {
  const env = { CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD };
  const req = new Request('https://x/admin/approve');
  expect(await getModeratorEmail(req, env)).toBeNull();
});

test('getModeratorEmail returns null when the token has no email claim', async () => {
  const token = await signToken({ aud: AUD, exp: future(), iss: `https://${TEAM}` });
  const fetchImpl = async () => new Response(JSON.stringify({ keys: [publicJwk] }));
  const env = { CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD };
  const req = new Request('https://x/admin/approve', { headers: { 'cf-access-jwt-assertion': token } });
  expect(await getModeratorEmail(req, env, Date.now(), fetchImpl)).toBeNull();
});
```

Update the import line at the top of `tests/access.test.ts` to also pull in `getModeratorEmail`:

```ts
import { verifyJwt, verifyAccessJwt, requireModerator, resetJwksCache, getModeratorEmail } from '../functions/_shared/access.js';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/access.test.ts -t "getModeratorEmail"`
Expected: FAIL — `getModeratorEmail is not a function` (or import error)

- [ ] **Step 3: Write the implementation**

Add to `functions/_shared/access.js`, directly after the existing `verifyAccessJwt` function (before `requireModerator`):

```js
/**
 * The moderator's email from a verified Access identity, or null if there's
 * no valid token or it carries no `email` claim. Called AFTER `requireModerator`
 * has already gated the request — this re-verifies (cheaply, the JWKS fetch
 * is cached) rather than threading the identity through the gate's return
 * value, so the existing `requireModerator` contract used by every admin
 * route stays unchanged.
 * @param {Request} request
 * @param {{CF_ACCESS_TEAM_DOMAIN: string, CF_ACCESS_AUD: string}} env
 * @param {number} [now]
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<string|null>}
 */
export async function getModeratorEmail(request, env, now = Date.now(), fetchImpl = fetch) {
  const identity = await verifyAccessJwt(request, env, now, fetchImpl);
  return typeof identity?.email === 'string' ? identity.email : null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/access.test.ts`
Expected: PASS (all tests in the file, not just the new ones)

- [ ] **Step 5: Commit**

```bash
git add functions/_shared/access.js tests/access.test.ts
git commit -m "feat: add getModeratorEmail for the moderation audit trail"
```

---

### Task 4: Bulk `id` validation — `parseIds` in `functions/_shared/admin.js`

**Files:**
- Modify: `functions/_shared/admin.js`
- Test: Create `tests/admin-shared.test.ts`

**Interfaces:**
- Produces: `parseIds(form: FormData): string[]|null` — consumed by Task 5 (approve/reject/delete rewrites).

- [ ] **Step 1: Write the failing tests**

Create `tests/admin-shared.test.ts`:

```ts
// tests/admin-shared.test.ts
import { expect, test } from 'vitest';
import { parseIds } from '../functions/_shared/admin.js';

function formWith(...ids: (string | Blob)[]) {
  const form = new FormData();
  for (const id of ids) form.append('id', id);
  return form;
}

test('parseIds returns a single id as a one-element array', () => {
  expect(parseIds(formWith('a1'))).toEqual(['a1']);
});

test('parseIds returns multiple ids in submitted order', () => {
  expect(parseIds(formWith('a1', 'a2', 'a3'))).toEqual(['a1', 'a2', 'a3']);
});

test('parseIds returns null when there are no ids at all', () => {
  expect(parseIds(new FormData())).toBeNull();
});

test('parseIds returns null when any entry is empty', () => {
  expect(parseIds(formWith('a1', ''))).toBeNull();
});

test('parseIds returns null when any entry is a File, not a string', () => {
  const file = new Blob(['x'], { type: 'text/plain' });
  expect(parseIds(formWith('a1', file))).toBeNull();
});

test('parseIds returns null when there are more than 200 ids', () => {
  const many = Array.from({ length: 201 }, (_, i) => `id-${i}`);
  expect(parseIds(formWith(...many))).toBeNull();
});

test('parseIds accepts exactly 200 ids', () => {
  const exactly200 = Array.from({ length: 200 }, (_, i) => `id-${i}`);
  expect(parseIds(formWith(...exactly200))).toHaveLength(200);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/admin-shared.test.ts`
Expected: FAIL — `parseIds is not a function` (or import error)

- [ ] **Step 3: Write the implementation**

Add to `functions/_shared/admin.js`, after the existing `isCrossSiteWrite` function:

```js
const MAX_BULK_IDS = 200;

/**
 * Extracts and validates the `id` field(s) from submitted form data for the
 * bulk-capable approve/reject/delete routes — one or more non-empty strings,
 * capped at MAX_BULK_IDS. A `File` entry (a stray multipart field) or an
 * empty string anywhere in the list invalidates the whole batch, rather than
 * silently dropping just that one entry.
 * @param {FormData} form
 * @returns {string[]|null} null means the caller should respond 400
 */
export function parseIds(form) {
  const raw = form.getAll('id');
  if (raw.length === 0 || raw.length > MAX_BULK_IDS) return null;
  if (raw.some((v) => typeof v !== 'string' || v === '')) return null;
  return /** @type {string[]} */ (raw);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/admin-shared.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add functions/_shared/admin.js tests/admin-shared.test.ts
git commit -m "feat: add parseIds for bulk-capable admin actions"
```

---

### Task 5: Shared admin page chrome — `functions/_shared/admin-chrome.js`

**Files:**
- Create: `functions/_shared/admin-chrome.js`
- Test: `tests/admin-chrome.test.ts`

**Interfaces:**
- Consumes: `escapeHtml` from `functions/_shared/html.js`; `pageLink` from `functions/_shared/admin-query.js` (Task 2).
- Produces: `renderNav(active: 'queue'|'history'): string`, `renderFilterForm(query, action: string): string`, `renderPagination(basePath: string, query, page: number, totalPages: number): string` — consumed by Task 8 (`index.js`) and Task 9 (`history.js`).

- [ ] **Step 1: Write the failing tests**

Create `tests/admin-chrome.test.ts`:

```ts
// tests/admin-chrome.test.ts
import { expect, test } from 'vitest';
import { renderNav, renderFilterForm, renderPagination } from '../functions/_shared/admin-chrome.js';

test('renderNav marks the active tab', () => {
  const html = renderNav('queue');
  expect(html).toContain('href="/admin"');
  expect(html).toContain('href="/admin/history"');
  expect(html).toMatch(/href="\/admin"[^>]*aria-current="page"/);
});

test('renderNav marks history as active when given "history"', () => {
  const html = renderNav('history');
  expect(html).toMatch(/href="\/admin\/history"[^>]*aria-current="page"/);
});

test('renderFilterForm escapes the current query values and points at the given action', () => {
  const html = renderFilterForm({ q: '<script>', category: 'Cars"', level: 'LOW', sort: 'oldest' }, '/admin/history');
  expect(html).toContain('action="/admin/history"');
  expect(html).not.toContain('<script>');
  expect(html).toContain('&lt;script&gt;');
  expect(html).toContain('&quot;');
  expect(html).toContain('value="LOW" selected');
  expect(html).toContain('value="oldest" selected');
});

test('renderPagination shows Prev only past page 1, and Next only before the last page', () => {
  const query = { q: '', category: '', level: '', sort: 'newest' };
  const middle = renderPagination('/admin', query, 2, 3);
  expect(middle).toContain('Prev');
  expect(middle).toContain('Next');
  const first = renderPagination('/admin', query, 1, 3);
  expect(first).not.toContain('Prev');
  expect(first).toContain('Next');
  const last = renderPagination('/admin', query, 3, 3);
  expect(last).toContain('Prev');
  expect(last).not.toContain('Next');
});

test('renderPagination links preserve filters via pageLink', () => {
  const query = { q: 'foo', category: '', level: '', sort: 'newest' };
  const html = renderPagination('/admin', query, 1, 2);
  expect(html).toContain('/admin?q=foo&page=2');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/admin-chrome.test.ts`
Expected: FAIL — `Cannot find module '../functions/_shared/admin-chrome.js'`

- [ ] **Step 3: Write the implementation**

Create `functions/_shared/admin-chrome.js`:

```js
// functions/_shared/admin-chrome.js
// Shared HTML chrome for the admin surface: the Queue/History tab nav, the
// search/filter GET form, and pagination links — used identically by both
// functions/admin/index.js (queue) and functions/admin/history.js.
import { escapeHtml } from './html.js';
import { pageLink } from './admin-query.js';

/**
 * @param {'queue'|'history'} active
 * @returns {string}
 */
export function renderNav(active) {
  const tab = (href, label, key) =>
    `<a href="${href}"${active === key ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<nav class="admin-nav">${tab('/admin', 'Queue', 'queue')}${tab('/admin/history', 'History', 'history')}</nav>`;
}

/**
 * @param {{q: string, category: string, level: string, sort: string}} query
 * @param {string} action e.g. "/admin" or "/admin/history"
 * @returns {string}
 */
export function renderFilterForm(query, action) {
  const levelOption = (value, label) =>
    `<option value="${value}"${query.level === value ? ' selected' : ''}>${label}</option>`;
  return `<form method="GET" action="${action}" class="admin-filters">
  <input type="search" name="q" value="${escapeHtml(query.q)}" placeholder="Search title or category">
  <input type="text" name="category" value="${escapeHtml(query.category)}" placeholder="Category">
  <select name="level">
    <option value=""${query.level === '' ? ' selected' : ''}>Any level</option>
    ${levelOption('LOW', 'LOW')}
    ${levelOption('MED', 'MED')}
    ${levelOption('HIGH', 'HIGH')}
  </select>
  <select name="sort">
    <option value="newest"${query.sort !== 'oldest' ? ' selected' : ''}>Newest first</option>
    <option value="oldest"${query.sort === 'oldest' ? ' selected' : ''}>Oldest first</option>
  </select>
  <button type="submit">Filter</button>
</form>`;
}

/**
 * @param {string} basePath e.g. "/admin" or "/admin/history"
 * @param {{q: string, category: string, level: string, sort: string}} query
 * @param {number} page current page (1-based)
 * @param {number} totalPages
 * @returns {string}
 */
export function renderPagination(basePath, query, page, totalPages) {
  const prev = page > 1 ? `<a href="${basePath}${pageLink(query, page - 1)}">&larr; Prev</a>` : '';
  const next = page < totalPages ? `<a href="${basePath}${pageLink(query, page + 1)}">Next &rarr;</a>` : '';
  return `<nav class="admin-pagination">${prev}<span>Page ${page} of ${totalPages}</span>${next}</nav>`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/admin-chrome.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add functions/_shared/admin-chrome.js tests/admin-chrome.test.ts
git commit -m "feat: add shared admin page chrome (nav, filter form, pagination)"
```

---

### Task 6: Admin visual design + CSP relaxation — `public/admin.css`

**Files:**
- Create: `public/admin.css`
- Modify: `functions/_shared/admin.js` (CSP string in `ADMIN_HEADERS`)
- Test: `tests/admin-headers.test.ts` (extend), `tests/admin-css.test.ts` (create)

**Interfaces:**
- Consumes: color token values from `src/styles/tokens.css` (read that file if you haven't this session — copy the exact `oklch(...)` values, don't invent new ones).
- Produces: `/admin.css` as a static asset (referenced via `<link>` starting in Task 8); `ADMIN_HEADERS`'s CSP now allows `script-src 'self'` and `style-src 'self'`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/admin-headers.test.ts`:

```ts
test('GET /admin response CSP allows same-origin script and style, nothing else new', async () => {
  const res = await onRequestGet({ request: new Request('https://x/admin'), env: { DB: listDb } });
  const csp = res.headers.get('content-security-policy') ?? '';
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("style-src 'self'");
  expect(csp).not.toContain('unsafe-inline');
  expect(csp).not.toContain('unsafe-eval');
});
```

Create `tests/admin-css.test.ts`:

```ts
// tests/admin-css.test.ts
import { readFileSync, existsSync } from 'node:fs';
import { expect, test } from 'vitest';

test('public/admin.css exists and defines the shared color tokens', () => {
  expect(existsSync('public/admin.css')).toBe(true);
  const css = readFileSync('public/admin.css', 'utf8');
  expect(css).toContain('--accent');
  expect(css).toContain('--surface');
  expect(css).toContain('--border');
  expect(css).toContain('--ink');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/admin-headers.test.ts tests/admin-css.test.ts`
Expected: FAIL — the new `admin-headers` assertion fails (CSP still has `default-src 'none'` with no `script-src`/`style-src`); `admin-css.test.ts` fails with `existsSync` false.

- [ ] **Step 3: Update the CSP**

In `functions/_shared/admin.js`, change the `content-security-policy` line in `ADMIN_HEADERS`:

```js
const ADMIN_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'x-robots-tag': 'noindex',
  'referrer-policy': 'no-referrer',
};
```

Update the file's header comment (it currently says the admin pages ship no scripts/styles — that's no longer true):

```js
// functions/_shared/admin.js
// Shared helpers for the admin Pages Functions. Cloudflare `_headers` does NOT
// apply to Function responses (only to static assets), so every admin response
// sets its own security headers here. `script-src`/`style-src` allow only
// same-origin (`public/admin.js`/`public/admin.css`) — no inline script/style,
// no third-party host. This CSP is scoped to /admin*; the public site's CSP
// (public/_headers) is untouched.
```

- [ ] **Step 4: Write `public/admin.css`**

Read `src/styles/tokens.css` first to confirm the exact token values are unchanged from what's used below, then create `public/admin.css`:

```css
/* public/admin.css
 * Static stylesheet for the /admin surface (Cloudflare Pages Functions can't
 * share Astro's build-time CSS pipeline, so this is hand-written, not
 * generated). Reuses the public site's color tokens (values copied from
 * src/styles/tokens.css) for visual consistency, but a system font stack
 * instead of the self-hosted webfonts — those get build-hashed filenames
 * this static file can't reference.
 */
:root {
  --bg: oklch(0.975 0.005 95);
  --surface: oklch(1 0 0);
  --surface-2: oklch(0.955 0.006 95);
  --ink: oklch(0.21 0.012 265);
  --muted: oklch(0.50 0.012 265);
  --border: oklch(0.90 0.006 95);
  --accent: oklch(0.54 0.13 150);
  --accent-ink: oklch(0.99 0 0);
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  padding: 24px;
}

.admin-nav {
  display: flex;
  gap: 16px;
  margin-bottom: 20px;
  font-weight: 600;
}
.admin-nav a {
  color: var(--muted);
  text-decoration: none;
  padding: 6px 12px;
  border-radius: 6px;
}
.admin-nav a[aria-current='page'] {
  color: var(--ink);
  background: var(--surface-2);
}

.admin-filters {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}
.admin-filters input,
.admin-filters select,
.admin-filters button {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--ink);
  border-radius: 6px;
  padding: 6px 10px;
  font: inherit;
}

article {
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 12px;
}
article pre {
  white-space: pre-wrap;
  background: var(--surface-2);
  padding: 8px;
  border-radius: 6px;
}

.admin-bulk-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 16px 0;
}
.admin-bulk-actions button {
  border: 1px solid var(--border);
  background: var(--accent);
  color: var(--accent-ink);
  border-radius: 6px;
  padding: 8px 14px;
  cursor: pointer;
}
.admin-bulk-actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.admin-pagination {
  display: flex;
  gap: 16px;
  align-items: center;
  margin-top: 20px;
}
.admin-pagination a {
  color: var(--accent);
}

textarea {
  width: 100%;
  font-family: ui-monospace, monospace;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/admin-headers.test.ts tests/admin-css.test.ts`
Expected: PASS. Then run the full suite once, since the CSP change touches every existing admin-headers assertion:

Run: `npx vitest run`
Expected: PASS, all files (the existing `default-src 'none'` assertion in `tests/admin-headers.test.ts` still passes — that directive is unchanged, only `script-src`/`style-src` were added).

- [ ] **Step 6: Commit**

```bash
git add functions/_shared/admin.js public/admin.css tests/admin-headers.test.ts tests/admin-css.test.ts
git commit -m "feat: relax admin CSP to script-src/style-src 'self' and add admin.css"
```

---

### Task 7: Bulk-select client script — `public/admin.js`

**Files:**
- Create: `public/admin.js`
- Test: `tests/admin-js.test.ts`

**Interfaces:**
- Produces: `computeSelectedCount(checkboxes: {checked: boolean}[]): number` (unit-tested directly); a DOM-wiring block guarded by `typeof document !== 'undefined'` (not unit-tested — no DOM environment in this project's Vitest config, confirmed via `vitest.config.ts` having no `environment` override, so it defaults to `'node'` and this block is a no-op under test).
- Consumed by: Task 8 (`index.js`) and Task 9 (`history.js`), which add `<script type="module" src="/admin.js"></script>` and the `data-selected-count`/`data-confirm="delete"` markup this script looks for.

- [ ] **Step 1: Write the failing tests**

Create `tests/admin-js.test.ts`:

```ts
// tests/admin-js.test.ts
import { expect, test } from 'vitest';
import { computeSelectedCount } from '../public/admin.js';

test('computeSelectedCount counts only the checked boxes', () => {
  expect(computeSelectedCount([{ checked: true }, { checked: false }, { checked: true }])).toBe(2);
});

test('computeSelectedCount returns 0 for an empty list', () => {
  expect(computeSelectedCount([])).toBe(0);
});

test('computeSelectedCount returns 0 when none are checked', () => {
  expect(computeSelectedCount([{ checked: false }, { checked: false }])).toBe(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/admin-js.test.ts`
Expected: FAIL — `Cannot find module '../public/admin.js'`

- [ ] **Step 3: Write the implementation**

Create `public/admin.js`:

```js
// public/admin.js
// Progressive enhancement for the /admin moderation surface. Every feature
// it touches already works via plain links/forms without this file loading —
// this only adds a live selected-count and a confirm() prompt before a bulk
// delete. No fetch/XHR anywhere: every action stays a native form submit or
// link navigation that this script merely assists.

/**
 * @param {{checked: boolean}[]} checkboxes
 * @returns {number} how many are checked
 */
export function computeSelectedCount(checkboxes) {
  return checkboxes.filter((cb) => cb.checked).length;
}

if (typeof document !== 'undefined') {
  const checkboxes = () => Array.from(document.querySelectorAll('input[type="checkbox"][form="bulk-form"]'));
  const countEl = document.querySelector('[data-selected-count]');
  const bulkButtons = () => Array.from(document.querySelectorAll('button[form="bulk-form"]'));

  function refresh() {
    const count = computeSelectedCount(checkboxes());
    if (countEl) countEl.textContent = String(count);
    for (const btn of bulkButtons()) btn.disabled = count === 0;
  }

  for (const cb of checkboxes()) cb.addEventListener('change', refresh);
  refresh();

  for (const btn of bulkButtons()) {
    if (btn.dataset.confirm === 'delete') {
      btn.addEventListener('click', (e) => {
        const count = computeSelectedCount(checkboxes());
        if (!window.confirm(`Delete ${count} submission${count === 1 ? '' : 's'}? This cannot be undone.`)) {
          e.preventDefault();
        }
      });
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/admin-js.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add public/admin.js tests/admin-js.test.ts
git commit -m "feat: add admin bulk-select progressive-enhancement script"
```

---

### Task 8: Rework `/admin/approve`, `/admin/reject`, `/admin/delete` for bulk ids + audit trail

**Files:**
- Modify: `functions/admin/approve.js`
- Modify: `functions/admin/reject.js`
- Modify: `functions/admin/delete.js`
- Test: `tests/admin-approve.test.ts` (extend), `tests/admin-actions.test.ts` (extend)

**Interfaces:**
- Consumes: `parseIds` (Task 4), `getModeratorEmail` (Task 3), `generateGuideMarkdown` (existing).
- Produces: unchanged route paths/methods; response shapes documented in the steps below.

- [ ] **Step 1: Write the failing tests for approve (bulk + audit)**

Replace the mock `makeDb` in `tests/admin-approve.test.ts` (the existing one only supports one fixed row) with a lookup-by-id version, and add new tests. Full replacement content for `tests/admin-approve.test.ts`:

```ts
// tests/admin-approve.test.ts
import { expect, test, vi, beforeEach } from 'vitest';

vi.mock('../functions/_shared/access.js', () => ({
  requireModerator: vi.fn(async () => null),
  getModeratorEmail: vi.fn(async () => 'mod@example.com'),
}));
import { requireModerator, getModeratorEmail } from '../functions/_shared/access.js';
import { onRequestPost } from '../functions/admin/approve.js';

beforeEach(() => {
  vi.mocked(requireModerator).mockReset().mockResolvedValue(null);
  vi.mocked(getModeratorEmail).mockReset().mockResolvedValue('mod@example.com');
});

function makeDb(rowsById: Record<string, unknown>) {
  const calls: { sql: string; args: unknown[] }[] = [];
  return {
    calls,
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          calls.push({ sql, args });
          return {
            async run() {},
            async first() {
              if (!sql.trim().startsWith('SELECT')) return null;
              const id = args[args.length - 1];
              return rowsById[id as string] ?? null;
            },
          };
        },
      };
    },
  };
}

function form(...ids: string[]) {
  const body = new URLSearchParams();
  for (const id of ids) body.append('id', id);
  return new Request('https://x/admin/approve', { method: 'POST', body });
}

test('approve updates status, writes the audit columns, and returns the generated markdown', async () => {
  const db = makeDb({ a1: { title: 'Opt out of Foo', category: 'Cars', level: 'MED', body: 'steps', sources: '["https://a.example/x"]' } });
  const res = await onRequestPost({ request: form('a1'), env: { DB: db } });
  expect(res.status).toBe(200);
  const updateCall = db.calls.find((c) => c.sql.startsWith("UPDATE submissions SET status = 'approved'"));
  expect(updateCall).toBeDefined();
  expect(updateCall!.args).toEqual(['mod@example.com', expect.any(Number), 'a1']);
  const html = await res.text();
  expect(html).toContain('opt-out-of-foo.md');
  expect(html).toContain('summary: &quot;[ADD SUMMARY]&quot;');
});

test('approve accepts multiple ids and renders one block per approved submission', async () => {
  const db = makeDb({
    a1: { title: 'Guide One', category: 'Cars', level: 'LOW', body: 'b1', sources: '[]' },
    a2: { title: 'Guide Two', category: 'Phones', level: 'MED', body: 'b2', sources: '[]' },
  });
  const res = await onRequestPost({ request: form('a1', 'a2'), env: { DB: db } });
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain('guide-one.md');
  expect(html).toContain('guide-two.md');
  expect(html).toContain('Approved (2)');
});

test('approve skips ids with no matching row but still succeeds for the ones that exist', async () => {
  const db = makeDb({ a1: { title: 'Real Guide', category: 'Cars', level: 'LOW', body: 'b', sources: '[]' } });
  const res = await onRequestPost({ request: form('a1', 'gone'), env: { DB: db } });
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain('real-guide.md');
  expect(html).toContain('Approved (1)');
});

test('approve without any id is a 400', async () => {
  const res = await onRequestPost({ request: form(), env: { DB: makeDb({}) } });
  expect(res.status).toBe(400);
});

test('approve where every id is missing is a 404', async () => {
  const res = await onRequestPost({ request: form('gone'), env: { DB: makeDb({}) } });
  expect(res.status).toBe(404);
});

test('approve returns the 403 when the gate denies, and never touches the DB', async () => {
  vi.mocked(requireModerator).mockResolvedValue(new Response('Forbidden', { status: 403 }));
  const db = makeDb({ a1: { title: 'x', category: 'Cars', level: 'LOW', body: 'b', sources: '[]' } });
  const res = await onRequestPost({ request: form('a1'), env: { DB: db } });
  expect(res.status).toBe(403);
  expect(db.calls).toHaveLength(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/admin-approve.test.ts`
Expected: FAIL — `getModeratorEmail`/`parseIds` not used yet by `approve.js`; the bulk/audit-column assertions fail against the current single-id implementation.

- [ ] **Step 3: Rewrite `functions/admin/approve.js`**

```js
// functions/admin/approve.js
// POST /admin/approve — mark one or more submissions approved, write the
// moderation audit trail (moderated_by/moderated_at), and hand the moderator
// a guide markdown scaffold per submission to commit to git. Each generated
// markdown embeds the untrusted body, so it is HTML-escaped before going
// into its <textarea> (also blocks a </textarea> breakout).
import { requireModerator, getModeratorEmail } from '../_shared/access.js';
import { escapeHtml } from '../_shared/html.js';
import { generateGuideMarkdown } from '../_shared/guide-markdown.js';
import { adminHtml, adminText, isCrossSiteWrite, parseIds } from '../_shared/admin.js';

function parseSources(s) {
  try {
    const a = JSON.parse(s);
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

export async function onRequestPost({ request, env }) {
  const denied = await requireModerator(request, env);
  if (denied) return denied;

  if (isCrossSiteWrite(request)) return adminText('cross-site', 403);

  const form = await request.formData();
  const ids = parseIds(form);
  if (!ids) return adminText('bad-request', 400);

  const moderatedBy = await getModeratorEmail(request, env);
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);

  const blocks = [];
  for (const id of ids) {
    await env.DB.prepare(
      "UPDATE submissions SET status = 'approved', moderated_by = ?, moderated_at = ? WHERE id = ?",
    )
      .bind(moderatedBy, now, id)
      .run();
    const row = await env.DB.prepare(
      'SELECT title, category, level, body, sources FROM submissions WHERE id = ?',
    )
      .bind(id)
      .first();
    if (!row) continue;
    const { filename, markdown } = generateGuideMarkdown({ ...row, sources: parseSources(row.sources) }, today);
    blocks.push({ filename, markdown });
  }

  if (blocks.length === 0) return adminText('not-found', 404);

  return adminHtml(renderApprove(blocks));
}

function renderApprove(blocks) {
  const sections = blocks
    .map(
      ({ filename, markdown }) => `<section>
  <p>Save as <code>src/content/guides/${escapeHtml(filename)}</code>, fill the <code>[ADD …]</code> placeholders, then commit:</p>
  <textarea readonly rows="30" cols="100">${escapeHtml(markdown)}</textarea>
</section>`,
    )
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><link rel="stylesheet" href="/admin.css"></head><body>
<h1>Approved (${blocks.length}) &mdash; commit ${blocks.length === 1 ? 'this file' : 'these files'}</h1>
${sections}
<p><a href="/admin">Back to queue</a></p>
</body></html>`;
}
```

- [ ] **Step 4: Run tests to verify approve passes**

Run: `npx vitest run tests/admin-approve.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Write the failing tests for reject/delete (bulk + reject's audit trail)**

Replace `tests/admin-actions.test.ts` in full:

```ts
// tests/admin-actions.test.ts
import { expect, test, vi, beforeEach } from 'vitest';

vi.mock('../functions/_shared/access.js', () => ({
  requireModerator: vi.fn(async () => null),
  getModeratorEmail: vi.fn(async () => 'mod@example.com'),
}));
import { requireModerator, getModeratorEmail } from '../functions/_shared/access.js';
import { onRequestPost as reject } from '../functions/admin/reject.js';
import { onRequestPost as del } from '../functions/admin/delete.js';

beforeEach(() => {
  vi.mocked(requireModerator).mockReset().mockResolvedValue(null);
  vi.mocked(getModeratorEmail).mockReset().mockResolvedValue('mod@example.com');
});

function makeDb() {
  const calls: { sql: string; args: unknown[] }[] = [];
  return {
    calls,
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          calls.push({ sql, args });
          return { async run() {} };
        },
      };
    },
  };
}
function form(ids: string[], path: string) {
  const body = new URLSearchParams();
  for (const id of ids) body.append('id', id);
  return new Request(`https://x${path}`, { method: 'POST', body });
}

test('reject sets status=rejected, writes the audit columns, and 303-redirects to /admin', async () => {
  const db = makeDb();
  const res = await reject({ request: form(['a1'], '/admin/reject'), env: { DB: db } });
  expect(res.status).toBe(303);
  expect(res.headers.get('location')).toBe('https://x/admin');
  const call = db.calls.find((c) => c.sql.startsWith("UPDATE submissions SET status = 'rejected'"));
  expect(call).toBeDefined();
  expect(call!.args).toEqual(['mod@example.com', expect.any(Number), 'a1']);
});

test('reject accepts multiple ids and updates every one', async () => {
  const db = makeDb();
  const res = await reject({ request: form(['a1', 'a2', 'a3'], '/admin/reject'), env: { DB: db } });
  expect(res.status).toBe(303);
  const updates = db.calls.filter((c) => c.sql.startsWith("UPDATE submissions SET status = 'rejected'"));
  expect(updates).toHaveLength(3);
  expect(updates.map((c) => c.args[2])).toEqual(['a1', 'a2', 'a3']);
});

test('delete hard-removes multiple rows and 303-redirects to /admin', async () => {
  const db = makeDb();
  const res = await del({ request: form(['a1', 'a2'], '/admin/delete'), env: { DB: db } });
  expect(res.status).toBe(303);
  const deletes = db.calls.filter((c) => c.sql.startsWith('DELETE FROM submissions'));
  expect(deletes).toHaveLength(2);
});

test('delete never writes moderated_by/moderated_at (no audit trail for deletions)', async () => {
  const db = makeDb();
  await del({ request: form(['a1'], '/admin/delete'), env: { DB: db } });
  expect(db.calls.some((c) => c.sql.includes('moderated_by'))).toBe(false);
});

test('both reject and delete are 400 with no ids at all', async () => {
  expect((await reject({ request: form([], '/admin/reject'), env: { DB: makeDb() } })).status).toBe(400);
  expect((await del({ request: form([], '/admin/delete'), env: { DB: makeDb() } })).status).toBe(400);
});

test('reject and delete return the 403 when the gate denies, and never touch the DB', async () => {
  vi.mocked(requireModerator).mockResolvedValue(new Response('Forbidden', { status: 403 }));
  const rejectDb = makeDb();
  const deleteDb = makeDb();
  expect((await reject({ request: form(['a1'], '/admin/reject'), env: { DB: rejectDb } })).status).toBe(403);
  expect((await del({ request: form(['a1'], '/admin/delete'), env: { DB: deleteDb } })).status).toBe(403);
  expect(rejectDb.calls).toHaveLength(0);
  expect(deleteDb.calls).toHaveLength(0);
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npx vitest run tests/admin-actions.test.ts`
Expected: FAIL — current `reject.js`/`delete.js` only accept a single `id`, and `reject.js` doesn't write `moderated_by`/`moderated_at`.

- [ ] **Step 7: Rewrite `functions/admin/reject.js`**

```js
// functions/admin/reject.js
// POST /admin/reject — mark one or more submissions rejected (rows retained
// for audit), write who/when, back to queue.
import { requireModerator, getModeratorEmail } from '../_shared/access.js';
import { adminText, adminRedirect, isCrossSiteWrite, parseIds } from '../_shared/admin.js';

export async function onRequestPost({ request, env }) {
  const denied = await requireModerator(request, env);
  if (denied) return denied;
  if (isCrossSiteWrite(request)) return adminText('cross-site', 403);

  const form = await request.formData();
  const ids = parseIds(form);
  if (!ids) return adminText('bad-request', 400);

  const moderatedBy = await getModeratorEmail(request, env);
  const now = Date.now();
  for (const id of ids) {
    await env.DB.prepare(
      "UPDATE submissions SET status = 'rejected', moderated_by = ?, moderated_at = ? WHERE id = ?",
    )
      .bind(moderatedBy, now, id)
      .run();
  }
  return adminRedirect(new URL('/admin', request.url).toString());
}
```

- [ ] **Step 8: Rewrite `functions/admin/delete.js`**

```js
// functions/admin/delete.js
// POST /admin/delete — hard-remove one or more rows (obvious spam), back to
// queue. No audit trail: a deleted row has nothing left to audit.
import { requireModerator } from '../_shared/access.js';
import { adminText, adminRedirect, isCrossSiteWrite, parseIds } from '../_shared/admin.js';

export async function onRequestPost({ request, env }) {
  const denied = await requireModerator(request, env);
  if (denied) return denied;
  if (isCrossSiteWrite(request)) return adminText('cross-site', 403);

  const form = await request.formData();
  const ids = parseIds(form);
  if (!ids) return adminText('bad-request', 400);

  for (const id of ids) {
    await env.DB.prepare('DELETE FROM submissions WHERE id = ?').bind(id).run();
  }
  return adminRedirect(new URL('/admin', request.url).toString());
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npx vitest run tests/admin-actions.test.ts tests/admin-approve.test.ts`
Expected: PASS (6 + 7 tests). Then run the full suite (this task changed shared response shapes other tests may touch):

Run: `npx vitest run`
Expected: PASS, all files. Also run `npm run check` (0 errors/warnings) and `npm run build` (succeeds).

- [ ] **Step 10: Commit**

```bash
git add functions/admin/approve.js functions/admin/reject.js functions/admin/delete.js tests/admin-approve.test.ts tests/admin-actions.test.ts
git commit -m "feat: bulk-capable approve/reject/delete with moderation audit trail"
```

---

### Task 9: Rework `/admin` (queue) — search/filter/sort/pagination + bulk-select UI

**Files:**
- Modify: `functions/admin/index.js`
- Test: `tests/admin-list.test.ts` (extend)

**Interfaces:**
- Consumes: `parseAdminQuery`, `buildAdminListQuery`, `pageLink`, `totalPages`, `PAGE_SIZE` (Task 2); `renderNav`, `renderFilterForm`, `renderPagination` (Task 5).
- Produces: `GET /admin?q=&category=&level=&sort=&page=` behavior documented below; unchanged response shape for the no-query-param case (existing tests must keep passing).

- [ ] **Step 1: Write the failing tests**

Replace `tests/admin-list.test.ts` in full (the existing `dbWith` mock needs to support `.bind()` for the new parameterized queries, and the file needs a `.first()` for the count query):

```ts
// tests/admin-list.test.ts
import { expect, test, vi, beforeEach } from 'vitest';

vi.mock('../functions/_shared/access.js', () => ({
  requireModerator: vi.fn(async () => null), // authorized by default
}));
import { requireModerator } from '../functions/_shared/access.js';
import { onRequestGet } from '../functions/admin/index.js';

beforeEach(() => vi.mocked(requireModerator).mockReset().mockResolvedValue(null));

function dbWith(rows: unknown[]) {
  const calls: { sql: string; args: unknown[] }[] = [];
  return {
    calls,
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          calls.push({ sql, args });
          return {
            async all() { return { results: rows }; },
            async first() { return { n: rows.length }; },
          };
        },
      };
    },
  };
}
const req = (path = 'https://x/admin') => new Request(path);

test('lists pending submissions and escapes untrusted fields', async () => {
  const db = dbWith([
    { id: 'a1', created_at: 1, category: 'Cars', level: 'MED', title: '<script>alert(1)</script>', body: 'hi', sources: '[]', contributor: null, anonymous: 1 },
  ]);
  const res = await onRequestGet({ request: req(), env: { DB: db } });
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).not.toContain('<script>alert(1)</script>');
  expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  expect(html).toContain('action="/admin/approve"');
  expect(html).toContain('value="a1"');
});

test.each([
  ['null', null],
  ['undefined', undefined],
  ['empty string', ''],
])('renders a %s level as an empty value, not the literal string "null"', async (_label, level) => {
  const db = dbWith([
    { id: 'a2', created_at: 1, category: 'Cars', level, title: 'Title', body: 'hi', sources: '[]', contributor: 'Bob', anonymous: 0 },
  ]);
  const res = await onRequestGet({ request: req(), env: { DB: db } });
  const html = await res.text();
  expect(html).not.toContain('null');
  expect(html).toContain('<p><strong>Cars</strong> &middot;  &middot; by Bob</p>');
});

test('returns 403 when the gate denies', async () => {
  vi.mocked(requireModerator).mockResolvedValue(new Response('Forbidden', { status: 403 }));
  const res = await onRequestGet({ request: req(), env: { DB: dbWith([]) } });
  expect(res.status).toBe(403);
});

test('search/filter query params are bound into the WHERE clause with pending status', async () => {
  const db = dbWith([]);
  await onRequestGet({ request: req('https://x/admin?q=foo&category=Cars&level=LOW&sort=oldest'), env: { DB: db } });
  const selectCall = db.calls.find((c) => c.sql.includes('SELECT id'));
  expect(selectCall!.sql).toContain("status = 'pending'");
  expect(selectCall!.sql).toContain('LIKE');
  expect(selectCall!.sql).toContain('ORDER BY created_at ASC');
  expect(selectCall!.args).toEqual(['%foo%', '%foo%', 'Cars', 'LOW', 25, 0]);
});

test('the queue page includes the nav, filter form, checkboxes, and bulk-action buttons', async () => {
  const db = dbWith([
    { id: 'a1', created_at: 1, category: 'Cars', level: 'LOW', title: 'T', body: 'b', sources: '[]', contributor: null, anonymous: 1 },
  ]);
  const res = await onRequestGet({ request: req(), env: { DB: db } });
  const html = await res.text();
  expect(html).toContain('aria-current="page"'); // nav
  expect(html).toContain('class="admin-filters"');
  expect(html).toContain('type="checkbox" name="id" value="a1" form="bulk-form"');
  expect(html).toContain('formaction="/admin/approve"');
  expect(html).toContain('formaction="/admin/reject"');
  expect(html).toContain('formaction="/admin/delete"');
  expect(html).toContain('<link rel="stylesheet" href="/admin.css">');
  expect(html).toContain('<script type="module" src="/admin.js"></script>');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/admin-list.test.ts`
Expected: FAIL — the two new tests fail (no query-param handling, no checkboxes/nav/filter-form yet); the three pre-existing tests may also fail once the mock DB shape changes (bind-based), since the current `index.js` calls `.all()` directly without `.bind()`.

- [ ] **Step 3: Rewrite `functions/admin/index.js`**

```js
// functions/admin/index.js
// GET /admin — server-rendered, searchable/filterable/sortable/paginated
// queue of pending submissions. Every submission field is escaped:
// submission content is untrusted and rendered into this HTML.
import { requireModerator } from '../_shared/access.js';
import { escapeHtml } from '../_shared/html.js';
import { adminHtml } from '../_shared/admin.js';
import { parseAdminQuery, buildAdminListQuery, totalPages, PAGE_SIZE } from '../_shared/admin-query.js';
import { renderNav, renderFilterForm, renderPagination } from '../_shared/admin-chrome.js';

export async function onRequestGet({ request, env }) {
  const denied = await requireModerator(request, env);
  if (denied) return denied;

  const url = new URL(request.url);
  const query = parseAdminQuery(url);
  const { whereSql, orderSql, params } = buildAdminListQuery(query, "status = 'pending'");
  const offset = (query.page - 1) * PAGE_SIZE;

  const { results } = await env.DB.prepare(
    `SELECT id, created_at, category, level, title, body, sources, contributor, anonymous FROM submissions WHERE ${whereSql} ${orderSql} LIMIT ? OFFSET ?`,
  )
    .bind(...params, PAGE_SIZE, offset)
    .all();
  const countRow = await env.DB.prepare(`SELECT COUNT(*) as n FROM submissions WHERE ${whereSql}`)
    .bind(...params)
    .first();

  return adminHtml(renderQueue(results || [], query, countRow?.n ?? 0));
}

function actionForm(id, action, label) {
  return `<form method="POST" action="/admin/${action}"><input type="hidden" name="id" value="${escapeHtml(id)}"><button type="submit">${label}</button></form>`;
}

function renderQueue(rows, query, count) {
  const pages = totalPages(count);
  const items = rows
    .map(
      (r) => `<article>
  <input type="checkbox" name="id" value="${escapeHtml(r.id)}" form="bulk-form">
  <h2>${escapeHtml(r.title)}</h2>
  <p><strong>${escapeHtml(r.category)}</strong> &middot; ${escapeHtml(r.level || '')} &middot; by ${escapeHtml(r.anonymous ? 'anonymous' : r.contributor || '')}</p>
  <pre>${escapeHtml(r.body)}</pre>
  <p>sources: ${escapeHtml(r.sources || '[]')}</p>
  ${actionForm(r.id, 'approve', 'Approve')}
  ${actionForm(r.id, 'reject', 'Reject')}
  ${actionForm(r.id, 'delete', 'Delete')}
</article>`,
    )
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Moderation queue</title><link rel="stylesheet" href="/admin.css"></head><body>
${renderNav('queue')}
${renderFilterForm(query, '/admin')}
<form id="bulk-form" method="POST"></form>
<h1>Pending submissions (${count})</h1>
${items || '<p>Nothing pending.</p>'}
<div class="admin-bulk-actions">
  <span><span data-selected-count>0</span> selected</span>
  <button type="submit" form="bulk-form" formaction="/admin/approve">Approve selected</button>
  <button type="submit" form="bulk-form" formaction="/admin/reject">Reject selected</button>
  <button type="submit" form="bulk-form" formaction="/admin/delete" data-confirm="delete">Delete selected</button>
</div>
${renderPagination('/admin', query, query.page, pages)}
<script type="module" src="/admin.js"></script>
</body></html>`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/admin-list.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Run the full suite, typecheck, and build**

Run: `npx vitest run`
Expected: PASS, all files.

Run: `npm run check`
Expected: 0 errors, 0 warnings.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add functions/admin/index.js tests/admin-list.test.ts
git commit -m "feat: add search/filter/sort/pagination and bulk-select UI to the admin queue"
```

---

### Task 10: New `/admin/history` route

**Files:**
- Create: `functions/admin/history.js`
- Test: Create `tests/admin-history.test.ts`

**Interfaces:**
- Consumes: everything Task 9 consumed, plus reads the new `moderated_by`/`moderated_at` columns (Task 1).
- Produces: `GET /admin/history` — same query-param shape as `/admin`, but `status != 'pending'`, shows moderator/timestamp, and only offers bulk-delete (no approve/reject — rows here are already moderated).

- [ ] **Step 1: Write the failing tests**

Create `tests/admin-history.test.ts`:

```ts
// tests/admin-history.test.ts
import { expect, test, vi, beforeEach } from 'vitest';

vi.mock('../functions/_shared/access.js', () => ({
  requireModerator: vi.fn(async () => null),
}));
import { requireModerator } from '../functions/_shared/access.js';
import { onRequestGet } from '../functions/admin/history.js';

beforeEach(() => vi.mocked(requireModerator).mockReset().mockResolvedValue(null));

function dbWith(rows: unknown[]) {
  const calls: { sql: string; args: unknown[] }[] = [];
  return {
    calls,
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          calls.push({ sql, args });
          return {
            async all() { return { results: rows }; },
            async first() { return { n: rows.length }; },
          };
        },
      };
    },
  };
}
const req = (path = 'https://x/admin/history') => new Request(path);

test('lists non-pending submissions with moderator and timestamp, escaped', async () => {
  const db = dbWith([
    {
      id: 'a1', created_at: 1, category: '<b>Cars</b>', level: 'MED', title: 'T', status: 'approved',
      moderated_by: 'mod@example.com', moderated_at: 1720000000000,
    },
  ]);
  const res = await onRequestGet({ request: req(), env: { DB: db } });
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).not.toContain('<b>Cars</b>');
  expect(html).toContain('&lt;b&gt;Cars&lt;/b&gt;');
  expect(html).toContain('mod@example.com');
  expect(html).toContain('approved');
});

test('queries with status != pending', async () => {
  const db = dbWith([]);
  await onRequestGet({ request: req(), env: { DB: db } });
  const selectCall = db.calls.find((c) => c.sql.includes('SELECT id'));
  expect(selectCall!.sql).toContain("status != 'pending'");
});

test('shows "unknown" moderator when moderated_by is null (e.g. pre-migration rows)', async () => {
  const db = dbWith([
    { id: 'a1', created_at: 1, category: 'Cars', level: 'LOW', title: 'T', status: 'rejected', moderated_by: null, moderated_at: null },
  ]);
  const res = await onRequestGet({ request: req(), env: { DB: db } });
  const html = await res.text();
  expect(html).toContain('unknown');
});

test('only offers a bulk-delete action, not approve/reject', async () => {
  const db = dbWith([
    { id: 'a1', created_at: 1, category: 'Cars', level: 'LOW', title: 'T', status: 'rejected', moderated_by: 'mod@example.com', moderated_at: 1 },
  ]);
  const res = await onRequestGet({ request: req(), env: { DB: db } });
  const html = await res.text();
  expect(html).toContain('formaction="/admin/delete"');
  expect(html).not.toContain('formaction="/admin/approve"');
  expect(html).not.toContain('formaction="/admin/reject"');
});

test('returns 403 when the gate denies', async () => {
  vi.mocked(requireModerator).mockResolvedValue(new Response('Forbidden', { status: 403 }));
  const res = await onRequestGet({ request: req(), env: { DB: dbWith([]) } });
  expect(res.status).toBe(403);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/admin-history.test.ts`
Expected: FAIL — `Cannot find module '../functions/admin/history.js'`

- [ ] **Step 3: Write the implementation**

Create `functions/admin/history.js`:

```js
// functions/admin/history.js
// GET /admin/history — server-rendered, searchable/filterable/sortable/
// paginated view of already-moderated (approved/rejected) submissions, with
// who moderated each and when. Read-only except a bulk-delete for purging
// old rejected spam — approve/reject aren't offered here, those rows are
// already moderated.
import { requireModerator } from '../_shared/access.js';
import { escapeHtml } from '../_shared/html.js';
import { adminHtml } from '../_shared/admin.js';
import { parseAdminQuery, buildAdminListQuery, totalPages, PAGE_SIZE } from '../_shared/admin-query.js';
import { renderNav, renderFilterForm, renderPagination } from '../_shared/admin-chrome.js';

export async function onRequestGet({ request, env }) {
  const denied = await requireModerator(request, env);
  if (denied) return denied;

  const url = new URL(request.url);
  const query = parseAdminQuery(url);
  const { whereSql, orderSql, params } = buildAdminListQuery(query, "status != 'pending'");
  const offset = (query.page - 1) * PAGE_SIZE;

  const { results } = await env.DB.prepare(
    `SELECT id, created_at, category, level, title, status, moderated_by, moderated_at FROM submissions WHERE ${whereSql} ${orderSql} LIMIT ? OFFSET ?`,
  )
    .bind(...params, PAGE_SIZE, offset)
    .all();
  const countRow = await env.DB.prepare(`SELECT COUNT(*) as n FROM submissions WHERE ${whereSql}`)
    .bind(...params)
    .first();

  return adminHtml(renderHistory(results || [], query, countRow?.n ?? 0));
}

function renderHistory(rows, query, count) {
  const pages = totalPages(count);
  const items = rows
    .map((r) => {
      const when = r.moderated_at ? new Date(r.moderated_at).toISOString().slice(0, 10) : null;
      return `<article>
  <input type="checkbox" name="id" value="${escapeHtml(r.id)}" form="bulk-form">
  <h2>${escapeHtml(r.title)}</h2>
  <p><strong>${escapeHtml(r.category)}</strong> &middot; ${escapeHtml(r.level || '')} &middot; ${escapeHtml(r.status)}</p>
  <p>moderated by ${escapeHtml(r.moderated_by || 'unknown')}${when ? ` on ${escapeHtml(when)}` : ''}</p>
</article>`;
    })
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Moderation history</title><link rel="stylesheet" href="/admin.css"></head><body>
${renderNav('history')}
${renderFilterForm(query, '/admin/history')}
<form id="bulk-form" method="POST"></form>
<h1>History (${count})</h1>
${items || '<p>No history yet.</p>'}
<div class="admin-bulk-actions">
  <span><span data-selected-count>0</span> selected</span>
  <button type="submit" form="bulk-form" formaction="/admin/delete" data-confirm="delete">Delete selected</button>
</div>
${renderPagination('/admin/history', query, query.page, pages)}
<script type="module" src="/admin.js"></script>
</body></html>`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/admin-history.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Run the full suite, typecheck, and build**

Run: `npx vitest run`
Expected: PASS, all files.

Run: `npm run check`
Expected: 0 errors, 0 warnings.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add functions/admin/history.js tests/admin-history.test.ts
git commit -m "feat: add /admin/history moderation audit view"
```

---

### Task 11: Deploy prerequisites

**Files:**
- None (operational step, no code change)

- [ ] **Step 1: Apply migration 0003 to remote D1**

Run: `wrangler d1 migrations apply optout-wiki --remote`
Expected: `0003_moderation_audit.sql` applies cleanly alongside the two already-applied migrations.

- [ ] **Step 2: Build and deploy**

Run: `npm run build && wrangler pages deploy dist --project-name optout-wiki --branch main`
Expected: deployment succeeds; `public/admin.css` and `public/admin.js` appear as static assets alongside the Functions bundle.

- [ ] **Step 3: Smoke-check the live admin surface**

- `GET /admin` (as an authenticated moderator) shows the styled queue with the nav, filter form, checkboxes, and bulk-action buttons; the browser network tab shows `admin.css`/`admin.js` loading with 200s and no CSP console errors.
- `GET /admin/history` shows the tab, loads, and (once at least one submission has been approved/rejected through this new code) shows a moderator email and date.
- Approve/reject/delete a single row via its per-row button — still works exactly as before.
- Select two rows via checkboxes, click "Reject selected" — both move to History with the same `moderated_at` timestamp.

- [ ] **Step 4: Update project memory**

Note the live deployment (migration 0003 applied, admin rebuild shipped) wherever this project's memory file is tracked, per this project's own conventions — not part of this plan's file set.
