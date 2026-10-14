/**
 * The motion recipe registry: named, compiler-owned motion a block opts into
 * with `motion: <preset>` (or `motion: { preset }`).
 *
 * A recipe is data plus compiler-authored CSS. The spec only names it; it can
 * never supply CSS, keyframes, selectors, timings or scripts. Each recipe:
 *
 * - targets a fixed list of block types and is rejected on any other;
 * - emits CSS only when a page uses it, keyed on `[data-ak-motion="<id>"]`,
 *   with keyframes shared and de-duplicated through `MOTION_KEYFRAMES`;
 * - puts every animation and every transition behind `MOTION_ALLOWED`, so the
 *   effective-state matrix in `render/motion.ts` (ADR 0002) gates it like any
 *   other page motion: it plays under `full` only and settles under
 *   restrained, still, print and without JavaScript;
 * - times itself from the semantic scale (`--ak-motion-micro` .. `-emphasis`),
 *   which derives from the theme's `motion-duration`, so a still state that
 *   zeroes the duration zeroes every step.
 *
 * Recipes are original implementations from web-platform primitives. No
 * third-party transition recipe is copied or repackaged.
 *
 * This module is distinct from theme *style* recipes (`theme/recipes.ts`),
 * which restyle surfaces; motion recipes are per-block opt-ins.
 */

import { MOTION_ALLOWED } from '../render/motion.js';

/** When a recipe plays. */
export type MotionTrigger = 'on-enter' | 'state-change';

/** Which part of a lifecycle a recipe animates. */
export type MotionPhase = 'enter' | 'exit' | 'change';

/** A step of the semantic duration scale. */
export type MotionDuration = 'micro' | 'fast' | 'normal' | 'relaxed' | 'emphasis';

/** A named easing curve. */
export type MotionEasing = 'standard' | 'enter' | 'exit' | 'emphasis';

/**
 * What a recipe needs from the runtime:
 *
 * - `none`: pure CSS, adds no script;
 * - `in-view`: the shared arrival observer the runtime already ships;
 * - `lifecycle`: the motion lifecycle part (`motion-runtime.ts`), emitted only
 *   when a page uses such a recipe.
 */
export type MotionRuntime = 'none' | 'in-view' | 'lifecycle';

/** An effective motion state of ADR 0002 that a recipe may play in. */
export type MotionState = 'full' | 'restrained';

/**
 * Whether a recipe carries meaning (`feedback`, which restrained may keep) or
 * only polish (`decoration`, which plays under `full` alone).
 */
export type MotionRole = 'feedback' | 'decoration';

export interface MotionRecipe {
  /** Kebab-case, unique, stable across releases. */
  id: string;
  /** Bumped when the recipe's visible behaviour changes. */
  version: number;
  /** Effective states the recipe plays in; it settles in every other. */
  states: readonly MotionState[];
  role: MotionRole;
  /** One line: what the recipe is for. */
  purpose: string;
  /** Search words an agent might use for this intent. */
  aliases: readonly string[];
  /** Block types the recipe is valid on, or `'*'` for every block but `page`. */
  targets: readonly string[] | '*';
  triggers: readonly MotionTrigger[];
  phases: readonly MotionPhase[];
  duration: MotionDuration;
  easing: MotionEasing;
  /** CSS properties the recipe animates. */
  properties: readonly string[];
  runtime: MotionRuntime;
  /** Keyframes the recipe uses, defined once in `MOTION_KEYFRAMES`. */
  keyframes: readonly string[];
  /** What the reader sees under restrained, still, print and without scripts. */
  reduced: string;
  /** Spec conditions the recipe needs beyond its target type. */
  requires?: { visibleWhen?: true };
  /** Performance and accessibility notes. */
  notes: string;
  /** A minimal block that uses the recipe. */
  example: Record<string, unknown>;
  /** Compiler-authored CSS. Rules that animate go inside `guarded`. */
  css: { plain?: string; guarded: string; print?: string };
}

/** Multipliers of `motion-duration`; see `MOTION_SCALE_CSS`. */
export const MOTION_DURATION_SCALE: Readonly<Record<MotionDuration, number>> = {
  micro: 0.5,
  fast: 0.75,
  normal: 1,
  relaxed: 1.5,
  emphasis: 2.5,
};

