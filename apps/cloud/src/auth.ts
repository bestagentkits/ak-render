/**
 * Bearer validation through the canonical AgentKit entitlements endpoint.
 *
 * This worker never copies AgentKit's signing secrets and never talks to its
 * database. It forwards the caller's bearer to the entitlements endpoint the
 * deployment is configured with and trusts only that answer.
 *
 * The token is never stored: it is not written to R2, to KV, to logs, or into a
 * response. It exists for the duration of one request.
 */

import type { Env } from './bindings.js';

export type Scope = 'render' | 'share';

export interface Principal {
  readonly subject: string;
  readonly scopes: readonly Scope[];
}

export type AuthOutcome =
  | { ok: true; principal: Principal }
  | { ok: false; status: 401 | 403 | 502; code: string; message: string };

function bearerOf(request: Request): string | undefined {
  const header = request.headers.get('authorization');
  if (header === null) return undefined;
  const match = /^Bearer\s+(.+)$/iu.exec(header.trim());
  const token = match?.[1]?.trim();
  return token === undefined || token === '' ? undefined : token;
}

/**
 * Validate the request's bearer and return the principal it grants.
 *
 * A non-200 answer, a malformed body, or an unreachable endpoint all fail
 * closed: an unverifiable bearer is not a bearer.
 */
export async function authenticate(request: Request, env: Env): Promise<AuthOutcome> {
  const token = bearerOf(request);
  if (token === undefined) {
    return { ok: false, status: 401, code: 'UNAUTHENTICATED', message: 'a bearer token is required' };
  }
  const base = env.ENTITLEMENTS_URL.replace(/\/$/u, '');
  let response: Response;
  try {
    response = await fetch(`${base}/v1/entitlements/verify`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({}),
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
  if (!response.ok) {
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
    return {
      ok: false,
      status: 502,
      code: 'ENTITLEMENTS_MALFORMED',
      message: 'the entitlements endpoint returned a non-JSON body',
    };
  }
  const record = body as { subject?: unknown; entitlements?: unknown } | null;
  const subject = record?.subject;
  const entitlements = record?.entitlements;
  if (typeof subject !== 'string' || subject === '' || !Array.isArray(entitlements)) {
    return {
      ok: false,
      status: 502,
      code: 'ENTITLEMENTS_MALFORMED',
      message: 'the entitlements response is missing subject or entitlements',
    };
  }
  const scopes = entitlements.filter(
    (entry): entry is Scope => entry === 'render' || entry === 'share',
  );
  return { ok: true, principal: { subject, scopes } };
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
