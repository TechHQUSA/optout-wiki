// tests/access.test.ts
import { expect, test, beforeEach } from 'vitest';
import { verifyJwt, verifyAccessJwt, requireModerator, resetJwksCache, getModeratorEmail } from '../functions/_shared/access.js';

const AUD = 'test-aud-tag';
const TEAM = 'team.cloudflareaccess.com';

// Generate one RS256 keypair for the whole file; export the public JWK (with a
// kid) as the mock JWKS, and sign tokens with the private key.
let publicJwk: JsonWebKey & { kid: string };
let privateKey: CryptoKey;

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlJson(obj: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}
function b64urlDecode(s: string): Uint8Array {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  s += '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
async function signToken(payload: object): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT', kid: publicJwk.kid };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${b64url(new Uint8Array(sig))}`;
}

beforeEach(async () => {
  resetJwksCache();
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  privateKey = pair.privateKey;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
  publicJwk = { ...jwk, kid: 'test-kid' };
});

const future = () => Math.floor(Date.now() / 1000) + 3600;
const past = () => Math.floor(Date.now() / 1000) - 3600;

test('verifyJwt accepts a well-formed, correctly-signed token', async () => {
  const token = await signToken({ aud: AUD, exp: future() });
  const payload = await verifyJwt(token, [publicJwk], { aud: AUD });
  expect(payload).not.toBeNull();
  expect((payload as { aud: string }).aud).toBe(AUD);
});

test('verifyJwt rejects wrong aud, expired, tampered, and malformed tokens', async () => {
  expect(await verifyJwt(await signToken({ aud: 'other', exp: future() }), [publicJwk], { aud: AUD })).toBeNull();
  expect(await verifyJwt(await signToken({ aud: AUD, exp: past() }), [publicJwk], { aud: AUD })).toBeNull();
  const good = await signToken({ aud: AUD, exp: future() });
  const tampered = good.slice(0, -3) + (good.slice(-3) === 'AAA' ? 'BBB' : 'AAA');
  expect(await verifyJwt(tampered, [publicJwk], { aud: AUD })).toBeNull();
  expect(await verifyJwt('not.a.jwt', [publicJwk], { aud: AUD })).toBeNull();
  expect(await verifyJwt('', [publicJwk], { aud: AUD })).toBeNull();
});

test('verifyAccessJwt reads the header and uses the injected JWKS fetcher', async () => {
  const token = await signToken({ aud: AUD, exp: future(), iss: `https://${TEAM}` });
  const fetchImpl = async () => new Response(JSON.stringify({ keys: [publicJwk] }));
  const env = { CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD };
  const req = new Request('https://x/admin', { headers: { 'cf-access-jwt-assertion': token } });
  expect(await verifyAccessJwt(req, env, Date.now(), fetchImpl as typeof fetch)).not.toBeNull();
});

test('requireModerator returns 403 when no token is present', async () => {
  const env = { CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD };
  const req = new Request('https://x/admin');
  const res = await requireModerator(req, env);
  expect(res).not.toBeNull();
  expect((res as Response).status).toBe(403);
});

test('verifyJwt fails closed when no aud is configured', async () => {
  const token = await signToken({ aud: AUD, exp: future() });
  expect(await verifyJwt(token, [publicJwk], { aud: '' })).toBeNull();
  // @ts-expect-error — intentionally omitting the (now required) aud to prove the runtime fails closed
  expect(await verifyJwt(token, [publicJwk], {})).toBeNull();
});

test('verifyJwt rejects a token with no exp claim', async () => {
  const token = await signToken({ aud: AUD });
  expect(await verifyJwt(token, [publicJwk], { aud: AUD })).toBeNull();
});

test('verifyJwt returns null (not throw) on a malformed signature segment', async () => {
  const good = await signToken({ aud: AUD, exp: future() });
  const [h, p] = good.split('.');
  await expect(verifyJwt(`${h}.${p}.@@@not-base64url@@@`, [publicJwk], { aud: AUD })).resolves.toBeNull();
});

test('verifyJwt accepts an array-form aud that includes the expected value', async () => {
  const token = await signToken({ aud: [AUD, 'other-app'], exp: future() });
  expect(await verifyJwt(token, [publicJwk], { aud: AUD })).not.toBeNull();
});

test('verifyJwt rejects an RS256->HS256 alg-confusion attack', async () => {
  // Classic downgrade: forge an HS256-signed token, using the RSA public key's
  // own (public) modulus bytes as the HMAC secret. A verifier that reads
  // header.alg and dynamically dispatches to `crypto.subtle.verify` with an
  // HMAC algorithm would accept this, because "the secret" is just the public
  // key the attacker already has. This codebase's verifyJwt instead (a) checks
  // `header.alg !== 'RS256'` and rejects before touching crypto at all, and
  // (b) hardcodes `{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }` in the one
  // `crypto.subtle.verify` call it ever makes — there is no code path that
  // would call `crypto.subtle.verify('HMAC', ...)`. This test is a regression
  // guard against someone "fixing" the verifier to read `alg` dynamically.
  const secretBytes = b64urlDecode(publicJwk.n as string);
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    secretBytes as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const header = { alg: 'HS256', typ: 'JWT', kid: publicJwk.kid };
  const payload = { aud: AUD, exp: future() };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const sig = await crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode(signingInput));
  const forged = `${signingInput}.${b64url(new Uint8Array(sig))}`;
  expect(await verifyJwt(forged, [publicJwk], { aud: AUD })).toBeNull();
});

