/**
 * `ak-render mcp`: the compiler as a Model Context Protocol server over stdio.
 *
 * The tools mirror the CLI so an agent follows the same loop either way:
 * `catalog` → `describe` → `validate` → `render`. `render` writes the HTML to a
 * file and returns only a summary, because the point of the compiler is to keep
 * presentation bytes out of the model's context.
 *
 * The transport is newline-delimited JSON-RPC 2.0 on stdin/stdout, implemented
 * without an SDK so the package keeps its single runtime dependency. Protocol
 * routing and tool contracts are shared with the Streamable HTTP transport;
 * this module only frames lines and runs the local tools. Nothing here touches
 * the network.
 */

import { homedir } from 'node:os';
import type { Interface } from 'node:readline';
import { createInterface } from 'node:readline';
import { routeMcpMessage } from './mcp-json-rpc-dispatch.js';
import { LOCAL_INSTRUCTIONS, LOCAL_TOOLS, type McpContext } from './mcp-local-tools.js';
import {
  JSON_RPC_ERRORS,
  type JsonRpcResponse,
  rpcError,
  type ToolResult,
  toolErrorResult,
} from './mcp-protocol.js';

/**
 * Answer one JSON-RPC message. Resolves to `undefined` for notifications and
 * for responses sent to us, which need no reply. Most tools answer at once;
 * `audit-ui` with the publication preset waits for a browser.
 */
export async function handleMcpMessage(
  message: unknown,
  context: McpContext,
): Promise<JsonRpcResponse | undefined> {
  const route = routeMcpMessage(message, LOCAL_TOOLS, { instructions: LOCAL_INSTRUCTIONS });
  if (route.kind === 'silent') return undefined;
  if (route.kind === 'reply') return route.response;
  let result: ToolResult;
  try {
    result = await route.tool.run(route.args, context);
  } catch (error) {
    result = toolErrorResult(error);
  }
  return { jsonrpc: '2.0', id: route.id, result };
}

/** Answer one line of the stdio transport, or resolve to `undefined` for no reply. */
export async function handleMcpLine(
  line: string,
  context: McpContext,
): Promise<string | undefined> {
  if (line.trim() === '') return undefined;
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return JSON.stringify(rpcError(null, JSON_RPC_ERRORS.parse, 'parse error'));
  }
  // Revision 2025-03-26 allows batches: answer each member, omit the silent ones.
  if (Array.isArray(message)) {
    if (message.length === 0) {
      return JSON.stringify(rpcError(null, JSON_RPC_ERRORS.invalidRequest, 'invalid request'));
    }
    const responses = (
      await Promise.all(message.map((member) => handleMcpMessage(member, context)))
    ).filter((response) => response !== undefined);
    return responses.length === 0 ? undefined : JSON.stringify(responses);
  }
  const response = await handleMcpMessage(message, context);
  return response === undefined ? undefined : JSON.stringify(response);
}

/**
 * Serve MCP on stdin/stdout until stdin closes. Logs go to stderr only. A
 * reply is written when its call finishes; every reply carries its request id.
 */
export function serveMcp(context: McpContext = { cwd: process.cwd(), home: homedir() }): Interface {
  const lines = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
  lines.on('line', (line) => {
    handleMcpLine(line, context).then(
      (response) => {
        if (response !== undefined) process.stdout.write(`${response}\n`);
      },
      (error: unknown) => {
        // Tool failures are already replies; this is a bug in the transport itself.
        process.stderr.write(
          `ak-render mcp: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      },
    );
  });
  return lines;
}

export type { McpContext };
