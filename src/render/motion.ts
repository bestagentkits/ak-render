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

interface Declaration {
  property: string;
  value: string;
  /** Preludes of every enclosing block, outermost first. */
  context: readonly string[];
}

/**
 * Every declaration in a stylesheet with its enclosing preludes. Feature sheets
 * are compiler-authored and adapter sheets have passed the stylesheet filter,
 * so a brace-and-semicolon walk is enough; strings never hold braces here.
 */
function parse(css: string): { found: Declaration[]; blocks: Declaration[] } {
  const found: Declaration[] = [];
  const blocks: Declaration[] = [];
  const stack: string[] = [];
  let buffer = '';
  const flush = () => {
    const text = buffer.trim();
    buffer = '';
    const colon = text.indexOf(':');
    if (colon <= 0 || stack.length === 0) return;
    found.push({
      property: text.slice(0, colon).trim().toLowerCase(),
      value: text.slice(colon + 1).trim(),
      context: [...stack],
    });
  };
  for (const character of css) {
    if (character === '{') {
      const prelude = buffer.trim();
      blocks.push({ property: prelude, value: '', context: [...stack] });
      stack.push(prelude);
      buffer = '';
    } else if (character === '}') {
      flush();
      stack.pop();
    } else if (character === ';') {
      flush();
    } else {
      buffer += character;
    }
  }
  return { found, blocks };
}

/** Split a value or a media query list on its top-level commas. */
function layers(value: string): string[] {
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
const isGuarded = (context: readonly string[]) =>
  context.some((prelude) => {
    if (!prelude.startsWith('@media')) return false;
    const queries = layers(prelude.slice('@media'.length));
    return (
      queries.some((query) => query.includes(MOTION_ALLOWED)) &&
      queries.every(
        (query) => (query.includes(MOTION_ALLOWED) && !/^not\b/u.test(query)) || query === 'print',
      )
    );
  });

const isPrintOnly = (context: readonly string[]) =>
  context.some((prelude) => /^@media\s+print$/u.test(prelude));

const TIME = /(?:^|[\s(])\d*\.?\d+m?s\b/u;
const ZERO_TIME = /(?:^|[\s(])0*\.?0+m?s\b/gu;

/** Theme variables whose times the still state zeroes; easing carries no time. */
const TOKEN_TIME = /var\(--ak-(?:motion-duration|motion-easing|transition)\)/gu;

/**
 * A time left once the token variables are removed is fixed: the still state
 * cannot zero it. Any other `var()` counts as fixed too, since its value or
 * fallback may be a fixed time. A zero time moves nothing.
 */
const hasFixedTime = (layer: string) => {
  const rest = layer.replace(TOKEN_TIME, '').replace(ZERO_TIME, ' ');
  return rest.includes('var(') || TIME.test(rest);
};

const contextKey = (context: readonly string[]) => context.join('{');

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
  const { found: all, blocks } = parse(css);
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
      .map((item) => contextKey(item.context)),
  );
  for (const declaration of all) {
    const { property, value, context } = declaration;
    if (isGuarded(context) || isPrintOnly(context)) continue;
    if (context.some((prelude) => prelude.startsWith('@keyframes'))) continue;
    const plain = value.replace(/!important$/u, '').trim();
    const selector = context.at(-1) ?? '';
    if (property === 'animation' || property === 'animation-name') {
      const onScrollTimeline = scrollTimelines.has(contextKey(context));
      for (const layer of layers(plain)) {
        if (/^none\b/u.test(layer)) continue;
        const name = /ak-[\w-]+/u.exec(layer)?.[0] ?? layer;
        if (!SCROLL_POSITION_KEYFRAMES.has(name) || !onScrollTimeline) {
          messages.add(`animation ${name} on ${selector} is not behind ${MOTION_ALLOWED}`);
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
