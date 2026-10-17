/**
 * The MCP tool contract: one source of truth for every transport.
 *
 * The stdio server and the Streamable HTTP server list tools from here. The
 * read-only tools (`catalog`, `search-catalog`, `describe`, `recipes`,
 * `recipe`, `validate`) are complete and pure, so both transports run the very same function. `render`
 * and `themes` differ only
 * in where their output goes or where presets come from, so this module owns
 * their descriptions, input schemas and result shapes, and each transport
 * supplies the side effect: a local file for stdio, a stored artifact for HTTP.
 *
 * No Node-only import is allowed here; the Worker bundles this module.
 */

import { auditUiQuick } from '../audit/ui-audit-quick.js';
import { UI_AUDIT_PRESETS, type UiAuditPreset } from '../audit/ui-audit-rules.js';
import {
  describeIcon,
  iconPackSummaries,
  isIconProblem,
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_LIMIT,
  SEARCH_MAX_QUERY_LENGTH,
  searchIcons,
} from '../icons/icon-catalog.js';
import { ICON_PACK_IDS, type IconPackId, isIconPack } from '../icons/icon-packs.js';
import { auditMotionHtml, auditMotionSpec } from '../motion/motion-audit.js';
import {
  describeMotion,
  MOTION_SEARCH_LIMITS,
  motionCatalog,
  searchMotions,
} from '../motion/motion-catalog.js';
import { recipe, recipes } from '../recipes/index.js';
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

export const SEARCH_ICONS_TOOL: McpTool<unknown> = {
  name: 'search-icons',
  description: `Find icons by meaning, in English or Vietnamese, e.g. "gauge" or "bieu do". Returns up to ${SEARCH_DEFAULT_LIMIT} short hits (id, packs); pass limit up to ${SEARCH_MAX_LIMIT}. Use the id as an icon prop. Never returns SVG.`,
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        maxLength: SEARCH_MAX_QUERY_LENGTH,
        description: 'A few words for the meaning, in English or Vietnamese.',
      },
      pack: { enum: [...ICON_PACK_IDS], description: 'Only icons this pack can draw.' },
      limit: { type: 'integer', minimum: 1, maximum: SEARCH_MAX_LIMIT },
    },
    required: ['query'],
    additionalProperties: false,
  },
  run: (args) => {
    const query = requireString(args, 'query');
    if (query.length > SEARCH_MAX_QUERY_LENGTH) {
      throw new ToolArgumentError(`"query" is longer than ${SEARCH_MAX_QUERY_LENGTH} characters`);
    }
    return text(searchIcons(query, iconSearchOptions(args)));
  },
};

function iconSearchOptions(args: Record<string, unknown>): { pack?: IconPackId; limit?: number } {
  const options: { pack?: IconPackId; limit?: number } = {};
  const pack = optionalString(args, 'pack');
  if (pack !== undefined) {
    if (!isIconPack(pack)) {
      throw new ToolArgumentError(`"pack" must be one of ${ICON_PACK_IDS.join(', ')}`);
    }
    options.pack = pack;
  }
  if (args.limit !== undefined) {
    if (
      typeof args.limit !== 'number' ||
      !Number.isInteger(args.limit) ||
      args.limit < 1 ||
      args.limit > SEARCH_MAX_LIMIT
    ) {
      throw new ToolArgumentError(`"limit" must be an integer from 1 to ${SEARCH_MAX_LIMIT}`);
    }
    options.limit = args.limit;
  }
  return options;
}

export const DESCRIBE_ICON_TOOL: McpTool<unknown> = {
  name: 'describe-icon',
  description:
    'Describe one icon id (a meaning like "gauge" or "pack:name"): packs, variants, fallback order, license, examples. Unknown ids get close suggestions. Never returns SVG.',
  inputSchema: {
    type: 'object',
    properties: {
      icon: { type: 'string', maxLength: 80, description: 'An icon id from search-icons.' },
    },
    required: ['icon'],
    additionalProperties: false,
  },
  run: (args) => {
    const id = requireString(args, 'icon');
    if (id.length > 80) throw new ToolArgumentError('"icon" is longer than 80 characters');
    const described = describeIcon(id);
    return isIconProblem(described)
      ? failure({ code: 'UNKNOWN_ICON', ...described })
      : text(described);
  },
};

