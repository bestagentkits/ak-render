/**
 * Model Context Protocol vocabulary shared by every transport.
 *
 * Nothing here knows about stdio, HTTP, the filesystem or the network: these
 * are the JSON-RPC shapes, the protocol revisions this server speaks, and the
 * helpers that turn a tool outcome into an MCP tool result. Keeping them free of
 * Node-only imports is what lets the Cloudflare Worker bundle the same code.
 */

import { isRenderError } from '../errors.js';

/**
 * Revisions that open with an `initialize` handshake (the legacy era). A client
 * that sends `initialize` is answered with one of these.
 */
export const LEGACY_PROTOCOL_VERSIONS = [
  '2024-11-05',
  '2025-03-26',
  '2025-06-18',
  '2025-11-25',
] as const;

/**
 * Revisions with no handshake (the modern era): every request carries its
 * version and client capabilities in `_meta`, and `server/discover` replaces
 * `initialize` for up-front discovery.
 */
export const MODERN_PROTOCOL_VERSIONS = ['2026-07-28'] as const;

/** Every revision this server answers, oldest first. */
export const PROTOCOL_VERSIONS = [
  ...LEGACY_PROTOCOL_VERSIONS,
  ...MODERN_PROTOCOL_VERSIONS,
] as const;
export type LegacyProtocolVersion = (typeof LEGACY_PROTOCOL_VERSIONS)[number];
export type ModernProtocolVersion = (typeof MODERN_PROTOCOL_VERSIONS)[number];
export type ProtocolVersion = (typeof PROTOCOL_VERSIONS)[number];

/** The newest revision this server speaks. */
export const LATEST_PROTOCOL: ProtocolVersion = '2026-07-28';

/**
 * Revision `initialize` falls back to when the client asks for one this server
 * cannot negotiate there. A handshake can only select a legacy revision.
 */
export const LATEST_LEGACY_PROTOCOL: LegacyProtocolVersion = '2025-11-25';

/** Supported revisions newest first, as `server/discover` and version errors list them. */
export const SUPPORTED_VERSIONS: readonly ProtocolVersion[] = [...PROTOCOL_VERSIONS].reverse();

/**
 * Revision a Streamable HTTP server assumes when a client omits the
 * `MCP-Protocol-Version` header, as the 2025-06-18 transport specifies.
 */
export const DEFAULT_HTTP_PROTOCOL: ProtocolVersion = '2025-03-26';

export function isSupportedProtocol(value: unknown): value is ProtocolVersion {
  return PROTOCOL_VERSIONS.some((version) => version === value);
}

export function isLegacyProtocol(value: unknown): value is LegacyProtocolVersion {
  return LEGACY_PROTOCOL_VERSIONS.some((version) => version === value);
}

export function isModernProtocol(value: unknown): value is ModernProtocolVersion {
  return MODERN_PROTOCOL_VERSIONS.some((version) => version === value);
}

/**
 * JSON-RPC batching exists only in revision 2025-03-26 (and is tolerated for
 * 2024-11-05 clients); revision 2025-06-18 removed it. Revisions are ISO dates,
 * so string order is chronological order.
 */
export function protocolAllowsBatching(version: ProtocolVersion): boolean {
  return version < '2025-06-18';
}

/** Reserved `_meta` keys of the modern era. */
export const META_KEYS = {
  protocolVersion: 'io.modelcontextprotocol/protocolVersion',
  clientCapabilities: 'io.modelcontextprotocol/clientCapabilities',
  serverInfo: 'io.modelcontextprotocol/serverInfo',
} as const;

/** The `_meta` object of a message's params, when it has one. */
export function requestMeta(message: unknown): Record<string, unknown> | undefined {
  const params = (message as { params?: unknown } | null)?.params;
  if (typeof params !== 'object' || params === null) return undefined;
  const meta = (params as { _meta?: unknown })._meta;
  return typeof meta === 'object' && meta !== null && !Array.isArray(meta)
    ? (meta as Record<string, unknown>)
    : undefined;
}

/** The protocol revision a message names in `_meta`, if any. */
export function metaProtocolVersion(message: unknown): unknown {
  return requestMeta(message)?.[META_KEYS.protocolVersion];
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
  error?: { code: number; message: string; data?: unknown };
}

/** JSON-RPC 2.0 error codes this server emits. */
export const JSON_RPC_ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  /** Revision 2026-07-28: an HTTP header disagrees with the body, or is missing. */
  headerMismatch: -32020,
  /** Revision 2026-07-28: the requested protocol revision is not served here. */
  unsupportedProtocolVersion: -32022,
} as const;

export function rpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

/** The `UnsupportedProtocolVersion` error, listing what this server does support. */
export function unsupportedProtocolError(
  id: string | number | null,
  requested: unknown,
): JsonRpcResponse {
  return rpcError(id, JSON_RPC_ERRORS.unsupportedProtocolVersion, 'Unsupported protocol version', {
    supported: SUPPORTED_VERSIONS,
    requested,
  });
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
 * A tool argument the caller got wrong. Its message is written for the caller,
 * so every transport may show it, unlike an arbitrary runtime error.
 */
export class ToolArgumentError extends TypeError {
  override readonly name = 'ToolArgumentError';
}

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

/**
 * Map a thrown error to a tool failure a hosted server may show a stranger.
 * Compiler errors and argument errors keep their message, because the caller
 * needs it to fix the call; anything else (a storage, binding or runtime fault)
 * becomes a generic `INTERNAL_ERROR`, so no internal message leaves the server.
 */
export function publicToolErrorResult(error: unknown): ToolResult {
  if (isRenderError(error) || error instanceof ToolArgumentError) return toolErrorResult(error);
  return failure({ code: 'INTERNAL_ERROR', message: 'the tool failed; try again later' });
}
