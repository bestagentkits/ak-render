/**
 * The MCP tool contract: one source of truth for every transport.
 *
 * The stdio server and the Streamable HTTP server list tools from here. The
 * read-only tools (`catalog`, `search-catalog`, `describe`, `validate`) are
 * complete and pure, so both transports run the very same function. `render`
 * and `themes` differ only
 * in where their output goes or where presets come from, so this module owns
 * their descriptions, input schemas and result shapes, and each transport
 * supplies the side effect: a local file for stdio, a stored artifact for HTTP.
 *
 * No Node-only import is allowed here; the Worker bundles this module.
 */

import { BLOCK_CATEGORIES } from '../registry/block-module.js';
import { CATALOG_SEARCH_LIMITS, searchCatalog } from '../registry/catalog-search.js';
import { DESCRIBE_MANY_LIMIT, describeMany } from '../registry/describe-many.js';
import { catalog, describe, formatCatalogJson } from '../registry/registry.js';
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

/** An optional string argument: absent or empty means "not given". */
function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string') throw new ToolArgumentError(`"${key}" must be a string`);
  return value;
}

export const CATALOG_TOOL: McpTool<unknown> = {
  name: 'catalog',
  description:
    'List block types (category, tags, one-line summary) and actions. Pass category for one group. Call once per task, then describe only the types you use.',
  inputSchema: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        enum: [...BLOCK_CATEGORIES],
        description: 'Optional: list only this category.',
      },
    },
    additionalProperties: false,
  },
  run: (args) => {
    const category = optionalString(args, 'category');
    return text(formatCatalogJson(catalog(category === undefined ? {} : { category })));
  },
};

export const SEARCH_CATALOG_TOOL: McpTool<unknown> = {
  name: 'search-catalog',
  description:
    'Find block types by intent words, e.g. "sortable table" or "pricing". Returns up to 8 ranked hits with type, category, summary and score.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        maxLength: CATALOG_SEARCH_LIMITS.maxQueryLength,
        description: 'A few words describing what the block should do.',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
  run: (args) => text(searchCatalog(requireString(args, 'query'))),
};

/** The `types` argument: a non-empty list of non-empty strings. */
function requireTypes(args: Record<string, unknown>): string[] {
  const value = args.types;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > DESCRIBE_MANY_LIMIT ||
    !value.every((item): item is string => typeof item === 'string' && item !== '')
  ) {
    throw new ToolArgumentError(
      `"types" must be a list of 1 to ${DESCRIBE_MANY_LIMIT} non-empty strings`,
    );
  }
  return value;
}

export const DESCRIBE_TOOL: McpTool<unknown> = {
  name: 'describe',
  description:
    'Block contracts: props with defaults and bounds, slots, actions, features, network, accessibility. Pass type, or types (up to 12). compact: true gives one line per prop.',
  inputSchema: {
    type: 'object',
    properties: {
      type: { type: 'string', description: 'Block type from catalog, e.g. "hero".' },
      types: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: DESCRIBE_MANY_LIMIT,
        description: 'Several block types; the reply is a list in this order. Use instead of type.',
      },
      compact: {
        type: 'boolean',
        description: 'One line per prop (kind, required, enum); no prose or examples.',
      },
    },
    additionalProperties: false,
  },
  run: (args) => {
    if (args.compact !== undefined && typeof args.compact !== 'boolean') {
      throw new ToolArgumentError('"compact" must be a boolean');
    }
    const compact = args.compact === true;
    if (args.types !== undefined) {
      if (args.type !== undefined) {
        throw new ToolArgumentError('pass either "type" or "types", not both');
      }
      return text(describeMany(requireTypes(args), { compact }));
    }
    const type = requireString(args, 'type');
    // The single-type reply keeps its original shape: one contract object.
    return text(compact ? describeMany([type], { compact: true })[0] : describe(type));
  },
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
