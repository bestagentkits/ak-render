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
 * - **restrained**: state feedback only. Hover, focus, press and disclosure
 *   transitions keep the theme duration; every keyframe animation, smooth
 *   scroll and script-driven motion is off.
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
  return css.replaceAll(MOTION_ALLOWED, `${MOTION_ALLOWED} and (prefers-reduced-motion:reduce)`);
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

const isGuarded = (context: readonly string[]) =>
  context.some((prelude) => prelude.startsWith('@media') && prelude.includes(MOTION_ALLOWED));

/** Adapter stylesheets are scoped to their canvas, which has its own still rules. */
const isAdapterScoped = (context: readonly string[]) =>
  context.some((prelude) => prelude.startsWith('@scope'));

const isPrintOnly = (context: readonly string[]) =>
  context.some((prelude) => /^@media\s+print\b/u.test(prelude));

const TIME = /(?:^|[\s(])\d*\.?\d+m?s\b/u;

/** Split a value on its top-level commas: one entry per transition. */
function layers(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const character of value) {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  parts.push(current);
  return parts;
}

/**
 * Motion invariants of an emitted stylesheet, as human-readable messages:
 *
 * - every animation sits behind `MOTION_ALLOWED`, except a scroll-position
 *   indicator on a scroll timeline;
 * - every transition outside the guard is timed by the duration token, so the
 *   still state makes it instant;
 * - each keyframes name is defined once, because a later definition silently
 *   replaces an earlier one page-wide.
 */
export function motionDiagnostics(css: string): string[] {
  const messages = new Set<string>();
  const { found: all, blocks } = parse(css);
  const counts = new Map<string, number>();
  for (const block of blocks) {
    // Adapter keyframes cannot reuse a page name; that is the stylesheet
    // filter's check, and two copies of one diagram may share theirs.
    if (isAdapterScoped(block.context)) continue;
    const name = /^@keyframes\s+([\w-]+)/u.exec(block.property)?.[1];
    if (name !== undefined) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  for (const [name, count] of counts) {
    if (count > 1) messages.add(`@keyframes ${name} is defined ${count} times`);
  }

  for (const declaration of all) {
    const { property, value, context } = declaration;
    if (isGuarded(context) || isAdapterScoped(context) || isPrintOnly(context)) continue;
    if (context.some((prelude) => prelude.startsWith('@keyframes'))) continue;
    const plain = value.replace(/!important$/u, '').trim();
    if (property === 'animation' || property === 'animation-name') {
      if (/^none\b/u.test(plain)) continue;
      const name = /ak-[\w-]+/u.exec(plain)?.[0] ?? plain;
      const selector = context.at(-1) ?? '';
      const onScrollTimeline = all.some(
        (other) =>
          other.property === 'animation-timeline' &&
          /^scroll\(/u.test(other.value) &&
          other.context.join('{') === context.join('{'),
      );
      if (!SCROLL_POSITION_KEYFRAMES.has(name) || !onScrollTimeline) {
        messages.add(`animation ${name} on ${selector} is not behind ${MOTION_ALLOWED}`);
      }
    } else if (property === 'transition' || property === 'transition-duration') {
      const fixed = layers(plain).some((layer) => !layer.includes('--ak-') && TIME.test(layer));
      if (fixed) {
        messages.add(
          `transition on ${context.at(-1) ?? ''} has a fixed duration outside ${MOTION_ALLOWED}`,
        );
      }
    }
  }
  return [...messages];
}
