/**
 * Stable entry for the stdio MCP server.
 *
 * The implementation lives in `src/mcp/`: protocol vocabulary, shared tool
 * contracts, JSON-RPC routing, and one module per transport. This file keeps
 * the original import path working for the CLI and for existing callers.
 */

export type { JsonRpcResponse } from './mcp/mcp-protocol.js';
export {
  handleMcpLine,
  handleMcpMessage,
  type McpContext,
  serveMcp,
} from './mcp/mcp-stdio-transport.js';