/** Easing curves; `standard` follows the theme's `motion-easing`. */
export const MOTION_EASINGS: Readonly<Record<MotionEasing, string>> = {
  standard: 'var(--ak-motion-easing)',
  enter: 'cubic-bezier(.16,1,.3,1)',
  exit: 'cubic-bezier(.4,0,1,1)',
  emphasis: 'cubic-bezier(.34,1.36,.64,1)',
};

/**
 * The semantic scale, declared on every block that carries a recipe so it
 * resolves against that block's own `--ak-motion-duration`. The still state
 * zeroes the duration, which zeroes every step.
 */
export const MOTION_SCALE_CSS = `[data-ak-motion]{${[
  ...Object.entries(MOTION_DURATION_SCALE).map(([step, factor]) =>
    factor === 1
      ? `--ak-motion-${step}:var(--ak-motion-duration)`
      : `--ak-motion-${step}:calc(var(--ak-motion-duration) * ${factor})`,
  ),
  ...Object.entries(MOTION_EASINGS).map(([name, curve]) => `--ak-ease-${name}:${curve}`),
].join(';')}}`;

/** Keyframes shared across recipes; each is emitted at most once per page. */
export const MOTION_KEYFRAMES: Readonly<Record<string, string>> = {
  'ak-m-fade': '@keyframes ak-m-fade{from{opacity:0}}',
  'ak-m-fade-out': '@keyframes ak-m-fade-out{to{opacity:0}}',
  'ak-m-rise': '@keyframes ak-m-rise{from{opacity:0;translate:0 12px}}',
  'ak-m-roll': '@keyframes ak-m-roll{from{opacity:0;translate:0 .45em}}',
  'ak-m-pop-in': '@keyframes ak-m-pop-in{from{opacity:0;scale:.96;translate:0 6px}}',
  'ak-m-pop-out': '@keyframes ak-m-pop-out{to{opacity:0;scale:.98;translate:0 4px}}',
};

const at = (id: string) => `[data-ak-motion="${id}"]`;

/** Bounded stagger: items 2..8 step by one micro, every later item waits the same. */
function staggerDelays(item: string): string {
  const rules: string[] = [];
  for (let nth = 2; nth <= 8; nth += 1) {
    rules.push(
      `${item}:nth-child(${nth}){animation-delay:calc(var(--ak-motion-micro) * ${nth - 1})}`,
    );
  }
  rules.push(`${item}:nth-child(n+9){animation-delay:calc(var(--ak-motion-micro) * 7)}`);
  return rules.join('');
}

const STAGGER_ITEMS = `${at('stagger')}[data-ak-inview]>:is(.ak-stats,.ak-steps,.ak-timeline,.ak-list,.ak-grid)>*`;

const TAB_LIST = `${at('tabs-slide')}>[role="tablist"]`;

const ACCORDION_CONTENT = `${at('accordion-expand')}>details::details-content`;

/** Block types an arrival reveal suits: self-contained content surfaces. */
const REVEAL_TARGETS = [
  'section',
  'card',
  'callout',
  'alert',
  'quote',
  'image',
  'video',
  'chart',
  'table',
  'code',
  'comparison',
  'key-value',
  'diagram-panel',
  'data-table',
  'testimonial',
  'pricing',
  'metric-breakdown',
  'story',
] as const;