export const ICON_PACKS_TOOL: McpTool<unknown> = {
  name: 'icon-packs',
  description:
    'List the bundled icon packs with their role, variants, glyph count, license, version and the theme icon profiles that use them.',
  inputSchema: NO_INPUT,
  run: () => text(iconPackSummaries()),
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

export const RECIPES_TOOL: McpTool<unknown> = {
  name: 'recipes',
  description:
    'List page recipes (name, summary, use cases, block types): complete starter specs for common pages such as dashboard or incident-report. Fetch one with recipe.',
  inputSchema: NO_INPUT,
  run: () => text(recipes()),
};

export const RECIPE_TOOL: McpTool<unknown> = {
  name: 'recipe',
  description:
    'Get one page recipe as a valid starter Page Spec in YAML. Replace its placeholder text and sample dataset rows, then validate and render.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Recipe name from recipes, e.g. "dashboard".' },
    },
    required: ['name'],
    additionalProperties: false,
  },
  run: (args) => text(recipe(requireString(args, 'name')).spec),
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

export const MOTIONS_TOOL: McpTool<unknown> = {
  name: 'motions',
  description:
    'Motion recipes for the block field motion. No arguments: one line each. query: rank recipes for an intent ("smooth tabs"). id: one recipe, compact: true for the short form. No CSS.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        maxLength: CATALOG_SEARCH_LIMITS.maxQueryLength,
        description: 'A few words for the motion intent.',
      },
      id: { type: 'string', maxLength: 64, description: 'A recipe id, e.g. "tabs-slide".' },
      compact: { type: 'boolean', description: 'With id: the short form.' },
    },
    additionalProperties: false,
  },
  run: (args) => {
    const query = optionalString(args, 'query');
    const id = optionalString(args, 'id');
    if (query !== undefined && id !== undefined) {
      throw new ToolArgumentError('pass either "query" or "id", not both');
    }
    if (args.compact !== undefined && typeof args.compact !== 'boolean') {
      throw new ToolArgumentError('"compact" must be a boolean');
    }
    if (id !== undefined) {
      if (id.length > 64) throw new ToolArgumentError('"id" is longer than 64 characters');
      return text(describeMotion(id, { compact: args.compact === true }));
    }
    if (query !== undefined) return text(searchMotions(query, MOTION_SEARCH_LIMITS.defaultHits));
    return text(motionCatalog());
  },
};

/** Compiled pages are a few hundred kilobytes; this bound only stops abuse. */
export const AUDIT_HTML_MAX_LENGTH = 8_000_000;

export const AUDIT_MOTION_TOOL: McpTool<unknown> = {
  name: 'audit-motion',
  description:
    'Audit motion. spec: authoritative checks on the normalized Page Spec. html: best-effort checks on a compiled page. Returns findings (rule, severity, path, fix), counts and an advisory score.',
  inputSchema: {
    type: 'object',
    properties: {
      spec: SPEC_INPUT,
      html: {
        type: 'string',
        maxLength: AUDIT_HTML_MAX_LENGTH,
        description: 'A compiled page; use instead of spec.',
      },
    },
    additionalProperties: false,
  },
  run: (args) => {
    if ((args.spec === undefined) === (args.html === undefined)) {
      throw new ToolArgumentError('pass exactly one of "spec" or "html"');
    }
    if (args.html !== undefined) {
      const html = requireString(args, 'html');
      if (html.length > AUDIT_HTML_MAX_LENGTH) {
        throw new ToolArgumentError(`"html" is longer than ${AUDIT_HTML_MAX_LENGTH} characters`);
      }
      return text(auditMotionHtml(html));
    }
    return text(auditMotionSpec(args.spec, { source: '<spec>' }));
  },
};

/** The bounds `audit-ui` accepts for its browser budget, in milliseconds. */
export const AUDIT_UI_TIMEOUT_LIMITS = { min: 1_000, max: 300_000 } as const;

/**
 * `audit-ui` for a server that runs `presets`. Only a server with a browser
 * offers `publication`, so a schema never advertises a preset it cannot run.
 */
