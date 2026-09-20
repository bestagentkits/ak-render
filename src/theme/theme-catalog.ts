/**
 * Theme catalog: built-in presets plus presets authored as files.
 *
 * A preset file is data with a fixed shape. It can extend another preset and
 * override declared tokens; it cannot introduce a token, a selector, or a
 * declaration, so a shared team preset is exactly as constrained as a built-in
 * one. Precedence is explicit: built-in < user < project < explicitly named
 * files, which is what makes a project-level override predictable.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { RenderError } from '../errors.js';
import { isPlainObject } from '../json.js';
import { parseSpec } from '../spec/parse.js';
import { builtinPresetEntries, type PresetEntry } from './presets.js';
import { TOKEN_SPECS, validateTokenValue } from './tokens.js';

export const PRESET_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const THEME_DIRECTORIES = ['.ak-render/themes', '.config/ak-render/themes'] as const;
const PRESET_FILE_EXTENSIONS = ['.yaml', '.yml', '.json'] as const;
const ALLOWED_PRESET_KEYS = [
  'name',
  'version',
  'description',
  'extends',
  'tokens',
  'dark',
] as const;

export interface PresetSource {
  name: string;
  origin: PresetEntry['origin'];
  file?: string;
}

export interface ThemeCatalog {
  entries: Record<string, PresetEntry>;
  sources: PresetSource[];
  /** Problems found while discovering presets; surfaced, never silently skipped. */
  problems: { path: string; message: string }[];
}

/** Built-in-only catalog. */
export function builtinThemeCatalog(): ThemeCatalog {
  const entries = builtinPresetEntries();
  return {
    entries,
    sources: Object.values(entries).map((entry) => ({ name: entry.name, origin: entry.origin })),
    problems: [],
  };
}

function presetNameFromFile(file: string): string {
  return basename(file, extname(file));
}

function fail(message: string, path: string, details?: Record<string, unknown>): never {
  throw new RenderError('SPEC_VALIDATION_ERROR', message, {
    path,
    ...(details === undefined ? {} : { details }),
  });
}

/**
 * Validate a preset document.
 *
 * Unknown keys and unknown tokens are errors: a preset that silently ignores a
 * misspelled token would produce a page with a silently wrong theme.
 */
export function parsePresetDocument(
  value: unknown,
  options: { file?: string; origin?: PresetEntry['origin']; name?: string } = {},
): PresetEntry {
  const origin = options.origin ?? 'file';
  const path = options.file ?? '<theme>';
  if (!isPlainObject(value)) {
    fail('a preset must be an object', path);
  }
  for (const key of Object.keys(value)) {
    if (!(ALLOWED_PRESET_KEYS as readonly string[]).includes(key)) {
      fail(`unknown preset field "${key}"`, `${path}#${key}`, {
        allowed: [...ALLOWED_PRESET_KEYS],
      });
    }
  }

  const declaredName = value.name;
  const name =
    typeof declaredName === 'string' ? declaredName : (options.name ?? presetNameFromFile(path));
  if (!PRESET_NAME_PATTERN.test(name)) {
    fail(`"${name}" is not a valid preset name`, `${path}#name`);
  }

  const extendsValue = value.extends;
  if (extendsValue !== undefined) {
    if (typeof extendsValue !== 'string' || !PRESET_NAME_PATTERN.test(extendsValue)) {
      fail(`"${String(extendsValue)}" is not a valid preset name to extend`, `${path}#extends`);
    }
  }

  const version = value.version;
  if (
    version !== undefined &&
    (typeof version !== 'number' || !Number.isInteger(version) || version < 1)
  ) {
    fail('preset version must be a positive integer', `${path}#version`);
  }

  const description = value.description;
  if (description !== undefined && typeof description !== 'string') {
    fail('preset description must be a string', `${path}#description`);
  }

  const readTokens = (key: 'tokens' | 'dark'): Record<string, string> => {
    const raw = value[key];
    if (raw === undefined) return {};
    if (!isPlainObject(raw)) fail(`${key} must be an object of token values`, `${path}#${key}`);
    const tokens: Record<string, string> = {};
    for (const [token, tokenValue] of Object.entries(raw)) {
      if (TOKEN_SPECS[token] === undefined) {
        fail(`unknown theme token "${token}"`, `${path}#${key}.${token}`, {
          known: Object.keys(TOKEN_SPECS).sort(),
        });
      }
      const problem = validateTokenValue(token, tokenValue);
      if (problem !== undefined) {
        throw new RenderError('POLICY_VIOLATION', `theme token "${token}": ${problem.message}`, {
          path: `${path}#${key}.${token}`,
          details: { token },
        });
      }
      tokens[token] = String(tokenValue);
    }
    return tokens;
  };

  const entry: PresetEntry = {
    name,
    version: typeof version === 'number' ? version : 1,
    description: typeof description === 'string' ? description : 'Custom theme preset.',
    tokens: readTokens('tokens'),
    dark: readTokens('dark'),
    origin,
  };
  if (options.file !== undefined) entry.file = options.file;
  if (typeof extendsValue === 'string') entry.extends = extendsValue;
  return entry;
}

