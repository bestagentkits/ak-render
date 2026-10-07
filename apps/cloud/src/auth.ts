/**
 * Bearer validation through the canonical AgentKit entitlements endpoint.
 *
 * A bearer is an AgentKit personal API key, a CLI session token, or, where the
 * deployment enables OAuth, an OAuth access token. OAuth tokens are verified
 * locally (oauth-access-token.ts); every other bearer takes the path below.
 *
 * This worker never copies AgentKit's signing secrets and never talks to its
 * database. It forwards the caller's bearer to
 * `GET {ENTITLEMENTS_URL}/api/agentkit/entitlements` and trusts only that
 * answer. The response shape it accepts is the one the AgentKit CLI parses:
 *
 *   { schemaVersion, status: "active", userId, authMethod, licenseId,
 *     activationId, entitlements: { agentkitApp: bool, kits: { <kit>: bool } } }
 *
 * The token is never stored: it is not written to R2, to logs, or into a
 * response. Answers are cached in memory for a minute under a SHA-256 digest of
 * the token (principal-cache.ts), never under the token itself, and a cache
 * miss counts against a per-IP limit before anything is forwarded upstream.
 */

import type { Env } from './bindings.js';
import {
  isOAuthAccessToken,
  OAUTH_SCOPES,
  oauthConfig,
  protectedResourceMetadataUrl,
  verifyOAuthAccessToken,
} from './oauth-access-token.js';
import { bearerDigest, cachedOutcome, rememberOutcome } from './principal-cache.js';
import { clientIp, withinRateLimit } from './rate-limit.js';

export type Scope = 'render' | 'share';

export interface Principal {
  readonly subject: string;
  readonly scopes: readonly Scope[];
}

export type AuthFailure = {
  ok: false;
  status: 401 | 403 | 429 | 502;
  code: string;
  message: string;
};

export type AuthOutcome = { ok: true; principal: Principal } | AuthFailure;

/** Path of the canonical entitlements endpoint, appended to ENTITLEMENTS_URL. */
export const ENTITLEMENTS_PATH = '/api/agentkit/entitlements';

/** Upper bound on the entitlements round trip; a slow upstream fails closed. */
const ENTITLEMENTS_TIMEOUT_MS = 5_000;

/**
 * `WWW-Authenticate` value for a 401. A presented credential that failed is an
 * `invalid_token` (RFC 6750); a missing one only names the scheme. With OAuth
 * enabled the challenge also points at the protected-resource metadata
 * (RFC 9728) and names the scopes, which is how an MCP client discovers where
 * to sign in.
 */
export function bearerChallenge(request: Request, env: Env): string {
  const parts = ['realm="ak-render"'];
  const oauth = oauthConfig(env);
  if (oauth !== undefined) {
    parts.push(`resource_metadata="${protectedResourceMetadataUrl(oauth)}"`);
    parts.push(`scope="${Object.values(OAUTH_SCOPES).join(' ')}"`);
  }
  if (request.headers.has('authorization')) parts.push('error="invalid_token"');
  return `Bearer ${parts.join(', ')}`;
}

function bearerOf(request: Request): string | undefined {
  const header = request.headers.get('authorization');
  if (header === null) return undefined;
  const match = /^Bearer\s+(.+)$/iu.exec(header.trim());
  const token = match?.[1]?.trim();
  return token === undefined || token === '' ? undefined : token;
}

