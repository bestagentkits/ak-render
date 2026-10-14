/**
 * Motion audit: deterministic findings about the motion a page asks for and
 * the motion a compiled page ships.
 *
 * Two modes, with different strength:
 *
 * - **Spec audit (authoritative).** Validates and normalizes the Page Spec, then
 *   reads the IR: every recipe is checked against its block, its trigger and
 *   the theme's effective motion policy. Every recipe carries a registry
 *   fallback, so a spec cannot lack one; what the audit finds is motion that is
 *   invalid, nested, excessive, or that can never play.
 * - **HTML audit (best effort).** Reads the stylesheets and the runtime of a
 *   compiled page as text, with no script execution and no network: unguarded
 *   or unbounded motion, `transition: all`, layout-animating keyframes, fixed
 *   timings, a recipe without its CSS or lifecycle runtime, remote resources
 *   and an unsafe CSP. A clean report on a page this compiler did not produce
 *   proves little, and the report says so.
 *
 * Findings carry a stable rule id, a severity, the JSON path or markup location,
 * the evidence and a fix. They are sorted, so the same input always produces
 * the same report. Auditing never changes the input.
 */

import type { Diagnostic } from '../diagnostics.js';
import { DiagnosticBag } from '../diagnostics.js';
import { ADAPTER_STYLE_MARKER } from '../diagram/adapter-markup-fit.js';
import type { IrDocument, IrNode } from '../ir.js';
import {
  hasFixedTime,
  isGuarded,
  layers,
  type MotionPolicy,
  motionDiagnostics,
  motionPolicyOf,
  parseCssDeclarations,
} from '../render/motion.js';
import { normalizeSpec } from '../spec/normalize.js';
import type { ParseOptions } from '../spec/parse.js';
import { resolveTheme } from '../theme/load-theme.js';
import { builtinThemeCatalog, type ThemeCatalog } from '../theme/theme-catalog.js';
import { getMotionRecipe, MOTION_RECIPES } from './recipes.js';

export type MotionSeverity = 'error' | 'warning' | 'info';

/** Severities from most to least serious; `none` gates nothing. */
export const MOTION_SEVERITIES: readonly MotionSeverity[] = ['error', 'warning', 'info'];

export interface MotionFinding {
  /** Stable id, `motion/…` for spec rules and `html/…` for compiled-page rules. */
  rule: string;
  severity: MotionSeverity;
  message: string;
  /** JSON path in the spec, or `html` / `css` / `script` for a compiled page. */
  path: string;
  nodeId?: string;
  /** The text the rule matched, so the finding can be reproduced. */
  evidence?: string;
  fix: string;
  /** A recipe that would satisfy the rule, when one applies. */
  recipe?: string;
}

export interface MotionScore {
  /** 100 minus the weighted findings, floored at 0. Advisory only. */
  value: number;
  weights: Readonly<Record<MotionSeverity, number>>;
}

export interface MotionAuditReport {
  mode: 'spec' | 'html';
  /** `authoritative` for a spec; `best-effort` for compiled HTML. */
  reliability: 'authoritative' | 'best-effort';
  /** False only for HTML that does not name this compiler as its generator. */
  trusted: boolean;
  /** The effective theme policy, when the spec or page declares one. */
  policy?: MotionPolicy;
  /** Recipes in use: `nodeId` for a spec, occurrence counts for HTML. */
  recipes: { id: string; nodeId?: string; count?: number }[];
  counts: Record<MotionSeverity, number>;
  score: MotionScore;
  findings: MotionFinding[];
}

/** What each finding costs the advisory score. */
export const MOTION_SCORE_WEIGHTS: Readonly<Record<MotionSeverity, number>> = {
  error: 25,
  warning: 8,
  info: 2,
};

/** Arrival recipes past this count on one page turn reading into waiting. */
export const MOTION_ARRIVAL_BUDGET = 6;

/** The stagger delay stops growing after this many items. */
const STAGGER_CAP = 8;

