/**
 * The tool set the local stdio server runs.
 *
 * `catalog`, `search-catalog`, `describe`, `recipes`, `recipe`, `validate` and
 * `repair` are the shared pure tools. `audit-ui` adds the publication preset, which
 * launches a local browser. `render` and `compose` write the HTML to a file under the server's working directory and `themes`
 * discovers project and user presets on disk, which is why this module, unlike
 * the shared definitions, may touch the filesystem. Nothing here touches the
 * network.
 */

import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { auditUi } from '../audit/ui-audit.js';
import { compile } from '../render/render.js';
import { patchSpecFile } from '../spec/patch-file.js';
import { buildThemeCatalog, type ThemeCatalog } from '../theme/theme-catalog.js';
import { failure, ToolArgumentError, type ToolResult, text } from './mcp-protocol.js';
import {
  AUDIT_MOTION_TOOL,
  auditUiArgs,
  auditUiDefinition,
  CATALOG_TOOL,
  composeReplyExtras,
  composeToolStep,
  DESCRIBE_ICON_TOOL,
  DESCRIBE_TOOL,
  ICON_PACKS_TOOL,
  isComposeToolStep,
  LOCAL_COMPOSE_DEFINITION,
  LOCAL_FILE_WRITE,
  LOCAL_RENDER_DEFINITION,
  type McpTool,
  MOTIONS_TOOL,
  optionalTheme,
  PATCH_PROPERTIES,
  PATCH_TOOL,
  RECIPE_TOOL,
  RECIPES_TOOL,
  REPAIR_TOOL,
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
Fastest path: compose builds a whole page from a typed intent and content (e.g. investment-report) in one call; pass dryRun or returnSpec to get the Page Spec back for edits.
Full control: call catalog once (or search-catalog with a few words), describe only the block types you plan to use (several at once with types, compact: true for the short form), find icons by meaning with search-icons (describe-icon, icon-packs for detail), find motion recipes with motions, optionally start from a recipe (list them with recipes), validate the spec and fix every diagnostic by its JSON path (repair applies the safe fixes; validate with suggest: true lists the rest as JSON Patches; audit-motion checks the motion it names), then render to a file (themes lists the presets). audit-ui checks the page visually: quick needs no browser, publication runs a real one before you publish. For a later edit, patch the spec file in place (file plus ops, paths like /blocks/@<id>/title) instead of rewriting it.
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
 * `audit-ui` with both presets. Relative assets resolve against the server
 * working directory; the browser blocks every network request.
 */
const LOCAL_AUDIT_UI_TOOL: McpTool<McpContext, ToolResult | Promise<ToolResult>> = {
  ...auditUiDefinition(['quick', 'publication']),
  run: async (args, context) => {
    const parsed = auditUiArgs(args, ['quick', 'publication']);
    const report = await auditUi(parsed.input, {
      preset: parsed.preset,
      themeCatalog: themeCatalogFor(context),
      baseDir: context.cwd,
      ...(parsed.theme === undefined ? {} : { theme: parsed.theme }),
      ...(parsed.timeoutMs === undefined ? {} : { timeoutMs: parsed.timeoutMs }),
    });
    return text(report);
  },
};

const LOCAL_COMPOSE_TOOL: McpTool<McpContext> = {
  ...LOCAL_COMPOSE_DEFINITION,
  run: (args, context) => {
    const step = composeToolStep(args, themeCatalogFor(context));
    if (!isComposeToolStep(step)) return step;
    if (step.dryRun) return text({ ok: true, ...composeReplyExtras(step) });
    const out = resolve(context.cwd, requireString(args, 'out'));
    if (!HTML_FILE.test(out)) throw new TypeError('"out" must end in .html or .htm');
    const result = compile(step.composed.spec, {
      source: '<composed spec>',
      themeCatalog: themeCatalogFor(context),
    });
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, result.html, 'utf8');
    return text({ ok: true, out, ...renderSummary(result), ...composeReplyExtras(step) });
  },
};

/**
 * Local `patch` also edits a spec file in place (`file`), so a small change
 * never resends the spec either way. The reply then carries no spec.
 */
const LOCAL_PATCH_TOOL: McpTool<McpContext> = {
  ...PATCH_TOOL,
  // With `file` it rewrites that spec in place.
  annotations: LOCAL_FILE_WRITE,
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
    const file = specFileInside(context.cwd, requireString(args, 'file'));
    const baseHash =
      typeof args.baseHash === 'string' && args.baseHash !== '' ? args.baseHash : undefined;
    let patched: ReturnType<typeof patchSpecFile>;
    try {
      patched = patchSpecFile(file, args.ops, baseHash === undefined ? {} : { baseHash });
    } catch (error) {
      if (error instanceof TypeError) throw new ToolArgumentError(error.message);
      throw error;
    }
    const result = { file, ...patched };
    return result.ok ? text(result) : failure(result);
  },
};

/**
 * The real path of `file` when it lies under the working directory. An agent
 * edits the project's specs, never a file elsewhere on the machine.
 */
function specFileInside(cwd: string, file: string): string {
  let real: string;
  try {
    real = realpathSync(resolve(cwd, file));
  } catch {
    throw new ToolArgumentError(`${file} does not exist`);
  }
  const inside = relative(realpathSync(cwd), real);
  if (inside === '' || inside.split(sep)[0] === '..' || isAbsolute(inside)) {
    throw new ToolArgumentError(`${file} is outside the working directory`);
  }
  return real;
}

const LOCAL_THEMES_TOOL: McpTool<McpContext> = {
  ...THEMES_DEFINITION,
  run: (_args, context) => themesResult(themeCatalogFor(context)),
};

/** Local tools, in the order an agent uses them. */
export const LOCAL_TOOLS: readonly McpTool<McpContext, ToolResult | Promise<ToolResult>>[] = [
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
  REPAIR_TOOL,
  LOCAL_PATCH_TOOL,
  AUDIT_MOTION_TOOL,
  LOCAL_AUDIT_UI_TOOL,
  LOCAL_COMPOSE_TOOL,
  LOCAL_RENDER_TOOL,
  LOCAL_THEMES_TOOL,
];
