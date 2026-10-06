/**
 * In-memory bindings and request helpers for the cloud worker tests.
 *
 * The fakes implement the structural binding interfaces the worker declares,
 * and the global `fetch` stub plays the AgentKit entitlements endpoint, so the
 * tests exercise the worker's real routing, auth, budgets and storage code.
 */

import { vi } from 'vitest';
import type {
  BrowserRun,
  Env,
  R2Bucket,
  R2Listing,
  R2ObjectBody,
  RateLimitBinding,
} from '../../../apps/cloud/src/bindings.js';
import { RATE_LIMITS, type RateLimitKey } from '../../../apps/cloud/src/config.js';
import { clearPrincipalCache } from '../../../apps/cloud/src/principal-cache.js';
import { RATE_LIMIT_BINDINGS } from '../../../apps/cloud/src/rate-limit.js';

/**
 * In-memory R2. `list` pages like the platform (lexicographic keys, `limit`,
 * an opaque cursor, `truncated`) and returns custom metadata only when asked,
 * and every call is recorded so a test can assert how a caller used it.
 */
export class FakeR2 implements R2Bucket {
  readonly objects = new Map<string, { value: string; customMetadata?: Record<string, string> }>();
  readonly calls: { method: 'get' | 'put' | 'delete' | 'list'; detail: unknown }[] = [];

  async get(key: string): Promise<R2ObjectBody | null> {
    this.calls.push({ method: 'get', detail: key });
    const entry = this.objects.get(key);
    if (entry === undefined) return null;
    return {
      key,
      size: entry.value.length,
      text: async () => entry.value,
      ...(entry.customMetadata === undefined ? {} : { customMetadata: entry.customMetadata }),
    };
  }

  async put(
    key: string,
    value: string,
    options?: { customMetadata?: Record<string, string> },
  ): Promise<void> {
    this.calls.push({ method: 'put', detail: key });
    this.objects.set(key, {
      value,
      ...(options?.customMetadata === undefined ? {} : { customMetadata: options.customMetadata }),
    });
  }

  async delete(keys: string | string[]): Promise<void> {
    const batch = typeof keys === 'string' ? [keys] : keys;
    if (batch.length > 1000) throw new Error('R2 deletes at most 1000 keys per call');
    this.calls.push({ method: 'delete', detail: batch });
    for (const key of batch) this.objects.delete(key);
  }

  async list(
    options: { prefix?: string; limit?: number; cursor?: string; include?: string[] } = {},
  ): Promise<R2Listing> {
    this.calls.push({ method: 'list', detail: options });
    const prefix = options.prefix ?? '';
    const limit = Math.min(options.limit ?? 1000, 1000);
    const keys = [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
    const { cursor } = options;
    const start = cursor === undefined ? 0 : keys.findIndex((key) => key > cursor);
    const page = start < 0 ? [] : keys.slice(start, start + limit);
    const withMetadata = options.include?.includes('customMetadata') === true;
    const truncated = start >= 0 && start + limit < keys.length;
    return {
      objects: page.map((key) => {
        const customMetadata = this.objects.get(key)?.customMetadata;
        return withMetadata && customMetadata !== undefined ? { key, customMetadata } : { key };
      }),
      truncated,
      ...(truncated ? { cursor: page[page.length - 1] as string } : {}),
    };
  }

  get values(): string[] {
    return [...this.objects.values()].map((entry) => entry.value);
  }
}

/**
 * In-memory Workers Rate Limiting binding: counts per key with no window, and
 * can be told to throw so a test can prove the worker fails closed.
 */
export class FakeRateLimit implements RateLimitBinding {
  readonly counts = new Map<string, number>();
  fault: Error | undefined;

  constructor(public allowance: number) {}

