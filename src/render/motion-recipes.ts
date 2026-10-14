/**
 * Motion recipes: named, first-party motion intents a block opts into with
 * `motion: { preset }`.
 *
 * A recipe is not a style recipe (`theme.recipes`): it never changes how a
 * surface looks at rest, only how it arrives, leaves or changes. The author
 * names an intent; the compiler owns the selectors, keyframes, timings and the
 * small runtime part a recipe needs. Nothing an author writes reaches CSS or
 * script.
 *
 * Every recipe obeys the motion policy in `motion.ts`:
 *
 * - keyframe animations sit behind `MOTION_ALLOWED`, so the reader's
 *   reduced-motion setting and the theme's `reduced`/`none` policy turn them
 *   off, and print shows the settled page;
 * - transitions outside the guard are timed only by the semantic scale below,
 *   which derives from `--ak-motion-duration`, so the still state makes them
 *   instant and the restrained state keeps only colour and opacity;
 * - script-driven parts check `motionAllowed()` and fall back to the settled
 *   end state without waiting for an event that may never fire.
 *
 * Without scripts every recipe leaves the page in its final, readable state.
 *
 * Precedence, strongest first: the reader's reduced-motion setting, the theme
 * `motion-policy`, the block's `motion.preset`, then the block's built-in
 * motion. `preset: none` turns the built-in motion of that block off.
 */

import { MOTION_ALLOWED } from './motion.js';

export type MotionTrigger = 'on-enter' | 'state-change' | 'hover' | 'focus';
export type MotionPhase = 'enter' | 'exit' | 'change';
export type MotionStep = 'micro' | 'fast' | 'normal' | 'relaxed' | 'emphasis';

export interface MotionRecipe {
  /** Kebab-case id authors write as `motion.preset`. */
  id: string;
  /** Bumped when a recipe's visible behaviour changes. */
  version: number;
  summary: string;
  /** Block types that accept the recipe. */
  targets: readonly string[];
  triggers: readonly MotionTrigger[];
  phases: readonly MotionPhase[];
  /** The semantic duration and easing the recipe runs on. */
  defaults: { duration: MotionStep; easing: 'standard' | 'enter' | 'exit' };
  /** What a reader with reduced motion, `motion-policy: reduced|none`, print or no script sees. */
  reduced: string;
  /** True when the recipe needs the trusted runtime to play. */
  requiresRuntime: boolean;
  /** Recipe CSS; emitted once per page, only when a block uses the recipe. */
  css: string;
}

/**
 * The semantic duration scale, as multiples of the theme's `motion-duration`
 * (the `normal` step). The factors are design hypotheses: they keep a fixed
 * rhythm across themes while one token sets the tempo, and the still state
 * zeroes every step because it zeroes the base.
 */
export const MOTION_SCALE: Readonly<Record<MotionStep, number>> = {
  micro: 0.4,
  fast: 0.7,
  normal: 1,
  relaxed: 1.6,
  emphasis: 2.2,
};

/**
 * Easings by intent. `standard` is the theme's `motion-easing`; `enter`
 * decelerates into place and `exit` accelerates away. None overshoots.
 */
export const MOTION_EASINGS: Readonly<Record<'standard' | 'enter' | 'exit', string>> = {
  standard: 'var(--ak-motion-easing)',
  enter: 'cubic-bezier(.16,1,.3,1)',
  exit: 'cubic-bezier(.5,0,.75,0)',
};

const step = (name: MotionStep) => `var(--ak-motion-${name})`;
const ease = (name: keyof typeof MOTION_EASINGS) => `var(--ak-motion-ease-${name})`;

/** The scale as variables on the root, so every step follows the base token. */
export const MOTION_SCALE_CSS = `:root{${Object.entries(MOTION_SCALE)
  .map(([name, factor]) =>
    factor === 1
      ? `--ak-motion-${name}:var(--ak-motion-duration)`
      : `--ak-motion-${name}:calc(var(--ak-motion-duration) * ${factor})`,
  )
  .join(';')};${Object.entries(MOTION_EASINGS)
  .map(([name, value]) => `--ak-motion-ease-${name}:${value}`)
  .join(';')}}`;

