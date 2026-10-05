/**
 * `ak-render mcp`: the compiler as a Model Context Protocol server over stdio.
 *
 * The tools mirror the CLI so an agent follows the same loop either way:
 * `catalog` → `describe` → `validate` → `render`. `render` writes the HTML to a
 * file and returns only a summary, because the point of the compiler is to keep
 * presentation bytes out of the model's context.
 *
 * The transport is newline-delimited JSON-RPC 2.0 on stdin/stdout, implemented
 * here without an SDK so the package keeps its single runtime dependency.
 * Nothing in this module touches the network.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import type { Interface } from 'node:readline';
import { createInterface } from 'node:readline';
import { isRenderError } from './errors.js';
import { catalog, describe } from './registry/registry.js';
import { compile } from './render/render.js';
import { validate } from './spec/validate.js';
import { buildThemeCatalog, type ThemeCatalog } from './theme/theme-catalog.js';
import { PACKAGE_NAME, VERSION } from './version.js';

/** Protocol revisions this server answers with; the newest is the default. */
const PROTOCOL_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'] as const;
const LATEST_PROTOCOL = PROTOCOL_VERSIONS[PROTOCOL_VERSIONS.length - 1];

const INSTRUCTIONS = `AK Render compiles a Page Spec (YAML or JSON) into one self-contained, offline HTML file.
Loop: call catalog once, describe only the block types you plan to use, validate the spec and fix every diagnostic by its JSON path, then render to a file.
Describe meaning, not presentation: the compiler owns layout, colour, typography and motion.`;

export interface McpContext {
  /** Directory relative `out` paths and theme discovery resolve against. */
  cwd: string;
  home: string;
}

interface JsonRpcRequest {
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

interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>, context: McpContext) => ToolResult;
}

const SPEC_INPUT = {
  description: 'The Page Spec: YAML or JSON text, or the parsed object.',
  anyOf: [{ type: 'string' }, { type: 'object' }],
};

const text = (value: unknown): ToolResult => ({
  content: [
    { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
  ],
});

const failure = (value: unknown): ToolResult => ({ ...text(value), isError: true });

const HTML_FILE = /\.html?$/iu;

function themeCatalogFor(context: McpContext): ThemeCatalog {
  return buildThemeCatalog({ cwd: context.cwd, home: context.home, discovery: true });
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value === '') {
    throw new TypeError(`"${key}" must be a non-empty string`);
  }
  return value;
}

const TOOLS: readonly Tool[] = [
  {
    name: 'catalog',
    description:
      'List every block type and action with a one-line summary. Call once per task, then describe only the types you use.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => text(catalog()),
  },
  {
    name: 'describe',
    description:
      'Full contract for one block type: props with defaults and bounds, slots, actions, runtime features, network needs and accessibility.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Block type from catalog, e.g. "hero".' },
      },
      required: ['type'],
      additionalProperties: false,
    },
    run: (args) => text(describe(requireString(args, 'type'))),
  },
  {
    name: 'validate',
    description:
      'Check a Page Spec without rendering. Returns ok plus diagnostics, each with a code and the JSON path to fix.',
    inputSchema: {
      type: 'object',
      properties: { spec: SPEC_INPUT },
      required: ['spec'],
      additionalProperties: false,
    },
    run: (args) => {
      const result = validate(args.spec, { source: '<spec>' });
      return result.ok ? text(result) : failure(result);
    },
  },
  {
    name: 'render',
    description:
      'Compile a Page Spec and write the standalone HTML to `out`. Returns a summary (bytes, hash, features, warnings), never the HTML itself.',
    inputSchema: {
      type: 'object',
      properties: {
        spec: SPEC_INPUT,
        out: {
          type: 'string',
          description:
            'HTML file to write (.html or .htm), relative to the server working directory.',
        },
        theme: { type: 'string', description: 'Optional preset name overriding the spec theme.' },
      },
      required: ['spec', 'out'],
      additionalProperties: false,
    },
    run: (args, context) => {
      const out = resolve(context.cwd, requireString(args, 'out'));
      // The tool only ever writes pages; refusing other extensions keeps a
      // misdirected call from replacing a config or source file with HTML.
      if (!HTML_FILE.test(out)) throw new TypeError('"out" must end in .html or .htm');
      const theme = args.theme;
      const result = compile(args.spec, {
        source: '<spec>',
        themeCatalog: themeCatalogFor(context),
        ...(typeof theme === 'string' && theme !== '' ? { theme } : {}),
      });
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, result.html, 'utf8');
      return text({
        out,
        bytes: result.bytes,
        hash: result.hash,
        title: result.ir.meta.title,
        theme: result.theme.name,
        features: result.features,
        nodes: result.ir.nodes.length,
        warnings: result.warnings,
      });
    },
  },
  {
    name: 'themes',
    description: 'List theme presets: built-ins plus project or user presets discovered on disk.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: (_args, context) => {
      const themes = themeCatalogFor(context);
      const presets = themes.sources
        .map(({ name, origin }) => ({ name, origin }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      // A preset file that failed to load is reported, not silently dropped.
      return text(themes.problems.length === 0 ? presets : { presets, problems: themes.problems });
    },
  },
];

