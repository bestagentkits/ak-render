/**
 * Motion Studio model: everything the studio does to a Page Spec, without a
 * server or a browser.
 *
 * The source file stays the only truth. A proposal names a recipe per block id
 * and the three motion theme tokens, nothing else, so the studio cannot inject
 * CSS, selectors or script. Applying a proposal edits the parsed YAML document
 * (comments and key order survive) or the JSON object, then the result is
 * validated by the real compiler before anyone sees it. Accept is guarded by
 * the hash of the text the proposal was made against, so a file changed on
 * disk, or a second accept of the same proposal, is refused instead of
 * overwritten.
 */

import { createHash } from 'node:crypto';
import { type Document, isMap, parseDocument } from 'yaml';
import { RenderError } from '../../errors.js';
import type { IrDocument, IrNode } from '../../ir.js';
import { type CompileResult, compile } from '../../render/render.js';
import type { ThemeCatalog } from '../../theme/theme-catalog.js';
import { TOKEN_SPECS } from '../../theme/tokens.js';
import { auditMotionSpec, type MotionAuditReport } from '../motion-audit.js';
import {
  DEFAULT_MOTION_DURATION_MS,
  describeMotion,
  type MotionDescription,
} from '../motion-catalog.js';
import { getMotionRecipe, MOTION_DURATION_SCALE, motionPresetsFor } from '../recipes.js';

/** The theme tokens the studio may tune. */
export const STUDIO_TOKENS = ['motion-duration', 'motion-easing', 'motion-policy'] as const;
export type StudioToken = (typeof STUDIO_TOKENS)[number];

/** Bounds for `motion-duration`, in milliseconds. */
export const STUDIO_DURATION_LIMITS = { min: 0, max: 1000, step: 10 } as const;

/** An edit the studio proposes. `null` removes the field from the source. */
export interface StudioProposal {
  /** Block id to recipe id. */
  blocks?: Record<string, string | null>;
  tokens?: Partial<Record<StudioToken, string | null>>;
}

export interface StudioSource {
  path: string;
  text: string;
  hash: string;
  format: 'yaml' | 'json';
}

export interface StudioBlock {
  id: string;
  type: string;
  path: string;
  depth: number;
  motion: string | null;
  /** Recipes valid on this block as authored. */
  compatible: string[];
  hasVisibleWhen: boolean;
}

export interface StudioTiming {
  /** The theme `motion-duration` in effect, in milliseconds. */
  baseMs: number;
  durationMs: number;
  easing: string;
}

export interface StudioInspection {
  block: StudioBlock;
  recipe?: MotionDescription;
  timing?: StudioTiming;
  /** The recipe's rules exactly as the compiled page emits them. */
  css: string;
}

export interface StudioState {
  source: { path: string; hash: string; format: 'yaml' | 'json' };
  proposal: StudioProposal;
  ok: boolean;
  /** Present when the proposed spec does not compile. */
  error?: { code: string; message: string; path?: string };
  blocks: StudioBlock[];
  tokens: Record<StudioToken, string>;
  audit?: MotionAuditReport;
  /** Unified diff from the source to the proposed text; empty when unchanged. */
  diff: string;
  proposedText: string;
}

export function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function readSource(path: string, text: string): StudioSource {
  const trimmed = text.trimStart();
  const format = trimmed.startsWith('{') ? 'json' : 'yaml';
  return { path, text, hash: hashText(text), format };
}

function studioError(
  message: string,
  path: string,
  details: Record<string, unknown> = {},
): RenderError {
  return new RenderError('SPEC_VALIDATION_ERROR', message, { path, details });
}

/** `$.blocks[2].items[0].blocks[1]` to `['blocks', 2, 'items', 0, 'blocks', 1]`. */
export function jsonPathKeys(path: string): (string | number)[] {
  const keys: (string | number)[] = [];
  const pattern = /\.([A-Za-z_$][\w$-]*)|\[(\d+)\]/gu;
  if (!path.startsWith('$')) throw studioError(`unsupported path "${path}"`, path);
  let consumed = 1;
  for (const match of path.slice(1).matchAll(pattern)) {
    if (match.index !== consumed - 1) break;
    keys.push(match[1] !== undefined ? match[1] : Number(match[2]));
    consumed += match[0].length;
  }
  if (consumed !== path.length) throw studioError(`unsupported path "${path}"`, path);
  return keys;
}

