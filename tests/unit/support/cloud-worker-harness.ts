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
  KVNamespace,
  R2Bucket,
  R2ObjectBody,
} from '../../../apps/cloud/src/bindings.js';

export class FakeR2 implements R2Bucket {
  readonly objects = new Map<string, { value: string; customMetadata?: Record<string, string> }>();

  async get(key: string): Promise<R2ObjectBody | null> {
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
    this.objects.set(key, {
      value,
      ...(options?.customMetadata === undefined ? {} : { customMetadata: options.customMetadata }),
    });
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async list(options?: { prefix?: string }): Promise<{ objects: { key: string }[] }> {
    const prefix = options?.prefix ?? '';
    return {
      objects: [...this.objects.keys()]
        .filter((key) => key.startsWith(prefix))
        .map((key) => ({ key })),
    };
  }

  get values(): string[] {
    return [...this.objects.values()].map((entry) => entry.value);
  }
}

export class FakeKV implements KVNamespace {
  readonly entries = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.entries.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.entries.set(key, value);
  }

  get values(): string[] {
    return [...this.entries.values()];
  }
}

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
  kv: FakeKV;
  browserCalls: { action: string; options: Record<string, unknown> }[];
  fetchMock: ReturnType<typeof vi.fn>;
}

export function harness(
  options: { entitlements?: unknown; status?: number; browser?: boolean } = {},
): Harness {
  const r2 = new FakeR2();
  const kv = new FakeKV();
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
    RATE_LIMIT: kv,
    ...(options.browser === true ? { BROWSER: browser } : {}),
  };
  return { env, r2, kv, browserCalls, fetchMock };
}

export function post(path: string, body: unknown, token: string | null = TOKEN): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
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