/** Properties that make the browser lay the page out again on every frame. */
const LAYOUT_PROPERTIES =
  /^(?:width|height|min-width|min-height|max-width|max-height|top|right|bottom|left|inset|margin(?:-[\w-]+)?|padding(?:-[\w-]+)?|inset-[\w-]+|font-size|line-height)$/u;

const RANK: Readonly<Record<MotionSeverity, number>> = { error: 0, warning: 1, info: 2 };

function sortFindings(findings: MotionFinding[]): MotionFinding[] {
  const key = (finding: MotionFinding) =>
    `${finding.path}\u0000${finding.rule}\u0000${finding.nodeId ?? ''}\u0000${finding.evidence ?? ''}`;
  return findings.sort(
    (a, b) =>
      RANK[a.severity] - RANK[b.severity] || (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0),
  );
}

function report(
  mode: MotionAuditReport['mode'],
  findings: MotionFinding[],
  extra: Pick<MotionAuditReport, 'trusted' | 'recipes'> & { policy?: MotionPolicy },
): MotionAuditReport {
  const counts: Record<MotionSeverity, number> = { error: 0, warning: 0, info: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  const penalty = MOTION_SEVERITIES.reduce(
    (sum, severity) => sum + counts[severity] * MOTION_SCORE_WEIGHTS[severity],
    0,
  );
  return {
    mode,
    reliability: mode === 'spec' ? 'authoritative' : 'best-effort',
    trusted: extra.trusted,
    ...(extra.policy === undefined ? {} : { policy: extra.policy }),
    recipes: extra.recipes,
    counts,
    score: { value: Math.max(0, 100 - penalty), weights: MOTION_SCORE_WEIGHTS },
    findings: sortFindings(findings),
  };
}

/** True when the report holds a finding at `failOn` or more serious. */
export function motionAuditFails(
  findings: readonly MotionFinding[],
  failOn: MotionSeverity | 'none',
): boolean {
  if (failOn === 'none') return false;
  return findings.some((finding) => RANK[finding.severity] <= RANK[failOn]);
}

/**
 * Identity of a finding across runs: everything but its prose. A finding on a
 * named block keys on the block id, not its JSON path, so inserting or moving
 * other blocks does not turn a known finding into a new one.
 */
export function motionFindingKey(finding: MotionFinding): string {
  const where = finding.nodeId === undefined ? finding.path : `#${finding.nodeId}`;
  return [finding.rule, where, finding.evidence ?? ''].join('|');
}

/**
 * Findings that appeared or went away since a baseline report, so a CI gate
 * can fail on regressions rather than on a page's existing debt.
 */
export function compareMotionAudits(
  baseline: Pick<MotionAuditReport, 'findings'>,
  current: Pick<MotionAuditReport, 'findings'>,
): { added: MotionFinding[]; resolved: MotionFinding[] } {
  const before = new Set(baseline.findings.map(motionFindingKey));
  const after = new Set(current.findings.map(motionFindingKey));
  return {
    added: current.findings.filter((finding) => !before.has(motionFindingKey(finding))),
    resolved: baseline.findings.filter((finding) => !after.has(motionFindingKey(finding))),
  };
}

// --- spec audit -------------------------------------------------------------

export interface MotionSpecAuditOptions extends ParseOptions {
  /** Theme catalog that resolves the spec's preset; defaults to the built-in one. */
  themeCatalog?: ThemeCatalog;
}

const isMotionPath = (path: string) => /\.motion(?:$|[.[])/u.test(path);

function motionPathOwner(path: string): string {
  return path.replace(/\.motion(?:[.[].*)?$/u, '');
}

/** Every `state.*` path written by a control binding or an action. */
function writtenStatePaths(ir: IrDocument): Set<string> {
  const written = new Set<string>();
  const walk = (value: unknown, key: string) => {
    if (typeof value === 'string') {
      if ((key === 'bind' || key === 'path') && value.startsWith('state.')) written.add(value);
      return;
    }
    if (Array.isArray(value)) for (const item of value) walk(item, key);
    else if (value !== null && typeof value === 'object') {
      for (const [child, item] of Object.entries(value)) walk(item, child);
    }
  };
  for (const node of ir.nodes) {
    walk(node.props, '');
    walk(node.bindings, '');
  }
  return written;
}

/** Every `state.*` path a condition reads. */
function readStatePaths(condition: unknown, into: string[] = []): string[] {
  if (Array.isArray(condition)) for (const item of condition) readStatePaths(item, into);
  else if (condition !== null && typeof condition === 'object') {
    for (const [key, value] of Object.entries(condition)) {
      if (key === 'path' && typeof value === 'string') into.push(value);
      else readStatePaths(value, into);
    }
  }
  return into;
}

const related = (a: string, b: string) => a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);

function itemCount(node: IrNode): number {
  const items = node.props.items;
  return Array.isArray(items) ? items.length : node.children.length;
}

function specValidationFindings(diagnostics: readonly Diagnostic[]): MotionFinding[] {
  const findings: MotionFinding[] = [];
  const others = diagnostics.filter(
    (diagnostic) => diagnostic.severity === 'error' && !isMotionPath(diagnostic.path),
  );
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity !== 'error' || !isMotionPath(diagnostic.path)) continue;
    const details = (diagnostic.details ?? {}) as { rule?: string; compatible?: string[] };
    const compatible = details.compatible ?? [];
    findings.push({
      rule: details.rule ?? 'motion/invalid-value',
      severity: 'error',
      message: diagnostic.message,
      path: diagnostic.path,
      ...(diagnostic.nodeId === undefined ? {} : { nodeId: diagnostic.nodeId }),
      fix:
        details.rule === 'motion/needs-visible-when'
          ? 'Add visibleWhen to the block, or pick a recipe that plays on arrival.'
          : compatible.length === 0
            ? `Remove motion from ${motionPathOwner(diagnostic.path)}; its block takes no recipe.`
            : `Use one of: ${compatible.join(', ')}.`,
      ...(compatible[0] === undefined ? {} : { recipe: compatible[0] }),
    });
  }
  const first = others[0];
  if (first !== undefined) {
    findings.push({
      rule: 'spec/invalid',
      severity: 'error',
      message: `the spec has ${others.length} validation error(s) outside motion, so motion beyond the field itself was not audited`,
      path: first.path,
      evidence: first.message,
      fix: 'Run validate and fix every diagnostic by its JSON path, then audit again.',
    });
  }
  return findings;
}

