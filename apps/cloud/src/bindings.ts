/**
 * Structural bindings the worker uses.
 *
 * These mirror the Cloudflare platform API surface this worker actually calls,
 * declared locally so the worker builds and type-checks without a platform
 * types package. They are a subset on purpose: a binding this worker does not
 * use should not be reachable from its code.
 */

export interface R2ObjectBody {
  readonly key: string;
  readonly size: number;
  text(): Promise<string>;
  readonly httpMetadata?: { contentType?: string };
  readonly customMetadata?: Record<string, string>;
}

/** One page of an R2 listing. `cursor` is present only when `truncated`. */
export interface R2Listing {
  objects: { key: string; customMetadata?: Record<string, string> }[];
  truncated: boolean;
  cursor?: string;
}

export interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: string,
    options?: { customMetadata?: Record<string, string>; httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  /** One key, or up to 1,000 keys in one call. */
  delete(keys: string | string[]): Promise<void>;
  /** Used only by the expiry sweep. */
  list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
    include?: ('customMetadata' | 'httpMetadata')[];
  }): Promise<R2Listing>;
}

/**
 * Workers Rate Limiting binding (`ratelimits` in wrangler.jsonc). `limit`
 * counts one call against `key` and answers whether it is still within the
 * binding's limit for the current period.
 */
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/**
 * Browser Run binding, reduced to Quick Actions. `quickAction` renders the
 * given HTML in a managed headless browser and answers with the file itself
 * (compatibility date 2026-03-24 or later).
 */
export interface BrowserRun {
  quickAction(action: 'screenshot' | 'pdf', options: Record<string, unknown>): Promise<Response>;
}

export interface Env {
  /**
   * Origin of the canonical AgentKit entitlements endpoint, e.g.
   * `https://agentkit.best`. The worker appends `/api/agentkit/entitlements`.
   */
  ENTITLEMENTS_URL: string;
  /**
   * Canonical URL of the MCP resource OAuth tokens are issued for, e.g.
   * `https://render.agentkit.best/mcp`. Setting it enables OAuth: access tokens
   * for this audience are verified locally, protected-resource metadata is
   * served, and `/mcp` answers a request without a bearer with HTTP 401.
   */
  OAUTH_RESOURCE?: string;
  /** OAuth issuer origin. Defaults to the ENTITLEMENTS_URL origin. */
  OAUTH_ISSUER?: string;
  /** Private bucket holding shared artifacts. Never public. */
  RENDER_SHARES: R2Bucket;
  /** Per-subject limits, one binding per route class (see config.ts). */
  RATE_LIMIT_RENDER: RateLimitBinding;
  RATE_LIMIT_SHARE: RateLimitBinding;
  RATE_LIMIT_EXPORT: RateLimitBinding;
  RATE_LIMIT_VALIDATE: RateLimitBinding;
  /** Per-IP limit on the remote MCP tools that answer without a bearer. */
  RATE_LIMIT_ANON_IP: RateLimitBinding;
  /** Per-IP limit on bearer checks the principal cache could not answer. */
  RATE_LIMIT_AUTH_IP: RateLimitBinding;
  /** Browser Run binding. Present only where screenshot/PDF is deployed. */
  BROWSER?: BrowserRun;
  /** Share retention in days. Defaults to the conservative value in config.ts. */
  SHARE_RETENTION_DAYS?: string;
}
