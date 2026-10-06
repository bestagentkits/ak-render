/**
 * Rate limits through the Workers Rate Limiting binding, shared by REST and MCP.
 *
 * Every route class has its own binding (`ratelimits` in wrangler.jsonc), so a
 * key needs no route prefix: per-subject classes key on the subject, per-IP
 * classes on the client IP. REST routes and MCP tool calls count against the
 * same bindings, so MCP is never a way around a REST limit.
 *
 * The binding counts per Cloudflare location and is eventually consistent by
 * design. That is the trade this worker wants: the limit is a cost guard, not
 * an accounting system, and the budgets in config.ts are the hard limit. Unlike
 * a KV counter it has no per-key write ceiling, so a burst or a batch cannot
 * make the limiter itself fail.
 *
 * Any limiter fault (a missing binding, a thrown call, an unexpected answer)
 * fails closed: the call is refused and the caller sees only `RATE_LIMITED`.
 */

import type { Env, RateLimitBinding } from './bindings.js';
import type { RateLimitKey } from './config.js';

/** The binding that enforces each route class. */
export const RATE_LIMIT_BINDINGS = {
  render: 'RATE_LIMIT_RENDER',
  share: 'RATE_LIMIT_SHARE',
  export: 'RATE_LIMIT_EXPORT',
  validate: 'RATE_LIMIT_VALIDATE',
  'anon-ip': 'RATE_LIMIT_ANON_IP',
  'auth-ip': 'RATE_LIMIT_AUTH_IP',
} as const satisfies Record<RateLimitKey, keyof Env>;

/** Count one call against `key` in a route class; false means refuse it. */
export async function withinRateLimit(
  env: Env,
  route: RateLimitKey,
  key: string,
): Promise<boolean> {
  try {
    const binding: RateLimitBinding | undefined = env[RATE_LIMIT_BINDINGS[route]];
    const outcome = await binding?.limit({ key });
    return outcome?.success === true;
  } catch {
    return false;
  }
}

/** The caller's IP as Cloudflare reports it; one shared bucket when absent. */
export function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'unknown';
}