function irFindings(ir: IrDocument, policy: MotionPolicy | undefined): MotionFinding[] {
  const findings: MotionFinding[] = [];
  const byId = new Map(ir.nodes.map((node) => [node.id, node]));
  const withRecipe = ir.nodes.filter(
    (node) => node.motion !== undefined && getMotionRecipe(node.motion.preset) !== undefined,
  );
  const arrival = (node: IrNode) =>
    getMotionRecipe(node.motion?.preset ?? '')?.triggers.includes('on-enter') === true;
  const written = writtenStatePaths(ir);

  for (const node of withRecipe) {
    const preset = node.motion?.preset ?? '';
    const recipe = getMotionRecipe(preset);
    if (recipe === undefined) continue;
    const path = `${node.path}.motion`;

    if (arrival(node)) {
      let parent = node.parentId === null ? undefined : byId.get(node.parentId);
      while (parent !== undefined && !arrival(parent)) {
        parent = parent.parentId === null ? undefined : byId.get(parent.parentId);
      }
      if (parent !== undefined) {
        findings.push({
          rule: 'motion/nested-arrival',
          severity: 'warning',
          message: `"${preset}" plays inside "${parent.id}", which already arrives with "${parent.motion?.preset}"; the two entrances compete`,
          path,
          nodeId: node.id,
          evidence: `${parent.id} > ${node.id}`,
          fix: `Keep one entrance: remove motion from ${node.id} or from ${parent.id}.`,
        });
      }
    }

    if (preset === 'stagger' && itemCount(node) > STAGGER_CAP) {
      findings.push({
        rule: 'motion/stagger-capped',
        severity: 'info',
        message: `"${node.id}" has ${itemCount(node)} items; items after the ${STAGGER_CAP}th arrive together`,
        path,
        nodeId: node.id,
        evidence: `${itemCount(node)} items`,
        fix: 'Nothing to do if that is intended; split the list to stagger every item.',
      });
    }

    if (recipe.triggers.includes('state-change') && node.when !== undefined) {
      const reads = readStatePaths(node.when);
      if (reads.length > 0 && !reads.some((read) => [...written].some((w) => related(read, w)))) {
        findings.push({
          rule: 'motion/state-never-changes',
          severity: 'warning',
          message: `no control or action writes ${reads.join(', ')}, so "${preset}" on "${node.id}" can never replay`,
          path,
          nodeId: node.id,
          evidence: reads.join(', '),
          fix: 'Bind a control or an action to that state path, or drop the recipe.',
        });
      }
    }
  }

  const arrivals = withRecipe.filter(arrival);
  if (arrivals.length > MOTION_ARRIVAL_BUDGET) {
    findings.push({
      rule: 'motion/arrival-overuse',
      severity: 'warning',
      message: `${arrivals.length} blocks arrive with motion; past ${MOTION_ARRIVAL_BUDGET} the page reads as a sequence of entrances`,
      path: '$.blocks',
      evidence: arrivals.map((node) => node.id).join(', '),
      fix: 'Keep entrances for the few blocks a reader should notice first.',
    });
  }

  if (withRecipe.length > 0 && policy !== undefined && policy !== 'full') {
    findings.push({
      rule: 'motion/policy-off',
      severity: 'info',
      message: `the theme's motion-policy is "${policy}", so no recipe plays; ${withRecipe.length} block(s) name one`,
      path: '$.theme',
      evidence: `motion-policy: ${policy}`,
      fix: 'Nothing to do for a still theme; set motion-policy: full to let recipes play.',
    });
  }
  return findings;
}