/** Freezes a value and everything it holds, so no caller can edit a recipe's CSS. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export const MOTION_RECIPES: readonly MotionRecipe[] = deepFreeze<MotionRecipe[]>([
  {
    id: 'reveal-soft',
    version: 1,
    states: ['full'],
    role: 'decoration',
    purpose: 'The block fades and rises into place once, as it scrolls into view.',
    aliases: ['reveal', 'fade in', 'entrance', 'appear', 'scroll reveal', 'rise'],
    targets: REVEAL_TARGETS,
    triggers: ['on-enter'],
    phases: ['enter'],
    duration: 'emphasis',
    easing: 'enter',
    properties: ['opacity', 'translate'],
    runtime: 'in-view',
    keyframes: ['ak-m-rise'],
    reduced: 'Shown in place, no entrance.',
    notes:
      'Plays once per block. Content is visible until the block arrives, so captures, print and no-JS never see it blank.',
    example: {
      type: 'card',
      title: 'Revenue',
      text: 'Up 12% on last quarter.',
      motion: 'reveal-soft',
    },
    css: {
      guarded: `${at('reveal-soft')}[data-ak-inview]{animation:ak-m-rise var(--ak-motion-emphasis) var(--ak-ease-enter) backwards}`,
    },
  },
  {
    id: 'stagger',
    version: 1,
    states: ['full'],
    role: 'decoration',
    purpose: 'Items of a list-like block arrive one after another as it scrolls into view.',
    aliases: ['stagger', 'cascade', 'sequence', 'one by one', 'staggered reveal'],
    targets: ['stats', 'steps', 'timeline', 'list', 'card-grid'],
    triggers: ['on-enter'],
    phases: ['enter'],
    duration: 'relaxed',
    easing: 'enter',
    properties: ['opacity', 'translate'],
    runtime: 'in-view',
    keyframes: ['ak-m-rise'],
    reduced: 'Every item shown at once.',
    notes:
      'The delay steps by one micro duration and stops growing after the eighth item, so long lists never wait.',
    example: {
      type: 'steps',
      items: [{ title: 'Plan' }, { title: 'Build' }, { title: 'Ship' }],
      motion: 'stagger',
    },
    css: {
      guarded: `${STAGGER_ITEMS}{animation:ak-m-rise var(--ak-motion-relaxed) var(--ak-ease-enter) backwards}${staggerDelays(STAGGER_ITEMS)}`,
    },
  },
  {
    id: 'figure-roll',
    version: 1,
    states: ['full'],
    role: 'decoration',
    purpose:
      'Headline figures roll up into place when the block arrives or a state change shows it.',
    aliases: ['number change', 'kpi change', 'figure', 'value change', 'counter', 'metric update'],
    targets: ['stats', 'kpi'],
    triggers: ['on-enter', 'state-change'],
    phases: ['enter', 'change'],
    duration: 'relaxed',
    easing: 'enter',
    properties: ['opacity', 'translate'],
    runtime: 'in-view',
    keyframes: ['ak-m-roll'],
    reduced: 'Figures shown in place.',
    notes:
      'Pair with visibleWhen to animate a figure swap: the figures roll each time the block is shown again.',
    example: {
      type: 'stats',
      items: [{ label: 'Revenue', value: '$120K' }],
      motion: 'figure-roll',
    },
    css: {
      guarded: `${at('figure-roll')}[data-ak-inview] :is(.ak-stat dd,[data-ak-count]){animation:ak-m-roll var(--ak-motion-relaxed) var(--ak-ease-enter) backwards}`,
    },
  },
  {
    id: 'fade-swap',
    version: 1,
    states: ['full'],
    role: 'decoration',
    purpose: 'The block fades in each time a state change shows it.',
    aliases: ['crossfade', 'fade', 'swap', 'state change', 'content change', 'toggle view'],
    targets: '*',
    triggers: ['state-change'],
    phases: ['enter'],
    duration: 'relaxed',
    easing: 'standard',
    properties: ['opacity'],
    runtime: 'lifecycle',
    keyframes: ['ak-m-fade'],
    reduced: 'The block appears at once.',
    requires: { visibleWhen: true },
    notes:
      'Needs visibleWhen. Hidden content leaves at once, so focus and assistive technology never meet a half-gone block.',
    example: {
      type: 'callout',
      title: 'Annual plan',
      text: 'Two months free.',
      visibleWhen: { path: 'state.plan', equals: 'annual' },
      motion: 'fade-swap',
    },
    css: {
      guarded: `${at('fade-swap')}[data-ak-entering]{animation:ak-m-fade var(--ak-motion-relaxed) var(--ak-ease-standard) backwards}`,
    },
  },
  {
    id: 'tabs-slide',
    version: 1,
    states: ['full'],
    role: 'decoration',
    purpose: 'The selected-tab marker slides to the new tab and the panel fades in.',
    aliases: ['tabs', 'sliding indicator', 'tab underline', 'segmented', 'tab switch'],
    targets: ['tabs'],
    triggers: ['state-change'],
    phases: ['change'],
    duration: 'normal',
    easing: 'enter',
    properties: ['translate', 'width', 'height', 'opacity'],
    runtime: 'lifecycle',
    keyframes: ['ak-m-fade'],
    reduced: 'The marker and the panel switch at once.',
    notes:
      'The marker is one absolutely positioned layer, so its size change repaints only itself. Keyboard roving focus and aria-selected are unchanged.',
    example: {
      type: 'tabs',
      items: [
        { title: 'Monthly', text: 'Billed every month.' },
        { title: 'Annual', text: 'Two months free.' },
      ],
      motion: 'tabs-slide',
    },
    css: {
      plain: `${TAB_LIST}[data-ak-indicator]{position:relative;isolation:isolate}${TAB_LIST}[data-ak-indicator]::before{content:"";position:absolute;z-index:-1;left:0;top:0;width:var(--ak-tab-w,0);height:var(--ak-tab-h,0);translate:var(--ak-tab-x,0) var(--ak-tab-y,0);border-radius:max(0px,calc(var(--ak-radius-medium) - 3px));background:var(--ak-color-surface);box-shadow:0 0 0 var(--ak-border-width) var(--ak-color-border),0 1px 3px color-mix(in srgb,var(--ak-color-text) 10%,transparent)}${TAB_LIST}[data-ak-indicator]>[role="tab"][aria-selected="true"]{background:transparent;box-shadow:none}`,
      guarded: `${TAB_LIST}[data-ak-indicator-live]::before{transition:translate var(--ak-motion-normal) var(--ak-ease-enter),width var(--ak-motion-normal) var(--ak-ease-enter),height var(--ak-motion-normal) var(--ak-ease-enter)}${at('tabs-slide')}>[role="tabpanel"][data-ak-entering]{animation:ak-m-fade var(--ak-motion-normal) var(--ak-ease-standard) backwards}`,
    },
  },
  {
    id: 'accordion-expand',
    version: 1,
    states: ['full'],
    role: 'decoration',
    purpose: 'Sections open and close smoothly instead of snapping.',
    aliases: ['expand', 'collapse', 'disclosure', 'smooth accordion', 'faq'],
    targets: ['accordion'],
    triggers: ['state-change'],
    phases: ['enter', 'exit'],
    duration: 'normal',
    easing: 'standard',
    properties: ['block-size'],
    runtime: 'none',
    keyframes: [],
    reduced: 'Sections snap open and shut.',
    notes:
      'Pure CSS on native <details>; browsers without ::details-content or interpolate-size snap as before. One section animates at a time, as the reader opens it.',
    example: {
      type: 'accordion',
      items: [{ title: 'Is it offline?', text: 'Yes, every page opens from file://.' }],
      motion: 'accordion-expand',
    },
    css: {
      guarded: `${at('accordion-expand')}>details{interpolate-size:allow-keywords}${ACCORDION_CONTENT}{block-size:0;overflow-y:clip;transition:block-size var(--ak-motion-normal) var(--ak-ease-standard),content-visibility var(--ak-motion-normal) allow-discrete}${at('accordion-expand')}>details[open]::details-content{block-size:auto}`,
      print: `${ACCORDION_CONTENT}{block-size:auto!important}`,
    },
  },
  {
    id: 'dialog-pop',
    version: 1,
    states: ['full'],
    role: 'decoration',
    purpose: 'The dialog scales in on open and fades out on close, with its backdrop.',
    aliases: ['modal', 'dialog', 'popup', 'overlay', 'open close'],
    targets: ['dialog'],
    triggers: ['state-change'],
    phases: ['enter', 'exit'],
    duration: 'relaxed',
    easing: 'enter',
    properties: ['opacity', 'scale', 'translate'],
    runtime: 'lifecycle',
    keyframes: ['ak-m-pop-in', 'ak-m-pop-out', 'ak-m-fade', 'ak-m-fade-out'],
    reduced: 'The dialog opens and closes at once.',
    notes:
      'Focus returns to the opener after the exit, which never waits longer than its own duration. Escape and the close button share one exit; a reopen during it cancels the close.',
    example: { type: 'dialog', title: 'Confirm', text: 'Publish this page?', motion: 'dialog-pop' },
    css: {
      guarded: `dialog${at('dialog-pop')}[open]{animation:ak-m-pop-in var(--ak-motion-relaxed) var(--ak-ease-enter)}dialog${at('dialog-pop')}[open]::backdrop{animation:ak-m-fade calc(var(--ak-motion-duration) * 1.5) var(--ak-motion-easing)}dialog${at('dialog-pop')}[data-ak-leaving]{animation:ak-m-pop-out var(--ak-motion-fast) var(--ak-ease-exit) forwards}dialog${at('dialog-pop')}[data-ak-leaving]::backdrop{animation:ak-m-fade-out calc(var(--ak-motion-duration) * .75) var(--ak-motion-easing) forwards}`,
    },
  },
]);

const BY_ID: ReadonlyMap<string, MotionRecipe> = new Map(
  MOTION_RECIPES.map((recipe) => [recipe.id, recipe]),
);

export function getMotionRecipe(id: string): MotionRecipe | undefined {
  return BY_ID.get(id);
}

export function motionRecipeTargets(recipe: MotionRecipe, type: string): boolean {
  return recipe.targets === '*' ? type !== 'page' : recipe.targets.includes(type);
}

/** Recipe ids valid on a block type, in registry order. */
export function motionPresetsFor(type: string): string[] {
  return MOTION_RECIPES.filter((recipe) => motionRecipeTargets(recipe, type)).map(
    (recipe) => recipe.id,
  );
}