/** Load and validate one preset file. Throws a `RenderError` when it is invalid. */
export function loadPresetFile(file: string, origin: PresetEntry['origin'] = 'file'): PresetEntry {
  if (!existsSync(file)) {
    throw new RenderError('SPEC_VALIDATION_ERROR', `preset file not found: ${file}`, {
      path: file,
    });
  }
  const text = readFileSync(file, 'utf8');
  const document = parseSpec(text, { source: file });
  return parsePresetDocument(document, { file, origin, name: presetNameFromFile(file) });
}

/** Directories searched for presets, in increasing precedence. */
export function themeSearchDirectories(options: { cwd?: string; home?: string } = {}): {
  user: string[];
  project: string[];
} {
  const home = options.home ?? homedir();
  const cwd = options.cwd ?? process.cwd();
  return {
    user: THEME_DIRECTORIES.map((directory) => join(home, directory)),
    project: THEME_DIRECTORIES.map((directory) => join(cwd, directory)),
  };
}

function discoverIn(directory: string): string[] {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) return [];
  return readdirSync(directory)
    .filter((name) => (PRESET_FILE_EXTENSIONS as readonly string[]).includes(extname(name)))
    .sort()
    .map((name) => join(directory, name));
}

export interface ThemeCatalogOptions {
  cwd?: string;
  home?: string;
  /** Explicit preset files; highest precedence. */
  files?: string[];
  /** Set false to use built-ins only. */
  discovery?: boolean;
}

/**
 * Build a catalog from built-ins, discovered project and user presets, and any
 * explicitly named files. A malformed file becomes a recorded problem rather
 * than a crash, so one bad team preset does not make unrelated pages
 * uncompilable.
 */
export function buildThemeCatalog(options: ThemeCatalogOptions = {}): ThemeCatalog {
  const catalog = builtinThemeCatalog();
  if (options.discovery === false) return catalog;

  const directories = themeSearchDirectories(options);
  const sources: Array<{ file: string; origin: PresetEntry['origin'] }> = [];
  for (const directory of directories.user) {
    for (const file of discoverIn(directory)) sources.push({ file, origin: 'user' });
  }
  for (const directory of directories.project) {
    for (const file of discoverIn(directory)) sources.push({ file, origin: 'project' });
  }
  for (const file of options.files ?? []) sources.push({ file, origin: 'file' });

  for (const source of sources) {
    try {
      const entry = loadPresetFile(source.file, source.origin);
      catalog.entries[entry.name] = entry;
      catalog.sources.push({
        name: entry.name,
        origin: source.origin,
        file: source.file,
      });
    } catch (error) {
      catalog.problems.push({
        path: source.file,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return catalog;
}

/** Preset names in a catalog, sorted. */
export function catalogPresetNames(catalog: ThemeCatalog): string[] {
  return Object.keys(catalog.entries).sort();
}

export { builtinPresetEntries };
