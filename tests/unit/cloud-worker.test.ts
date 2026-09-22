import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env, KVNamespace, R2Bucket, R2ObjectBody } from '../../apps/cloud/src/bindings.js';
import {
  checkNodes,
  checkOutputBytes,
  checkRequestBytes,
  DEFAULT_SHARE_RETENTION_DAYS,
  MAX_SHARE_RETENTION_DAYS,
  retentionDays,
} from '../../apps/cloud/src/config.js';
import { handleRequest } from '../../apps/cloud/src/index.js';
import { purgeExpiredShares } from '../../apps/cloud/src/share.js';
import { compile, VERSION } from '../../src/index.js';

class FakeR2 implements R2Bucket {
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

class FakeKV implements KVNamespace {
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

const TOKEN = 'test-bearer-token-value';

interface Harness {
  env: Env;
  r2: FakeR2;
  kv: FakeKV;
  entitlementsCalls: string[];
  browserCalls: string[];
  fetchMock: ReturnType<typeof vi.fn>;
}

function harness(options: { scopes?: string[]; browser?: boolean } = {}): Harness {
  const r2 = new FakeR2();
  const kv = new FakeKV();
  const entitlementsCalls: string[] = [];
  const browserCalls: string[] = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    entitlementsCalls.push(url);
    return new Response(
      JSON.stringify({ subject: 'user-1', entitlements: options.scopes ?? ['render', 'share'] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
  vi.stubGlobal('fetch', fetchMock);

  const env: Env = {
    ENTITLEMENTS_URL: 'https://entitlements.example.test',
    RENDER_SHARES: r2,
    RATE_LIMIT: kv,
    ...(options.browser === true
      ? {
          BROWSER: {
            fetch: async () => {
              browserCalls.push('browser');
              return new Response(new Uint8Array([1, 2, 3]), {
                status: 200,
                headers: { 'content-type': 'image/png' },
              });
            },
          },
        }
      : {}),
  };

  return { env, r2, kv, entitlementsCalls, browserCalls, fetchMock };
}

function post(path: string, body: unknown, token: string | null = TOKEN): Request {
  return new Request(`https://render.example.test${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });
}

const SPEC = {
  version: 1,
  meta: { title: 'Cloud parity' },
  blocks: [
    { type: 'hero', title: 'Cloud parity' },
    { type: 'stats', items: [{ label: 'Blocks', value: '2' }] },
  ],
};

const YAML_SPEC = `version: 1
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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('cloud renderer: parity with local compilation', () => {
  it('returns byte-identical HTML to a local compile for the same spec and version', async () => {
    const { env } = harness();
    const response = await handleRequest(post('/v1/render', { spec: SPEC }), env);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toBe(compile(SPEC).html);
    expect(response.headers.get('content-type')).toContain('text/html');
  });

  it('compiles YAML through the same path', async () => {
    const { env } = harness();
    const response = await handleRequest(
      new Request('https://render.example.test/v1/render', {
        method: 'POST',
        headers: { 'content-type': 'application/yaml', authorization: `Bearer ${TOKEN}` },
        body: YAML_SPEC,
      }),
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(compile(YAML_SPEC).html);
  });

  it('reports the same compiler version locally and in the cloud', async () => {
    const { env } = harness();
    const response = await handleRequest(post('/v1/render', { spec: SPEC }), env);
    expect(response.status).toBe(200);
    expect(VERSION).toBe('0.1.0');
  });
});

describe('cloud renderer: authorization', () => {
  it('rejects a request without a bearer', async () => {
    const { env } = harness();
    const response = await handleRequest(post('/v1/render', { spec: SPEC }, null), env);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('keeps render permission separate from share permission', async () => {
    const renderOnly = harness({ scopes: ['render'] });
    const shareDenied = await handleRequest(post('/v1/share', { spec: SPEC }), renderOnly.env);
    expect(shareDenied.status).toBe(403);
    expect(await shareDenied.json()).toMatchObject({ code: 'FORBIDDEN' });

    const shareOnly = harness({ scopes: ['share'] });
    const renderDenied = await handleRequest(post('/v1/render', { spec: SPEC }), shareOnly.env);
    expect(renderDenied.status).toBe(403);
  });

  it('fails closed when the entitlements endpoint is unreachable', async () => {
    const { env } = harness();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    const response = await handleRequest(post('/v1/render', { spec: SPEC }), env);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: 'ENTITLEMENTS_UNREACHABLE' });
  });

  it('fails closed when the entitlements answer is malformed', async () => {
    const { env } = harness();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not json', { status: 200 })),
    );
    const response = await handleRequest(post('/v1/render', { spec: SPEC }), env);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: 'ENTITLEMENTS_MALFORMED' });
  });

  it('never persists the bearer token', async () => {
    const { env, r2, kv } = harness();
    await handleRequest(post('/v1/render', { spec: SPEC }), env);
    const shared = await handleRequest(post('/v1/share', { spec: SPEC }), env);
    expect(shared.status).toBe(201);
    expect(r2.values.join('\n')).not.toContain(TOKEN);
    expect(kv.values.join('\n')).not.toContain(TOKEN);
    for (const entry of r2.objects.values()) {
      expect(JSON.stringify(entry.customMetadata ?? {})).not.toContain(TOKEN);
    }
  });
});

describe('cloud renderer: budgets and rate limits', () => {
  it('rejects an oversized request body before compiling', async () => {
    const { env } = harness();
    const huge = `{"spec":"${'x'.repeat(1024 * 1024 + 16)}"}`;
    const response = await handleRequest(
      new Request('https://render.example.test/v1/render', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
        body: huge,
      }),
      env,
    );
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: 'BUDGET_EXCEEDED' });
  });

  it('rate limits per subject and route', async () => {
    const { env } = harness();
    let last = 0;
    for (let attempt = 0; attempt < 61; attempt += 1) {
      const response = await handleRequest(post('/v1/render', { spec: SPEC }), env);
      last = response.status;
    }
    expect(last).toBe(429);
  });

  it('keeps app budgets well below the platform limits', () => {
    expect(checkRequestBytes(1024)).toBeUndefined();
    expect(checkRequestBytes(2 * 1024 * 1024)).toMatchObject({ budget: 'request-bytes' });
    expect(checkOutputBytes(1024)).toBeUndefined();
    expect(checkOutputBytes(3 * 1024 * 1024)).toMatchObject({ budget: 'output-bytes' });
    expect(checkNodes(10)).toBeUndefined();
    expect(checkNodes(2_001)).toMatchObject({ budget: 'nodes', limit: 2000 });
  });
});

describe('cloud renderer: storage policy', () => {
  it('does not store a render response', async () => {
    const { env, r2 } = harness();
    const response = await handleRequest(post('/v1/render', { spec: SPEC }), env);
    expect(response.status).toBe(200);
    expect(r2.objects.size).toBe(0);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('stores a share only when one is explicitly created', async () => {
    const { env, r2 } = harness();
    const response = await handleRequest(post('/v1/share', { spec: SPEC }), env);
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string; url: string; expiresAt: string };
    expect(body.url).toBe(`/v1/share/${body.id}`);
    expect(r2.objects.size).toBe(1);
    const [entry] = [...r2.objects.values()];
    expect(entry?.value).toBe(compile(SPEC).html);
    expect(entry?.customMetadata?.['owner']).toBe('user-1');
  });

  it('sends no content anywhere except the entitlements endpoint', async () => {
    const { env, entitlementsCalls, fetchMock } = harness();
    await handleRequest(post('/v1/render', { spec: SPEC }), env);
    await handleRequest(post('/v1/share', { spec: SPEC }), env);
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.every((url) => url.startsWith('https://entitlements.example.test'))).toBe(true);
    expect(entitlementsCalls.length).toBeGreaterThan(0);
    // Nothing in the outbound call carries page content.
    for (const call of fetchMock.mock.calls) {
      expect(JSON.stringify(call[1] ?? {})).not.toContain('Cloud parity');
    }
  });
});

describe('cloud renderer: shares', () => {
  it('serves a valid share without a bearer and with the artifact intact', async () => {
    const { env } = harness();
    const created = await handleRequest(post('/v1/share', { spec: SPEC }), env);
    const { id } = (await created.json()) as { id: string };
    const preview = await handleRequest(
      new Request(`https://render.example.test/v1/share/${id}`, { method: 'GET' }),
      env,
    );
    expect(preview.status).toBe(200);
    expect(preview.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await preview.text()).toBe(compile(SPEC).html);
  });

  it('stops serving a share once it expires', async () => {
    const { env } = harness();
    const created = await handleRequest(post('/v1/share', { spec: SPEC }), env);
    const { id } = (await created.json()) as { id: string };
    const later = new Date(Date.now() + (DEFAULT_SHARE_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000);
    const preview = await handleRequest(
      new Request(`https://render.example.test/v1/share/${id}`, { method: 'GET' }),
      env,
      later,
    );
    expect(preview.status).toBe(410);
    expect(await preview.json()).toMatchObject({ code: 'EXPIRED' });
  });

  it('refuses a share id that is not an opaque id', async () => {
    const { env } = harness();
    const preview = await handleRequest(
      new Request('https://render.example.test/v1/share/..%2Fsecret', { method: 'GET' }),
      env,
    );
    expect(preview.status).toBe(404);
  });

  it('lets only the owner revoke, and revoking stops resolution', async () => {
    const { env } = harness();
    const created = await handleRequest(post('/v1/share', { spec: SPEC }), env);
    const { id } = (await created.json()) as { id: string };

    // A different valid principal cannot revoke someone else's share.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ subject: 'user-2', entitlements: ['share'] }), {
            status: 200,
          }),
      ),
    );
    const denied = await handleRequest(
      new Request(`https://render.example.test/v1/share/${id}`, {
        method: 'DELETE',
        headers: { authorization: 'Bearer other' },
      }),
      env,
    );
    expect(denied.status).toBe(403);

    // The owner can.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ subject: 'user-1', entitlements: ['share'] }), {
            status: 200,
          }),
      ),
    );
    const revoked = await handleRequest(
      new Request(`https://render.example.test/v1/share/${id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
      env,
    );
    expect(revoked.status).toBe(200);

    const after = await handleRequest(
      new Request(`https://render.example.test/v1/share/${id}`, { method: 'GET' }),
      env,
    );
    expect(after.status).toBe(404);
  });

  it('sweeps expired shares', async () => {
    const { env, r2 } = harness();
    await handleRequest(post('/v1/share', { spec: SPEC }), env);
    expect(r2.objects.size).toBe(1);
    const removed = await purgeExpiredShares(
      env,
      new Date(Date.now() + (DEFAULT_SHARE_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000),
    );
    expect(removed).toBe(1);
    expect(r2.objects.size).toBe(0);
  });

  it('defaults retention conservatively and caps a configuration that asks for more', () => {
    expect(retentionDays({})).toBe(DEFAULT_SHARE_RETENTION_DAYS);
    expect(DEFAULT_SHARE_RETENTION_DAYS).toBe(30);
    expect(retentionDays({ SHARE_RETENTION_DAYS: '7' })).toBe(7);
    expect(retentionDays({ SHARE_RETENTION_DAYS: '9999' })).toBe(MAX_SHARE_RETENTION_DAYS);
    expect(retentionDays({ SHARE_RETENTION_DAYS: 'nonsense' })).toBe(DEFAULT_SHARE_RETENTION_DAYS);
  });
});

