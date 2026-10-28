/**
 * Transport-independent JSON-RPC routing for the MCP server.
 *
 * `routeMcpMessage` answers everything a server can answer without running a
 * tool (initialize, ping, tools/list, protocol errors) and hands a `tools/call`
 * back to the transport as a pending call. The transport decides how to run it:
 * stdio runs it synchronously, HTTP awaits it after authorization. That split
 * keeps one protocol implementation while letting each transport own its side
 * effects.
 *
 * The server is dual-era. A request whose `_meta` names a modern revision
 * (2026-07-28) is served statelessly by that revision: it must carry client
 * capabilities, results carry `resultType` and the server's identity, and
 * `server/discover` answers instead of `initialize`. Everything else is served
 * as before, so legacy clients that open with `initialize` keep working.
 */

import { PACKAGE_NAME, VERSION } from '../version.js';
import {
  isLegacyProtocol,
  isModernProtocol,
  JSON_RPC_ERRORS,
  type JsonRpcRequest,
  type JsonRpcResponse,
  LATEST_LEGACY_PROTOCOL,
  META_KEYS,
  metaProtocolVersion,
  requestMeta,
  rpcError,
  SUPPORTED_VERSIONS,
  type ToolResult,
  unsupportedProtocolError,
} from './mcp-protocol.js';
import type { McpToolDefinition } from './mcp-tool-definitions.js';

/** What a transport announces about itself in `initialize`. */
export interface McpServerDescription {
  /** Guidance for the model: the loop and what `render` returns on this transport. */
  instructions: string;
}

/**
 * How long a client may reuse a modern `tools/list` or `server/discover`
 * answer. The tool list changes only with a deploy, so five minutes keeps a
 * redeploy visible quickly while sparing repeated discovery calls.
 */
export const DISCOVERY_TTL_MS = 300_000;

/** The outcome of routing one JSON-RPC message. */
export type McpRoute<T extends McpToolDefinition> =
  | {
      kind: 'reply';
      response: JsonRpcResponse;
      /** HTTP status a modern request's error maps to; absent means 200. */
      status?: number;
    }
  | { kind: 'silent' }
  | {
      kind: 'call';
      id: string | number;
      tool: T;
      args: Record<string, unknown>;
      /** True when the request named a modern revision in `_meta`. */
      modern: boolean;
    };

const SERVER_INFO = { name: PACKAGE_NAME, version: VERSION };

/** Shape a result for the modern era: `resultType` plus the server's identity. */
function modernResult(result: object): Record<string, unknown> {
  const meta = (result as { _meta?: Record<string, unknown> })._meta;
  return {
    resultType: 'complete',
    ...result,
    _meta: { ...meta, [META_KEYS.serverInfo]: SERVER_INFO },
  };
}

/** The JSON-RPC response for a tool call a transport ran to completion. */
export function toolCallResponse(
  route: { id: string | number; modern: boolean },
  result: ToolResult,
): JsonRpcResponse {
  return { jsonrpc: '2.0', id: route.id, result: route.modern ? modernResult(result) : result };
}

function isRequest(message: unknown): message is JsonRpcRequest {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { jsonrpc?: unknown }).jsonrpc === '2.0' &&
    typeof (message as { method?: unknown }).method === 'string'
  );
}

/** True when the message is a JSON-RPC response sent to us, which needs no reply. */
export function isJsonRpcResponse(message: unknown): boolean {
  return (
    typeof message === 'object' && message !== null && ('result' in message || 'error' in message)
  );
}

/**
 * Route one JSON-RPC message against a tool list. Notifications and responses
 * sent to us are silent; everything else either gets a reply now or becomes a
 * pending tool call.
 */