const DURATION = /^(\d{1,4})ms$/u;

/** Reject anything outside the closed proposal shape before it touches a file. */
export function checkProposal(proposal: unknown): StudioProposal {
  if (typeof proposal !== 'object' || proposal === null || Array.isArray(proposal)) {
    throw studioError('a proposal must be an object', 'proposal');
  }
  const { blocks, tokens, ...rest } = proposal as Record<string, unknown>;
  const extra = Object.keys(rest);
  if (extra.length > 0)
    throw studioError(`unknown proposal field "${extra[0]}"`, `proposal.${extra[0]}`);
  const checked: StudioProposal = {};
  if (blocks !== undefined) {
    if (typeof blocks !== 'object' || blocks === null || Array.isArray(blocks)) {
      throw studioError('"blocks" must map block ids to recipe ids', 'proposal.blocks');
    }
    const entries = Object.entries(blocks as Record<string, unknown>);
    if (entries.length > 500) throw studioError('too many block edits', 'proposal.blocks');
    checked.blocks = {};
    for (const [id, recipe] of entries) {
      if (
        recipe !== null &&
        (typeof recipe !== 'string' || getMotionRecipe(recipe) === undefined)
      ) {
        throw studioError(
          `unknown motion recipe ${JSON.stringify(recipe)} for block "${id}"`,
          `proposal.blocks.${id}`,
          { recipe },
        );
      }
      checked.blocks[id] = recipe as string | null;
    }
  }
  if (tokens !== undefined) {
    if (typeof tokens !== 'object' || tokens === null || Array.isArray(tokens)) {
      throw studioError('"tokens" must be an object', 'proposal.tokens');
    }
    checked.tokens = {};
    for (const [token, value] of Object.entries(tokens as Record<string, unknown>)) {
      if (!(STUDIO_TOKENS as readonly string[]).includes(token)) {
        throw studioError(
          `the studio does not tune "${token}"; it tunes only ${STUDIO_TOKENS.join(', ')}`,
          `proposal.tokens.${token}`,
        );
      }
      if (value !== null) {
        if (typeof value !== 'string') {
          throw studioError(`"${token}" must be a string`, `proposal.tokens.${token}`);
        }
        if (token === 'motion-duration') {
          const ms = DURATION.exec(value);
          if (ms === null || Number(ms[1]) > STUDIO_DURATION_LIMITS.max) {
            throw studioError(
              `"motion-duration" must be whole milliseconds from ${STUDIO_DURATION_LIMITS.min} to ${STUDIO_DURATION_LIMITS.max}`,
              `proposal.tokens.${token}`,
              { value },
            );
          }
        } else {
          const allowed = TOKEN_SPECS[token]?.values ?? [];
          if (!allowed.includes(value)) {
            throw studioError(
              `"${token}" must be one of ${allowed.join(', ')}`,
              `proposal.tokens.${token}`,
              {
                value,
                allowed,
              },
            );
          }
        }
      }
      checked.tokens[token as StudioToken] = value as string | null;
    }
  }
  return checked;
}

function blockPaths(ir: IrDocument): Map<string, IrNode> {
  const byId = new Map<string, IrNode>();
  for (const node of ir.nodes) if (node.parentId !== null) byId.set(node.id, node);
  return byId;
}

function setIn(
  target: Document | Record<string, unknown>,
  keys: (string | number)[],
  value: unknown,
): void {
  if (isDocument(target)) {
    if (value === undefined) target.deleteIn(keys);
    else target.setIn(keys, value);
    return;
  }
  let node: unknown = target;
  for (const key of keys.slice(0, -1)) {
    const container = node as Record<string | number, unknown>;
    if (container[key] === undefined || container[key] === null) container[key] = {};
    node = container[key];
  }
  const last = keys[keys.length - 1] as string | number;
  const container = node as Record<string | number, unknown>;
  if (value === undefined) delete container[last];
  else container[last] = value;
}

