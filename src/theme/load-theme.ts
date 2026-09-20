/**
 * Theme resolution.
 *
 * A preset is resolved through its `extends` chain into a complete light and
 * dark token set, then emitted as CSS custom properties. This is the only place
 * a theme becomes CSS, and it can only emit declarations built from validated
 * token values — which is what makes "themes are typed data, never CSS" a
 * property of the implementation rather than a promise.
 *
 * Nonces and font policy are deliberately absent: nothing here can reference a
 * remote font, so the emitted artifact never needs a webfont licence.
 */

import { type Diagnostic, DiagnosticBag } from '../diagnostics.js';
import { RenderError } from '../errors.js';
import { DEFAULT_PRESET } from './presets.js';
import { builtinThemeCatalog, catalogPresetNames, type ThemeCatalog } from './theme-catalog.js';
import {
  TOKEN_SPECS,
  type Tokens,
  tokenCssValue,
  tokenVariable,
  validateTokenValue,
} from './tokens.js';

export interface ThemeInput {
  preset?: string;
  extends?: string;
  tokens?: Record<string, unknown>;
  dark?: Record<string, unknown>;
}

export interface ResolvedTheme {
  /** Resolved preset name, which may be a user-defined name. */
  name: string;
  /** Root preset of the resolution chain. */
  base: string;
  version: number;
  description: string;
  /** Ordered chain from the root preset to the resolved preset. */
  chain: string[];
  light: Tokens;
  dark: Tokens;
  css: string;
  motionPolicy: string;
  density: string;
}

function declarations(tokens: Tokens): string {
  return Object.keys(tokens)
    .sort()
    .map((token) => `${tokenVariable(token)}:${tokenCssValue(token, tokens[token] ?? '')}`)
    .join(';');
}

function buildThemeCss(light: Tokens, dark: Tokens, motionDisabled: boolean): string {
  const parts = [`:root{${declarations(light)}}`];
  parts.push(
    `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${declarations(dark)}}}`,
  );
  parts.push(`:root[data-theme="dark"]{${declarations(dark)}}`);
  parts.push(`:root[data-theme="light"]{${declarations(light)}}`);
  if (motionDisabled) parts.push(':root{--ak-motion-duration:0ms}');
  parts.push('@media (prefers-reduced-motion: reduce){:root{--ak-motion-duration:0ms}}');
  return parts.join('\n');
}

function coerceInput(input: unknown): ThemeInput {
  if (input === undefined || input === null) return {};
  if (typeof input === 'string') return { preset: input };
  if (typeof input === 'object' && !Array.isArray(input)) return input as ThemeInput;
  return {};
}

interface ChainResult {
  tokens: Tokens;
  dark: Tokens;
  description: string;
  version: number;
  chain: string[];
}

function resolveChain(
  name: string,
  catalog: ThemeCatalog,
  bag: DiagnosticBag,
  trail: string[],
): ChainResult | undefined {
  const entry = catalog.entries[name];
  if (entry === undefined) {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path: 'theme.preset',
      message: `unknown theme preset "${name}"`,
      details: { known: catalogPresetNames(catalog) },
    });
    return undefined;
  }

  if (trail.includes(name)) {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path: 'theme.extends',
      message: `theme preset cycle: ${[...trail, name].join(' -> ')}`,
      details: { chain: [...trail, name] },
    });
    return undefined;
  }

  let inherited: ChainResult = { tokens: {}, dark: {}, description: '', version: 1, chain: [] };
  if (entry.extends !== undefined) {
    const parent = resolveChain(entry.extends, catalog, bag, [...trail, name]);
    if (parent === undefined) return undefined;
    inherited = parent;
  }

  const applyOverrides = (
    key: 'tokens' | 'dark',
    overrides: Record<string, string>,
  ): Record<string, string> => {
    const merged: Record<string, string> = {};
    for (const [token, value] of Object.entries(overrides)) {
      const problem = validateTokenValue(token, value);
      if (problem !== undefined) {
        bag.add({
          code: 'POLICY_VIOLATION',
          path: `theme.${key}.${token}`,
          message: `theme token "${token}": ${problem.message}`,
          details: {
            token,
            preset: entry.name,
            ...(entry.file === undefined ? {} : { file: entry.file }),
            known: Object.keys(TOKEN_SPECS).sort(),
          },
        });
        continue;
      }
      merged[token] = value;
    }
    return merged;
  };

  return {
    tokens: { ...inherited.tokens, ...applyOverrides('tokens', entry.tokens) },
    dark: { ...inherited.dark, ...applyOverrides('dark', entry.dark) },
    description: entry.description === '' ? inherited.description : entry.description,
    version: entry.version,
    chain: [...inherited.chain, entry.name],
  };
}

