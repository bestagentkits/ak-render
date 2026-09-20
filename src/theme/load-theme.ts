/**
 * Theme resolution.
 *
 * `loadTheme` validates a typed preset input, resolves `extends`, applies token
 * overrides, and emits the token declarations as CSS custom properties. It is
 * the only place a theme becomes CSS, and it can only emit declarations built
 * from validated token values.
 */

import { DiagnosticBag } from '../diagnostics.js';
import { RenderError } from '../errors.js';
import { DEFAULT_PRESET, PRESETS, presetNames } from './presets.js';
import {
  TOKEN_SPECS,
  type Tokens,
  tokenCssValue,
  tokenVariable,
  validateTokens,
} from './tokens.js';

export interface ThemeInput {
  preset?: string;
  extends?: string;
  tokens?: Record<string, unknown>;
  dark?: Record<string, unknown>;
}

export interface ResolvedTheme {
  /** Resolved preset name (a custom name when the spec named one). */
  name: string;
  /** Built-in preset the tokens derive from. */
  base: string;
  description: string;
  light: Tokens;
  dark: Tokens;
  /** Token declarations: light, dark, and reduced-motion overrides. */
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
  if (motionDisabled) {
    parts.push(':root{--ak-motion-duration:0ms}');
  }
  parts.push('@media (prefers-reduced-motion: reduce){:root{--ak-motion-duration:0ms}}');
  return parts.join('\n');
}

function coerceInput(input: unknown): ThemeInput {
  if (input === undefined || input === null) return {};
  if (typeof input === 'string') return { preset: input };
  if (typeof input === 'object' && !Array.isArray(input)) return input as ThemeInput;
  return {};
}

/**
 * Resolve a theme, reporting problems as diagnostics instead of throwing.
 */
export function resolveTheme(input: unknown, bag: DiagnosticBag): ResolvedTheme | undefined {
  const themeInput = coerceInput(input);
  const base = themeInput.extends ?? themeInput.preset ?? DEFAULT_PRESET;
  const definition = PRESETS[base];

  if (definition === undefined) {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path: themeInput.extends === undefined ? 'theme.preset' : 'theme.extends',
      message: `unknown theme preset "${base}"`,
      details: { known: presetNames() },
    });
    return undefined;
  }

  const light: Tokens = { ...definition.light };
  const dark: Tokens = { ...definition.dark };

  const overrides: Array<[string, Record<string, unknown> | undefined]> = [
    ['theme.tokens', themeInput.tokens],
    ['theme.dark', themeInput.dark],
  ];

  for (const [path, overrideSet] of overrides) {
    if (overrideSet === undefined) continue;
    if (typeof overrideSet !== 'object' || Array.isArray(overrideSet)) {
      bag.add({ code: 'SPEC_VALIDATION_ERROR', path, message: 'expected a token object' });
      continue;
    }
    for (const problem of validateTokens(overrideSet)) {
      bag.add({
        code: 'POLICY_VIOLATION',
        path: `${path}.${problem.token}`,
        message: `theme token "${problem.token}": ${problem.message}`,
        details: { token: problem.token, known: Object.keys(TOKEN_SPECS).sort() },
      });
    }
    const target = path === 'theme.tokens' ? light : dark;
    for (const [token, value] of Object.entries(overrideSet)) {
      if (TOKEN_SPECS[token] === undefined) continue;
      if (validateTokens({ [token]: value }).length > 0) continue;
      target[token] = String(value);
    }
  }

  const motionPolicy = light['motion-policy'] ?? 'full';
  return {
    name: themeInput.preset ?? base,
    base,
    description: definition.description,
    light,
    dark,
    css: buildThemeCss(light, dark, motionPolicy === 'none'),
    motionPolicy,
    density: light.density ?? 'comfortable',
  };
}

/**
 * Load and validate a theme preset.
 *
 * Accepts a preset name (`'blueprint'`), or an object with `preset`,
 * `extends`, `tokens`, and `dark` overrides. Throws a `RenderError` carrying
 * every token problem when the input is invalid.
 */
export function loadTheme(input?: unknown): ResolvedTheme {
  const bag = new DiagnosticBag();
  const resolved = resolveTheme(input, bag);
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

export { presetNames as themePresetNames } from './presets.js';