function isDocument(value: unknown): value is Document {
  return typeof value === 'object' && value !== null && 'contents' in value && 'toString' in value;
}

function getIn(target: Document | Record<string, unknown>, keys: (string | number)[]): unknown {
  if (isDocument(target)) return target.getIn(keys);
  let node: unknown = target;
  for (const key of keys) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string | number, unknown>)[key];
  }
  return node;
}

function jsonIndent(text: string): number {
  const match = /\n( +)"/u.exec(text);
  return match?.[1]?.length ?? 2;
}

/**
 * Apply a proposal to the source text and return the new text. The block ids
 * are resolved through the normalized source, so a nested block is edited
 * where it is authored.
 */
export function applyProposal(
  source: StudioSource,
  proposal: StudioProposal,
  options: StudioOptions = {},
): string {
  const blocks = Object.entries(proposal.blocks ?? {});
  const tokens = Object.entries(proposal.tokens ?? {});
  if (blocks.length === 0 && tokens.length === 0) return source.text;

  const ir = compileSource(source.text, source.path, options).ir;
  const byId = blockPaths(ir);
  const target: Document | Record<string, unknown> =
    source.format === 'json'
      ? (JSON.parse(source.text) as Record<string, unknown>)
      : parseDocument(source.text, { keepSourceTokens: true });

  for (const [id, recipe] of blocks) {
    const node = byId.get(id);
    if (node === undefined) {
      throw studioError(`no block has the id "${id}"`, `proposal.blocks.${id}`, {
        known: [...byId.keys()],
      });
    }
    setIn(target, [...jsonPathKeys(node.path), 'motion'], recipe === null ? undefined : recipe);
  }

  if (tokens.length > 0) {
    const theme = getIn(target, ['theme']);
    const isObject = isDocument(target)
      ? isMap(theme)
      : typeof theme === 'object' && theme !== null;
    if (theme !== undefined && !isObject) {
      throw studioError('the spec theme must be an object to take token overrides', '$.theme');
    }
    for (const [token, value] of tokens) {
      setIn(target, ['theme', 'tokens', token], value === null ? undefined : value);
    }
    const remaining = getIn(target, ['theme', 'tokens']);
    const empty = isDocument(target)
      ? isMap(remaining) && remaining.items.length === 0
      : typeof remaining === 'object' && remaining !== null && Object.keys(remaining).length === 0;
    if (empty) setIn(target, ['theme', 'tokens'], undefined);
    const themeLeft = getIn(target, ['theme']);
    const themeEmpty = isDocument(target)
      ? isMap(themeLeft) && themeLeft.items.length === 0
      : typeof themeLeft === 'object' && themeLeft !== null && Object.keys(themeLeft).length === 0;
    if (themeEmpty) setIn(target, ['theme'], undefined);
  }

  if (isDocument(target)) return target.toString({ lineWidth: 0 });
  const trailing = source.text.endsWith('\n') ? '\n' : '';
  return `${JSON.stringify(target, null, jsonIndent(source.text))}${trailing}`;
}

export interface StudioOptions {
  /** Preset catalog, so project and user presets resolve as in the CLI. */
  themeCatalog?: ThemeCatalog;
}

export function compileSource(
  text: string,
  path: string,
  options: StudioOptions = {},
): CompileResult {
  return compile(text, {
    source: path,
    ...(options.themeCatalog === undefined ? {} : { themeCatalog: options.themeCatalog }),
  });
}

function blocksOf(ir: IrDocument): StudioBlock[] {
  return ir.nodes
    .filter((node) => node.parentId !== null)
    .map((node) => ({
      id: node.id,
      type: node.type,
      path: node.path,
      depth: node.depth,
      motion: node.motion?.preset ?? null,
      compatible: motionPresetsFor(node.type).filter(
        (id) => getMotionRecipe(id)?.requires?.visibleWhen !== true || node.when !== undefined,
      ),
      hasVisibleWhen: node.when !== undefined,
    }));
}

