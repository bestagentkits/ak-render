/**
 * The MCP tool contract: one source of truth for every transport.
 *
 * The stdio server and the Streamable HTTP server list tools from here. The
 * read-only tools (`catalog`, `describe`, `validate`) are complete and pure, so
 * both transports run the very same function. `render` and `themes` differ only
 * in where their output goes or where presets come from, so this module owns
 * their descriptions, input schemas and result shapes, and each transport
 * supplies the side effect: a local file for stdio, a stored artifact for HTTP.
 *
 * No Node-only import is allowed here; the Worker bundles this module.
 */

import { catalog, describe } from '../registry/registry.js';
import type { CompileResult } from '../render/render.js';
import { validate } from '../spec/validate.js';
import { builtinPresetEntries } from '../theme/presets.js';
import type { ThemeCatalog } from '../theme/theme-catalog.js';
import { failure, ToolArgumentError, type ToolResult, text } from './mcp-protocol.js';

/** What `tools/list` announces for one tool. */
export interface McpToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

/**
 * A runnable tool. `C` is the transport's per-call context; `R` lets the HTTP
 * transport run asynchronous tools while stdio stays synchronous.
 */
export interface McpTool<C, R extends ToolResult | Promise<ToolResult> = ToolResult>
  extends McpToolDefinition {
  run: (args: Record<string, unknown>, context: C) => R;
}

const SPEC_INPUT = {
  description: 'The Page Spec: YAML or JSON text, or the parsed object.',
  anyOf: [{ type: 'string' }, { type: 'object' }],
};

const THEME_INPUT = {
  type: 'string',
  description: 'Optional preset name overriding the spec theme.',
};

const NO_INPUT = { type: 'object', properties: {}, additionalProperties: false };

export function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value === '') {
    throw new ToolArgumentError(`"${key}" must be a non-empty string`);
  }
  return value;
}

/** The optional `theme` argument, normalized: an empty string means "not given". */
export function optionalTheme(args: Record<string, unknown>): string | undefined {
  const theme = args.theme;
  return typeof theme === 'string' && theme !== '' ? theme : undefined;
}

export const CATALOG_TOOL: McpTool<unknown> = {
  name: 'catalog',
  description:
    'List every block type and action with a one-line summary. Call once per task, then describe only the types you use.',
  inputSchema: NO_INPUT,
  run: () => text(catalog()),
};

export const DESCRIBE_TOOL: McpTool<unknown> = {
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
};

export const VALIDATE_TOOL: McpTool<unknown> = {
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
};

/** `render` as the local stdio server runs it: the HTML goes to a file. */
export const LOCAL_RENDER_DEFINITION: McpToolDefinition = {
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
          'HTML file to write (.html or .htm). A relative path resolves against the server working directory; an absolute path is used as given.',
      },
      theme: THEME_INPUT,
    },
    required: ['spec', 'out'],
    additionalProperties: false,
  },
};

/**
 * `render` as a remote server runs it. A remote server cannot write into the
 * caller's filesystem, so the artifact is stored behind a URL instead and the
 * reply is the same compact summary plus that URL.
 */
export const REMOTE_RENDER_DEFINITION: McpToolDefinition = {
  name: 'render',
  description:
    'Compile a Page Spec and store the standalone HTML behind a URL. Returns a summary (bytes, hash, features, warnings, artifactUrl, expiresAt), never the HTML itself. The artifact is short-lived unless `share` is true.',
  inputSchema: {
    type: 'object',
    properties: {
      spec: SPEC_INPUT,
      theme: THEME_INPUT,
      share: {
        type: 'boolean',
        description:
          'Publish the artifact as an expiring share link instead of a short-lived one. Requires the share grant.',
      },
    },
    required: ['spec'],
    additionalProperties: false,
  },
};

export const THEMES_DEFINITION: McpToolDefinition = {
  name: 'themes',
  description:
    'List theme presets (built-ins plus project or user presets discovered on disk) and any preset file that failed to load.',
  inputSchema: NO_INPUT,
};

/** The compact render summary every transport returns instead of the HTML. */
export interface RenderSummary {
  bytes: number;
  hash: string;
  title: string;
  theme: string;
  features: CompileResult['features'];
  nodes: number;
  warnings: CompileResult['warnings'];
}

export function renderSummary(result: CompileResult): RenderSummary {
  return {
    bytes: result.bytes,
    hash: result.hash,
    title: result.ir.meta.title,
    theme: result.theme.name,
    features: result.features,
    nodes: result.ir.nodes.length,
    warnings: result.warnings,
  };
}

/** The `themes` reply for a catalog, sorted by name. */
export function themesResult(themes: Pick<ThemeCatalog, 'sources' | 'problems'>): ToolResult {
  const presets = themes.sources
    .map(({ name, origin }) => ({ name, origin }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  // A preset file that failed to load is reported, not silently dropped.
  return text({ presets, problems: themes.problems });
}

/**
 * `themes` for a server with no project or user presets on disk, such as a
 * remote one: the built-in presets, in the same reply shape as the local tool.
 */
export const BUILTIN_THEMES_TOOL: McpTool<unknown> = {
  name: 'themes',
  description: 'List the built-in theme presets this server renders with.',
  inputSchema: NO_INPUT,
  run: () =>
    themesResult({
      sources: Object.values(builtinPresetEntries()).map(({ name, origin }) => ({ name, origin })),
      problems: [],
    }),
};
