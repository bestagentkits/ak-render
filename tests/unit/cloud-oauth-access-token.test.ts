/**
 * OAuth on the cloud worker: protected-resource discovery, the 401 challenge
 * that starts an MCP client's sign-in, and local verification of the issuer's
 * ES256 access tokens. A real P-256 key pair signs each token, and the
 * `fetch` stub plays both the issuer's JWKS and the entitlements endpoint.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../apps/cloud/src/bindings.js';
import { handleRequest } from '../../apps/cloud/src/index.js';
import { clearJwksCache, isOAuthAccessToken } from '../../apps/cloud/src/oauth-access-token.js';
import {
  activeEntitlements,
  ENTITLEMENTS_ORIGIN,
  harness,
  ORIGIN,
  post,
  SPEC,
} from './support/cloud-worker-harness.js';

const ISSUER = 'https://issuer.example.test';
const RESOURCE = `${ORIGIN}/mcp`;
const KID = 'test-key';
const USER = '6b4d4a5e-6f0a-4f0e-9a51-0c4f7f5b9e21';
const METADATA_URL = `${ORIGIN}/.well-known/oauth-protected-resource/mcp`;

let signer: CryptoKeyPair;
let stranger: CryptoKeyPair;
let publicJwk: JsonWebKey;

beforeAll(async () => {
  const params = { name: 'ECDSA', namedCurve: 'P-256' } as const;
  signer = await crypto.subtle.generateKey(params, true, ['sign', 'verify']);
  stranger = await crypto.subtle.generateKey(params, true, ['sign', 'verify']);
  publicJwk = await crypto.subtle.exportKey('jwk', signer.publicKey);
});

beforeEach(() => clearJwksCache());

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const base64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/u, '');

const encodeJson = (value: unknown): string =>
  base64Url(new TextEncoder().encode(JSON.stringify(value)));

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

async function accessToken(
  claims: Record<string, unknown> = {},
  options: { header?: Record<string, unknown>; key?: CryptoKey } = {},
): Promise<string> {
  const iat = nowSeconds();
  const header = encodeJson({ alg: 'ES256', typ: 'at+jwt', kid: KID, ...options.header });
  const payload = encodeJson({
    iss: ISSUER,
    aud: RESOURCE,
    sub: USER,
    client_id: 'client-1',
    grant_id: '0d3c1d5c-0c62-4d55-8d8e-1b0f6a3c7a10',
    jti: 'jti-1',
    scope: 'ak-render:render ak-render:share',
    iat,
    exp: iat + 3600,
    ...claims,
  });
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    options.key ?? signer.privateKey,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${base64Url(new Uint8Array(signature))}`;
}

/** A worker env with OAuth on, and a fetch stub serving JWKS and entitlements. */
function oauthHarness(options: { jwksStatus?: number } = {}) {
  const base = harness();
  const jwks = { status: options.jwksStatus ?? 200 };
  const env: Env = { ...base.env, OAUTH_RESOURCE: RESOURCE, OAUTH_ISSUER: ISSUER };
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === `${ISSUER}/.well-known/jwks.json`) {
      return new Response(
        JSON.stringify({
          keys: [
            // A malformed key the worker must skip without losing the good one.
            { kty: 'EC', crv: 'P-256', kid: 'broken', x: 'AA', y: 'AA' },
            { ...publicJwk, kid: KID, alg: 'ES256', use: 'sig' },
          ],
        }),
        {
          status: jwks.status,
          headers: { 'content-type': 'application/json' },
        },
      );
    }
    return new Response(JSON.stringify(activeEntitlements('api-key-user')), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  const jwksCalls = () =>
    fetchMock.mock.calls.filter(([input]) => String(input).startsWith(ISSUER)).length;
  const entitlementCalls = () =>
    fetchMock.mock.calls.filter(([input]) => String(input).startsWith(ENTITLEMENTS_ORIGIN)).length;
  return { ...base, env, jwks, fetchMock, jwksCalls, entitlementCalls };
}

