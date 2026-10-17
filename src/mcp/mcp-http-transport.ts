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
 *
 * A request with `MCP-Protocol-Version: 2026-07-28` (or later modern revision)
 * must also mirror its body in headers: the header revision equals the `_meta`
 * revision, `Mcp-Method` equals `method`, and `Mcp-Name` equals the tool name
 * for `tools/call`. A mismatch or a missing header answers 400 with the
 * `HeaderMismatch` error, so an intermediary routing on headers never sees a
 * different request from the one this server runs.
 */

import { routeMcpMessage, toolCallResponse } from './mcp-json-rpc-dispatch.js';
import {
  DEFAULT_HTTP_PROTOCOL,
  isModernProtocol,
  isSupportedProtocol,
  JSON_RPC_ERRORS,
  type JsonRpcResponse,
  metaProtocolVersion,
  type ProtocolVersion,
  protocolAllowsBatching,
  rpcError,
  type ToolResult,
  toolErrorResult,
  unsupportedProtocolError,
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

/** Methods whose `Mcp-Name` header mirrors `params.name` or `params.uri`. */
const NAMED_METHODS = new Set(['tools/call', 'resources/read', 'prompts/get']);

const BASE64_SENTINEL = /^=\?base64\?([A-Za-z0-9+/]*={0,2})\?=$/u;

/** Decode a header value that uses the `=?base64?…?=` sentinel; plain values pass through. */
export function decodeMcpHeaderValue(value: string): string | undefined {
  const encoded = BASE64_SENTINEL.exec(value);
  if (encoded === null) return value;
  try {
    const binary = atob(encoded[1] ?? '');
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/**
 * Why one message's headers disagree with its body, or `undefined` when they
 * agree. Only requests are checked: notifications and responses carry no
 * header contract. Legacy requests are checked only for a modern `_meta`
 * revision the header does not announce.
 */
function headerMismatch(
  message: unknown,
  request: Request,
  header: string | null,
): string | undefined {
  if (typeof message !== 'object' || message === null) return undefined;
  const { id, method, params } = message as { id?: unknown; method?: unknown; params?: unknown };
  if (id === undefined || typeof method !== 'string') return undefined;
  const body = metaProtocolVersion(message);
  if (!isModernProtocol(header)) {
    return isModernProtocol(body)
      ? `MCP-Protocol-Version header ${header ?? '(missing)'} does not match _meta revision ${body}`
      : undefined;
  }
  // A modern request without the `_meta` revision is malformed; the dispatcher
  // would serve it as legacy, so it is refused here rather than silently
  // downgraded.
  if (body === undefined) return 'missing _meta field io.modelcontextprotocol/protocolVersion';
  if (body !== header) {
    return `MCP-Protocol-Version header ${header} does not match _meta revision ${String(body)}`;
  }
  const methodHeader = request.headers.get('mcp-method');
  if (methodHeader !== method) {
    return `Mcp-Method header ${methodHeader ?? '(missing)'} does not match body method ${method}`;
  }
  if (NAMED_METHODS.has(method)) {
    const named = params as { name?: unknown; uri?: unknown } | undefined;
    const expected = method === 'resources/read' ? named?.uri : named?.name;
    const raw = request.headers.get('mcp-name');
    const decoded = raw === null ? undefined : decodeMcpHeaderValue(raw);
    if (decoded === undefined || decoded !== expected) {
      return `Mcp-Name header ${raw ?? '(missing)'} does not match body value ${String(expected)}`;
    }
  }
  return undefined;
}

/** The request id to echo in a transport-level error, when one can be read. */
function messageId(message: unknown): string | number | null {
  const id = (message as { id?: unknown } | null)?.id;
  return typeof id === 'string' || typeof id === 'number' ? id : null;
}

/** Run one routed message to completion. Tool errors become tool results. */
async function answer<C>(
  message: unknown,
  options: McpHttpOptions<C>,
): Promise<{ response: JsonRpcResponse; status?: number } | undefined> {
  const route = routeMcpMessage(message, options.tools, { instructions: options.instructions });
  if (route.kind === 'silent') return undefined;
  if (route.kind === 'reply') {
    return route.status === undefined
      ? { response: route.response }
      : { response: route.response, status: route.status };
  }
  let result: ToolResult;
  try {
    result = await route.tool.run(route.args, options.context);
  } catch (error) {
    result = (options.toolError ?? toolErrorResult)(error);
  }
  return { response: toolCallResponse(route, result) };
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
 * - An unsupported `MCP-Protocol-Version` header answers 400 with the
 *   `UnsupportedProtocolVersion` error listing the supported revisions.
 * - A modern request whose headers disagree with its body answers 400 with
 *   `HeaderMismatch`; a modern request for an unknown method answers 404.
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
    return jsonResponse(400, unsupportedProtocolError(null, header));
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
  for (const member of Array.isArray(message) ? message : [message]) {
    const mismatch = headerMismatch(member, request, header);
    if (mismatch !== undefined) {
      return jsonResponse(
        400,
        rpcError(messageId(member), JSON_RPC_ERRORS.headerMismatch, `Header mismatch: ${mismatch}`),
      );
    }
  }

  const gated = await options.preflight?.();
  if (gated !== undefined) return gated;

  if (Array.isArray(message)) {
    // Members run in order so per-subject rate limits count deterministically.
    const responses: JsonRpcResponse[] = [];
    for (const member of message) {
      const answered = await answer(member, options);
      if (answered !== undefined) responses.push(answered.response);
    }
    return responses.length === 0
      ? new Response(null, { status: 202 })
      : jsonResponse(200, responses);
  }

  const answered = await answer(message, options);
  if (answered === undefined) return new Response(null, { status: 202 });
  const { response, status } = answered;
  const malformed =
    response.error?.code === JSON_RPC_ERRORS.invalidRequest && response.result === undefined;
  return jsonResponse(status ?? (malformed ? 400 : 200), response);
}
