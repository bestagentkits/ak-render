import { describe, expect, it } from 'vitest';
import { decodeMcpHeaderValue, handleMcpHttpRequest } from '../../src/mcp/mcp-http-transport.js';
import { LOCAL_INSTRUCTIONS, LOCAL_TOOLS } from '../../src/mcp/mcp-local-tools.js';
import { LATEST_LEGACY_PROTOCOL, LATEST_PROTOCOL } from '../../src/mcp/mcp-protocol.js';
import { handleMcpLine } from '../../src/mcp/mcp-stdio-transport.js';
import { CATALOG_TOOL, VALIDATE_TOOL } from '../../src/mcp/mcp-tool-definitions.js';
import { handleMcpMessage } from '../../src/mcp-server.js';
import { PACKAGE_NAME, VERSION } from '../../src/version.js';

// Revision 2026-07-28 is stateless: no handshake, every request carries its
// revision and client capabilities in `_meta`, and Streamable HTTP mirrors the
// method and tool name into headers.

const ENDPOINT = 'https://mcp.example.test/mcp';
const MODERN = '2026-07-28';
const META = {
  'io.modelcontextprotocol/protocolVersion': MODERN,
  'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1.0.0' },
  'io.modelcontextprotocol/clientCapabilities': {},
};
const SERVER_INFO = { name: PACKAGE_NAME, version: VERSION };

// biome-ignore lint/suspicious/noExplicitAny: assertions walk arbitrary JSON-RPC replies.
type RpcBody = Record<string, any>;

function modernRequest(method: string, params: Record<string, unknown> = {}, id = 1) {
  return { jsonrpc: '2.0', id, method, params: { ...params, _meta: META } };
}

/** Headers a conforming 2026-07-28 client sends for a request body. */
function modernHeaders(body: { method: string; params?: Record<string, unknown> }) {
  const name = body.params?.name;
  return {
    'mcp-protocol-version': MODERN,
    'mcp-method': body.method,
    ...(typeof name === 'string' ? { 'mcp-name': name } : {}),
  };
}

async function post(body: unknown, headers: Record<string, string>) {
  const response = await handleMcpHttpRequest(
    new Request(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...headers,
      },
      body: JSON.stringify(body),
    }),
    { tools: [CATALOG_TOOL, VALIDATE_TOOL], context: {}, instructions: 'test instructions' },
  );
  const raw = await response.text();
  return { status: response.status, body: raw === '' ? undefined : (JSON.parse(raw) as RpcBody) };
}

