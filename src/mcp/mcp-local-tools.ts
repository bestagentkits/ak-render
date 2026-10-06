/**
 * The tool set the local stdio server runs.
 *
 * `catalog`, `describe` and `validate` are the shared pure tools. `render`
 * writes the HTML to a file under the server's working directory and `themes`
 * discovers project and user presets on disk, which is why this module, unlike
 * the shared definitions, may touch the filesystem. Nothing here touches the
 * network.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { compile } from '../render/render.js';
import { buildThemeCatalog, type ThemeCatalog } from '../theme/theme-catalog.js';
import { text } from './mcp-protocol.js';
import {
  CATALOG_TOOL,
  DESCRIBE_TOOL,
  LOCAL_RENDER_DEFINITION,
  type McpTool,
  optionalTheme,
  renderSummary,
  requireString,
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
Loop: call catalog once, describe only the block types you plan to use, validate the spec and fix every diagnostic by its JSON path, then render to a file.
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

const LOCAL_THEMES_TOOL: McpTool<McpContext> = {
  ...THEMES_DEFINITION,
  run: (_args, context) => themesResult(themeCatalogFor(context)),
};

/** Local tools, in the order an agent uses them. */
export const LOCAL_TOOLS: readonly McpTool<McpContext>[] = [
  CATALOG_TOOL,
  DESCRIBE_TOOL,
  VALIDATE_TOOL,
  LOCAL_RENDER_TOOL,
  LOCAL_THEMES_TOOL,
];