export function routeMcpMessage<T extends McpToolDefinition>(
  message: unknown,
  tools: readonly T[],
  server: McpServerDescription,
): McpRoute<T> {
  if (!isRequest(message)) {
    if (isJsonRpcResponse(message)) return { kind: 'silent' };
    const id = (message as { id?: unknown } | null)?.id;
    return {
      kind: 'reply',
      response: rpcError(
        typeof id === 'string' || typeof id === 'number' ? id : null,
        JSON_RPC_ERRORS.invalidRequest,
        'invalid request',
      ),
    };
  }
  if (message.id === undefined) return { kind: 'silent' };
  // MCP requires a string or number id; null is reserved for error replies.
  if (message.id === null) {
    return {
      kind: 'reply',
      response: rpcError(null, JSON_RPC_ERRORS.invalidRequest, 'invalid request'),
    };
  }
  const id = message.id;
  const params = message.params ?? {};
  const requested = metaProtocolVersion(message);
  const modern = isModernProtocol(requested);

  // A request that names a revision in `_meta` is either modern, a legacy
  // revision (served as legacy: the handshake was never stateful here), or one
  // this server does not speak.
  if (requested !== undefined && typeof requested !== 'string') {
    return {
      kind: 'reply',
      response: rpcError(
        id,
        JSON_RPC_ERRORS.invalidParams,
        `_meta field ${META_KEYS.protocolVersion} must be a string`,
      ),
      status: 400,
    };
  }
  if (requested !== undefined && !modern && !isLegacyProtocol(requested)) {
    return { kind: 'reply', response: unsupportedProtocolError(id, requested), status: 400 };
  }
  // `server/discover` exists only in the modern era; a legacy revision has no
  // such method, which is not the same as an unsupported revision.
  if (message.method === 'server/discover' && requested !== undefined && !modern) {
    return {
      kind: 'reply',
      response: rpcError(id, JSON_RPC_ERRORS.methodNotFound, 'method not found: server/discover'),
    };
  }
  if (modern) {
    const capabilities = requestMeta(message)?.[META_KEYS.clientCapabilities];
    if (typeof capabilities !== 'object' || capabilities === null || Array.isArray(capabilities)) {
      return {
        kind: 'reply',
        response: rpcError(
          id,
          JSON_RPC_ERRORS.invalidParams,
          `missing _meta field ${META_KEYS.clientCapabilities}`,
        ),
        status: 400,
      };
    }
  } else if (message.method === 'server/discover') {
    return {
      kind: 'reply',
      response: rpcError(
        id,
        JSON_RPC_ERRORS.invalidParams,
        `missing _meta field ${META_KEYS.protocolVersion}`,
      ),
      status: 400,
    };
  }

  const reply = (result: Record<string, unknown>): McpRoute<T> => ({
    kind: 'reply',
    response: { jsonrpc: '2.0', id, result: modern ? modernResult(result) : result },
  });

  switch (message.method) {
    case 'initialize': {
      // A handshake can only select a legacy revision; revision 2026-07-28
      // removed it.
      if (modern) break;
      const asked = params.protocolVersion;
      return {
        kind: 'reply',
        response: {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: isLegacyProtocol(asked) ? asked : LATEST_LEGACY_PROTOCOL,
            capabilities: { tools: { listChanged: false } },
            serverInfo: SERVER_INFO,
            instructions: server.instructions,
          },
        },
      };
    }
    case 'server/discover':
      return reply({
        supportedVersions: SUPPORTED_VERSIONS,
        capabilities: { tools: {} },
        instructions: server.instructions,
        ttlMs: DISCOVERY_TTL_MS,
        cacheScope: 'public',
      });
    case 'ping':
      // Revision 2026-07-28 removed ping.
      if (modern) break;
      return reply({});
    case 'tools/list':
      return reply({
        tools: tools.map(({ name, description, inputSchema, annotations }) => ({
          name,
          description,
          inputSchema,
          annotations,
        })),
        ...(modern ? { ttlMs: DISCOVERY_TTL_MS, cacheScope: 'public' } : {}),
      });
    case 'tools/call': {
      const tool = tools.find((candidate) => candidate.name === params.name);
      if (tool === undefined) {
        return {
          kind: 'reply',
          response: rpcError(
            id,
            JSON_RPC_ERRORS.invalidParams,
            `unknown tool: ${String(params.name)}`,
          ),
        };
      }
      const args = params.arguments;
      return {
        kind: 'call',
        id,
        tool,
        modern,
        args:
          typeof args === 'object' && args !== null && !Array.isArray(args)
            ? (args as Record<string, unknown>)
            : {},
      };
    }
  }
  // The modern Streamable HTTP transport answers an unknown method with 404.
  return {
    kind: 'reply',
    response: rpcError(id, JSON_RPC_ERRORS.methodNotFound, `method not found: ${message.method}`),
    ...(modern ? { status: 404 } : {}),
  };
}
