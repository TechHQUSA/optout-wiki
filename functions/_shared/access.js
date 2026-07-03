// functions/_shared/access.js
//
// Verifies the Cloudflare Access identity JWT inside each admin Function
// (defense-in-depth behind the edge Access policy). Web-standard APIs only
// (crypto.subtle RS256, atob) so it runs in the Workers runtime.
//
// `verifyJwt` is a pure verifier (token + JWKS in, payload-or-null out) and is
// the unit-tested core. `verifyAccessJwt` adds request/header parsing and a
// cached JWKS fetch; `requireModerator` is the 403-or-proceed gate the routes call.

function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  s += '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function decodeSegment(seg) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(seg)));
}

/**
 * Pure RS256 JWT verifier.
 * @param {string} token
 * @param {Array<JsonWebKey & {kid?: string}>} jwks
 * @param {{aud?: string, now?: number, iss?: string}} opts
 * @returns {Promise<object|null>}
 */
export async function verifyJwt(token, jwks, { aud, now = Date.now(), iss } = {}) {
  if (typeof token !== 'string' || token.split('.').length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = token.split('.');
  let header, payload;
  try {
    header = decodeSegment(headerB64);
    payload = decodeSegment(payloadB64);
  } catch {
    return null;
  }
  if (header.alg !== 'RS256') return null;
  const jwk = jwks.find((k) => k.kid === header.kid) || (jwks.length === 1 ? jwks[0] : null);
  if (!jwk) return null;

  let key;
  try {
    key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
  } catch {
    return null;
  }
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(sigB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`),
  );
  if (!ok) return null;

  const audOk = Array.isArray(payload.aud) ? payload.aud.includes(aud) : payload.aud === aud;
  if (aud && !audOk) return null;
  if (iss && payload.iss !== iss) return null;
  if (typeof payload.exp === 'number' && now >= payload.exp * 1000) return null;
  return payload;
}

let jwksCache = { keys: null, at: 0 };
const JWKS_TTL_MS = 60 * 60 * 1000;

/** Test helper: clear the module-level JWKS cache. */
export function resetJwksCache() {
  jwksCache = { keys: null, at: 0 };
}

async function getJwks(teamDomain, fetchImpl, now) {
  if (jwksCache.keys && now - jwksCache.at < JWKS_TTL_MS) return jwksCache.keys;
  const res = await fetchImpl(`https://${teamDomain}/cdn-cgi/access/certs`);
  const body = await res.json();
  jwksCache = { keys: body.keys || [], at: now };
  return jwksCache.keys;
}

/**
 * @param {Request} request
 * @param {{CF_ACCESS_TEAM_DOMAIN: string, CF_ACCESS_AUD: string}} env
 * @param {number} [now]
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<object|null>}
 */
export async function verifyAccessJwt(request, env, now = Date.now(), fetchImpl = fetch) {
  const token =
    request.headers.get('cf-access-jwt-assertion') ||
    (request.headers.get('cookie') || '').match(/CF_Authorization=([^;]+)/)?.[1] ||
    null;
  if (!token) return null;
  const jwks = await getJwks(env.CF_ACCESS_TEAM_DOMAIN, fetchImpl, now);
  return verifyJwt(token, jwks, { aud: env.CF_ACCESS_AUD, now, iss: `https://${env.CF_ACCESS_TEAM_DOMAIN}` });
}

/**
 * 403-or-proceed gate. Returns a Response to return early, or null to continue.
 * @returns {Promise<Response|null>}
 */
export async function requireModerator(request, env, now = Date.now()) {
  const identity = await verifyAccessJwt(request, env, now);
  if (!identity) return new Response('Forbidden', { status: 403 });
  return null;
}
