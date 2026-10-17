/**
 * `compose()` — build a page from a typed intent instead of a hand-written
 * Page Spec.
 *
 * An intent names a page kind and a set of typed content slots. Composition
 * checks the slots, expands them deterministically into an ordinary Page Spec
 * built from existing blocks, validates that spec, and (unless asked for a dry
 * run) compiles it with the same `compile()` every other path uses. The spec is
 * returned too, so an agent can keep editing it with the full block vocabulary.
 * `render(spec)` is untouched: compose is a shortcut in front of it, not a
 * second compiler.
 */

import { type Diagnostic, DiagnosticBag } from '../diagnostics.js';
import { isRenderError } from '../errors.js';
import type { JsonValue } from '../json.js';
import { type CompileResult, compile, type RenderOptions } from '../render/render.js';
import { parseSpec } from '../spec/parse.js';
import { validate } from '../spec/validate.js';
import { themePresetNames } from '../theme/load-theme.js';
import type { ThemeCatalog } from '../theme/theme-catalog.js';
import {
  checkInvestmentReport,
  expandInvestmentReport,
  INVESTMENT_REPORT_SLOTS,
  type InvestmentReportContent,
} from './investment-report.js';
import { checkSlot, type SlotField, slotJsonSchema } from './slot-schema.js';

interface IntentDefinition {
  summary: string;
  defaultTheme: string;
  slots: SlotField;
  /** Expand content that already passed `checkSlot`, or report why not. */
  expand: (content: unknown, theme: string, bag: DiagnosticBag) => Record<string, JsonValue>;
}

const INTENTS = {
  'investment-report': {
    summary:
      'Thesis with a recommendation, key facts, headline metrics, scenario projections (chart and table over one dataset), risks, milestones and sources.',
    defaultTheme: 'executive-report',
    slots: INVESTMENT_REPORT_SLOTS,
    expand: (content, theme, bag) => {
      const typed = content as InvestmentReportContent;
      checkInvestmentReport(typed, 'content', bag);
      return expandInvestmentReport(typed, theme);
    },
  },
} as const satisfies Record<string, IntentDefinition>;

export type ComposeIntent = keyof typeof INTENTS;

/** Intent names, sorted. */
export const COMPOSE_INTENTS = Object.keys(INTENTS).sort() as ComposeIntent[];

export function isComposeIntent(value: unknown): value is ComposeIntent {
  return typeof value === 'string' && Object.hasOwn(INTENTS, value);
}

export interface ComposeInput {
  intent: ComposeIntent;
  content: unknown;
  /** Theme preset; each intent has its own default. */
  theme?: string;
}

export interface ComposeIntentDescription {
  intent: ComposeIntent;
  summary: string;
  defaultTheme: string;
  /** JSON Schema for `content`. */
  content: Record<string, unknown>;
}

/** Every intent with its summary, default theme and content schema. */
export function composeIntents(): ComposeIntentDescription[] {
  return COMPOSE_INTENTS.map((intent) => ({
    intent,
    summary: INTENTS[intent].summary,
    defaultTheme: INTENTS[intent].defaultTheme,
    content: slotJsonSchema(INTENTS[intent].slots),
  }));
}

/**
 * JSON Schema for a compose input. With one intent, `content` is that
 * intent's schema; with several it becomes a `oneOf` keyed by `intent`.
 */
export function composeInputJsonSchema(): Record<string, unknown> {
  const contents = COMPOSE_INTENTS.map((intent) => slotJsonSchema(INTENTS[intent].slots));
  return {
    type: 'object',
    properties: {
      intent: { type: 'string', enum: [...COMPOSE_INTENTS], description: 'The page kind.' },
      content: contents.length === 1 ? contents[0] : { oneOf: contents },
      theme: { type: 'string', description: 'Optional theme preset; the intent picks a default.' },
    },
    required: ['intent', 'content'],
    additionalProperties: false,
  };
}

export interface ComposeSpecResult {
  ok: boolean;
  /** Errors and warnings. Paths start at the compose input (`content.…`). */
  diagnostics: Diagnostic[];
  /** The expanded Page Spec, present whenever the content was usable. */
  spec?: Record<string, JsonValue>;
}

const INPUT_KEYS: ReadonlySet<string> = new Set(['intent', 'content', 'theme']);