function durationMs(value: string | undefined): number {
  if (value === undefined) return DEFAULT_MOTION_DURATION_MS;
  const match = /^(\d+(?:\.\d+)?)(ms|s)$/u.exec(value.trim());
  if (match === null) return DEFAULT_MOTION_DURATION_MS;
  return Number(match[1]) * (match[2] === 's' ? 1000 : 1);
}

function tokensOf(result: CompileResult): Record<StudioToken, string> {
  const tokens = result.theme.light as Record<string, string | undefined>;
  return {
    'motion-duration': tokens['motion-duration'] ?? `${DEFAULT_MOTION_DURATION_MS}ms`,
    'motion-easing': tokens['motion-easing'] ?? 'ease',
    'motion-policy': result.theme.motionPolicy ?? 'full',
  };
}

/** The studio's view of a source plus a proposal. Never throws on a bad spec. */
export function studioState(
  source: StudioSource,
  proposal: StudioProposal,
  options: StudioOptions = {},
): StudioState & { html?: string } {
  const base = { path: source.path, hash: source.hash, format: source.format };
  let proposedText = source.text;
  try {
    proposedText = applyProposal(source, proposal, options);
    const result = compileSource(proposedText, source.path, options);
    return {
      source: base,
      proposal,
      ok: true,
      blocks: blocksOf(result.ir),
      tokens: tokensOf(result),
      audit: auditMotionSpec(proposedText, {
        source: source.path,
        ...(options.themeCatalog === undefined ? {} : { themeCatalog: options.themeCatalog }),
      }),
      diff: lineDiff(source.text, proposedText, source.path),
      proposedText,
      html: result.html,
    };
  } catch (error) {
    const failure =
      error instanceof RenderError
        ? {
            code: error.code,
            message: error.message,
            ...(error.path === undefined ? {} : { path: error.path }),
          }
        : { code: 'STUDIO_ERROR', message: error instanceof Error ? error.message : String(error) };
    return {
      source: base,
      proposal,
      ok: false,
      error: failure,
      blocks: [],
      tokens: { 'motion-duration': '', 'motion-easing': '', 'motion-policy': '' },
      diff: proposedText === source.text ? '' : lineDiff(source.text, proposedText, source.path),
      proposedText,
    };
  }
}

/** One block's recipe, timing at the current theme, and its emitted CSS. */
export function inspectBlock(state: StudioState, html: string, id: string): StudioInspection {
  const block = state.blocks.find((entry) => entry.id === id);
  if (block === undefined) throw studioError(`no block has the id "${id}"`, 'id');
  if (block.motion === null) return { block, css: '' };
  const recipe = describeMotion(block.motion) as MotionDescription;
  const baseMs = durationMs(state.tokens['motion-duration']);
  return {
    block,
    recipe,
    timing: {
      baseMs,
      durationMs: Math.round(baseMs * MOTION_DURATION_SCALE[recipe.duration]),
      easing: recipe.easing === 'standard' ? state.tokens['motion-easing'] : recipe.easing,
    },
    css: recipeCss(html, recipe.id, recipe.keyframes),
  };
}

/** Split a stylesheet into its top-level rules, keeping at-rule blocks whole. */
function topLevelRules(css: string): string[] {
  const rules: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < css.length; index += 1) {
    const character = css[index];
    if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        rules.push(css.slice(start, index + 1).trim());
        start = index + 1;
      }
    } else if (character === ';' && depth === 0) {
      start = index + 1;
    }
  }
  return rules.filter((rule) => rule !== '');
}

/**
 * The rules a compiled page emits for one recipe: every rule keyed on its
 * `data-ak-motion` value (inside its media query when it has one) and its
 * keyframes.
 */
