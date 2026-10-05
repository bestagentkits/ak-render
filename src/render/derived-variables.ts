/**
 * Derived custom properties, computed from theme tokens.
 *
 * `:root` declares them once, and the night band redeclares them because an
 * inherited custom property carries the root's computed result, not its
 * formula. Both read these constants, so the band and dark mode cannot drift.
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