/**
 * Audit a Page Spec (YAML or JSON text, or the parsed object). Motion field
 * errors become findings with their rule ids; other validation errors become
 * one `spec/invalid` finding, since the IR rules need a valid spec.
 */
export function auditMotionSpec(
  input: unknown,
  options: MotionSpecAuditOptions = {},
): MotionAuditReport {
  const { themeCatalog, ...parseOptions } = options;
  const normalized = normalizeSpec(input, parseOptions);
  const findings = specValidationFindings(normalized.diagnostics);
  // A bad motion field is already a finding; only errors elsewhere leave an IR
  // the motion rules cannot trust.
  const valid = !normalized.diagnostics.some(
    (diagnostic) => diagnostic.severity === 'error' && !isMotionPath(diagnostic.path),
  );
  const recipes = normalized.ir.nodes
    .filter((node) => node.motion !== undefined)
    .map((node) => ({ id: node.motion?.preset ?? '', nodeId: node.id }));

  let policy: MotionPolicy | undefined;
  if (valid) {
    const bag = new DiagnosticBag();
    const theme = resolveTheme(normalized.ir.theme, bag, themeCatalog ?? builtinThemeCatalog());
    if (theme !== undefined && bag.errors().length === 0)
      policy = motionPolicyOf(theme.motionPolicy);
    findings.push(...irFindings(normalized.ir, policy));
  }
  return report('spec', findings, {
    trusted: true,
    recipes,
    ...(policy === undefined ? {} : { policy }),
  });
}

// --- compiled HTML audit ----------------------------------------------------

/** Lower-case ASCII only, so every index still lines up with the original. */
const asciiLower = (text: string) => text.replace(/[A-Z]+/gu, (run) => run.toLowerCase());

interface Element {
  start: number;
  end: number;
  attributes: string;
  body: string;
}

/**
 * Every `<name ...>body</name>` element, found with forward-only scans so an
 * unclosed or malformed tag costs linear time on untrusted input.
 */