test('verifyJwt rejects an alg:none unsigned token (empty and "null" signature segments)', async () => {
  const header = { alg: 'none', typ: 'JWT' };
  const payload = { aud: AUD, exp: future() };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  expect(await verifyJwt(`${signingInput}.`, [publicJwk], { aud: AUD })).toBeNull();
  expect(await verifyJwt(`${signingInput}.null`, [publicJwk], { aud: AUD })).toBeNull();
});

test('verifyJwt rejects an unknown or missing kid when multiple keys are configured', async () => {
  const pair2 = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const jwk2 = { ...((await crypto.subtle.exportKey('jwk', pair2.publicKey)) as JsonWebKey), kid: 'test-kid-2' };
  const jwks = [publicJwk, jwk2];
  const payload = { aud: AUD, exp: future() };

  // kid present but matches neither entry in the JWKS.
  const headerBadKid = { alg: 'RS256', typ: 'JWT', kid: 'no-such-kid' };
  const signingInput1 = `${b64urlJson(headerBadKid)}.${b64urlJson(payload)}`;
  const sig1 = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(signingInput1));
  const tokenBadKid = `${signingInput1}.${b64url(new Uint8Array(sig1))}`;
  expect(await verifyJwt(tokenBadKid, jwks, { aud: AUD })).toBeNull();

  // kid omitted entirely — with >1 keys configured, the verifier must not
  // guess; it should reject rather than trying every key in the array.
  const headerNoKid = { alg: 'RS256', typ: 'JWT' };
  const signingInput2 = `${b64urlJson(headerNoKid)}.${b64urlJson(payload)}`;
  const sig2 = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(signingInput2));
  const tokenNoKid = `${signingInput2}.${b64url(new Uint8Array(sig2))}`;
  expect(await verifyJwt(tokenNoKid, jwks, { aud: AUD })).toBeNull();
});

test('DOCUMENTED QUIRK: with a single-key JWKS, a mismatched/missing kid still falls back to that sole key', async () => {
  // verifyJwt's kid lookup is:
  //   jwks.find((k) => k.kid === header.kid) || (jwks.length === 1 ? jwks[0] : null)
  // So when the JWKS has exactly one entry (the common Cloudflare Access case
  // outside of key-rotation windows), a kid mismatch or omission does NOT
  // reject — it falls back to the sole key. This is NOT an auth bypass: the
  // token's signature still has to validate against that one genuine
  // Cloudflare-held private key, which an attacker cannot forge. It just
  // means `kid` provides no additional enforcement in the single-key case.
  // Recorded here as a characterization/regression test, not a vulnerability.
  const header = { alg: 'RS256', typ: 'JWT', kid: 'no-such-kid' };
  const payload = { aud: AUD, exp: future() };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(signingInput));
  const token = `${signingInput}.${b64url(new Uint8Array(sig))}`;
  expect(await verifyJwt(token, [publicJwk], { aud: AUD })).not.toBeNull();
});

test('verifyJwt handles an oversized (~200KB) payload promptly, without unbounded work', async () => {
  const token = await signToken({ aud: AUD, exp: future(), pad: 'a'.repeat(200_000) });
  const start = performance.now();
  const payload = await verifyJwt(token, [publicJwk], { aud: AUD });
  const elapsed = performance.now() - start;
  expect(payload).not.toBeNull();
  expect(elapsed).toBeLessThan(2000);
});

test('a bad JWKS refresh (after cache TTL expiry) does not poison/clear the previously cached good keys', async () => {
  resetJwksCache();
  const env = { CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD };
  const t0 = Date.now();
  const JWKS_TTL_MS = 60 * 60 * 1000;
  const tStale = t0 + JWKS_TTL_MS + 1000;
  // exp is derived from tStale (with headroom) rather than the default
  // future() helper (relative to real Date.now()), so the token is still
  // valid at tStale — this test is about JWKS cache poisoning, not expiry.
  const token = await signToken({ aud: AUD, exp: Math.floor(tStale / 1000) + 3600, iss: `https://${TEAM}` });

  const goodFetch = async () => new Response(JSON.stringify({ keys: [publicJwk] }));
  const req1 = new Request('https://x/admin', { headers: { 'cf-access-jwt-assertion': token } });
  expect(await verifyAccessJwt(req1, env, t0, goodFetch as typeof fetch)).not.toBeNull();

  // Advance past the JWKS TTL so the next call actually attempts a refetch —
  // and give it a bad response each time (not-ok, malformed JSON, empty
  // `keys` array). getJwks must keep serving the previously cached good keys
  // rather than being poisoned or emptied by any of these.
  const badFetches: Array<() => Promise<Response>> = [
    async () => new Response('', { status: 500 }),
    async () => new Response('not json'),
    async () => new Response(JSON.stringify({ keys: [] })),
  ];
  for (const badFetch of badFetches) {
    const req2 = new Request('https://x/admin', { headers: { 'cf-access-jwt-assertion': token } });
    const payload = await verifyAccessJwt(req2, env, tStale, badFetch as typeof fetch);
    expect(payload).not.toBeNull();
  }
});

test('getModeratorEmail returns the email claim from a valid Access token', async () => {
  const token = await signToken({ aud: AUD, exp: future(), iss: `https://${TEAM}`, email: 'mod@example.com' });
  const fetchImpl = async () => new Response(JSON.stringify({ keys: [publicJwk] }));
  const env = { CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD };
  const req = new Request('https://x/admin/approve', { headers: { 'cf-access-jwt-assertion': token } });
  expect(await getModeratorEmail(req, env, Date.now(), fetchImpl as typeof fetch)).toBe('mod@example.com');
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
  expect(await getModeratorEmail(req, env, Date.now(), fetchImpl as typeof fetch)).toBeNull();
});
