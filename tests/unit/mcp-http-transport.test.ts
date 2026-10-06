import { describe, expect, it } from 'vitest';
import { handleMcpHttpRequest, type McpHttpOptions } from '../../src/mcp/mcp-http-transport.js';
import { type ToolResult, text } from '../../src/mcp/mcp-protocol.js';
import {
  BUILTIN_THEMES_TOOL,
  CATALOG_TOOL,
  DESCRIBE_TOOL,
  type McpTool,
  VALIDATE_TOOL,
} from '../../src/mcp/mcp-tool-definitions.js';
import { handleMcpMessage } from '../../src/mcp-server.js';

const ENDPOINT = 'https://mcp.example.test/mcp';

// biome-ignore lint/suspicious/noExplicitAny: assertions walk arbitrary JSON-RPC replies.
type RpcBody = Record<string, any>;

interface Context {
  calls: string[];
}

const ECHO_TOOL: McpTool<Context, Promise<ToolResult>> = {
  name: 'echo',
  description: 'Echo the context the transport handed over.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  run: async (_args, context) => {
    context.calls.push('echo');
    return text({ calls: context.calls.length });
  },
};

const THROWING_TOOL: McpTool<Context> = {
  name: 'boom',
  description: 'Always throws.',
  inputSchema: { type: 'object' },
  run: () => {
    throw new TypeError('"thing" must be a non-empty string');
  },
};

function options(overrides: Partial<McpHttpOptions<Context>> = {}): McpHttpOptions<Context> {
  return {
    tools: [
      CATALOG_TOOL,
      DESCRIBE_TOOL,
      VALIDATE_TOOL,
      BUILTIN_THEMES_TOOL,
      ECHO_TOOL,
      THROWING_TOOL,
    ],
    context: { calls: [] },
    instructions: 'test instructions',
    ...overrides,
  };
}

function rpc(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function call(
  body: unknown,
  headers: Record<string, string> = {},
  overrides: Partial<McpHttpOptions<Context>> = {},
) {
  const response = await handleMcpHttpRequest(rpc(body, headers), options(overrides));
  const raw = await response.text();
  return { response, body: raw === '' ? undefined : (JSON.parse(raw) as RpcBody) };
}

describe('MCP Streamable HTTP: lifecycle', () => {
  it('initializes with the negotiated revision and the host instructions', async () => {
    const { response, body } = await call({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't' } },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('mcp-session-id')).toBeNull();
    expect(body?.result).toMatchObject({
      protocolVersion: '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: '@bestagentkits/render' },
      instructions: 'test instructions',
    });
  });

  it('answers the same initialize as the stdio server, apart from instructions', async () => {
    const message = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} };
    const { body } = await call(message);
    const stdio = handleMcpMessage(message, { cwd: '/', home: '/' });
    const { instructions: _http, ...httpRest } = (body?.result ?? {}) as Record<string, unknown>;
    const { instructions: _stdio, ...stdioRest } = (stdio?.result ?? {}) as Record<string, unknown>;
    expect(Object.keys(httpRest).length).toBeGreaterThan(0);
    expect(httpRest).toEqual(stdioRest);
  });

  it('accepts a notification or a response with 202 and no body', async () => {
    const notification = await call({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(notification.response.status).toBe(202);
    expect(notification.body).toBeUndefined();
    const reply = await call({ jsonrpc: '2.0', id: 5, result: {} });
    expect(reply.response.status).toBe(202);
  });

  it('lists the host tools in order with their shared schemas', async () => {
    const { body } = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const tools = body?.result.tools as { name: string; inputSchema: unknown }[];
    expect(tools.map((tool) => tool.name)).toEqual([
      'catalog',
      'describe',
      'validate',
      'themes',
      'echo',
      'boom',
    ]);
    expect(tools[2]?.inputSchema).toEqual(VALIDATE_TOOL.inputSchema);
  });
});

