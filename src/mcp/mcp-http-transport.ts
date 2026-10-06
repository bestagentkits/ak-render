/**
 * MCP Streamable HTTP transport, written against the Fetch API only.
 *
 * `handleMcpHttpRequest` turns one `Request` into one `Response`, so any
 * runtime with `Request`/`Response` can host it: a Cloudflare Worker, Deno, Bun
 * or Node 20+. It imports nothing Node-specific and no tool with a side effect;
 * the host passes the tool list and a per-request context, which is how the
 * Worker attaches authorization, rate limiting and storage to the shared tool
 * contracts.
 *
 * The server is stateless: it issues no `Mcp-Session-Id`, opens no
 * server-initiated stream (GET answers 405), and replies to every POST with a
 * single JSON body rather than an SSE stream, which the specification allows.
 */

import { routeMcpMessage } from './mcp-json-rpc-dispatch.js';
import {
  isSupportedProtocol,
  JSON_RPC_ERRORS,
  type JsonRpcResponse,
  rpcError,
  type ToolResult,
  toolErrorResult,
} from './mcp-protocol.js';
import type { McpTool } from './mcp-tool-definitions.js';

/** Request body ceiling used when the host does not set one: 1 MiB. */
export const DEFAULT_MCP_MAX_REQUEST_BYTES = 1024 * 1024;

export interface McpHttpOptions<C> {
  /** The tools this endpoint serves, in the order `tools/list` announces them. */
  tools: readonly McpTool<C, ToolResult | Promise<ToolResult>>[];
  /** Per-request context handed to every tool call in this request. */
  context: C;
  /** `initialize` instructions for the model. */
  instructions: string;
  /**
   * Browser origins allowed besides the endpoint's own. A request carrying any
   * other `Origin` is refused with 403, which is the DNS-rebinding guard the
   * transport specification requires. Requests without `Origin` (non-browser
   * clients) are not affected.
   */
  allowedOrigins?: readonly string[];
  /** Request body ceiling in bytes. */
  maxRequestBytes?: number;
}

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

function jsonResponse(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}

function transportError(status: number, code: number, message: string): Response {
  return jsonResponse(status, rpcError(null, code, message));
}

function originAllowed(request: Request, allowed: readonly string[]): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) return true;
  return origin === new URL(request.url).origin || allowed.includes(origin);
}

/** Run one routed message to completion. Tool errors become tool results. */
async function answer<C>(
  message: unknown,
  options: McpHttpOptions<C>,
): Promise<JsonRpcResponse | undefined> {
  const route = routeMcpMessage(message, options.tools, { instructions: options.instructions });
  if (route.kind === 'silent') return undefined;
  if (route.kind === 'reply') return route.response;
  let result: ToolResult;
  try {
    result = await route.tool.run(route.args, options.context);
  } catch (error) {
    result = toolErrorResult(error);
  }
  return { jsonrpc: '2.0', id: route.id, result };
}

/**
 * Serve one Streamable HTTP request on the MCP endpoint.
 *
 * - POST with one JSON-RPC message (or a batch, for 2025-03-26 clients) answers
 *   200 with the JSON response, or 202 with no body when every message was a
 *   notification or a response.
 * - Any other method answers 405: this server has no server-initiated stream
 *   and no session to delete.
 * - An unsupported `MCP-Protocol-Version` header answers 400.
 */
export async function handleMcpHttpRequest<C>(
  request: Request,
  options: McpHttpOptions<C>,
): Promise<Response> {
  if (!originAllowed(request, options.allowedOrigins ?? [])) {
    return transportError(403, JSON_RPC_ERRORS.invalidRequest, 'origin not allowed');
  }
  if (request.method.toUpperCase() !== 'POST') {
    return jsonResponse(
      405,
      rpcError(null, JSON_RPC_ERRORS.invalidRequest, 'method not allowed: use POST'),
      { allow: 'POST' },
    );
  }
  const version = request.headers.get('mcp-protocol-version');
  if (version !== null && !isSupportedProtocol(version)) {
    return transportError(
      400,
      JSON_RPC_ERRORS.invalidRequest,
      `unsupported MCP-Protocol-Version: ${version}`,
    );
  }
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return transportError(
      415,
      JSON_RPC_ERRORS.invalidRequest,
      'content-type must be application/json',
    );
  }

  const limit = options.maxRequestBytes ?? DEFAULT_MCP_MAX_REQUEST_BYTES;
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > limit) {
    return transportError(
      413,
      JSON_RPC_ERRORS.invalidRequest,
      `request body exceeds ${limit} bytes`,
    );
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).length > limit) {
    return transportError(
      413,
      JSON_RPC_ERRORS.invalidRequest,
      `request body exceeds ${limit} bytes`,
    );
  }

  let message: unknown;
  try {
    message = JSON.parse(body);
  } catch {
    return transportError(400, JSON_RPC_ERRORS.parse, 'parse error');
  }

  if (Array.isArray(message)) {
    if (message.length === 0) {
      return transportError(400, JSON_RPC_ERRORS.invalidRequest, 'invalid request');
    }
    // Members run in order so per-subject rate limits count deterministically.
    const responses: JsonRpcResponse[] = [];
    for (const member of message) {
      const response = await answer(member, options);
      if (response !== undefined) responses.push(response);
    }
    return responses.length === 0
      ? new Response(null, { status: 202 })
      : jsonResponse(200, responses);
  }

  const response = await answer(message, options);
  if (response === undefined) return new Response(null, { status: 202 });
  const malformed =
    response.error?.code === JSON_RPC_ERRORS.invalidRequest && response.result === undefined;
  return jsonResponse(malformed ? 400 : 200, response);
}