/** Attribute selector for blocks that use a recipe. */
const uses = (id: string) => `[data-ak-motion="${id}"]`;

/** Most items a stagger offsets; later items share the last delay. */
export const STAGGER_LIMIT = 8;

/**
 * The items a stagger runs through: the entries of the list the block renders
 * directly under its root (stats, cards, KPIs, list, steps, timeline and
 * checklist entries). Structural, so the sheet names no feature's classes.
 */
const STAGGER_ITEMS = ':is(ul,ol,dl)>:is(li,div)';

function staggerDelays(): string {
  const rules: string[] = [];
  for (let index = 2; index <= STAGGER_LIMIT; index += 1) {
    const nth = index === STAGGER_LIMIT ? `n+${index}` : String(index);
    rules.push(
      `${uses('stagger')}[data-ak-entered]>${STAGGER_ITEMS}:nth-child(${nth}){animation-delay:calc(${step('micro')} * ${index - 1})}`,
    );
  }
  return rules.join('');
}

/** Content blocks whose first element carries the block id. */
const CONTENT_TARGETS = [
  'hero',
  'section',
  'card',
  'card-grid',
  'stats',
  'kpi',
  'chart',
  'table',
  'data-table',
  'callout',
  'alert',
  'quote',
  'image',
  'steps',
  'timeline',
  'list',
  'checklist',
  'comparison',
  'metric-breakdown',
  'benchmark-comparison',
  'feature-matrix',
  'text',
  'rich-text',
];

