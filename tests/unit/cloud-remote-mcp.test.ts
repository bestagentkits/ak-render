import { afterEach, describe, expect, it, vi } from 'vitest';
import { ARTIFACT_TTL_SECONDS } from '../../apps/cloud/src/config.js';
import { handleRequest } from '../../apps/cloud/src/index.js';
import {
  REMOTE_INSTRUCTIONS,
  REMOTE_TOOLS,
  remoteVersion,
} from '../../apps/cloud/src/remote-mcp-endpoint.js';
import { compile } from '../../src/index.js';
import { LOCAL_INSTRUCTIONS, LOCAL_TOOLS } from '../../src/mcp/mcp-local-tools.js';
import { handleMcpMessage } from '../../src/mcp-server.js';
import { PACKAGE_NAME, VERSION } from '../../src/version.js';
import {
  activeEntitlements,
  harness,
  limiterKeys,
  ORIGIN,
  post,
  SPEC,
  TOKEN,
  YAML_SPEC,
} from './support/cloud-worker-harness.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

interface ToolReply {
  isError?: boolean;
  content: { type: string; text: string }[];
}

let nextId = 1;

function mcpRequest(
  method: string,
  params: unknown,
  token: string | null,
  headers: Record<string, string> = {},
): Request {
  return new Request(`${ORIGIN}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-11-25',
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  });
}

/** A 2025-03-26 batch (the last revision with batching) of tool calls. */
function batchRequest(
  calls: { name: string; arguments?: Record<string, unknown> }[],
  token: string | null = TOKEN,
): Request {
  return new Request(`${ORIGIN}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'mcp-protocol-version': '2025-03-26',
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(
      calls.map((params, index) => ({
        jsonrpc: '2.0',
        id: index + 1,
        method: 'tools/call',
        params,
      })),
    ),
  });
}

async function tool(
  env: Parameters<typeof handleRequest>[1],
  name: string,
  args: Record<string, unknown> = {},
  token: string | null = TOKEN,
  now?: Date,
): Promise<{ status: number; reply: ToolReply; payload: Record<string, unknown> }> {
  const response = await handleRequest(
    mcpRequest('tools/call', { name, arguments: args }, token),
    env,
    now,
  );
  const body = (await response.json()) as { result: ToolReply };
  const raw = body.result.content[0]?.text ?? '';
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    payload = { text: raw };
  }
  return { status: response.status, reply: body.result, payload };
}