const malformed = (message: string): AuthFailure => ({
  ok: false,
  status: 502,
  code: 'ENTITLEMENTS_MALFORMED',
  message,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The entitlement facts this worker grants scopes from. */
export interface EntitlementGrants {
  agentkitApp: boolean;
  activeKits: readonly string[];
}

/**
 * Scope mapping.
 *
 * Today one active AgentKit entitlement (the app, or any kit) grants both
 * `render` and `share`: the endpoint has no narrower grant to read. The two
 * scopes are still derived by separate rules, so a future render-only or
 * share-only entitlement changes one function here and nothing else, and every
 * route keeps checking the scope it needs.
 */
export function scopesFor(grants: EntitlementGrants): Scope[] {
  const scopes: Scope[] = [];
  if (grantsRender(grants)) scopes.push('render');
  if (grantsShare(grants)) scopes.push('share');
  return scopes;
}

function hasActiveEntitlement(grants: EntitlementGrants): boolean {
  return grants.agentkitApp || grants.activeKits.length > 0;
}

function grantsRender(grants: EntitlementGrants): boolean {
  return hasActiveEntitlement(grants);
}

function grantsShare(grants: EntitlementGrants): boolean {
  return hasActiveEntitlement(grants);
}

/**
 * Parse a 200 entitlements body into a principal, or fail closed.
 *
 * Anything other than `status: "active"` with a subject and an entitlements
 * object is refused: an inactive account is authenticated but not entitled
 * (403), and a body this worker cannot read is an upstream fault (502).
 */
export function principalFromEntitlements(body: unknown): AuthOutcome {
  if (!isRecord(body)) return malformed('the entitlements response is not an object');
  if (typeof body['status'] !== 'string') {
    return malformed('the entitlements response has no status');
  }
  if (body['status'] !== 'active') {
    return {
      ok: false,
      status: 403,
      code: 'ENTITLEMENT_INACTIVE',
      message: 'the bearer has no active AgentKit entitlement',
    };
  }
  const userId = body['userId'];
  const licenseId = body['licenseId'];
  // The user id is the subject. A license-only principal (no user id) keeps a
  // distinct namespace so it can never collide with a user's shares.
  const subject =
    typeof userId === 'string' && userId !== ''
      ? userId
      : typeof licenseId === 'string' && licenseId !== ''
        ? `license:${licenseId}`
        : undefined;
  if (subject === undefined) return malformed('the entitlements response has no subject');

  const entitlements = body['entitlements'];
  if (!isRecord(entitlements)) return malformed('the entitlements response has no entitlements');
  const app = entitlements['agentkitApp'];
  const kits = entitlements['kits'];
  if (app !== undefined && typeof app !== 'boolean') {
    return malformed('entitlements.agentkitApp is not a boolean');
  }
  if (kits !== undefined && !isRecord(kits)) return malformed('entitlements.kits is not an object');
  const activeKits = Object.entries(kits ?? {})
    .filter(([, active]) => active === true)
    .map(([kit]) => kit)
    .sort();
  const scopes = scopesFor({ agentkitApp: app === true, activeKits });
  return { ok: true, principal: { subject, scopes } };
}

/**
 * Validate the request's bearer and return the principal it grants.
 *
 * A recent answer for the same bearer is reused from the in-isolate cache.
 * Otherwise the lookup first counts against the caller's IP, so a client
 * spraying bearers cannot turn this worker into an amplifier against the
 * entitlements endpoint. A non-200 answer, a redirect, a malformed body, a
 * timeout or an unreachable endpoint all fail closed: an unverifiable bearer is
 * not a bearer.
 */
export async function authenticate(
  request: Request,
  env: Env,
  now: number = Date.now(),
): Promise<AuthOutcome> {
  const token = bearerOf(request);
  if (token === undefined) {
    return {
      ok: false,
      status: 401,
      code: 'UNAUTHENTICATED',
      message: 'a bearer token is required',
    };
  }
  // An OAuth access token is verified locally against the issuer's keys: no
  // entitlements round trip, so no cache entry and no per-IP lookup budget.
  const oauth = oauthConfig(env);
  if (oauth !== undefined && isOAuthAccessToken(token)) {
    return verifyOAuthAccessToken(token, oauth, now);
  }
  const digest = await bearerDigest(token);
  const cached = cachedOutcome(digest, now);
  if (cached !== undefined) return cached;
  if (!(await withinRateLimit(env, 'auth-ip', clientIp(request)))) {
    return {
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
      message: 'too many bearer checks from this address',
    };
  }
  const outcome = await lookUpEntitlements(token, env);
  rememberOutcome(digest, outcome, now);
  return outcome;
}

/** One round trip to the canonical entitlements endpoint. */
async function lookUpEntitlements(token: string, env: Env): Promise<AuthOutcome> {
  const base = env.ENTITLEMENTS_URL.replace(/\/+$/u, '');
  let response: Response;
  try {
    response = await fetch(`${base}${ENTITLEMENTS_PATH}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      // A redirect is an answer this worker does not understand, and following
      // one could carry the bearer to a host it was not meant for.
      redirect: 'manual',
      signal: AbortSignal.timeout(ENTITLEMENTS_TIMEOUT_MS),
    });
  } catch {
    return {
      ok: false,
      status: 502,
      code: 'ENTITLEMENTS_UNREACHABLE',
      message: 'the entitlements endpoint could not be reached',
    };
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, status: 401, code: 'UNAUTHENTICATED', message: 'the bearer was rejected' };
  }
  if (response.status !== 200) {
    return {
      ok: false,
      status: 502,
      code: 'ENTITLEMENTS_ERROR',
      message: `the entitlements endpoint answered ${response.status}`,
    };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return malformed('the entitlements endpoint returned a non-JSON body');
  }
  return principalFromEntitlements(body);
}

/**
 * Authorize a scope separately from authenticating.
 *
 * Render permission and public-share permission are different grants: holding
 * one never implies the other.
 */
export function authorize(principal: Principal, scope: Scope): AuthOutcome {
  if (principal.scopes.includes(scope)) return { ok: true, principal };
  return {
    ok: false,
    status: 403,
    code: 'FORBIDDEN',
    message: `the bearer does not grant the ${scope} scope`,
  };
}

/** Authenticated principal holding every listed scope, or the first failure. */
export function authorizeAll(outcome: AuthOutcome, scopes: readonly Scope[]): AuthOutcome {
  if (!outcome.ok) return outcome;
  for (const scope of scopes) {
    const permitted = authorize(outcome.principal, scope);
    if (!permitted.ok) return permitted;
  }
  return outcome;
}