function elements(html: string, name: string, withBody = true): Element[] {
  const found: Element[] = [];
  const lower = asciiLower(html);
  const open = `<${name}`;
  const close = `</${name}`;
  let position = 0;
  while (position < lower.length) {
    const start = lower.indexOf(open, position);
    if (start < 0) break;
    const after = lower.charAt(start + open.length);
    if (after !== '' && !/[\s/>]/u.test(after)) {
      position = start + open.length;
      continue;
    }
    const tagEnd = lower.indexOf('>', start);
    if (tagEnd < 0) break;
    const attributes = html.slice(start + open.length, tagEnd);
    if (!withBody) {
      found.push({ start, end: tagEnd + 1, attributes, body: '' });
      position = tagEnd + 1;
      continue;
    }
    const closeAt = lower.indexOf(close, tagEnd + 1);
    if (closeAt < 0) break;
    const closeEnd = lower.indexOf('>', closeAt);
    const end = closeEnd < 0 ? lower.length : closeEnd + 1;
    found.push({ start, end, attributes, body: html.slice(tagEnd + 1, closeAt) });
    position = end;
  }
  return found;
}

/** `url(...)` arguments in a stylesheet, scanned forward only. */
function cssUrls(css: string): string[] {
  const urls: string[] = [];
  const lower = asciiLower(css);
  let position = 0;
  while (position < lower.length) {
    const start = lower.indexOf('url(', position);
    if (start < 0) break;
    const end = lower.indexOf(')', start);
    if (end < 0) break;
    urls.push(css.slice(start, end + 1));
    position = end + 1;
  }
  return urls;
}

/** Tokens of an `animation` layer that cannot be its name. */
const ANIMATION_KEYWORDS = new Set([
  'none',
  'infinite',
  'normal',
  'reverse',
  'alternate',
  'alternate-reverse',
  'forwards',
  'backwards',
  'both',
  'running',
  'paused',
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'step-start',
  'step-end',
  'initial',
  'inherit',
  'unset',
]);

/** The keyframes name in one `animation` shorthand layer, if it has one. */
function animationName(layer: string): string {
  for (const token of layer.replace(/\([^)]*\)/gu, ' ').split(/\s+/u)) {
    if (token === '' || ANIMATION_KEYWORDS.has(token.toLowerCase())) continue;
    if (/^[-+]?[\d.]/u.test(token) || token.startsWith('var(')) continue;
    if (/^-?[a-z_][\w-]*$/iu.test(token)) return token;
  }
  return '';
}

/** What a lifecycle recipe needs from the runtime, as text the runtime holds. */
const LIFECYCLE_MARKERS: Readonly<Record<string, string>> = {
  'tabs-slide': 'wireTabMotion',
  'fade-swap': 'wireSwapMotion',
  'dialog-pop': 'data-ak-leaving',
};

function clip(text: string, length = 160): string {
  const flat = text.replace(/\s+/gu, ' ').trim();
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
}