export function auditUiDefinition(presets: readonly UiAuditPreset[]): McpToolDefinition {
  const publication = presets.includes('publication');
  return {
    name: 'audit-ui',
    description: publication
      ? 'Visual QA of the compiled page. quick: no browser. publication: real browser at 375/768/1440, light/dark, print, no-JS, reduced motion, network blocked. Findings carry rule, path, fix.'
      : 'Visual QA of the compiled page (quick preset: theme contrast, wide tables, long chart labels; no browser). Findings carry rule, severity, path and fix.',
    inputSchema: {
      type: 'object',
      properties: {
        spec: SPEC_INPUT,
        html: {
          type: 'string',
          maxLength: AUDIT_HTML_MAX_LENGTH,
          description: 'A compiled page; use instead of spec. Its scripts do not run.',
        },
        preset: { type: 'string', enum: [...presets], description: 'Default quick.' },
        theme: THEME_INPUT,
        ...(publication
          ? {
              timeoutMs: {
                type: 'integer',
                minimum: AUDIT_UI_TIMEOUT_LIMITS.min,
                maximum: AUDIT_UI_TIMEOUT_LIMITS.max,
                description: 'Browser budget for publication; default 60000.',
              },
            }
          : {}),
      },
      additionalProperties: false,
    },
  };
}

export interface AuditUiArgs {
  /** The spec, or the compiled HTML. */
  input: unknown;
  preset: UiAuditPreset;
  theme?: string;
  timeoutMs?: number;
}

/** Check `audit-ui` arguments against what this server runs. */
export function auditUiArgs(
  args: Record<string, unknown>,
  presets: readonly UiAuditPreset[],
): AuditUiArgs {
  if ((args.spec === undefined) === (args.html === undefined)) {
    throw new ToolArgumentError('pass exactly one of "spec" or "html"');
  }
  const preset = optionalString(args, 'preset') ?? 'quick';
  if (!(UI_AUDIT_PRESETS as readonly string[]).includes(preset)) {
    throw new ToolArgumentError(`"preset" must be one of ${UI_AUDIT_PRESETS.join(', ')}`);
  }
  if (!(presets as readonly string[]).includes(preset)) {
    throw new ToolArgumentError(
      `the ${preset} preset needs a browser, which this server does not run; use quick, or run ak-render audit-ui locally`,
    );
  }
  let input: unknown = args.spec;
  if (args.html !== undefined) {
    const html = requireString(args, 'html');
    if (html.length > AUDIT_HTML_MAX_LENGTH) {
      throw new ToolArgumentError(`"html" is longer than ${AUDIT_HTML_MAX_LENGTH} characters`);
    }
    if (!/^\uFEFF?\s*</u.test(html)) throw new ToolArgumentError('"html" must be an HTML document');
    input = html;
  }
  const timeoutMs = args.timeoutMs;
  if (
    timeoutMs !== undefined &&
    (typeof timeoutMs !== 'number' ||
      !Number.isInteger(timeoutMs) ||
      timeoutMs < AUDIT_UI_TIMEOUT_LIMITS.min ||
      timeoutMs > AUDIT_UI_TIMEOUT_LIMITS.max)
  ) {
    throw new ToolArgumentError(
      `"timeoutMs" must be an integer from ${AUDIT_UI_TIMEOUT_LIMITS.min} to ${AUDIT_UI_TIMEOUT_LIMITS.max}`,
    );
  }
  const theme = optionalTheme(args);
  return {
    input,
    preset: preset as UiAuditPreset,
    ...(theme === undefined ? {} : { theme }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
}

/** `audit-ui` for a server with no browser, such as a remote one: the quick preset only. */
export const AUDIT_UI_QUICK_TOOL: McpTool<unknown> = {
  ...auditUiDefinition(['quick']),
  run: (args) => {
    const parsed = auditUiArgs(args, ['quick']);
    return text(
      auditUiQuick(parsed.input, parsed.theme === undefined ? {} : { theme: parsed.theme }),
    );
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
    'Compile a Page Spec and store the HTML behind a URL. Returns a summary (bytes, hash, features, warnings, artifactUrl, expiresAt), never the HTML. Short-lived unless `share` is true.',
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
