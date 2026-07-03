// tests/access.test.ts
import { expect, test, beforeEach } from 'vitest';
import { verifyJwt, verifyAccessJwt, requireModerator, resetJwksCache } from '../functions/_shared/access.js';

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