function cssFindings(css: string): MotionFinding[] {
  const findings: MotionFinding[] = [];
  for (const message of motionDiagnostics(css)) {
    const duplicate = message.startsWith('@keyframes');
    findings.push({
      rule: duplicate ? 'html/duplicate-keyframes' : 'html/unguarded-motion',
      severity: 'error',
      message,
      path: 'css',
      evidence: clip(message),
      fix: duplicate
        ? 'Give each keyframes a page-unique name; a later definition replaces the earlier one.'
        : 'Move the animation inside @media (prefers-reduced-motion:no-preference), or time the transition from --ak-motion-duration.',
    });
  }

  const { found, blocks } = parseCssDeclarations(css);
  const infinite = new Set<string>();
  const fixed: string[] = [];
  for (const { property, value, context } of found) {
    const selector = context.at(-1) ?? '';
    const inKeyframes = context.some((prelude) => prelude.startsWith('@keyframes'));
    if (inKeyframes) continue;
    if (property === 'transition' || property === 'transition-property') {
      for (const layer of layers(value.replace(/!important$/u, ''))) {
        if (/^all\b/u.test(layer)) {
          findings.push({
            rule: 'html/transition-all',
            severity: 'warning',
            message: `"${selector}" transitions every property, including layout and ones added later`,
            path: 'css',
            evidence: clip(`${selector}{${property}:${value}}`),
            fix: 'List the properties that should transition.',
          });
        }
      }
    }
    if (property === 'animation' || property === 'animation-iteration-count') {
      for (const layer of layers(value)) {
        if (/\binfinite\b/u.test(layer)) {
          const name = property === 'animation' ? animationName(layer) : '';
          infinite.add(name === '' ? selector : name);
        }
      }
    }
    if (
      isGuarded(context) &&
      (property === 'animation' || property === 'transition') &&
      layers(value).some(hasFixedTime)
    ) {
      fixed.push(selector);
    }
  }
  if (fixed.length > 0) {
    const examples = [...new Set(fixed)].sort().slice(0, 3);
    findings.push({
      rule: 'html/fixed-timing',
      severity: 'info',
      message: `${fixed.length} guarded animation or transition rule(s) use a fixed time instead of the motion tokens, so a theme cannot retime them`,
      path: 'css',
      evidence: clip(examples.join(' | ')),
      fix: 'Time motion from --ak-motion-duration or a semantic step such as --ak-motion-relaxed.',
    });
  }
  if (infinite.size > 1) {
    findings.push({
      rule: 'html/unbounded-motion',
      severity: 'info',
      message: `${infinite.size} animations loop forever; the motion budget allows one ambient loop in view at once`,
      path: 'css',
      evidence: [...infinite].sort().join(', '),
      fix: 'Check that only one loop is in view at once, and let every other animation finish.',
    });
  }

  // Layout properties per keyframes prelude, gathered in one pass.
  const layoutIn = new Map<string, Set<string>>();
  for (const { property, context } of found) {
    if (!LAYOUT_PROPERTIES.test(property)) continue;
    const prelude = context.find((entry) => entry.startsWith('@keyframes'));
    if (prelude === undefined) continue;
    const set = layoutIn.get(prelude) ?? new Set<string>();
    set.add(property);
    layoutIn.set(prelude, set);
  }
  for (const block of blocks) {
    const name = /^@keyframes\s+([\w-]+)/u.exec(block.property)?.[1];
    if (name === undefined) continue;
    const moved = [...(layoutIn.get(block.property) ?? [])];
    if (moved.length > 0) {
      findings.push({
        rule: 'html/layout-keyframes',
        severity: 'warning',
        message: `@keyframes ${name} animates ${moved.join(', ')}, which lays the page out on every frame`,
        path: 'css',
        evidence: `@keyframes ${name}`,
        fix: 'Animate transform, translate, scale or opacity instead.',
      });
    }
  }
  return findings;
}

/**
 * Audit a compiled page's markup, stylesheet and runtime as text. Only the
 * document's own stylesheet is audited; diagram adapter sheets are scoped to
 * their canvas and stopped by it.
 */
