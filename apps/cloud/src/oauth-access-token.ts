/**
 * OAuth access tokens for the remote MCP server, verified locally.
 *
 * AgentKit's authorization server (`OAUTH_ISSUER`, by default the
 * `ENTITLEMENTS_URL` origin) issues ES256 JWT access tokens (`typ: at+jwt`) for
 * the resource named by `OAUTH_RESOURCE`. This worker verifies them against
 * the issuer's public JWKS, so an OAuth call costs no upstream round trip. The
 * issuer re-checks the account's eligibility on every refresh, and an access
 * token lives at most an hour, which bounds how long a revoked grant keeps
 * working here.
 *
 * OAuth is opt-in per deployment: without `OAUTH_RESOURCE` every bearer goes
 * to the entitlements endpoint and no protected-resource metadata is served.
 *
 * Only public keys are fetched. The token is never stored or logged.
 */

import type { AuthOutcome, Scope } from './auth.js';
import type { Env } from './bindings.js';

/** OAuth scope per worker scope. The issuer grants these for the render resource. */
export const OAUTH_SCOPES: Readonly<Record<Scope, string>> = {
  render: 'ak-render:render',
  share: 'ak-render:share',
};

/** Longest access-token lifetime the issuer grants for this resource. */
export const MAX_ACCESS_TOKEN_SECONDS = 60 * 60;

/** Tolerated clock difference between the issuer and this worker. */
const CLOCK_SKEW_SECONDS = 60;

/** How long fetched signing keys are trusted before they are refreshed. */
const JWKS_TTL_MS = 10 * 60_000;

/** Least time between two JWKS fetches, so unknown `kid`s cannot force a fetch storm. */
const JWKS_REFETCH_MS = 60_000;

const JWKS_TIMEOUT_MS = 5_000;

/** Longest token this worker will parse; the issuer's are well under 2 kB. */
const MAX_TOKEN_LENGTH = 8_192;

export interface OAuthConfig {
  issuer: string;
  resource: string;
}

/** The deployment's OAuth settings, or `undefined` when OAuth is not enabled. */
export function oauthConfig(env: Env): OAuthConfig | undefined {
  const resource = env.OAUTH_RESOURCE?.trim();
  if (resource === undefined || resource === '') return undefined;
  const issuer = (env.OAUTH_ISSUER ?? env.ENTITLEMENTS_URL).trim().replace(/\/+$/u, '');
  return { issuer, resource };
}

/** RFC 9728 metadata URL for the resource: the well-known path plus the resource path. */
export function protectedResourceMetadataUrl(config: OAuthConfig): string {
  const resource = new URL(config.resource);
  const path = resource.pathname === '/' ? '' : resource.pathname;
  return `${resource.origin}/.well-known/oauth-protected-resource${path}`;
}

/** RFC 9728 protected-resource metadata body. */
export function protectedResourceMetadata(config: OAuthConfig): Record<string, unknown> {
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: Object.values(OAUTH_SCOPES),
    bearer_methods_supported: ['header'],
    resource_name: 'AK Render',
  };
}

const decoder = new TextDecoder();