  async limit({ key }: { key: string }): Promise<{ success: boolean }> {
    if (this.fault !== undefined) throw this.fault;
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return { success: count <= this.allowance };
  }
}

export type FakeRateLimits = Record<RateLimitKey, FakeRateLimit>;

export const TOKEN = 'test-bearer-token-value';
export const ENTITLEMENTS_ORIGIN = 'https://entitlements.example.test';
export const ORIGIN = 'https://render.example.test';

/** A live-shaped active entitlements body for `userId`. */
export function activeEntitlements(userId = 'user-1'): Record<string, unknown> {
  return {
    schemaVersion: 1,
    status: 'active',
    userId,
    authMethod: 'license_key',
    licenseId: 'lic-1',
    activationId: 'act-1',
    entitlements: { agentkitApp: false, kits: { engineer: true, marketing: false } },
  };
}

/** Stub the entitlements endpoint with one fixed answer. */
export function stubEntitlements(
  body: unknown = activeEntitlements(),
  status = 200,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export interface Harness {
  env: Env;
  r2: FakeR2;
  limits: FakeRateLimits;
  browserCalls: { action: string; options: Record<string, unknown> }[];
  fetchMock: ReturnType<typeof vi.fn>;
}

/**
 * A fresh worker environment. Each call also clears the in-isolate principal
 * cache, so a test never sees an answer cached by an earlier one. `limits`
 * overrides a class's allowance (the default is the production number), which
 * lets a test reach a limit without compiling sixty pages.
 */
export function harness(
  options: {
    entitlements?: unknown;
    status?: number;
    browser?: boolean;
    limits?: Partial<Record<RateLimitKey, number>>;
  } = {},
): Harness {
  clearPrincipalCache();
  const r2 = new FakeR2();
  const limits = Object.fromEntries(
    (Object.keys(RATE_LIMITS) as RateLimitKey[]).map((key) => [
      key,
      new FakeRateLimit(options.limits?.[key] ?? RATE_LIMITS[key]),
    ]),
  ) as FakeRateLimits;
  const browserCalls: Harness['browserCalls'] = [];
  const fetchMock = stubEntitlements(options.entitlements, options.status);
  const browser: BrowserRun = {
    quickAction: async (action, actionOptions) => {
      browserCalls.push({ action, options: actionOptions });
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    },
  };
  const env: Env = {
    ENTITLEMENTS_URL: ENTITLEMENTS_ORIGIN,
    RENDER_SHARES: r2,
    RATE_LIMIT_RENDER: limits.render,
    RATE_LIMIT_SHARE: limits.share,
    RATE_LIMIT_EXPORT: limits.export,
    RATE_LIMIT_VALIDATE: limits.validate,
    RATE_LIMIT_ANON_IP: limits['anon-ip'],
    RATE_LIMIT_AUTH_IP: limits['auth-ip'],
    ...(options.browser === true ? { BROWSER: browser } : {}),
  };
  // Every class must be wired to the binding the worker reads for it.
  for (const [key, binding] of Object.entries(RATE_LIMIT_BINDINGS)) {
    if (env[binding] !== limits[key as RateLimitKey]) throw new Error(`unwired limit ${key}`);
  }
  return { env, r2, limits, browserCalls, fetchMock };
}

/** Every key any fake limiter counted, for assertions that no bearer is used as a key. */
export function limiterKeys(limits: FakeRateLimits): string[] {
  return Object.values(limits).flatMap((limit) => [...limit.counts.keys()]);
}

export function post(
  path: string,
  body: unknown,
  token: string | null = TOKEN,
  headers: Record<string, string> = {},
): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

export const SPEC = {
  version: 1,
  meta: { title: 'Cloud parity' },
  blocks: [
    { type: 'hero', title: 'Cloud parity' },
    { type: 'stats', items: [{ label: 'Blocks', value: '2' }] },
  ],
};

export const YAML_SPEC = `version: 1
meta:
  title: Cloud parity
blocks:
  - type: hero
    title: Cloud parity
  - type: stats
    items:
      - label: Blocks
        value: "2"
`;
