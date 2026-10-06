/**
 * Transport-independent JSON-RPC routing for the MCP server.
 *
 * `routeMcpMessage` answers everything a server can answer without running a
 * tool (initialize, ping, tools/list, protocol errors) and hands a `tools/call`
 * back to the transport as a pending call. The transport decides how to run it:
 * stdio runs it synchronously, HTTP awaits it after authorization. That split
 * keeps one protocol implementation while letting each transport own its side
 * effects.
 */

import { PACKAGE_NAME, VERSION } from '../version.js';
import {
  isSupportedProtocol,
  JSON_RPC_ERRORS,
  type JsonRpcRequest,
  type JsonRpcResponse,
  LATEST_PROTOCOL,
  rpcError,
} from './mcp-protocol.js';
import type { McpToolDefinition } from './mcp-tool-definitions.js';

/** What a transport announces about itself in `initialize`. */
export interface McpServerDescription {
  /** Guidance for the model: the loop and what `render` returns on this transport. */
  instructions: string;
}

/** The outcome of routing one JSON-RPC message. */
export type McpRoute<T extends McpToolDefinition> =
  | { kind: 'reply'; response: JsonRpcResponse }
  | { kind: 'silent' }
  | { kind: 'call'; id: string | number; tool: T; args: Record<string, unknown> };

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
  const reply = (result: unknown): McpRoute<T> => ({
    kind: 'reply',
    response: { jsonrpc: '2.0', id, result },
  });

  switch (message.method) {
    case 'initialize': {
      const requested = params.protocolVersion;
      return reply({
        protocolVersion: isSupportedProtocol(requested) ? requested : LATEST_PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: PACKAGE_NAME, version: VERSION },
        instructions: server.instructions,
      });
    }
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({
        tools: tools.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
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
        args:
          typeof args === 'object' && args !== null && !Array.isArray(args)
            ? (args as Record<string, unknown>)
            : {},
      };
    }
    default:
      return {
        kind: 'reply',
        response: rpcError(
          id,
          JSON_RPC_ERRORS.methodNotFound,
          `method not found: ${message.method}`,
        ),
      };
  }
}