describe('MCP 2026-07-28 over Streamable HTTP', () => {
  it('answers server/discover with versions, capabilities, identity and cache hints', async () => {
    const body = modernRequest('server/discover');
    const { status, body: reply } = await post(body, modernHeaders(body));
    expect(status).toBe(200);
    expect(reply?.result).toEqual({
      resultType: 'complete',
      supportedVersions: ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'],
      capabilities: { tools: {} },
      instructions: 'test instructions',
      ttlMs: 300_000,
      cacheScope: 'public',
      _meta: { 'io.modelcontextprotocol/serverInfo': SERVER_INFO },
    });
  });

  it('lists tools in a stable order with resultType and cache hints', async () => {
    const body = modernRequest('tools/list');
    const first = await post(body, modernHeaders(body));
    const second = await post(body, modernHeaders(body));
    expect(first.status).toBe(200);
    expect(first.body?.result.resultType).toBe('complete');
    expect(first.body?.result.ttlMs).toBe(300_000);
    expect(first.body?.result.cacheScope).toBe('public');
    expect(first.body?.result._meta['io.modelcontextprotocol/serverInfo']).toEqual(SERVER_INFO);
    expect(first.body?.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      'catalog',
      'validate',
    ]);
    expect(second.body).toEqual(first.body);
  });

  it('runs tools/call without a handshake and marks the result complete', async () => {
    const body = modernRequest('tools/call', { name: 'catalog', arguments: {} });
    const { status, body: reply } = await post(body, modernHeaders(body));
    expect(status).toBe(200);
    expect(reply?.result.resultType).toBe('complete');
    expect(reply?.result._meta['io.modelcontextprotocol/serverInfo']).toEqual(SERVER_INFO);
    expect(JSON.parse(reply?.result.content[0].text).blockCount).toBeGreaterThan(40);
  });

  it('keeps tool failures as tool results, not protocol errors', async () => {
    const body = modernRequest('tools/call', { name: 'validate', arguments: {} });
    const { status, body: reply } = await post(body, modernHeaders(body));
    expect(status).toBe(200);
    expect(reply?.result.resultType).toBe('complete');
    expect(reply?.result.isError).toBe(true);
  });

  it('rejects a missing or mismatched Mcp-Method with HeaderMismatch', async () => {
    const body = modernRequest('tools/list');
    for (const headers of [
      { 'mcp-protocol-version': MODERN },
      { 'mcp-protocol-version': MODERN, 'mcp-method': 'tools/call' },
    ]) {
      const { status, body: reply } = await post(body, headers);
      expect(status).toBe(400);
      expect(reply?.error.code).toBe(-32020);
      expect(reply?.id).toBe(1);
    }
  });

  it('rejects a missing or mismatched Mcp-Name on tools/call', async () => {
    const body = modernRequest('tools/call', { name: 'catalog', arguments: {} });
    const missing = await post(body, {
      'mcp-protocol-version': MODERN,
      'mcp-method': 'tools/call',
    });
    expect(missing.status).toBe(400);
    expect(missing.body?.error.code).toBe(-32020);
    const other = await post(body, { ...modernHeaders(body), 'mcp-name': 'validate' });
    expect(other.status).toBe(400);
    expect(other.body?.error.message).toContain('Mcp-Name');
  });

  it('decodes a Base64-sentinel Mcp-Name before comparing it', async () => {
    const body = modernRequest('tools/call', { name: 'catalog', arguments: {} });
    const encoded = `=?base64?${btoa('catalog')}?=`;
    const { status } = await post(body, { ...modernHeaders(body), 'mcp-name': encoded });
    expect(status).toBe(200);
    expect(decodeMcpHeaderValue('=?base64?SGVsbG8sIOS4lueVjA==?=')).toBe('Hello, 世界');
    expect(decodeMcpHeaderValue('plain')).toBe('plain');
    expect(decodeMcpHeaderValue('=?base64?/w==?=')).toBeUndefined();
  });

  it('rejects a header revision that differs from the _meta revision', async () => {
    const body = modernRequest('tools/list');
    const legacyHeader = await post(body, { 'mcp-protocol-version': '2025-11-25' });
    expect(legacyHeader.status).toBe(400);
    expect(legacyHeader.body?.error.code).toBe(-32020);
    const noHeader = await post(body, {});
    expect(noHeader.status).toBe(400);
    expect(noHeader.body?.error.code).toBe(-32020);
    const legacyBody = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
    const modernHeader = await post(legacyBody, modernHeaders(legacyBody));
    expect(modernHeader.status).toBe(400);
    expect(modernHeader.body?.error.message).toContain('protocolVersion');
  });

  it('rejects a request without client capabilities as invalid params', async () => {
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: { _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN } },
    };
    const { status, body: reply } = await post(body, modernHeaders(body));
    expect(status).toBe(400);
    expect(reply?.error.code).toBe(-32602);
  });

  it('answers an unknown _meta revision with UnsupportedProtocolVersion', async () => {
    const body = {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/list',
      params: { _meta: { ...META, 'io.modelcontextprotocol/protocolVersion': '2099-01-01' } },
    };
    const { status, body: reply } = await post(body, {});
    expect(status).toBe(400);
    expect(reply?.error.code).toBe(-32022);
    expect(reply?.error.data.requested).toBe('2099-01-01');
    expect(reply?.error.data.supported[0]).toBe(MODERN);
  });

  it('answers 404 for a method the revision removed or never had', async () => {
    for (const method of ['initialize', 'ping', 'logging/setLevel', 'resources/list']) {
      const body = modernRequest(method);
      const { status, body: reply } = await post(body, modernHeaders(body));
      expect(status).toBe(404);
      expect(reply?.error.code).toBe(-32601);
    }
  });

  it('refuses a JSON-RPC batch and ignores Mcp-Session-Id', async () => {
    const body = modernRequest('tools/list');
    const batch = await post([body], modernHeaders(body));
    expect(batch.status).toBe(400);
    const session = await post(body, { ...modernHeaders(body), 'mcp-session-id': 'abc' });
    expect(session.status).toBe(200);
    expect(session.body?.result.tools).toHaveLength(2);
  });

  it('keeps serving legacy clients that open with initialize', async () => {
    const init = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: MODERN },
    };
    const { status, body: reply } = await post(init, { 'mcp-protocol-version': '2025-11-25' });
    expect(status).toBe(200);
    // A handshake can only select a legacy revision.
    expect(reply?.result.protocolVersion).toBe(LATEST_LEGACY_PROTOCOL);
    expect(reply?.result.resultType).toBeUndefined();
    const list = { jsonrpc: '2.0', id: 2, method: 'tools/list' };
    const legacy = await post(list, { 'mcp-protocol-version': '2025-11-25' });
    expect(legacy.body?.result.resultType).toBeUndefined();
    expect(legacy.body?.result.ttlMs).toBeUndefined();
  });
});

