// functions/_shared/security.js
//
// Pure, unit-testable server-side security helpers for the Cloudflare Pages
// Function backend. Runs in the Cloudflare Workers runtime, so only
// Web-standard APIs are used (crypto.subtle, TextEncoder) — no Node builtins.

/**
 * Salted SHA-256 hash of an IP address, hex-encoded.
 * We never store the raw IP; only this hash is persisted, so the salt
 * must be kept secret (e.g. a Worker secret binding).
 *
 * @param {string} ip
 * @param {string} salt
 * @returns {Promise<string>} 64-character lowercase hex string
 */
export async function hashIp(ip, salt) {
  const data = new TextEncoder().encode(`${ip}:${salt}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Honeypot field check: bots that fill in the hidden field trip this.
 * A real (human-driven) submission leaves it empty/undefined.
 *
 * @param {unknown} value
 * @returns {boolean} true iff value is a non-empty (non-whitespace) string
 */
export function isHoneypotTripped(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Fixed-window rate limiter backed by the `rate_limits` D1 table.
 * Creates the row on first request in a window, increments on subsequent
 * requests, and resets once the window has elapsed.
 *
 * @param {{prepare: (sql: string) => {bind: (...args: unknown[]) => {first: () => Promise<any>, run: () => Promise<any>}}}} db D1-like binding
 * @param {string} ipHash salted IP hash (never the raw IP)
 * @param {number} now current time in ms (e.g. Date.now())
 * @param {number} windowMs window length in ms
 * @param {number} max max requests allowed per window
 * @returns {Promise<boolean>} true if the request is allowed
 */
export async function checkRateLimit(db, ipHash, now, windowMs, max) {
  const row = await db.prepare('SELECT window_start, count FROM rate_limits WHERE ip_hash = ?').bind(ipHash).first();
  if (!row || now - row.window_start > windowMs) {
    await db.prepare('INSERT OR REPLACE INTO rate_limits (ip_hash, window_start, count) VALUES (?, ?, 1)').bind(ipHash, now).run();
    return true;
  }
  if (row.count >= max) return false;
  await db.prepare('UPDATE rate_limits SET count = count + 1 WHERE ip_hash = ?').bind(ipHash).run();
  return true;
}
