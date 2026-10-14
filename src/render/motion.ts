/**
 * The motion policy: one place that decides what may move on a page.
 *
 * Two inputs meet here: the theme's `motion-policy` token and the reader's
 * `prefers-reduced-motion` setting. The reader's setting always wins.
 *
 * | theme policy | system `no-preference` | system `reduce` |
 * | ------------ | ---------------------- | --------------- |
 * | `full`       | full                   | still           |
 * | `reduced`    | restrained             | still           |
 * | `none`       | still                  | still           |
 *
 * - **full**: every transition, entrance, ambient loop, scroll-linked parallax,
 *   smooth scroll, count-up and the theme view transition.
 * - **restrained**: state feedback only. Colour, shadow and opacity
 *   transitions keep the theme duration; anything that would move (a hover
 *   lift, an image zoom, a turning chevron) jumps to its end state, and every
 *   keyframe animation, smooth scroll and script-driven motion is off.
 * - **still**: the duration token is 0ms, so state changes are instant, and
 *   nothing animates.
 *
 * In every state, scroll-position indicators (the reading-progress rail and
 * the edge shades of sideways scrollers) keep following the scroll position.
 * They are driven by a scroll timeline, not by time, and they report state the
 * way a scrollbar does, so they are feedback rather than motion.
 *
 * The mechanism has three parts that all key off this module:
 *
 * - Feature sheets put every animation, and every transition that moves
 *   something for decoration, behind `MOTION_ALLOWED`. `applyMotionPolicy`
 *   turns that condition into one that never matches for `reduced` and `none`.
 * - The theme sheet zeroes `--ak-motion-duration` under `none` and under the
 *   system setting, so token-timed transitions become instant.
 * - The root carries `data-motion` for `reduced` and `none`; the runtime reads
 *   it before any script-driven motion, and adapter canvases stop under it.
 *
 * `motionDiagnostics` checks the emitted stylesheet against these rules, so an
 * unguarded animation fails the compile rather than shipping.
 */

export type MotionPolicy = 'full' | 'reduced' | 'none';

/** The media condition every animation sits behind. */
export const MOTION_ALLOWED = '(prefers-reduced-motion:no-preference)';

/**
 * Keyframes that follow the scroll position rather than time. They are the only
 * animations allowed outside `MOTION_ALLOWED`, and only on a scroll timeline.
 */
export const SCROLL_POSITION_KEYFRAMES: ReadonlySet<string> = new Set([
  'ak-reading',
  'ak-scroll-edges',
]);

/**
 * Print shows the settled page: nothing is mid-entrance, and no scroll-linked
 * indicator is caught at some position.
 */
export const PRINT_STILL_CSS =
  '@media print{*,*::before,*::after{animation:none!important;transition:none!important}}';

/**
 * Restrained feedback changes colour, shadow and opacity but never moves
 * anything: a hover lift, an image zoom or a turning chevron jumps to its end
 * state, as WCAG 2.3.3 asks of motion a reader's interaction starts. Every kept
 * transition runs at the theme duration and easing with no delay, so authored
 * per-property times cannot shift onto the wrong property. Screen only: print
 * keeps `PRINT_STILL_CSS`.
 */
export const RESTRAINED_CSS =
  '@media screen{:root[data-motion="reduced"] *,:root[data-motion="reduced"] *::before,:root[data-motion="reduced"] *::after{transition-property:color,background-color,border-color,outline-color,text-decoration-color,box-shadow,opacity,fill,stroke!important;transition-duration:var(--ak-motion-duration)!important;transition-timing-function:var(--ak-motion-easing)!important;transition-delay:0s!important}}';

export function motionPolicyOf(value: string | undefined): MotionPolicy {
  return value === 'reduced' || value === 'none' ? value : 'full';
}

/**
 * Apply the theme policy to the assembled stylesheet. Under `reduced` and
 * `none` the guard can never match, so the page keeps only what sits outside
 * it: token-timed state transitions and the scroll-position indicators.
 */
export function applyMotionPolicy(css: string, policy: MotionPolicy): string {
  if (policy === 'full') return css;
  const still = css.replaceAll(
    MOTION_ALLOWED,
    `${MOTION_ALLOWED} and (prefers-reduced-motion:reduce)`,
  );
  return policy === 'reduced' ? `${still}\n${RESTRAINED_CSS}` : still;
}