export interface ComposeSpecOptions {
  /** Source label used in parse diagnostics. */
  source?: string;
  /** Theme preset that replaces the input's `theme`, e.g. from a CLI flag. */
  theme?: string;
  /** Presets the theme may name. Defaults to the built-ins. */
  themeCatalog?: ThemeCatalog;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Expand a compose input (an object, or YAML/JSON text) into a Page Spec
 * without compiling it. Never throws for input problems.
 */
export function composeSpec(input: unknown, options: ComposeSpecOptions = {}): ComposeSpecResult {
  const bag = new DiagnosticBag();
  let document: unknown;
  try {
    document = parseSpec(input, { source: options.source ?? '<compose>' });
  } catch (error) {
    if (!isRenderError(error)) throw error;
    bag.add({ code: error.code, message: error.message, path: error.path ?? '$' });
    return { ok: false, diagnostics: bag.list() };
  }

  if (!isRecord(document)) {
    bag.add({ code: 'SPEC_VALIDATION_ERROR', path: '$', message: 'must be an object' });
    return { ok: false, diagnostics: bag.list() };
  }
  for (const key of Object.keys(document)) {
    if (!INPUT_KEYS.has(key)) {
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: key,
        message: `unknown field "${key}"; expected intent, content, theme`,
      });
    }
  }
  const { intent, content } = document;
  const theme = options.theme ?? document.theme;
  if (!isComposeIntent(intent)) {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path: 'intent',
      message: `unknown intent ${JSON.stringify(intent)}; expected one of: ${COMPOSE_INTENTS.join(', ')}`,
      details: { allowed: [...COMPOSE_INTENTS] },
    });
  }
  if (theme !== undefined) {
    const known = themePresetNames(options.themeCatalog);
    if (typeof theme !== 'string' || !known.includes(theme)) {
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: 'theme',
        message: `unknown theme preset ${JSON.stringify(theme)}`,
        details: { known },
      });
    }
  }
  if (!isComposeIntent(intent) || bag.hasErrors) return { ok: false, diagnostics: bag.list() };

  const definition: IntentDefinition = INTENTS[intent];
  if (!checkSlot(content, definition.slots, 'content', bag)) {
    return { ok: false, diagnostics: bag.list() };
  }
  const spec = definition.expand(
    content,
    typeof theme === 'string' ? theme : definition.defaultTheme,
    bag,
  );
  if (bag.hasErrors) return { ok: false, diagnostics: bag.list() };

  // The expansion only emits known blocks, so a spec diagnostic here points at
  // content the slot schema let through (an over-long value, say). It is
  // reported against the expanded spec, which `spec` lets the caller inspect.
  const checked = validate(spec, { source: '<composed spec>' });
  const diagnostics = [
    ...bag.list(),
    ...checked.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      path: diagnostic.path === '$' ? 'spec' : `spec.${diagnostic.path.replace(/^\$\.?/u, '')}`,
    })),
  ];
  return { ok: checked.ok, diagnostics, spec };
}

export interface ComposeOptions extends Omit<RenderOptions, 'theme' | 'source'> {
  /** Expand and validate only; skip compiling. */
  dryRun?: boolean;
  /** Theme preset that replaces the input's `theme`. */
  theme?: string;
}

export interface ComposeResult extends ComposeSpecResult {
  /** The compiled page, unless the input failed or `dryRun` was set. */
  result?: CompileResult;
}

/**
 * Compose and compile. The HTML is byte-identical to `compile(spec)` of the
 * returned spec, because that is exactly what runs.
 */
export function compose(input: unknown, options: ComposeOptions = {}): ComposeResult {
  const { dryRun, theme, ...renderOptions } = options;
  const expanded = composeSpec(input, {
    ...(theme === undefined ? {} : { theme }),
    ...(renderOptions.themeCatalog === undefined
      ? {}
      : { themeCatalog: renderOptions.themeCatalog }),
  });
  if (!expanded.ok || expanded.spec === undefined || dryRun === true) return expanded;
  try {
    const result = compile(expanded.spec, { ...renderOptions, source: '<composed spec>' });
    return { ...expanded, result };
  } catch (error) {
    // A theme that resolves but cannot compile (a broken custom preset, say)
    // is still reported as a diagnostic rather than thrown.
    if (!isRenderError(error)) throw error;
    const failed: Diagnostic = {
      code: error.code,
      severity: 'error',
      message: error.message,
      path: `spec.${(error.path ?? '').replace(/^\$\.?/u, '')}`.replace(/\.$/u, ''),
    };
    return { ok: false, diagnostics: [...expanded.diagnostics, failed], spec: expanded.spec };
  }
}
