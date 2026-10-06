/**
 * Derived custom properties, computed from theme tokens.
 *
 * `:root` declares them once, and the night band redeclares them because an
 * inherited custom property carries the root's computed result, not its
 * formula. Both read these constants, so the band and dark mode cannot drift.
 * The scroll-edge shades below are written per scroller instead, so their
 * colours resolve where they are used.
 */

/** Hover wash: a little accent mixed into the surface. */
export const TINT =
  '--ak-tint:color-mix(in srgb,var(--ak-color-accent) 7%,var(--ak-color-surface))';

/** Focus halo for inputs and controls. */
export const RING = '--ak-ring:0 0 0 3px color-mix(in srgb,var(--ak-color-accent) 24%,transparent)';

/**
 * Surface background in dark schemes: a faint top-lit sheen, because the fixed
 * elevation shadows are invisible against a dark page.
 */
export const DARK_FILL =
  '--ak-fill:linear-gradient(180deg,color-mix(in srgb,var(--ak-color-text) 4%,transparent),transparent 160px),var(--ak-color-surface)';

const EDGE_SHADE = 'color-mix(in srgb,var(--ak-color-text) 18%,transparent)';

/**
 * Edge shades that show a sideways scroller holds more than it shows.
 *
 * A soft shade sits on each edge of a box whose `background` is `var(--ak-fill)`
 * (the night band and dark mode recolour it from tokens). A scroll timeline
 * sizes each shade from the scroll position: the start edge stays clear until
 * the content moves, and the end edge clears once the end is reached. A box
 * that does not overflow has an inactive timeline and so no shades, and an
 * engine without scroll timelines keeps the plain fill. The shades follow
 * position, not time, so like the reading-progress rail they are not motion and
 * are not gated on reduced motion. `SCROLL_EDGE_KEYFRAMES` must be on the page.
 */
export function scrollEdges(selector: string): string {
  return `@supports (animation-timeline:scroll()){${selector}{background:radial-gradient(farthest-side at 0 50%,${EDGE_SHADE},transparent) left center/0 100% no-repeat,radial-gradient(farthest-side at 100% 50%,${EDGE_SHADE},transparent) right center/0 100% no-repeat,var(--ak-fill);animation:ak-scroll-edges linear both;animation-timeline:scroll(self inline)}}`;
}

/**
 * Shade sizes along the scroll: start clear, both shaded in between, end clear.
 * The third size covers the dark fill's sheen layer and is ignored in light.
 */
export const SCROLL_EDGE_KEYFRAMES =
  '@keyframes ak-scroll-edges{0%{background-size:0 100%,14px 100%,auto}6%,94%{background-size:14px 100%,14px 100%,auto}100%{background-size:14px 100%,0 100%,auto}}';