/** The `data-motion` value the root carries, or `undefined` under `full`. */
export function rootMotionAttribute(policy: MotionPolicy): string | undefined {
  return policy === 'full' ? undefined : policy;
}

export interface CssDeclaration {
  property: string;
  value: string;
  /** Preludes of every enclosing block, outermost first. */
  context: readonly string[];
}

/**
 * Blocks nested deeper than this are walked for balance but not collected, so
 * hostile input cannot make the context copies grow with the nesting. A sheet
 * that nests deeper reports `tooDeep`, and {@link motionDiagnostics} fails it.
 */
export const CSS_MAX_NESTING = 32;

/**
 * Every declaration in a stylesheet with its enclosing preludes. Feature sheets
 * are compiler-authored and adapter sheets have passed the stylesheet filter,
 * so a brace-and-semicolon walk is enough; strings never hold braces here.
 * The motion audit also feeds it untrusted pages, so the work stays linear:
 * enclosing preludes are shared until the nesting changes, and blocks past
 * {@link CSS_MAX_NESTING} are skipped.
 */
export function parseCssDeclarations(css: string): {
  found: CssDeclaration[];
  blocks: CssDeclaration[];
  tooDeep: boolean;
} {
  const found: CssDeclaration[] = [];
  const blocks: CssDeclaration[] = [];
  const stack: string[] = [];
  // Depth including skipped blocks past the cap.
  let depth = 0;
  let tooDeep = false;
  // One frozen copy of the stack, shared by every entry until it changes.
  let context: readonly string[] = [];
  // Facts of each open context, so each prelude is read once, when it opens.
  const factsStack: ContextFacts[] = [NO_FACTS];
  FACTS.set(context, NO_FACTS);
  let buffer = '';
  const flush = () => {
    const text = buffer.trim();
    buffer = '';
    const colon = text.indexOf(':');
    if (colon <= 0 || stack.length === 0 || depth > CSS_MAX_NESTING) return;
    found.push({
      property: text.slice(0, colon).trim().toLowerCase(),
      value: text.slice(colon + 1).trim(),
      context,
    });
  };
  for (const character of css) {
    if (character === '{') {
      const prelude = buffer.trim();
      buffer = '';
      depth += 1;
      if (depth > CSS_MAX_NESTING) {
        tooDeep = true;
        continue;
      }
      blocks.push({ property: prelude, value: '', context });
      stack.push(prelude);
      context = [...stack];
      const facts = joinFacts(factsStack.at(-1) ?? NO_FACTS, preludeFacts(prelude));
      factsStack.push(facts);
      FACTS.set(context, facts);
    } else if (character === '}') {
      flush();
      if (depth > 0) depth -= 1;
      if (stack.length > depth) {
        stack.pop();
        factsStack.pop();
        context = [...stack];
        FACTS.set(context, factsStack.at(-1) ?? NO_FACTS);
      }
    } else if (character === ';') {
      flush();
    } else {
      buffer += character;
    }
  }
  return { found, blocks, tooDeep };
}

/** Split a value or a media query list on its top-level commas. */
export function layers(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const character of value) {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }
  parts.push(current.trim());
  return parts;
}

/**
 * True when some enclosing `@media` holds only queries that need the guard (or
 * print): `(min-width:0),(prefers-reduced-motion:no-preference)` still matches
 * under reduced motion, so it is not a guard.
 */
export const isGuarded = (context: readonly string[]) => contextFacts(context).guarded;

const isGuardPrelude = (prelude: string) => {
  if (!prelude.startsWith('@media')) return false;
  const queries = layers(prelude.slice('@media'.length));
  return (
    queries.some((query) => query.includes(MOTION_ALLOWED)) &&
    queries.every(
      (query) => (query.includes(MOTION_ALLOWED) && !/^not\b/u.test(query)) || query === 'print',
    )
  );
};

interface ContextFacts {
  guarded: boolean;
  printOnly: boolean;
  inKeyframes: boolean;
}

const NO_FACTS: ContextFacts = { guarded: false, printOnly: false, inKeyframes: false };

const preludeFacts = (prelude: string): ContextFacts => ({
  guarded: isGuardPrelude(prelude),
  printOnly: /^@media\s+print$/u.test(prelude),
  inKeyframes: prelude.startsWith('@keyframes'),
});

const joinFacts = (outer: ContextFacts, inner: ContextFacts): ContextFacts => ({
  guarded: outer.guarded || inner.guarded,
  printOnly: outer.printOnly || inner.printOnly,
  inKeyframes: outer.inKeyframes || inner.inKeyframes,
});

