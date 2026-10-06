/**
 * Shared CSS fragments for feature sheets: the transition shorthand, motion
 * timings and the spacing unit, plus the quiet disclosure summary. Feature
 * sheets in `src/render/` and in block modules both build on them.
 */

export const TRANSITION = 'transition:var(--ak-transition)';

/**
 * The quiet disclosure summary: a mono label with a chevron that turns when the
 * `<details>` opens. A chart's data table and an adapter diagram's text
 * description both sit behind one.
 */
export function disclosureSummary(details: string): string {
  return `${details} summary{display:inline-flex;align-items:center;gap:.55em;cursor:pointer;list-style:none;font-family:var(--ak-font-mono);font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:var(--ak-color-text-muted);${TRANSITION}}
${details} summary::-webkit-details-marker{display:none}
${details} summary::before{content:"";width:.42em;height:.42em;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg);${TRANSITION}}
${details}[open] summary::before{transform:rotate(45deg)}
${details} summary:hover{color:var(--ak-color-accent)}
${details}[open] summary{margin-bottom:calc(var(--ak-space-unit) * 1.5)}`;
}

export const EASE_OUT = 'cubic-bezier(.16,1,.3,1)';
export const SLOW = 'calc(var(--ak-motion-duration) * 4)';
export const MID = 'calc(var(--ak-motion-duration) * 1.6)';
export const UNIT = (n: number) => `calc(var(--ak-space-unit) * ${n})`;
