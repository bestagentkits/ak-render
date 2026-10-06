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
  DEFAULT_HTTP_PROTOCOL,
  isSupportedProtocol,
  JSON_RPC_ERRORS,
  type JsonRpcResponse,
  type ProtocolVersion,
  protocolAllowsBatching,
  rpcError,
  type ToolResult,
  toolErrorResult,
} from './mcp-protocol.js';
import type { McpTool } from './mcp-tool-definitions.js';

/** Request body ceiling used when the host does not set one: 1 MiB. */
export const DEFAULT_MCP_MAX_REQUEST_BYTES = 1024 * 1024;

/**
 * Most members one batch may carry. A batch is answered member by member in one
 * request, so without a ceiling a small body buys unbounded work and output.
 */
export const DEFAULT_MCP_MAX_BATCH_SIZE = 16;

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
  /** Most members a JSON-RPC batch may carry. */
  maxBatchSize?: number;
  /**
   * Runs once per request after every transport check passed and before any
   * message is dispatched. A returned `Response` is sent as is (for example a
   * 401 for a rejected bearer); `undefined` lets the request through.
   */
  preflight?: () => Promise<Response | undefined>;
  /**
   * Turns an error a tool threw into a tool result. Defaults to reporting the
   * error's message; a hosted server passes a mapper that hides internals.
   */
  toolError?: (error: unknown) => ToolResult;
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

/** Why a batch cannot be served, or `undefined` when it can. */
function batchRefusal(
  batch: unknown[],
  version: ProtocolVersion,
  maxBatchSize = DEFAULT_MCP_MAX_BATCH_SIZE,
): string | undefined {
  if (batch.length === 0) return 'invalid request';
  if (!protocolAllowsBatching(version)) {
    return `protocol revision ${version} does not support JSON-RPC batches`;
  }
  if (batch.length > maxBatchSize) return `a batch may carry at most ${maxBatchSize} messages`;
  const initializes = batch.some(
    (member) =>
      typeof member === 'object' &&
      member !== null &&
      (member as { method?: unknown }).method === 'initialize',
  );
  return initializes ? 'initialize must not be part of a batch' : undefined;
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
    result = (options.toolError ?? toolErrorResult)(error);
  }
  return { jsonrpc: '2.0', id: route.id, result };
}

/**
 * Serve one Streamable HTTP request on the MCP endpoint.
 *
 * - POST with one JSON-RPC message (or a batch, for 2025-03-26 clients) answers
 *   200 with the JSON response, or 202 with no body when every message was a
 *   notification or a response.
 * - A batch answers 400 when the request's protocol revision has no batching
 *   (2025-06-18 and later), when it is larger than `maxBatchSize`, or when it
 *   carries `initialize`, which must be sent alone.
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
  const header = request.headers.get('mcp-protocol-version');
  if (header !== null && !isSupportedProtocol(header)) {
    return transportError(
      400,
      JSON_RPC_ERRORS.invalidRequest,
      `unsupported MCP-Protocol-Version: ${header}`,
    );
  }
  // A client that omits the header is assumed to speak the revision the
  // transport specification names for that case.
  const version = header ?? DEFAULT_HTTP_PROTOCOL;
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
    const refused = batchRefusal(message, version, options.maxBatchSize);
    if (refused !== undefined) return transportError(400, JSON_RPC_ERRORS.invalidRequest, refused);
  }

  const gated = await options.preflight?.();
  if (gated !== undefined) return gated;

  if (Array.isArray(message)) {
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