function base64UrlBytes(segment: string): Uint8Array<ArrayBuffer> {
  const padded = segment.replace(/-/gu, '+').replace(/_/gu, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function jsonSegment(segment: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(decoder.decode(base64UrlBytes(segment)));
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;

/**
 * Whether a bearer is an OAuth access token rather than an AgentKit key or
 * session token. Only a three-segment JWS whose header declares `at+jwt` is;
 * everything else is sent to the entitlements endpoint as before.
 */
export function isOAuthAccessToken(token: string): boolean {
  if (token.length > MAX_TOKEN_LENGTH || !JWT_SHAPE.test(token)) return false;
  const header = jsonSegment(token.slice(0, token.indexOf('.')));
  return header?.['typ'] === 'at+jwt';
}

interface KeySet {
  keys: Map<string, CryptoKey>;
  fetchedAt: number;
}

let keySet: KeySet | undefined;

/** Drop the cached signing keys. Tests call this so each starts cold. */
export function clearJwksCache(): void {
  keySet = undefined;
}

async function fetchKeySet(issuer: string, now: number): Promise<KeySet> {
  const response = await fetch(`${issuer}/.well-known/jwks.json`, {
    headers: { accept: 'application/json' },
    redirect: 'manual',
    signal: AbortSignal.timeout(JWKS_TIMEOUT_MS),
  });
  if (response.status !== 200) throw new Error('jwks unavailable');
  const body = (await response.json()) as { keys?: unknown };
  if (!Array.isArray(body.keys)) throw new Error('jwks malformed');
  const keys = new Map<string, CryptoKey>();
  for (const jwk of body.keys as Record<string, unknown>[]) {
    // Only P-256 signing keys can verify an ES256 token; anything else is skipped.
    if (
      typeof jwk?.['kid'] !== 'string' ||
      jwk['kty'] !== 'EC' ||
      jwk['crv'] !== 'P-256' ||
      (jwk['alg'] !== undefined && jwk['alg'] !== 'ES256') ||
      (jwk['use'] !== undefined && jwk['use'] !== 'sig')
    ) {
      continue;
    }
    const { kty, crv, x, y } = jwk as { kty: string; crv: string; x: string; y: string };
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty, crv, x, y },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    keys.set(jwk['kid'], key);
  }
  return { keys, fetchedAt: now };
}

/** The verification key for `kid`, refreshing the cached set when it is stale or lacks it. */
async function signingKey(issuer: string, kid: string, now: number): Promise<CryptoKey | undefined> {
  const fresh = keySet !== undefined && now - keySet.fetchedAt < JWKS_TTL_MS;
  const known = keySet?.keys.get(kid);
  if (fresh && known !== undefined) return known;
  if (keySet !== undefined && now - keySet.fetchedAt < JWKS_REFETCH_MS) return known;
  keySet = await fetchKeySet(issuer, now);
  return keySet.keys.get(kid);
}

const rejected: AuthOutcome = {
  ok: false,
  status: 401,
  code: 'UNAUTHENTICATED',
  message: 'the bearer was rejected',
};

/**
 * Verify an OAuth access token for this resource and return its principal.
 *
 * The signature, issuer, audience, type, lifetime and scopes are all checked;
 * a delegated token (`act`) is refused because this resource accepts only
 * tokens issued to the calling client. The subject is the AgentKit user id,
 * the same subject the entitlements endpoint reports, so shares stay owned by
 * the same account whichever credential created them.
 */
export async function verifyOAuthAccessToken(
  token: string,
  config: OAuthConfig,
  now: number,
): Promise<AuthOutcome> {
  const [headerPart, payloadPart, signaturePart] = token.split('.') as [string, string, string];
  const header = jsonSegment(headerPart);
  const claims = jsonSegment(payloadPart);
  if (
    header === undefined ||
    claims === undefined ||
    header['alg'] !== 'ES256' ||
    header['typ'] !== 'at+jwt' ||
    typeof header['kid'] !== 'string'
  ) {
    return rejected;
  }

  let key: CryptoKey | undefined;
  try {
    key = await signingKey(config.issuer, header['kid'], now);
  } catch {
    return {
      ok: false,
      status: 502,
      code: 'JWKS_UNREACHABLE',
      message: 'the authorization server keys could not be fetched',
    };
  }
  if (key === undefined) return rejected;

  let signature: Uint8Array<ArrayBuffer>;
  try {
    signature = base64UrlBytes(signaturePart);
  } catch {
    return rejected;
  }
  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    signature,
    new TextEncoder().encode(`${headerPart}.${payloadPart}`),
  );
  if (!valid) return rejected;

  const seconds = now / 1000;
  const { iss, aud, sub, exp, iat, nbf, scope, act } = claims;
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (
    iss !== config.issuer ||
    !audiences.includes(config.resource) ||
    typeof sub !== 'string' ||
    sub === '' ||
    typeof exp !== 'number' ||
    typeof iat !== 'number' ||
    exp <= seconds ||
    iat > seconds + CLOCK_SKEW_SECONDS ||
    exp - iat > MAX_ACCESS_TOKEN_SECONDS ||
    (nbf !== undefined && (typeof nbf !== 'number' || nbf > seconds + CLOCK_SKEW_SECONDS)) ||
    typeof scope !== 'string' ||
    act !== undefined
  ) {
    return rejected;
  }

  const granted = new Set(scope.split(' '));
  const scopes = (Object.keys(OAUTH_SCOPES) as Scope[]).filter((name) =>
    granted.has(OAUTH_SCOPES[name]),
  );
  return { ok: true, principal: { subject: sub, scopes } };
}