/** Fill any token a preset chain left unset, so a partial preset still renders. */
function completeTokens(
  tokens: Tokens,
  bag: DiagnosticBag,
  presetName: string,
  scheme: string,
): Tokens {
  const fallback = catalogFallbackTokens();
  const completed: Tokens = { ...tokens };
  for (const token of Object.keys(TOKEN_SPECS)) {
    if (completed[token] !== undefined) continue;
    const value = fallback[token];
    if (value === undefined) continue;
    completed[token] = value;
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      severity: 'warning',
      path: `theme.${scheme}.${token}`,
      message: `preset "${presetName}" does not declare "${token}"; the default preset value is used`,
      details: { token, preset: presetName },
    });
  }
  return completed;
}

let fallbackCache: Tokens | undefined;

function catalogFallbackTokens(): Tokens {
  if (fallbackCache === undefined) {
    const defaultEntry = builtinThemeCatalog().entries[DEFAULT_PRESET];
    fallbackCache = { ...(defaultEntry?.tokens ?? {}) };
  }
  return fallbackCache;
}

/**
 * Resolve a theme, reporting problems as diagnostics instead of throwing.
 */
export function resolveTheme(
  input: unknown,
  bag: DiagnosticBag,
  catalog: ThemeCatalog = builtinThemeCatalog(),
): ResolvedTheme | undefined {
  const themeInput = coerceInput(input);
  // `extends` names the preset to inherit from; `preset` names the result. An
  // inline theme therefore labels itself and inherits a catalog preset, while a
  // bare name (or a discovered preset file used without `extends`) resolves
  // directly through the catalog.
  const lookup = themeInput.extends ?? themeInput.preset ?? DEFAULT_PRESET;
  const root = resolveChain(lookup, catalog, bag, []);
  if (root === undefined) return undefined;
  const resolvedName = themeInput.preset ?? lookup;

  const lightOverrides = themeInput.tokens ?? {};
  const darkOverrides = themeInput.dark ?? {};
  const applyInput = (
    key: 'tokens' | 'dark',
    base: Tokens,
    overrides: Record<string, unknown>,
  ): Tokens => {
    const merged: Tokens = { ...base };
    for (const [token, value] of Object.entries(overrides)) {
      if (TOKEN_SPECS[token] === undefined) {
        bag.add({
          code: 'POLICY_VIOLATION',
          path: `theme.${key}.${token}`,
          message: `theme token "${token}": unknown token`,
          details: { token, known: Object.keys(TOKEN_SPECS).sort() },
        });
        continue;
      }
      const problem = validateTokenValue(token, value);
      if (problem !== undefined) {
        bag.add({
          code: 'POLICY_VIOLATION',
          path: `theme.${key}.${token}`,
          message: `theme token "${token}": ${problem.message}`,
          details: { token },
        });
        continue;
      }
      merged[token] = String(value);
    }
    return merged;
  };

  const light = completeTokens(
    applyInput('tokens', root.tokens, lightOverrides),
    bag,
    resolvedName,
    'tokens',
  );
  const dark = completeTokens(
    applyInput('dark', root.dark, darkOverrides),
    bag,
    resolvedName,
    'dark',
  );
  const motionPolicy = light['motion-policy'] ?? 'full';

  return {
    name: resolvedName,
    base: root.chain[0] ?? lookup,
    version: root.version,
    description: root.description,
    chain: root.chain,
    light,
    dark,
    css: buildThemeCss(light, dark, motionPolicy === 'none'),
    motionPolicy,
    density: light.density ?? 'comfortable',
  };
}

export interface LoadThemeOptions {
  catalog?: ThemeCatalog;
}

/**
 * Load and validate a theme preset.
 *
 * Accepts a preset name (`'blueprint'`), an object with `preset`, `extends`,
 * `tokens`, and `dark`, or a spec-shaped theme block. Throws a `RenderError`
 * carrying every token problem when the input is invalid.
 */
export function loadTheme(input?: unknown, options: LoadThemeOptions = {}): ResolvedTheme {
  const bag = new DiagnosticBag();
  const resolved = resolveTheme(input, bag, options.catalog ?? builtinThemeCatalog());
  const errors = bag.errors();
  const first = errors[0];
  if (resolved === undefined || first !== undefined) {
    if (first === undefined) {
      throw new RenderError('INTERNAL_ERROR', 'theme resolution failed without a diagnostic');
    }
    throw new RenderError(first.code, first.message, {
      path: first.path,
      details: { ...(first.details ?? {}), diagnostics: errors },
    });
  }
  return resolved;
}

/** Diagnostics produced while resolving a theme, including completion warnings. */
export function themeDiagnostics(input: unknown, catalog: ThemeCatalog): Diagnostic[] {
  const bag = new DiagnosticBag();
  resolveTheme(input, bag, catalog);
  return bag.list();
}

export function themePresetNames(catalog: ThemeCatalog = builtinThemeCatalog()): string[] {
  return catalogPresetNames(catalog);
}