/** The first-party recipes, in emission order. */
export const MOTION_RECIPES: readonly MotionRecipe[] = [
  {
    id: 'reveal-soft',
    version: 1,
    summary: 'The block fades and rises a little as it scrolls into view.',
    targets: CONTENT_TARGETS,
    triggers: ['on-enter'],
    phases: ['enter'],
    defaults: { duration: 'relaxed', easing: 'enter' },
    reduced: 'Shown in place, fully visible, with no movement.',
    requiresRuntime: true,
    css: `@keyframes ak-m-reveal{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@media ${MOTION_ALLOWED}{${uses('reveal-soft')}[data-ak-entered]{animation:ak-m-reveal ${step('relaxed')} ${ease('enter')} both}}`,
  },
  {
    id: 'stagger',
    version: 1,
    summary: `Items arrive one after another as the block scrolls into view; at most ${STAGGER_LIMIT} offsets.`,
    targets: ['stats', 'card-grid', 'kpi', 'list', 'steps', 'timeline', 'checklist'],
    triggers: ['on-enter'],
    phases: ['enter'],
    defaults: { duration: 'normal', easing: 'enter' },
    reduced: 'Every item shown at once, fully visible.',
    requiresRuntime: true,
    css: `@keyframes ak-m-item-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@media ${MOTION_ALLOWED}{${uses('stagger')}[data-ak-entered]>${STAGGER_ITEMS}{animation:ak-m-item-in ${step('normal')} ${ease('enter')} both}${staggerDelays()}}`,
  },
  {
    id: 'number-tick',
    version: 1,
    summary:
      'Figures tick up into place as the block enters, and again when a state change shows it.',
    targets: ['stats', 'kpi'],
    triggers: ['on-enter', 'state-change'],
    phases: ['enter', 'change'],
    defaults: { duration: 'fast', easing: 'enter' },
    reduced: 'Figures shown at their final value.',
    requiresRuntime: true,
    css: `@keyframes ak-m-tick{from{opacity:0;transform:translateY(.45em)}to{opacity:1;transform:none}}
@media ${MOTION_ALLOWED}{${uses('number-tick')}[data-ak-entered] :is(dd,[data-ak-count]){animation:ak-m-tick ${step('fast')} ${ease('enter')} both}}`,
  },
  {
    id: 'crossfade',
    version: 1,
    summary:
      'New content fades in when state changes it: the next tab panel, the next slide, or a block that `visibleWhen` shows.',
    targets: ['tabs', 'carousel', ...CONTENT_TARGETS.filter((type) => type !== 'hero')],
    triggers: ['state-change'],
    phases: ['change'],
    defaults: { duration: 'normal', easing: 'standard' },
    reduced: 'The new content replaces the old instantly.',
    requiresRuntime: true,
    // The runtime marks content as entering only when a change reveals it, so
    // the authored first view never fades. The old content leaves at once, so
    // focus, ARIA and layout always follow one panel.
    css: `@keyframes ak-m-fade-in{from{opacity:0}to{opacity:1}}
@media ${MOTION_ALLOWED}{${uses('crossfade')}[data-ak-entering],${uses('crossfade')} [data-ak-entering]{animation:ak-m-fade-in ${step('normal')} ${ease('standard')} both}}`,
  },
  {
    id: 'tab-indicator',
    version: 1,
    summary: 'A pill slides under the selected tab as the selection moves.',
    targets: ['tabs'],
    triggers: ['state-change'],
    phases: ['change'],
    defaults: { duration: 'normal', easing: 'standard' },
    reduced:
      'The pill moves to the selected tab instantly; under the reduced policy it jumps while colours still fade.',
    requiresRuntime: true,
    // Until the runtime measures the selected tab, the tab keeps its own
    // surface, so the selection never shows without a marker.
    css: `${uses('tab-indicator')}>[role="tablist"]{position:relative;isolation:isolate}
${uses('tab-indicator')}[data-ak-indicator]>[role="tablist"]::before{content:"";position:absolute;z-index:-1;top:0;left:0;width:var(--ak-ind-w);height:var(--ak-ind-h);transform:translate(var(--ak-ind-x),var(--ak-ind-y));border-radius:max(0px,calc(var(--ak-radius-medium) - 3px));background:var(--ak-color-surface);box-shadow:0 0 0 var(--ak-border-width) var(--ak-color-border),0 1px 3px color-mix(in srgb,var(--ak-color-text) 10%,transparent);transition:transform ${step('normal')} ${ease('standard')},width ${step('normal')} ${ease('standard')},height ${step('normal')} ${ease('standard')}}
${uses('tab-indicator')}[data-ak-indicator]>[role="tablist"]>[role="tab"][aria-selected="true"]{background:transparent;box-shadow:none}
@media print{${uses('tab-indicator')}>[role="tablist"]::before{display:none}}`,
  },
  {
    id: 'accordion-expand',
    version: 1,
    summary: 'Sections open and close by growing and shrinking to their content height.',
    targets: ['accordion'],
    triggers: ['state-change'],
    phases: ['enter', 'exit'],
    defaults: { duration: 'normal', easing: 'standard' },
    reduced:
      'Sections open and close instantly; a browser without size interpolation does the same.',
    requiresRuntime: false,
    css: `@media screen and ${MOTION_ALLOWED}{@supports (interpolate-size:allow-keywords){${uses('accordion-expand')}{interpolate-size:allow-keywords}${uses('accordion-expand')}>details::details-content{block-size:0;overflow-y:clip;transition:block-size ${step('normal')} ${ease('standard')},content-visibility ${step('normal')} allow-discrete}${uses('accordion-expand')}>details[open]::details-content{block-size:auto}}}`,
  },
  {
    id: 'dialog-rise',
    version: 1,
    summary: 'The dialog rises into place on open and sinks away on close, with its backdrop.',
    targets: ['dialog'],
    triggers: ['state-change'],
    phases: ['enter', 'exit'],
    defaults: { duration: 'emphasis', easing: 'enter' },
    reduced: 'The dialog opens and closes instantly; focus returns to the opener either way.',
    requiresRuntime: true,
    css: `@keyframes ak-m-dialog-rise{from{opacity:0;transform:translateY(16px) scale(.97)}to{opacity:1;transform:none}}
@keyframes ak-m-dialog-sink{from{opacity:1;transform:none}to{opacity:0;transform:translateY(10px) scale(.98)}}
@keyframes ak-m-backdrop-in{from{opacity:0}to{opacity:1}}
@keyframes ak-m-backdrop-out{from{opacity:1}to{opacity:0}}
@media ${MOTION_ALLOWED}{dialog.ak-dialog${uses('dialog-rise')}[open]{animation:ak-m-dialog-rise ${step('emphasis')} ${ease('enter')} both}dialog.ak-dialog${uses('dialog-rise')}[open]::backdrop{animation:ak-m-backdrop-in ${step('relaxed')} ${ease('standard')} both}dialog.ak-dialog${uses('dialog-rise')}[open][data-ak-closing]{animation:ak-m-dialog-sink ${step('fast')} ${ease('exit')} both}dialog.ak-dialog${uses('dialog-rise')}[open][data-ak-closing]::backdrop{animation:ak-m-backdrop-out ${step('fast')} ${ease('exit')} both}}`,
  },
];

