/**
 * Fixed-window rate limit per subject and route, shared by REST and MCP.
 *
 * Every authenticated route and every authenticated MCP tool call counts
 * against the same keys, so the MCP endpoint is never a way around the REST
 * limits.
 *
 * KV is eventually consistent, so two simultaneous requests can both read the
 * same count. That is a deliberate trade: the limit is a cost guard, not a
 * security boundary, and the budgets are the hard limit.
 */

import type { Env } from './bindings.js';
import { RATE_LIMITS, RATE_WINDOW_SECONDS, type RateLimitKey } from './config.js';

export async function withinRateLimit(
  env: Env,
  subject: string,
  route: RateLimitKey,
  now: Date,
): Promise<boolean> {
  const limit = RATE_LIMITS[route];
  const window = Math.floor(now.getTime() / 1000 / RATE_WINDOW_SECONDS);
  const key = `rl:${route}:${subject}:${window}`;
  const current = Number((await env.RATE_LIMIT.get(key)) ?? '0');
  if (current >= limit) return false;
  await env.RATE_LIMIT.put(key, String(current + 1), { expirationTtl: RATE_WINDOW_SECONDS * 2 });
  return true;
}