function mcp(method: string, params: unknown, token: string | null): Request {
  return new Request(`${ORIGIN}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-11-25',
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
}

describe('cloud OAuth: discovery', () => {
  it('serves protected-resource metadata at the root and the resource path', async () => {
    const { env } = oauthHarness();
    for (const path of [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/mcp',
    ]) {
      const response = await handleRequest(new Request(`${ORIGIN}${path}`), env);
      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      expect(await response.json()).toEqual({
        resource: RESOURCE,
        authorization_servers: [ISSUER],
        scopes_supported: ['ak-render:render', 'ak-render:share'],
        bearer_methods_supported: ['header'],
        resource_name: 'AK Render',
      });
    }
    const other = await handleRequest(
      new Request(`${ORIGIN}/.well-known/oauth-protected-resource/v1`),
      env,
    );
    expect(other.status).toBe(404);
  });

  it('serves no metadata where OAuth is not enabled', async () => {
    const { env } = harness();
    const response = await handleRequest(
      new Request(`${ORIGIN}/.well-known/oauth-protected-resource/mcp`),
      env,
    );
    expect(response.status).toBe(404);
  });

  it('answers an MCP request without a bearer with a 401 that points at the metadata', async () => {
    const { env, fetchMock } = oauthHarness();
    const response = await handleRequest(
      mcp('initialize', { protocolVersion: '2025-11-25' }, null),
      env,
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe(
      `Bearer realm="ak-render", resource_metadata="${METADATA_URL}", scope="ak-render:render ak-render:share"`,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('adds the metadata to a REST 401 and marks a rejected bearer invalid', async () => {
    const { env } = oauthHarness();
    const missing = await handleRequest(post('/v1/render', { spec: SPEC }, null), env);
    expect(missing.status).toBe(401);
    expect(missing.headers.get('www-authenticate')).toContain(
      `resource_metadata="${METADATA_URL}"`,
    );
    const forged = await handleRequest(
      post('/v1/render', { spec: SPEC }, await accessToken({}, { key: stranger.privateKey })),
      env,
    );
    expect(forged.status).toBe(401);
    expect(forged.headers.get('www-authenticate')).toContain('error="invalid_token"');
  });
});

describe('cloud OAuth: access tokens', () => {
  it('renders with a valid token without calling the entitlements endpoint', async () => {
    const { env, jwksCalls, entitlementCalls } = oauthHarness();
    const token = await accessToken();
    for (let index = 0; index < 2; index += 1) {
      const response = await handleRequest(post('/v1/render', { spec: SPEC }, token), env);
      expect(response.status).toBe(200);
    }
    expect(entitlementCalls()).toBe(0);
    // The signing keys are fetched once and reused.
    expect(jwksCalls()).toBe(1);
  });

  it('owns a share by the token subject', async () => {
    const { env, r2 } = oauthHarness();
    const response = await handleRequest(
      post('/v1/share', { spec: SPEC }, await accessToken()),
      env,
    );
    expect(response.status).toBe(201);
    const [stored] = [...r2.objects.values()];
    expect(stored?.customMetadata?.['owner']).toBe(USER);
  });

  it('serves MCP render with a valid token', async () => {
    const { env } = oauthHarness();
    const response = await handleRequest(
      mcp('tools/call', { name: 'render', arguments: { spec: SPEC } }, await accessToken()),
      env,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: { isError?: boolean; content: { text: string }[] };
    };
    expect(body.result.isError).toBeFalsy();
    expect(JSON.parse(body.result.content[0]?.text ?? '{}')['artifactUrl']).toMatch(
      `${ORIGIN}/v1/artifact/`,
    );
  });

  it('grants only the scopes the token carries', async () => {
    const { env } = oauthHarness();
    const token = await accessToken({ scope: 'ak-render:render' });
    expect((await handleRequest(post('/v1/render', { spec: SPEC }, token), env)).status).toBe(200);
    const share = await handleRequest(post('/v1/share', { spec: SPEC }, token), env);
    expect(share.status).toBe(403);
    expect(((await share.json()) as { code: string }).code).toBe('FORBIDDEN');
  });

  it.each([
    ['another audience', { aud: 'https://bwak.example.test/mcp' }],
    ['another issuer', { iss: 'https://evil.example.test' }],
    ['an expired token', { iat: nowSeconds() - 7200, exp: nowSeconds() - 3600 }],
    ['a lifetime over an hour', { exp: nowSeconds() + 7200 }],
    ['a delegated token', { act: { sub: 'worker' } }],
    ['a missing subject', { sub: '' }],
    ['a missing scope claim', { scope: 1 }],
  ])('rejects %s', async (_label, claims) => {
    const { env } = oauthHarness();
    const response = await handleRequest(
      post('/v1/render', { spec: SPEC }, await accessToken(claims)),
      env,
    );
    expect(response.status).toBe(401);
  });

  it('rejects another algorithm and an unknown key without a fetch storm', async () => {
    const { env, jwksCalls } = oauthHarness();
    const wrongAlg = await accessToken({}, { header: { alg: 'HS256' } });
    expect((await handleRequest(post('/v1/render', { spec: SPEC }, wrongAlg), env)).status).toBe(
      401,
    );
    for (let index = 0; index < 3; index += 1) {
      const unknown = await accessToken({}, { header: { kid: `unknown-${index}` } });
      expect((await handleRequest(post('/v1/render', { spec: SPEC }, unknown), env)).status).toBe(
        401,
      );
    }
    expect(jwksCalls()).toBe(1);
  });

  it('fails closed when the signing keys cannot be fetched', async () => {
    const { env } = oauthHarness({ jwksStatus: 503 });
    const response = await handleRequest(
      post('/v1/render', { spec: SPEC }, await accessToken()),
      env,
    );
    expect(response.status).toBe(502);
    expect(((await response.json()) as { code: string }).code).toBe('JWKS_UNREACHABLE');
  });

  it('keeps verifying with cached keys through an issuer outage, fetching at most once a minute', async () => {
    const { env, jwks, jwksCalls } = oauthHarness();
    const token = await accessToken();
    const start = Date.now();
    const at = (minutes: number) => new Date(start + minutes * 60_000);
    expect(
      (await handleRequest(post('/v1/render', { spec: SPEC }, token), env, at(0))).status,
    ).toBe(200);
    jwks.status = 503;
    // Past the 10-minute refresh: the refetch fails, the cached key still verifies.
    expect(
      (await handleRequest(post('/v1/render', { spec: SPEC }, token), env, at(11))).status,
    ).toBe(200);
    expect(
      (await handleRequest(post('/v1/render', { spec: SPEC }, token), env, at(11.5))).status,
    ).toBe(200);
    expect(jwksCalls()).toBe(2);
  });

  it('shares one key fetch between concurrent requests', async () => {
    const { env, jwksCalls } = oauthHarness();
    const token = await accessToken();
    const responses = await Promise.all(
      [0, 1, 2].map(() => handleRequest(post('/v1/render', { spec: SPEC }, token), env)),
    );
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    expect(jwksCalls()).toBe(1);
  });

  it('still sends an API key to the entitlements endpoint', async () => {
    const { env, entitlementCalls, jwksCalls } = oauthHarness();
    const response = await handleRequest(
      post('/v1/render', { spec: SPEC }, 'ck_live_example'),
      env,
    );
    expect(response.status).toBe(200);
    expect(entitlementCalls()).toBe(1);
    expect(jwksCalls()).toBe(0);
  });

  it('recognises only at+jwt bearers as OAuth access tokens', async () => {
    expect(isOAuthAccessToken(await accessToken())).toBe(true);
    expect(isOAuthAccessToken('ck_live_abc')).toBe(false);
    expect(isOAuthAccessToken(`${encodeJson({ alg: 'ES256', typ: 'JWT' })}.e30.sig`)).toBe(false);
  });
});