/** `preset: none`: the block's built-in motion is off. */
export const MOTION_NONE = 'none';

/**
 * The off switch: a block that opts out keeps no keyframe animation of its own,
 * pseudo-elements included. Scroll-position indicators (the overflow shades on
 * tables, diagrams and roadmaps) are not motion and keep working, as ADR 0002
 * requires; the caller passes the shaded boxes its page styles, so the sheet
 * never names a feature the page does not use.
 */
function noneCss(edges: readonly string[]): string {
  const descendants = edges.length === 0 ? '*' : `*:not(${edges.join(',')})`;
  return [uses(MOTION_NONE), `${uses(MOTION_NONE)} ${descendants}`]
    .flatMap((scope) => [scope, `${scope}::before`, `${scope}::after`, `${scope}::backdrop`])
    .join(',')
    .concat('{animation:none!important}');
}

const BY_ID: ReadonlyMap<string, MotionRecipe> = new Map(
  MOTION_RECIPES.map((recipe) => [recipe.id, recipe]),
);

export function motionRecipe(id: string): MotionRecipe | undefined {
  return BY_ID.get(id);
}

/** Presets a block type accepts, in registry order, then `none`; empty when it accepts none. */
export function motionPresetsFor(type: string): string[] {
  const ids = MOTION_RECIPES.filter((recipe) => recipe.targets.includes(type)).map(
    (recipe) => recipe.id,
  );
  return ids.length === 0 ? [] : [...ids, MOTION_NONE];
}

/** Recipes that start when a block enters the viewport. */
export const ENTER_RECIPES: ReadonlySet<string> = new Set(
  MOTION_RECIPES.filter((recipe) => recipe.triggers.includes('on-enter')).map(
    (recipe) => recipe.id,
  ),
);

/**
 * The recipe sheet for the presets a page uses: the scale once, then each
 * used recipe once in registry order. Empty when the page uses none.
 */
export function motionRecipeCss(
  used: ReadonlySet<string>,
  scrollEdges: readonly string[] = [],
): string {
  if (used.size === 0) return '';
  const sheets = [MOTION_SCALE_CSS];
  for (const recipe of MOTION_RECIPES) if (used.has(recipe.id)) sheets.push(recipe.css);
  if (used.has(MOTION_NONE)) sheets.push(noneCss(scrollEdges));
  return sheets.join('\n');
}

/** A compact, serializable descriptor of a recipe, for catalog and discovery surfaces. */
export interface MotionRecipeDescriptor {
  id: string;
  version: number;
  summary: string;
  targets: string[];
  triggers: MotionTrigger[];
  phases: MotionPhase[];
  duration: MotionStep;
  easing: 'standard' | 'enter' | 'exit';
  reduced: string;
  requiresRuntime: boolean;
}

export function motionRecipeDescriptors(): MotionRecipeDescriptor[] {
  return MOTION_RECIPES.map((recipe) => ({
    id: recipe.id,
    version: recipe.version,
    summary: recipe.summary,
    targets: [...recipe.targets],
    triggers: [...recipe.triggers],
    phases: [...recipe.phases],
    duration: recipe.defaults.duration,
    easing: recipe.defaults.easing,
    reduced: recipe.reduced,
    requiresRuntime: recipe.requiresRuntime,
  }));
}