/**
 * Facts the parser recorded for each context it handed out, so every prelude
 * is read once when its block opens, never once per declaration or nested
 * block: a long prelude over many rules stays linear.
 */
const FACTS = new WeakMap<readonly string[], ContextFacts>();

function contextFacts(context: readonly string[]): ContextFacts {
  let facts = FACTS.get(context);
  if (facts === undefined) {
    facts = context.map(preludeFacts).reduce(joinFacts, NO_FACTS);
    FACTS.set(context, facts);
  }
  return facts;
}

/** True inside an `@keyframes` block, whose declarations are frames, not rules. */
export const isInKeyframes = (context: readonly string[]) => contextFacts(context).inKeyframes;

/** A selector or name short enough to quote in a message. */
export function clipSelector(text: string, length = 120): string {
  const flat = text.length > length * 4 ? text.slice(0, length * 4) : text;
  const single = flat.replace(/\s+/gu, ' ').trim();
  return single.length > length ? `${single.slice(0, length - 1)}…` : single;
}

const TIME = /(?:^|[\s(])\d*\.?\d+m?s\b/u;
const ZERO_TIME = /(?:^|[\s(])0*\.?0+m?s\b/gu;

/** Theme variables whose times the still state zeroes; easing carries no time. */
const TOKEN_TIME = /var\(--ak-(?:motion-duration|motion-easing|transition)\)/gu;

/**
 * A time left once the token variables are removed is fixed: the still state
 * cannot zero it. Any other `var()` counts as fixed too, since its value or
 * fallback may be a fixed time. A zero time moves nothing.
 */
export const hasFixedTime = (layer: string) => {
  const rest = layer.replace(TOKEN_TIME, '').replace(ZERO_TIME, ' ');
  return rest.includes('var(') || TIME.test(rest);
};

/**
 * Motion invariants of an emitted stylesheet, as human-readable messages:
 *
 * - every animation layer sits behind `MOTION_ALLOWED`, except a
 *   scroll-position indicator on a scroll timeline;
 * - every transition outside the guard is timed by the duration token, with no
 *   fixed duration or delay, so the still state makes it instant;
 * - each keyframes name is defined once, because a later definition silently
 *   replaces an earlier one page-wide.
 *
 * Adapter stylesheets are not part of the page sheet; their canvas stops them
 * under every still or restrained state and in print.
 */
export function motionDiagnostics(css: string): string[] {
  const messages = new Set<string>();
  const { found: all, blocks, tooDeep } = parseCssDeclarations(css);
  if (tooDeep) {
    messages.add(
      `the stylesheet nests blocks deeper than ${CSS_MAX_NESTING} levels, so its motion cannot be checked`,
    );
  }
  const counts = new Map<string, number>();
  for (const block of blocks) {
    const name = /^@keyframes\s+([\w-]+)/u.exec(block.property)?.[1];
    if (name !== undefined) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  for (const [name, count] of counts) {
    if (count > 1) messages.add(`@keyframes ${name} is defined ${count} times`);
  }

  const scrollTimelines = new Set(
    all
      .filter((item) => item.property === 'animation-timeline' && /^scroll\(/u.test(item.value))
      .map((item) => item.context),
  );
  for (const declaration of all) {
    const { property, value, context } = declaration;
    const facts = contextFacts(context);
    if (facts.guarded || facts.printOnly || facts.inKeyframes) continue;
    const plain = value.replace(/!important$/u, '').trim();
    const selector = clipSelector(context.at(-1) ?? '');
    if (property === 'animation' || property === 'animation-name') {
      const onScrollTimeline = scrollTimelines.has(context);
      for (const layer of layers(plain)) {
        if (/^none\b/u.test(layer)) continue;
        const name = /ak-[\w-]+/u.exec(layer)?.[0] ?? layer;
        if (!SCROLL_POSITION_KEYFRAMES.has(name) || !onScrollTimeline) {
          messages.add(
            `animation ${clipSelector(name)} on ${selector} is not behind ${MOTION_ALLOWED}`,
          );
        }
      }
    } else if (
      property === 'transition' ||
      property === 'transition-duration' ||
      property === 'transition-delay'
    ) {
      if (layers(plain).some(hasFixedTime)) {
        messages.add(`${property} on ${selector} has a fixed time outside ${MOTION_ALLOWED}`);
      }
    }
  }
  return [...messages];
}