export function recipeCss(html: string, id: string, keyframes: readonly string[]): string {
  const marker = `[data-ak-motion="${id}"]`;
  const sheets = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/giu)].map(
    (match) => match[1] ?? '',
  );
  const picked: string[] = [];
  const visit = (rule: string, wrapper?: string) => {
    if (rule.startsWith('@keyframes')) {
      const name = /^@keyframes\s+([\w-]+)/u.exec(rule)?.[1];
      if (name !== undefined && keyframes.includes(name)) picked.push(rule);
      return;
    }
    if (rule.startsWith('@media') || rule.startsWith('@supports')) {
      const open = rule.indexOf('{');
      const head = rule.slice(0, open).trim();
      for (const inner of topLevelRules(rule.slice(open + 1, -1))) visit(inner, head);
      return;
    }
    const selector = rule.slice(0, rule.indexOf('{'));
    if (!selector.includes(marker)) return;
    picked.push(wrapper === undefined ? rule : `${wrapper}{${rule}}`);
  };
  for (const sheet of sheets) for (const rule of topLevelRules(sheet)) visit(rule);
  return [...new Set(picked)].join('\n');
}

/**
 * A unified diff of two texts, line by line, with three lines of context. It
 * is the review surface for Accept, so it favours a readable hunk over the
 * shortest edit script.
 */
export function lineDiff(before: string, after: string, label: string): string {
  if (before === after) return '';
  const a = before.split('\n');
  const b = after.split('\n');
  // Trim the shared head and tail so the quadratic table covers only the edit.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail += 1;
  }
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  const table: number[][] = Array.from({ length: midA.length + 1 }, () =>
    new Array<number>(midB.length + 1).fill(0),
  );
  for (let i = midA.length - 1; i >= 0; i -= 1) {
    for (let j = midB.length - 1; j >= 0; j -= 1) {
      const row = table[i] as number[];
      row[j] =
        midA[i] === midB[j]
          ? ((table[i + 1] as number[])[j + 1] as number) + 1
          : Math.max((table[i + 1] as number[])[j] as number, row[j + 1] as number);
    }
  }
  type Line = { kind: ' ' | '-' | '+'; text: string };
  const lines: Line[] = a.slice(0, head).map((text) => ({ kind: ' ', text }));
  let i = 0;
  let j = 0;
  while (i < midA.length || j < midB.length) {
    if (i < midA.length && j < midB.length && midA[i] === midB[j]) {
      lines.push({ kind: ' ', text: midA[i] as string });
      i += 1;
      j += 1;
    } else if (
      i < midA.length &&
      (j === midB.length ||
        ((table[i + 1] as number[])[j] as number) >= ((table[i] as number[])[j + 1] as number))
    ) {
      // Removals print before additions, as in a conventional unified diff.
      lines.push({ kind: '-', text: midA[i] as string });
      i += 1;
    } else {
      lines.push({ kind: '+', text: midB[j] as string });
      j += 1;
    }
  }
  for (const text of a.slice(a.length - tail)) lines.push({ kind: ' ', text });

  const context = 3;
  const out = [`--- a/${label}`, `+++ b/${label}`];
  let index = 0;
  while (index < lines.length) {
    if ((lines[index] as Line).kind === ' ') {
      index += 1;
      continue;
    }
    let end = index;
    // Extend the hunk while the next change is within two context windows.
    for (let probe = index; probe < lines.length; probe += 1) {
      if ((lines[probe] as Line).kind !== ' ') end = probe;
      else if (probe - end > context * 2) break;
    }
    const from = Math.max(0, index - context);
    const to = Math.min(lines.length, end + context + 1);
    const slice = lines.slice(from, to);
    const oldStart = lines.slice(0, from).filter((line) => line.kind !== '+').length + 1;
    const newStart = lines.slice(0, from).filter((line) => line.kind !== '-').length + 1;
    const oldCount = slice.filter((line) => line.kind !== '+').length;
    const newCount = slice.filter((line) => line.kind !== '-').length;
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const line of slice) out.push(`${line.kind}${line.text}`);
    index = to;
  }
  return `${out.join('\n')}\n`;
}