describe('remote MCP: discovery', () => {
  it('initializes and lists the same tool names as the stdio server', async () => {
    const { env, fetchMock } = harness();
    const init = await handleRequest(
      mcpRequest('initialize', { protocolVersion: '2025-06-18' }, null),
      env,
    );
    expect(init.status).toBe(200);
    expect(
      ((await init.json()) as { result: { protocolVersion: string } }).result.protocolVersion,
    ).toBe('2025-06-18');

    const listed = await handleRequest(mcpRequest('tools/list', {}, null), env);
    const remote = ((await listed.json()) as { result: { tools: { name: string }[] } }).result
      .tools;
    const stdio = handleMcpMessage(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { cwd: '/', home: '/' },
    );
    const local = (stdio?.result as { tools: { name: string }[] } | undefined)?.tools ?? [];
    expect(local.length).toBe(14);
    expect(remote.map((entry) => entry.name)).toEqual(local.map((entry) => entry.name));
    // The remote audit schema advertises the Worker's body cap, not the local one.
    const audit = (
      remote as { name: string; inputSchema: { properties: { html: { maxLength: number } } } }[]
    ).find((entry) => entry.name === 'audit-motion');
    expect(audit?.inputSchema.properties.html.maxLength).toBe(1024 * 1024);
    // Discovery never reaches the entitlements endpoint.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('names every tool it lists in its instructions, like the stdio server', () => {
    // Instructions are what an agent reads first; a tool missing from them is
    // a tool the agent does not reach for. Both transports keep every name.
    for (const [instructions, tools] of [
      [REMOTE_INSTRUCTIONS, REMOTE_TOOLS],
      [LOCAL_INSTRUCTIONS, LOCAL_TOOLS],
    ] as const) {
      for (const { name } of tools) {
        expect(instructions, name).toMatch(new RegExp(`(^|[^\\w-])${name}([^\\w-]|$)`, 'u'));
      }
    }
  });

  it('reports the deployed build, revisions and tool names at /v1/version', async () => {
    const { env, fetchMock } = harness();
    const response = await handleRequest(new Request(`${ORIGIN}/v1/version`), {
      ...env,
      BUILD_SHA: 'abc123',
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=60');
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({
      name: PACKAGE_NAME,
      version: VERSION,
      build: 'abc123',
      protocolVersions: ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'],
      tools: LOCAL_TOOLS.map((tool) => tool.name),
    });
    const unbuilt = await handleRequest(new Request(`${ORIGIN}/v1/version`), env);
    expect(((await unbuilt.json()) as { build: unknown }).build).toBeNull();
    const posted = await handleRequest(
      new Request(`${ORIGIN}/v1/version`, { method: 'POST' }),
      env,
    );
    expect(posted.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('serves a stateless 2026-07-28 client the same tools without a bearer', async () => {
    const { env, fetchMock } = harness();
    const meta = {
      'io.modelcontextprotocol/protocolVersion': '2026-07-28',
      'io.modelcontextprotocol/clientCapabilities': {},
    };
    const request = (method: string, params: Record<string, unknown>, name?: string) =>
      new Request(`${ORIGIN}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'mcp-protocol-version': '2026-07-28',
          'mcp-method': method,
          ...(name === undefined ? {} : { 'mcp-name': name }),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: meta } }),
      });
    const discover = await handleRequest(request('server/discover', {}), env);
    expect(discover.status).toBe(200);
    const discovered = ((await discover.json()) as { result: Record<string, unknown> }).result;
    expect(discovered.instructions).toBe(REMOTE_INSTRUCTIONS);
    expect(discovered.supportedVersions).toEqual(remoteVersion(env).protocolVersions);
    const listed = await handleRequest(request('tools/list', {}), env);
    const tools = ((await listed.json()) as { result: { tools: { name: string }[] } }).result.tools;
    expect(tools.map((tool) => tool.name)).toEqual(remoteVersion(env).tools);
    const called = await handleRequest(
      request('tools/call', { name: 'recipes', arguments: {} }, 'recipes'),
      env,
    );
    const result = ((await called.json()) as { result: { resultType: string; isError?: boolean } })
      .result;
    expect(result.resultType).toBe('complete');
    expect(result.isError).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('serves catalog, search-catalog, describe, recipes, recipe and themes without a bearer', async () => {
    const { env, fetchMock } = harness();
    expect((await tool(env, 'catalog', {}, null)).payload['blockCount']).toBeGreaterThan(40);
    const search = await tool(env, 'search-catalog', { query: 'architecture diagram' }, null);
    expect(search.reply.isError).toBeUndefined();
    expect((search.payload as unknown as { type: string }[])[0]?.type).toBe('diagram-panel');
    expect((await tool(env, 'describe', { type: 'hero' }, null)).payload['type']).toBe('hero');
    const listed = await tool(env, 'recipes', {}, null);
    expect(listed.reply.isError).toBeUndefined();
    expect((listed.payload as unknown as { name: string }[]).map((entry) => entry.name)).toContain(
      'dashboard',
    );
    const starter = await tool(env, 'recipe', { name: 'dashboard' }, null);
    expect(starter.reply.isError).toBeUndefined();
    expect(starter.reply.content[0]?.text).toMatch(/^version: 1\n/u);
    const unknown = await tool(env, 'recipe', { name: 'nope' }, null);
    expect(unknown.reply.isError).toBe(true);
    expect(unknown.payload['code']).toBe('SPEC_VALIDATION_ERROR');
    const themes = (await tool(env, 'themes', {}, null)).payload as {
      presets: { name: string; origin: string }[];
    };
    expect(themes.presets.map((preset) => preset.name)).toContain('editorial');
    expect(themes.presets.every((preset) => preset.origin === 'built-in')).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('limits anonymous discovery calls per client IP', async () => {
    const { env, limits } = harness({ limits: { 'anon-ip': 2 } });
    const from = (ip: string) => ({ 'cf-connecting-ip': ip });
    const call = async (ip: string) => {
      const response = await handleRequest(
        mcpRequest('tools/call', { name: 'themes', arguments: {} }, null, from(ip)),
        env,
      );
      return ((await response.json()) as { result: ToolReply }).result;
    };
    expect((await call('203.0.113.7')).isError).toBeUndefined();
    expect((await call('203.0.113.7')).isError).toBeUndefined();
    const limited = await call('203.0.113.7');
    expect(limited.isError).toBe(true);
    expect(JSON.parse(limited.content[0]?.text ?? '{}')).toMatchObject({ code: 'RATE_LIMITED' });
    // A different address keeps its own allowance.
    expect((await call('198.51.100.1')).isError).toBeUndefined();
    expect([...limits['anon-ip'].counts.keys()].sort()).toEqual(['198.51.100.1', '203.0.113.7']);
  });

  it('counts every discovery call in a batch, so a batch cannot multiply the allowance', async () => {
    const { env } = harness({ limits: { 'anon-ip': 3 } });
    const response = await handleRequest(
      batchRequest(
        Array.from({ length: 5 }, () => ({ name: 'catalog' })),
        null,
      ),
      env,
    );
    const replies = (await response.json()) as { result: ToolReply }[];
    expect(replies.map((reply) => reply.result.isError === true)).toEqual([
      false,
      false,
      false,
      true,
      true,
    ]);
  });

  it('refuses a batch above 16 members before running any of it', async () => {
    const { env, limits } = harness();
    const response = await handleRequest(
      batchRequest(
        Array.from({ length: 17 }, () => ({ name: 'catalog' })),
        null,
      ),
      env,
    );
    expect(response.status).toBe(400);
    expect(limits['anon-ip'].counts.size).toBe(0);
  });

  it('refuses a batch under a protocol revision without batching', async () => {
    const { env } = harness();
    const response = await handleRequest(
      new Request(`${ORIGIN}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'mcp-protocol-version': '2025-11-25' },
        body: JSON.stringify([
          { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'catalog' } },
        ]),
      }),
      env,
    );
    expect(response.status).toBe(400);
  });

  it('answers GET on /mcp with 405', async () => {
    const { env } = harness();
    const response = await handleRequest(new Request(`${ORIGIN}/mcp`), env);
    expect(response.status).toBe(405);
  });
});

describe('remote MCP: authorization', () => {
  it('answers a rejected bearer with HTTP 401 and a Bearer challenge', async () => {
    const { env, r2 } = harness({
      entitlements: { status: 'inactive', code: 'not_authenticated' },
      status: 401,
    });
    for (const [method, params] of [
      ['tools/call', { name: 'render', arguments: { spec: SPEC } }],
      ['tools/call', { name: 'catalog', arguments: {} }],
      ['tools/list', {}],
    ] as const) {
      const response = await handleRequest(mcpRequest(method, params, 'expired-token'), env);
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toBe(
        'Bearer realm="ak-render", error="invalid_token"',
      );
      const body = (await response.json()) as { error: { message: string } };
      expect(body.error.message).toBe('the bearer was rejected');
    }
    expect(r2.objects.size).toBe(0);
  });

  it('answers a non-bearer Authorization scheme with HTTP 401', async () => {
    const { env, fetchMock } = harness();
    const response = await handleRequest(
      mcpRequest('tools/list', {}, null, { authorization: 'Basic dXNlcjpwYXNz' }),
      env,
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('Bearer');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects validate and render without a bearer as tool errors', async () => {
    const { env, r2 } = harness();
    for (const name of ['validate', 'render']) {
      const { status, reply, payload } = await tool(env, name, { spec: SPEC }, null);
      expect(status).toBe(200);
      expect(reply.isError).toBe(true);
      expect(payload['code']).toBe('UNAUTHENTICATED');
    }
    expect(r2.objects.size).toBe(0);
  });

  it('rejects an inactive entitlement and an upstream failure', async () => {
    const inactive = harness({ entitlements: { ...activeEntitlements(), status: 'inactive' } });
    expect((await tool(inactive.env, 'render', { spec: SPEC })).payload['code']).toBe(
      'ENTITLEMENT_INACTIVE',
    );
    const down = harness({ entitlements: 'bad gateway', status: 530 });
    expect((await tool(down.env, 'render', { spec: SPEC })).payload['code']).toBe(
      'ENTITLEMENTS_ERROR',
    );
  });

  it('authenticates a batch once', async () => {
    const { env, fetchMock } = harness();
    const response = await handleRequest(
      batchRequest([
        { name: 'validate', arguments: { spec: SPEC } },
        { name: 'render', arguments: { spec: SPEC } },
      ]),
      env,
    );
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reuses an accepted bearer across requests instead of asking upstream again', async () => {
    const { env, fetchMock } = harness();
    await tool(env, 'validate', { spec: SPEC });
    await tool(env, 'validate', { spec: SPEC });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('remote MCP: errors never leak internals', () => {
  it('reports a storage fault as a generic INTERNAL_ERROR', async () => {
    const { env, r2 } = harness();
    r2.put = async () => {
      throw new Error('R2 bucket ak-render-shares: internal detail');
    };
    const { status, reply, payload } = await tool(env, 'render', { spec: SPEC });
    expect(status).toBe(200);
    expect(reply.isError).toBe(true);
    expect(payload['code']).toBe('INTERNAL_ERROR');
    expect(reply.content[0]?.text).not.toContain('internal detail');
  });

  it('keeps an argument error readable', async () => {
    const { env } = harness();
    const { reply } = await tool(env, 'describe', {}, null);
    expect(reply.isError).toBe(true);
    expect(reply.content[0]?.text).toContain('"type" must be a non-empty string');
  });

  it('reports a faulting limiter as RATE_LIMITED without its message', async () => {
    const { env, limits } = harness();
    limits.validate.fault = new Error('limiter internal detail');
    limits['anon-ip'].fault = new Error('limiter internal detail');
    for (const [name, token] of [
      ['validate', TOKEN],
      ['catalog', null],
    ] as const) {
      const { reply, payload } = await tool(env, name, { spec: SPEC }, token);
      expect(reply.isError).toBe(true);
      expect(payload['code']).toBe('RATE_LIMITED');
      expect(reply.content[0]?.text).not.toContain('internal detail');
    }
  });
});

describe('remote MCP: render', () => {
  it('returns compact metadata and an artifact URL, never the HTML', async () => {
    const { env, r2 } = harness();
    const now = new Date('2026-10-06T00:00:00.000Z');
    const { reply, payload } = await tool(env, 'render', { spec: SPEC }, TOKEN, now);
    expect(reply.isError).toBeUndefined();
    expect(reply.content[0]?.text).not.toContain('<html');
    const local = compile(SPEC);
    expect(payload).toMatchObject({
      bytes: local.bytes,
      hash: local.hash,
      title: 'Cloud parity',
      theme: local.theme.name,
      features: local.features,
      shared: false,
      expiresAt: new Date(now.getTime() + ARTIFACT_TTL_SECONDS * 1000).toISOString(),
    });
    expect(String(payload['artifactUrl'])).toMatch(
      /^https:\/\/render\.example\.test\/v1\/artifact\/[0-9a-f-]{36}$/u,
    );
    expect([...r2.objects.keys()][0]).toMatch(/^artifact\//u);
  });

  it('stores bytes identical to POST /v1/render and serves them at the artifact URL', async () => {
    const { env } = harness();
    for (const spec of [SPEC, YAML_SPEC]) {
      const rest = await handleRequest(
        typeof spec === 'string'
          ? new Request(`${ORIGIN}/v1/render`, {
              method: 'POST',
              headers: { 'content-type': 'application/yaml', authorization: `Bearer ${TOKEN}` },
              body: spec,
            })
          : post('/v1/render', { spec }),
        env,
      );
      const restHtml = await rest.text();
      const { payload } = await tool(env, 'render', { spec });
      const served = await handleRequest(new Request(String(payload['artifactUrl'])), env);
      expect(served.status).toBe(200);
      expect(served.headers.get('content-type')).toContain('text/html');
      const html = await served.text();
      expect(html).toBe(restHtml);
      expect(html).toBe(compile(spec).html);
    }
  });

  it('applies the theme argument exactly like the REST theme field', async () => {
    const { env } = harness();
    const rest = await (
      await handleRequest(post('/v1/render', { spec: SPEC, theme: 'terminal-mono' }), env)
    ).text();
    const { payload } = await tool(env, 'render', { spec: SPEC, theme: 'terminal-mono' });
    const served = await (
      await handleRequest(new Request(String(payload['artifactUrl'])), env)
    ).text();
    expect(served).toBe(rest);
  });

  it('expires the short-lived artifact', async () => {
    const { env } = harness();
    const { payload } = await tool(env, 'render', { spec: SPEC });
    const later = new Date(Date.now() + (ARTIFACT_TTL_SECONDS + 60) * 1000);
    const served = await handleRequest(new Request(String(payload['artifactUrl'])), env, later);
    expect(served.status).toBe(410);
  });

  it('publishes a share when asked, readable on the share route', async () => {
    const { env, r2 } = harness();
    const { payload } = await tool(env, 'render', { spec: SPEC, share: true });
    expect(payload['shared']).toBe(true);
    expect(String(payload['artifactUrl'])).toMatch(/\/v1\/share\/[0-9a-f-]{36}$/u);
    expect([...r2.objects.keys()][0]).toMatch(/^share\//u);
    const served = await handleRequest(new Request(String(payload['artifactUrl'])), env);
    expect(await served.text()).toBe(compile(SPEC).html);
  });

  it('reports compiler and budget errors as tool errors', async () => {
    const { env } = harness();
    const unknown = await tool(env, 'render', {
      spec: { version: 1, meta: { title: 'x' }, blocks: [{ type: 'nope' }] },
    });
    expect(unknown.reply.isError).toBe(true);
    expect(unknown.payload['code']).toBe('SPEC_UNKNOWN_BLOCK');
    const badShare = await tool(env, 'render', { spec: SPEC, share: 'yes' });
    expect(badShare.reply.isError).toBe(true);
  });

  it('rejects an oversized MCP body with the REST request budget', async () => {
    const { env } = harness();
    const response = await handleRequest(
      new Request(`${ORIGIN}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'render', arguments: { spec: 'x'.repeat(1024 * 1024 + 16) } },
        }),
      }),
      env,
    );
    expect(response.status).toBe(413);
  });
});

describe('remote MCP: rate limits are shared with REST', () => {
  it('stops MCP render once REST renders used the window', async () => {
    const { env } = harness({ limits: { render: 2 } });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await handleRequest(post('/v1/render', { spec: SPEC }), env);
    }
    const { reply, payload } = await tool(env, 'render', { spec: SPEC });
    expect(reply.isError).toBe(true);
    expect(payload['code']).toBe('RATE_LIMITED');
  });

  it('stops REST render once MCP renders used the window', async () => {
    const { env } = harness({ limits: { render: 2 } });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await tool(env, 'render', { spec: SPEC });
    }
    const response = await handleRequest(post('/v1/render', { spec: SPEC }), env);
    expect(response.status).toBe(429);
  });

  it('counts a shared render against the share limit, as POST /v1/share does', async () => {
    const { env, limits } = harness({ limits: { share: 2 } });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await handleRequest(post('/v1/share', { spec: SPEC }), env);
    }
    const { payload } = await tool(env, 'render', { spec: SPEC, share: true });
    expect(payload['code']).toBe('RATE_LIMITED');
    // Neither a REST share nor an MCP share consumes the render allowance.
    expect(limits.render.counts.size).toBe(0);
  });

  it('keeps sharing available when the render allowance is spent, and the reverse', async () => {
    const { env } = harness({ limits: { render: 1, share: 1 } });
    expect((await tool(env, 'render', { spec: SPEC })).reply.isError).toBeUndefined();
    expect((await tool(env, 'render', { spec: SPEC })).payload['code']).toBe('RATE_LIMITED');
    expect((await tool(env, 'render', { spec: SPEC, share: true })).payload['shared']).toBe(true);
  });

  it('consumes nothing for a call refused by authorization', async () => {
    const { env, limits } = harness({
      entitlements: {
        ...activeEntitlements(),
        entitlements: { agentkitApp: false, kits: {} },
      },
    });
    expect((await tool(env, 'render', { spec: SPEC, share: true })).payload['code']).toBe(
      'FORBIDDEN',
    );
    expect(limits.render.counts.size + limits.share.counts.size).toBe(0);
  });

  it('never persists the bearer through MCP', async () => {
    const { env, r2, limits } = harness();
    await tool(env, 'render', { spec: SPEC });
    await tool(env, 'render', { spec: SPEC, share: true });
    const stored = [
      ...r2.values,
      ...limiterKeys(limits),
      ...[...r2.objects.values()].map((entry) => JSON.stringify(entry.customMetadata ?? {})),
    ].join('\n');
    expect(stored).not.toContain(TOKEN);
  });
});

/** A 2026-07-28 request: the revision and client capabilities ride in `_meta`. */
function modernRequest(
  method: string,
  params: Record<string, unknown>,
  token: string | null,
  headers: Record<string, string> = {},
): Request {
  const name = typeof params['name'] === 'string' ? params['name'] : undefined;
  return new Request(`${ORIGIN}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': method,
      ...(name === undefined ? {} : { 'mcp-name': name }),
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: nextId++,
      method,
      params: {
        ...params,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }),
  });
}

describe('remote MCP: 2026-07-28 requests keep the authorization path', () => {
  it('refuses validate and render without a bearer as tool errors', async () => {
    const { env, fetchMock } = harness();
    for (const name of ['validate', 'render']) {
      const response = await handleRequest(
        modernRequest('tools/call', { name, arguments: { spec: SPEC } }, null),
        env,
      );
      expect(response.status).toBe(200);
      const result = ((await response.json()) as { result: ToolReply & { resultType: string } })
        .result;
      expect(result.resultType).toBe('complete');
      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0]?.text ?? '{}')).toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers server/discover without a bearer with the OAuth challenge when OAuth is on', async () => {
    const { env } = harness();
    const oauthEnv = {
      ...env,
      OAUTH_RESOURCE: `${ORIGIN}/mcp`,
      OAUTH_ISSUER: 'https://auth.example.test',
    };
    const response = await handleRequest(modernRequest('server/discover', {}, null), oauthEnv);
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('resource_metadata=');
  });

  it('counts anonymous calls against the per-IP limit', async () => {
    const { env, limits } = harness({ limits: { 'anon-ip': 1 } });
    const call = async () => {
      const response = await handleRequest(
        modernRequest('tools/call', { name: 'themes', arguments: {} }, null, {
          'cf-connecting-ip': '203.0.113.9',
        }),
        env,
      );
      return ((await response.json()) as { result: ToolReply }).result;
    };
    expect((await call()).isError).toBeUndefined();
    const limited = await call();
    expect(limited.isError).toBe(true);
    expect(JSON.parse(limited.content[0]?.text ?? '{}')).toMatchObject({ code: 'RATE_LIMITED' });
    expect([...limits['anon-ip'].counts.keys()]).toEqual(['203.0.113.9']);
  });

  it('refuses a header mismatch before the bearer is checked', async () => {
    const { env, fetchMock } = harness();
    const response = await handleRequest(
      modernRequest('tools/call', { name: 'render', arguments: { spec: SPEC } }, TOKEN, {
        'mcp-name': 'validate',
      }),
      env,
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: number } }).error.code).toBe(-32020);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('remote MCP: motion tools', () => {
  const MOTION_SPEC = {
    version: 1,
    meta: { title: 'Remote motion' },
    blocks: [{ type: 'card', id: 'solo', title: 'Solo', text: 'Body.', motion: 'reveal-soft' }],
  };

  it('answers motions with no bearer, for the catalog, a query and one recipe', async () => {
    const { env, fetchMock } = harness();
    const listing = await tool(env, 'motions', {}, null);
    expect(listing.reply.isError).toBeUndefined();
    expect(listing.payload['recipeCount']).toBe(7);
    const hits = await tool(env, 'motions', { query: 'smooth tabs' }, null);
    expect(hits.reply.isError).toBeUndefined();
    expect((hits.payload as unknown as { id: string }[])[0]?.id).toBe('tabs-slide');
    const compact = await tool(env, 'motions', { id: 'tabs-slide', compact: true }, null);
    expect(compact.payload['id']).toBe('tabs-slide');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses audit-motion without a bearer as a tool error, like validate', async () => {
    const { env, fetchMock, r2 } = harness();
    for (const args of [{ spec: MOTION_SPEC }, { html: '<p>x</p>' }]) {
      const { status, reply, payload } = await tool(env, 'audit-motion', args, null);
      expect(status).toBe(200);
      expect(reply.isError).toBe(true);
      expect(payload['code']).toBe('UNAUTHENTICATED');
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r2.objects.size).toBe(0);
  });

  it('repairs only with a bearer, under the render limit', async () => {
    const { env, fetchMock, limits } = harness();
    const spec =
      'version: 1\nmeta:\n  title: R\nblocks:\n  - type: badge\n    text: x\n    tone: Info\n';
    const anonymous = await tool(env, 'repair', { spec }, null);
    expect(anonymous.reply.isError).toBe(true);
    expect(anonymous.payload['code']).toBe('UNAUTHENTICATED');
    expect(fetchMock).not.toHaveBeenCalled();

    const { reply, payload } = await tool(env, 'repair', { spec });
    expect(reply.isError).toBeUndefined();
    expect(payload['changed']).toBe(true);
    expect(payload['spec']).toContain('tone: info');
    // Repair revalidates many times per call, so it is charged like a render.
    expect(limits.render.counts.size).toBe(1);
    expect(limits.validate.counts.size).toBe(0);
  });

  it('audits a spec with a bearer and returns the report', async () => {
    const { env } = harness();
    const { reply, payload } = await tool(env, 'audit-motion', { spec: MOTION_SPEC });
    expect(reply.isError).toBeUndefined();
    expect(payload['mode']).toBe('spec');
    expect(payload['findings']).toEqual([]);
  });

  it('refuses audit-motion for a principal without the render entitlement', async () => {
    const { env } = harness({
      entitlements: {
        ...activeEntitlements(),
        entitlements: { agentkitApp: false, kits: {} },
      },
    });
    const { payload } = await tool(env, 'audit-motion', { spec: MOTION_SPEC });
    expect(payload['code']).toBe('FORBIDDEN');
  });
});