describe('MCP 2026-07-28 over stdio', () => {
  const context = { cwd: '/', home: '/' };

  it('answers server/discover as the dual-era probe and lists every local tool', async () => {
    const discover = await handleMcpMessage(modernRequest('server/discover'), context);
    const result = discover?.result as RpcBody;
    expect(result.supportedVersions[0]).toBe(LATEST_PROTOCOL);
    expect(result.instructions).toBe(LOCAL_INSTRUCTIONS);
    const listed = await handleMcpMessage(modernRequest('tools/list', {}, 2), context);
    expect(
      (listed?.result as RpcBody | undefined)?.tools.map((tool: { name: string }) => tool.name),
    ).toEqual(LOCAL_TOOLS.map((tool) => tool.name));
  });

  it('runs a tool call with the modern result shape', async () => {
    const reply = await handleMcpMessage(
      modernRequest('tools/call', { name: 'recipes', arguments: {} }),
      context,
    );
    expect((reply?.result as RpcBody | undefined)?.resultType).toBe('complete');
  });

  it('answers server/discover without a revision as a non-modern error, so a legacy probe falls back', async () => {
    const reply = await handleMcpMessage(
      { jsonrpc: '2.0', id: 1, method: 'server/discover', params: {} },
      context,
    );
    expect(reply?.error?.code).toBe(-32602);
  });

  it('answers server/discover under a legacy revision as method not found', async () => {
    const reply = await handleMcpMessage(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'server/discover',
        params: { _meta: { ...META, 'io.modelcontextprotocol/protocolVersion': '2025-11-25' } },
      },
      context,
    );
    expect(reply?.error?.code).toBe(-32601);
  });

  it('answers a non-string _meta revision as invalid params', async () => {
    const reply = await handleMcpMessage(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: { _meta: { ...META, 'io.modelcontextprotocol/protocolVersion': 5 } },
      },
      context,
    );
    expect(reply?.error?.code).toBe(-32602);
  });

  it('refuses a batch that carries 2026-07-28 requests', async () => {
    const line = JSON.stringify([
      modernRequest('tools/list', {}, 1),
      modernRequest('tools/list', {}, 2),
    ]);
    const reply = JSON.parse((await handleMcpLine(line, context)) ?? '{}') as RpcBody;
    expect(reply.error?.code).toBe(-32600);
  });
});