describe('MCP Streamable HTTP: tool calls', () => {
  it('runs shared tools and asynchronous host tools with the request context', async () => {
    const catalog = await call({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'catalog', arguments: {} },
    });
    expect(JSON.parse(catalog.body?.result.content[0].text).blockCount).toBeGreaterThan(40);

    const context: Context = { calls: [] };
    const echo = await call(
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'echo' } },
      {},
      { context },
    );
    expect(context.calls).toEqual(['echo']);
    expect(echo.body?.result.isError).toBeUndefined();
  });

  it('turns a thrown error and a spec error into tool errors, not protocol errors', async () => {
    const boom = await call({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'boom' },
    });
    expect(boom.response.status).toBe(200);
    expect(boom.body?.result).toMatchObject({ isError: true });
    expect(boom.body?.result.content[0].text).toContain('"thing"');

    const invalid = await call({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'validate', arguments: { spec: 'version: 1\nblocks: nope\n' } },
    });
    expect(invalid.body?.result.isError).toBe(true);
  });

  it('answers an unknown tool and an unknown method as JSON-RPC errors', async () => {
    const tool = await call({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'nope' },
    });
    expect(tool.body?.error.code).toBe(-32602);
    const method = await call({ jsonrpc: '2.0', id: 8, method: 'resources/list' });
    expect(method.response.status).toBe(200);
    expect(method.body?.error.code).toBe(-32601);
  });

  it('answers each member of a batch in order and omits notifications', async () => {
    const context: Context = { calls: [] };
    const { response, body } = await call(
      [
        { jsonrpc: '2.0', id: 1, method: 'ping' },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'echo' } },
      ],
      {},
      { context },
    );
    expect(response.status).toBe(200);
    expect((body as unknown as { id: number }[]).map((member) => member.id)).toEqual([1, 2]);
  });
});

describe('MCP Streamable HTTP: transport errors', () => {
  it('rejects malformed JSON, an empty batch and a non-request message with 400', async () => {
    expect((await call('{nope')).body?.error.code).toBe(-32700);
    expect((await call('{nope')).response.status).toBe(400);
    expect((await call([])).response.status).toBe(400);
    const notRequest = await call({ hello: 'world' });
    expect(notRequest.response.status).toBe(400);
    expect(notRequest.body?.error.code).toBe(-32600);
  });

  it('answers GET and DELETE with 405 because there is no stream or session', async () => {
    for (const method of ['GET', 'DELETE']) {
      const response = await handleMcpHttpRequest(new Request(ENDPOINT, { method }), options());
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('POST');
    }
  });

  it('rejects an unsupported MCP-Protocol-Version header and accepts a supported one', async () => {
    const ping = { jsonrpc: '2.0', id: 1, method: 'ping' };
    const bad = await call(ping, { 'mcp-protocol-version': '1999-01-01' });
    expect(bad.response.status).toBe(400);
    const good = await call(ping, { 'mcp-protocol-version': '2025-11-25' });
    expect(good.response.status).toBe(200);
  });

  it('refuses a foreign browser Origin with 403 and allows its own or a listed one', async () => {
    const ping = { jsonrpc: '2.0', id: 1, method: 'ping' };
    expect((await call(ping, { origin: 'https://evil.example' })).response.status).toBe(403);
    expect((await call(ping, { origin: 'https://mcp.example.test' })).response.status).toBe(200);
    const listed = await call(
      ping,
      { origin: 'https://app.example' },
      { allowedOrigins: ['https://app.example'] },
    );
    expect(listed.response.status).toBe(200);
  });

  it('rejects a non-JSON content type with 415 and an oversized body with 413', async () => {
    const yaml = await handleMcpHttpRequest(
      new Request(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: 'ping',
      }),
      options(),
    );
    expect(yaml.status).toBe(415);
    const big = await call(
      { jsonrpc: '2.0', id: 1, method: 'ping', params: { pad: 'x'.repeat(2048) } },
      {},
      { maxRequestBytes: 1024 },
    );
    expect(big.response.status).toBe(413);
  });
});
