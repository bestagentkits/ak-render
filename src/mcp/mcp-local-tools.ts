/**
 * The tool set the local stdio server runs.
 *
 * `catalog`, `search-catalog`, `describe`, `recipes`, `recipe` and `validate`
 * are the shared pure tools. `render`
 * writes the HTML to a file under the server's working directory and `themes`
 * discovers project and user presets on disk, which is why this module, unlike
 * the shared definitions, may touch the filesystem. Nothing here touches the
 * network.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { compile } from '../render/render.js';
import { patchSpecFile } from '../spec/patch-file.js';
import { buildThemeCatalog, type ThemeCatalog } from '../theme/theme-catalog.js';
import { failure, ToolArgumentError, text } from './mcp-protocol.js';
import {
  AUDIT_MOTION_TOOL,
  CATALOG_TOOL,
  DESCRIBE_ICON_TOOL,
  DESCRIBE_TOOL,
  ICON_PACKS_TOOL,
  LOCAL_RENDER_DEFINITION,
  type McpTool,
  MOTIONS_TOOL,
  optionalTheme,
  PATCH_PROPERTIES,
  PATCH_TOOL,
  RECIPE_TOOL,
  RECIPES_TOOL,
  renderSummary,
  requireString,
  SEARCH_CATALOG_TOOL,
  SEARCH_ICONS_TOOL,
  THEMES_DEFINITION,
  themesResult,
  VALIDATE_TOOL,
} from './mcp-tool-definitions.js';

export interface McpContext {
  /** Directory relative `out` paths and theme discovery resolve against. */
  cwd: string;
  home: string;
}

export const LOCAL_INSTRUCTIONS = `AK Render compiles a Page Spec (YAML or JSON) into one self-contained, offline HTML file.
Loop: call catalog once (or search-catalog with a few words), describe only the block types you plan to use (several at once with types, compact: true for the short form), find icons by meaning with search-icons (describe-icon, icon-packs for detail), find motion recipes with motions, optionally start from a recipe (list them with recipes), validate the spec and fix every diagnostic by its JSON path (audit-motion checks the motion it names), then render to a file. For a later edit, patch the spec file in place (file plus ops, paths like /blocks/@<id>/title) instead of rewriting it.
Describe meaning, not presentation: the compiler owns layout, colour, typography and motion.`;

const HTML_FILE = /\.html?$/iu;

function themeCatalogFor(context: McpContext): ThemeCatalog {
  return buildThemeCatalog({ cwd: context.cwd, home: context.home, discovery: true });
}

const LOCAL_RENDER_TOOL: McpTool<McpContext> = {
  ...LOCAL_RENDER_DEFINITION,
  run: (args, context) => {
    const out = resolve(context.cwd, requireString(args, 'out'));
    // The tool only ever writes pages; refusing other extensions keeps a
    // misdirected call from replacing a config or source file with HTML.
    if (!HTML_FILE.test(out)) throw new TypeError('"out" must end in .html or .htm');
    const theme = optionalTheme(args);
    const result = compile(args.spec, {
      source: '<spec>',
      themeCatalog: themeCatalogFor(context),
      ...(theme === undefined ? {} : { theme }),
    });
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, result.html, 'utf8');
    return text({ out, ...renderSummary(result) });
  },
};

/**
 * Local `patch` also edits a spec file in place (`file`), so a small change
 * never resends the spec either way. The reply then carries no spec.
 */
const LOCAL_PATCH_TOOL: McpTool<McpContext> = {
  ...PATCH_TOOL,
  description:
    'Edit a spec file in place (file) or a Page Spec (spec) with JSON Patch ops. Returns the new hash for baseHash, the changes and diagnostics; a file reply carries no spec.',
  inputSchema: {
    ...PATCH_TOOL.inputSchema,
    properties: {
      ...(PATCH_TOOL.inputSchema.properties as Record<string, unknown>),
      file: {
        type: 'string',
        description:
          'Spec file (.yaml, .yml or .json) to edit in place, relative to the working directory.',
      },
      ...PATCH_PROPERTIES,
    },
    required: ['ops'],
  },
  run: (args, context) => {
    if (args.file === undefined) {
      if (args.spec === undefined) throw new ToolArgumentError('pass "spec" or "file"');
      return PATCH_TOOL.run(args, context);
    }
    if (args.spec !== undefined) throw new ToolArgumentError('pass "spec" or "file", not both');
    const file = resolve(context.cwd, requireString(args, 'file'));
    const baseHash =
      typeof args.baseHash === 'string' && args.baseHash !== '' ? args.baseHash : undefined;
    const result = {
      file,
      ...patchSpecFile(file, args.ops, baseHash === undefined ? {} : { baseHash }),
    };
    return result.ok ? text(result) : failure(result);
  },
};

const LOCAL_THEMES_TOOL: McpTool<McpContext> = {
  ...THEMES_DEFINITION,
  run: (_args, context) => themesResult(themeCatalogFor(context)),
};

/** Local tools, in the order an agent uses them. */
export const LOCAL_TOOLS: readonly McpTool<McpContext>[] = [
  CATALOG_TOOL,
  SEARCH_CATALOG_TOOL,
  DESCRIBE_TOOL,
  SEARCH_ICONS_TOOL,
  DESCRIBE_ICON_TOOL,
  ICON_PACKS_TOOL,
  MOTIONS_TOOL,
  RECIPES_TOOL,
  RECIPE_TOOL,
  VALIDATE_TOOL,
  LOCAL_PATCH_TOOL,
  AUDIT_MOTION_TOOL,
  LOCAL_RENDER_TOOL,
  LOCAL_THEMES_TOOL,
];