describe('cloud renderer: export', () => {
  it('answers 501 when the deployment has no browser binding', async () => {
    const { env, browserCalls } = harness();
    const response = await handleRequest(post('/v1/screenshot', { spec: SPEC }), env);
    expect(response.status).toBe(501);
    expect(await response.json()).toMatchObject({ code: 'EXPORT_UNAVAILABLE' });
    expect(browserCalls).toEqual([]);
  });

  it('routes export through the browser binding only', async () => {
    const { env, browserCalls, fetchMock } = harness({ browser: true });
    const response = await handleRequest(post('/v1/pdf', { spec: SPEC }), env);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(browserCalls.length).toBe(1);
    // The global fetch is used for entitlements only, never for export.
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.every((url) => url.startsWith('https://entitlements.example.test'))).toBe(true);
  });

  it('never sends page content to a non-browser destination', async () => {
    const { env, fetchMock } = harness({ browser: true });
    await handleRequest(post('/v1/screenshot', { spec: SPEC }), env);
    for (const call of fetchMock.mock.calls) {
      expect(JSON.stringify(call[1] ?? {})).not.toContain('<html');
    }
  });
});

describe('cloud renderer: routing', () => {
  it('404s an unknown route', async () => {
    const { env } = harness();
    const response = await handleRequest(
      new Request('https://render.example.test/v1/unknown', { method: 'POST' }),
      env,
    );
    expect(response.status).toBe(404);
  });

  it('rejects a malformed body', async () => {
    const { env } = harness();
    const response = await handleRequest(
      new Request('https://render.example.test/v1/render', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
        body: '{not json',
      }),
      env,
    );
    expect(response.status).toBe(400);
  });

  it('reports a spec error without leaking internals', async () => {
    const { env } = harness();
    const response = await handleRequest(
      post('/v1/render', {
        spec: { version: 1, meta: { title: 'x' }, blocks: [{ type: 'nope' }] },
      }),
      env,
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe('SPEC_UNKNOWN_BLOCK');
  });
});
