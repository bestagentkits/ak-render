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

export interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: string,
    options?: { customMetadata?: Record<string, string>; httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  delete(key: string): Promise<void>;
  /** Used only by the expiry sweep. */
  list(options?: { prefix?: string; limit?: number }): Promise<{ objects: { key: string }[] }>;
}

export interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface Env {
  /** Canonical AgentKit entitlements endpoint. The worker validates against it. */
  ENTITLEMENTS_URL: string;
  /** Private bucket holding shared artifacts. Never public. */
  RENDER_SHARES: R2Bucket;
  /** Rate-limit counters, keyed by subject and route. */
  RATE_LIMIT: KVNamespace;
  /** Browser Run binding. Present only where screenshot/PDF is deployed. */
  BROWSER?: Fetcher;
  /** Share retention in days. Defaults to the conservative value in config.ts. */
  SHARE_RETENTION_DAYS?: string;
}
