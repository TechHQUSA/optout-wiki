// functions/_shared/admin.js
// Shared helpers for the admin Pages Functions. Cloudflare `_headers` does NOT
// apply to Function responses (only to static assets), so every admin response
// sets its own security headers here. `script-src`/`style-src` allow only
// same-origin (`public/admin.js`/`public/admin.css`) — no inline script/style,
// no third-party host. This CSP is scoped to /admin*; the public site's CSP
// (public/_headers) is untouched.
const ADMIN_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'x-robots-tag': 'noindex',
  'referrer-policy': 'no-referrer',
};

/** HTML response with the admin security headers. */
export function adminHtml(body, status = 200) {
  return new Response(body, { status, headers: ADMIN_HEADERS });
}

/** Plain-text response with the admin security headers (for 400/404 etc.). */
export function adminText(body, status) {
  return new Response(body, { status, headers: { ...ADMIN_HEADERS, 'content-type': 'text/plain; charset=utf-8' } });
}

/** 303 redirect carrying the admin security headers (Response.redirect can't). */
export function adminRedirect(location) {
  return new Response(null, { status: 303, headers: { ...ADMIN_HEADERS, location } });
}

/**
 * CSRF defense-in-depth for state-changing POSTs. Returns true iff the request
 * is cross-site. Prefers the Sec-Fetch-Site hint; falls back to an Origin vs
 * request-origin comparison. A request with neither header (rare, non-browser)
 * is treated as same-site (the Access edge gate is the primary control).
 */
export function isCrossSiteWrite(request) {
  const site = request.headers.get('sec-fetch-site');
  if (site) return site !== 'same-origin' && site !== 'same-site' && site !== 'none';
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).origin !== new URL(request.url).origin;
  } catch {
    return true;
  }
}

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

/**
 * Validates a `return_to` form field against an allow-list of internal admin
 * paths (queue or history, with or without a filter query string) and falls
 * back to `/admin` otherwise — never redirects to an attacker-supplied
 * external location.
 * @param {FormData} form
 * @returns {string}
 */
export function safeReturnTo(form) {
  const raw = form.get('return_to');
  if (typeof raw === 'string' && /^\/admin(\/history)?(\?[^\s]*)?$/.test(raw)) return raw;
  return '/admin';
}
