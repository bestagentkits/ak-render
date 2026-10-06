/**
 * Cloud-renderer budgets and policy defaults.
 *
 * Every budget here sits well below the platform's own limit, because the
 * platform limit is a ceiling for the whole account, not a per-request
 * allowance. A request that exceeds an app budget is rejected before it reaches
 * the compiler, and the rejection says which budget it broke.
 */

/** Request body ceiling: 1 MiB. The platform allows far more per request. */
export const MAX_REQUEST_BYTES = 1024 * 1024;

/** Emitted artifact ceiling: 2 MiB. A page larger than this is not a page. */
export const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

/** Node ceiling, well under the compiler's own bound. */
export const MAX_NODES = 2_000;

/** Conservative share retention default: 30 days. Configurable per deployment. */
export const DEFAULT_SHARE_RETENTION_DAYS = 30;

/** Hard ceiling on configurable retention, so a deployment cannot make shares permanent. */
export const MAX_SHARE_RETENTION_DAYS = 365;

/**
 * Lifetime of an artifact a remote MCP `render` stores for the caller: 1 hour.
 * Long enough to open or download the page, short enough that an unshared
 * render is not a hosting service. A durable link is an explicit share.
 */
export const ARTIFACT_TTL_SECONDS = 60 * 60;

/**
 * Rate limits per minute, one Workers Rate Limiting binding each. The numbers
 * are enforced by the `ratelimits` entries in wrangler.jsonc; this table is the
 * typed mirror the code and docs read, and a unit test keeps the two equal.
 *
 * The first four count per subject, and REST routes and MCP tool calls share
 * them. The last two count per client IP.
 */
export const RATE_LIMITS = {
  render: 60,
  share: 20,
  export: 10,
  /** MCP `validate`: cheaper than a render, so a looser limit. */
  validate: 120,
  /** MCP `catalog`, `describe` and `themes`, which answer without a bearer. */
  'anon-ip': 120,
  /** Bearer checks the principal cache could not answer, i.e. upstream lookups. */
  'auth-ip': 30,
} as const satisfies Record<string, number>;

export type RateLimitKey = keyof typeof RATE_LIMITS;

/** Rate-limit period in seconds; the binding accepts 10 or 60. */
export const RATE_WINDOW_SECONDS = 60;

export function retentionDays(env: { SHARE_RETENTION_DAYS?: string }): number {
  const configured = Number(env.SHARE_RETENTION_DAYS ?? DEFAULT_SHARE_RETENTION_DAYS);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_SHARE_RETENTION_DAYS;
  return Math.min(Math.floor(configured), MAX_SHARE_RETENTION_DAYS);
}

export interface BudgetViolation {
  budget: 'request-bytes' | 'output-bytes' | 'nodes';
  limit: number;
  actual: number;
}

export function checkRequestBytes(bytes: number): BudgetViolation | undefined {
  return bytes > MAX_REQUEST_BYTES
    ? { budget: 'request-bytes', limit: MAX_REQUEST_BYTES, actual: bytes }
    : undefined;
}

export function checkOutputBytes(bytes: number): BudgetViolation | undefined {
  return bytes > MAX_OUTPUT_BYTES
    ? { budget: 'output-bytes', limit: MAX_OUTPUT_BYTES, actual: bytes }
    : undefined;
}

export function checkNodes(nodes: number): BudgetViolation | undefined {
  return nodes > MAX_NODES ? { budget: 'nodes', limit: MAX_NODES, actual: nodes } : undefined;
}
