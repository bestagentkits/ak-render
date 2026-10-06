/**
 * Model Context Protocol vocabulary shared by every transport.
 *
 * Nothing here knows about stdio, HTTP, the filesystem or the network: these
 * are the JSON-RPC shapes, the protocol revisions this server speaks, and the
 * helpers that turn a tool outcome into an MCP tool result. Keeping them free of
 * Node-only imports is what lets the Cloudflare Worker bundle the same code.
 */

import { isRenderError } from '../errors.js';

/** Protocol revisions this server answers with; the newest is the default. */
export const PROTOCOL_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'] as const;
export type ProtocolVersion = (typeof PROTOCOL_VERSIONS)[number];
export const LATEST_PROTOCOL: ProtocolVersion = '2025-11-25';

/**
 * Revision a Streamable HTTP server assumes when a client omits the
 * `MCP-Protocol-Version` header, as the 2025-06-18 transport specifies.
 */
export const DEFAULT_HTTP_PROTOCOL: ProtocolVersion = '2025-03-26';

export function isSupportedProtocol(value: unknown): value is ProtocolVersion {
  return PROTOCOL_VERSIONS.some((version) => version === value);
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

/** JSON-RPC 2.0 error codes this server emits. */
export const JSON_RPC_ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
} as const;

export function rpcError(
  id: string | number | null,
  code: number,
  message: string,
): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

/** A successful tool result carrying text, or JSON pretty-printed as text. */
export const text = (value: unknown): ToolResult => ({
  content: [
    { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
  ],
});

/** A tool-level failure: the model sees it and can correct its call. */
export const failure = (value: unknown): ToolResult => ({ ...text(value), isError: true });

/**
 * Map a thrown error to a tool failure. A compiler error keeps its code, JSON
 * path and diagnostics so the caller can fix the spec; anything else reports
 * only its message.
 */
export function toolErrorResult(error: unknown): ToolResult {
  if (isRenderError(error)) {
    return failure({
      code: error.code,
      message: error.message,
      path: error.path ?? '$',
      ...(error.details?.diagnostics === undefined
        ? {}
        : { diagnostics: error.details.diagnostics }),
    });
  }
  return failure(error instanceof Error ? error.message : String(error));
}