export function auditMotionHtml(html: string): MotionAuditReport {
  const findings: MotionFinding[] = [];
  const trusted = /<meta name="generator" content="@bestagentkits\/render /u.test(html);
  if (!trusted) {
    findings.push({
      rule: 'html/untrusted-source',
      severity: 'info',
      message:
        'the page does not name @bestagentkits/render as its generator, so these findings are best effort and a clean report proves little',
      path: 'html',
      fix: 'Audit the Page Spec instead when you have it.',
    });
  }

  const styles = elements(html, 'style');
  const css = styles
    .filter((style) => !style.attributes.includes(ADAPTER_STYLE_MARKER))
    .map((style) => style.body)
    .join('\n');
  const scripts = elements(html, 'script');
  const js = scripts.map((script) => script.body).join('\n');
  findings.push(...cssFindings(css));

  const root = elements(html, 'html', false)[0];
  const policyAttribute = /\bdata-motion="(reduced|none)"/u.exec(root?.attributes ?? '')?.[1];
  const policy: MotionPolicy | undefined = trusted
    ? motionPolicyOf(policyAttribute ?? 'full')
    : undefined;

  // Count uses in the markup only; stylesheet selectors and runtime strings
  // name the same attribute.
  let markup = '';
  let cursor = 0;
  for (const range of [...styles, ...scripts].sort((a, b) => a.start - b.start)) {
    if (range.start < cursor) continue;
    markup += html.slice(cursor, range.start);
    cursor = range.end;
  }
  markup += html.slice(cursor);
  const counts = new Map<string, number>();
  for (const match of markup.matchAll(/\bdata-ak-motion="([^"<>]{0,64})"/gu)) {
    const id = match[1] ?? '';
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const recipes = [...counts]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, count]) => ({ id, count }));
  for (const { id } of recipes) {
    if (getMotionRecipe(id) === undefined) {
      findings.push({
        rule: 'html/unknown-recipe',
        severity: 'warning',
        message: `data-ak-motion="${id}" names no recipe this compiler knows`,
        path: 'html',
        evidence: `data-ak-motion="${id}"`,
        fix: `Use a known recipe: ${MOTION_RECIPES.map((recipe) => recipe.id).join(', ')}.`,
      });
      continue;
    }
    if (!css.includes(`[data-ak-motion="${id}"]`)) {
      findings.push({
        rule: 'html/missing-recipe-css',
        severity: 'error',
        message: `"${id}" is applied in the markup but the stylesheet has no rules for it`,
        path: 'css',
        evidence: `data-ak-motion="${id}"`,
        fix: 'Recompile the page from its spec; recipe CSS is emitted with the recipe.',
        recipe: id,
      });
    }
    const marker = LIFECYCLE_MARKERS[id];
    if (marker !== undefined && !js.includes(marker)) {
      findings.push({
        rule: id === 'dialog-pop' ? 'html/missing-exit' : 'html/missing-lifecycle',
        severity: 'error',
        message:
          id === 'dialog-pop'
            ? 'a dialog-pop dialog ships without its exit phase, so it closes without the recipe and its focus handling'
            : `"${id}" ships without its lifecycle runtime, so its state changes never animate`,
        path: 'script',
        evidence: marker,
        fix: 'Recompile the page from its spec; the lifecycle runtime is emitted with the recipe.',
        recipe: id,
      });
    }
  }

  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/iu.exec(html)?.[1];
  if (csp === undefined) {
    findings.push({
      rule: 'html/missing-csp',
      severity: 'error',
      message: 'the page declares no Content-Security-Policy',
      path: 'html',
      fix: "Declare a CSP that starts from default-src 'none' with nonces for the inline style and script.",
    });
  } else if (/unsafe-inline|unsafe-eval/iu.test(csp)) {
    findings.push({
      rule: 'html/unsafe-csp',
      severity: 'error',
      message: 'the CSP allows unsafe-inline or unsafe-eval',
      path: 'html',
      evidence: clip(csp.replace(/&#39;|&apos;/gu, "'")),
      fix: 'Use nonces instead of unsafe-inline, and never allow unsafe-eval.',
    });
  }

  const remote: string[] = [];
  for (const script of scripts) {
    const src = /\bsrc="([^"]*)"/u.exec(script.attributes)?.[1];
    if (src !== undefined) remote.push(`<script src="${src}">`);
  }
  for (const link of elements(html, 'link', false)) {
    if (/\brel="stylesheet"/iu.test(link.attributes)) remote.push(`<link${link.attributes}>`);
  }
  for (const match of css.matchAll(/@import\b[^;]*;?/gu)) remote.push(match[0]);
  for (const url of cssUrls(css)) {
    if (/^url\(\s*['"]?(?:https?:)?\/\//iu.test(url)) remote.push(url);
  }
  for (const resource of remote) {
    findings.push({
      rule: 'html/remote-resource',
      severity: 'error',
      message: 'the page loads a script or stylesheet resource from outside the file',
      path: 'html',
      evidence: clip(resource),
      fix: 'Inline the resource; a compiled page is one offline file.',
    });
  }

  return report('html', findings, {
    trusted,
    recipes,
    ...(policy === undefined ? {} : { policy }),
  });
}