/**
 * Recipe ids a block type takes beyond the universal ones (`targets: '*'`),
 * for compact descriptions: a universal recipe applies to every block, so
 * repeating it on each one would only add tokens.
 */
export function specificMotionPresetsFor(type: string): string[] {
  return MOTION_RECIPES.filter(
    (recipe) => recipe.targets !== '*' && motionRecipeTargets(recipe, type),
  ).map((recipe) => recipe.id);
}

/** JSON Schema of a `motion` field that accepts the given recipe ids. */
export function motionJsonSchema(presets: readonly string[]): Record<string, unknown> {
  const preset = { type: 'string', enum: [...presets] };
  return {
    description: 'A compiler-owned motion recipe, named by id; a spec cannot supply CSS or script.',
    oneOf: [
      preset,
      { type: 'object', additionalProperties: false, required: ['preset'], properties: { preset } },
    ],
  };
}

/** Recipe ids every block but the page accepts. */
export const UNIVERSAL_MOTION_PRESETS: readonly string[] = MOTION_RECIPES.filter(
  (recipe) => recipe.targets === '*',
).map((recipe) => recipe.id);

/** Every keyframes name a recipe can emit. */
export const MOTION_KEYFRAMES_NAMES: readonly string[] = Object.keys(MOTION_KEYFRAMES);

/**
 * The stylesheet for the recipes a page uses: the scale, each keyframes once,
 * each recipe's rules in registry order, and the animating rules behind the
 * guard. Empty when the page uses none.
 */
export function motionRecipeCss(used: ReadonlySet<string>): string {
  const recipes = MOTION_RECIPES.filter((recipe) => used.has(recipe.id));
  if (recipes.length === 0) return '';
  const keyframes = new Set(recipes.flatMap((recipe) => recipe.keyframes));
  const parts = [MOTION_SCALE_CSS];
  for (const name of MOTION_KEYFRAMES_NAMES) {
    if (keyframes.has(name)) parts.push(MOTION_KEYFRAMES[name] as string);
  }
  const plain = recipes.map((recipe) => recipe.css.plain ?? '').join('');
  if (plain !== '') parts.push(plain);
  parts.push(`@media ${MOTION_ALLOWED}{${recipes.map((recipe) => recipe.css.guarded).join('')}}`);
  const print = recipes.map((recipe) => recipe.css.print ?? '').join('');
  if (print !== '') parts.push(`@media print{${print}}`);
  return parts.join('\n');
}