function callTool(tool: Tool, params: Record<string, unknown>, context: McpContext): ToolResult {
  const args = (params.arguments ?? {}) as Record<string, unknown>;
  try {
    return tool.run(args, context);
  } catch (error) {
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
}

function isRequest(message: unknown): message is JsonRpcRequest {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { jsonrpc?: unknown }).jsonrpc === '2.0' &&
    typeof (message as { method?: unknown }).method === 'string'
  );
}

/**
 * Answer one JSON-RPC message. Returns `undefined` for notifications and for
 * responses sent to us, which need no reply.
 */
export function handleMcpMessage(
  message: unknown,
  context: McpContext,
): JsonRpcResponse | undefined {
  if (!isRequest(message)) {
    const id = (message as { id?: unknown } | null)?.id;
    const isResponse =
      typeof message === 'object' &&
      message !== null &&
      ('result' in message || 'error' in message);
    if (isResponse) return undefined;
    return {
      jsonrpc: '2.0',
      id: typeof id === 'string' || typeof id === 'number' ? id : null,
      error: { code: -32600, message: 'invalid request' },
    };
  }
  if (message.id === undefined) return undefined;
  // MCP requires a string or number id; null is reserved for error replies.
  if (message.id === null) {
    return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'invalid request' } };
  }
  const id = message.id;
  const params = message.params ?? {};
  const reply = (result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id, result });

  switch (message.method) {
    case 'initialize': {
      const requested = params.protocolVersion;
      const protocolVersion = PROTOCOL_VERSIONS.find((version) => version === requested);
      return reply({
        protocolVersion: protocolVersion ?? LATEST_PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: PACKAGE_NAME, version: VERSION },
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({
        tools: TOOLS.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      });
    case 'tools/call': {
      const tool = TOOLS.find((candidate) => candidate.name === params.name);
      if (tool === undefined) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: `unknown tool: ${String(params.name)}` },
        };
      }
      return reply(callTool(tool, params, context));
    }
    default:
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `method not found: ${message.method}` },
      };
  }
}

/** Answer one line of the stdio transport, or return `undefined` for no reply. */
export function handleMcpLine(line: string, context: McpContext): string | undefined {
  if (line.trim() === '') return undefined;
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'parse error' },
    });
  }
  // Revision 2025-03-26 allows batches: answer each member, omit the silent ones.
  if (Array.isArray(message)) {
    if (message.length === 0) {
      return JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'invalid request' },
      });
    }
    const responses = message
      .map((member) => handleMcpMessage(member, context))
      .filter((response) => response !== undefined);
    return responses.length === 0 ? undefined : JSON.stringify(responses);
  }
  const response = handleMcpMessage(message, context);
  return response === undefined ? undefined : JSON.stringify(response);
}

/** Serve MCP on stdin/stdout until stdin closes. Logs go to stderr only. */
export function serveMcp(context: McpContext = { cwd: process.cwd(), home: homedir() }): Interface {
  const lines = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
  lines.on('line', (line) => {
    const response = handleMcpLine(line, context);
    if (response !== undefined) process.stdout.write(`${response}\n`);
  });
  return lines;
}
