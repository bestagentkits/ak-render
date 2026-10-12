/**
 * Feature sheets for the editorial blocks.
 *
 * Token-driven like every sheet: rules and ink come from `color-text` and
 * `color-border`, type from the heading, body and mono stacks, and spacing from
 * `space-unit`. The look is print-first (hairlines, double rules, flat fills),
 * so it reads the same in light and dark and in print.
 *
 * Three features, each emitted only when a page uses it:
 * - `masthead`: `publication-header`.
 * - `story`: `story` and `digest-list`.
 * - `broadsheet`: `editorial-layout`. Three columns from 1100px, two from
 *   700px with the aside below, one column below that. Regions keep their DOM
 *   order, so nothing is reordered with CSS.
 *
 * The drop cap belongs to the `newspaper` section recipe (see
 * `src/render/recipe-styles.ts`), not to the block.
 */

import type { FeatureModule } from '../../registry/block-module.js';

const unit = (factor: number): string => `calc(var(--ak-space-unit) * ${factor})`;
const INK = 'var(--ak-color-text)';
const MUTED = 'var(--ak-color-text-muted)';
const HAIRLINE = `var(--ak-border-width) solid ${INK}`;
const DOUBLE = `calc(var(--ak-border-width) * 3) double ${INK}`;
const MONO_LABEL = `font-family:var(--ak-font-mono);font-size:.72rem;line-height:1.4;text-transform:uppercase;letter-spacing:.1em`;

/** Children of a region, directly or inside a `visibleWhen` wrapper. */
const regionChildren = (region: string) =>
  `${region} > .ak-block,${region} > [data-ak-when] > .ak-block`;

const MASTHEAD_CSS = [
  `.ak-masthead{display:flex;flex-direction:column;align-items:center;gap:${unit(1)};text-align:center;min-width:0}`,
  `.ak-masthead-meta{display:flex;flex-wrap:wrap;justify-content:space-between;gap:.25em 1em;width:100%;margin:0;padding:.55em 0;border-top:${HAIRLINE};border-bottom:var(--ak-border-width) solid var(--ak-color-border);color:${MUTED};${MONO_LABEL}}`,
  `.ak-masthead-name{max-width:100%;margin:${unit(1)} 0 0;font-size:clamp(2.5rem,8.5vw,6rem);font-weight:800;line-height:.95;letter-spacing:-.02em;overflow-wrap:anywhere;text-wrap:balance}`,
  `.ak-masthead-tagline{margin:0;color:${MUTED};${MONO_LABEL};letter-spacing:.24em}`,
  `.ak-masthead-blurb{max-width:62ch;margin:0;color:${MUTED};font-style:italic}`,
  `.ak-masthead-nav{width:100%;margin-top:${unit(1)};border-top:${DOUBLE};border-bottom:${DOUBLE}}`,
  `.ak-masthead-nav ul{display:flex;flex-wrap:wrap;justify-content:center;gap:0 ${unit(3)};margin:0;padding:0;list-style:none}`,
  `.ak-masthead-nav :is(a,span){display:inline-flex;align-items:center;min-height:44px;color:${INK};${MONO_LABEL};font-size:.78rem;font-weight:650;letter-spacing:.14em;text-decoration:none}`,
  `.ak-masthead-nav a:hover{color:var(--ak-color-accent);text-decoration:underline;text-underline-offset:.3em}`,
  `@media print{.ak-masthead-name{break-after:avoid}}`,
].join('\n');

const STORY_CSS = [
  `.ak-story{display:flex;flex-direction:column;gap:.55em;min-width:0;overflow-wrap:anywhere}`,
  `.ak-story > *{margin:0}`,
  `.ak-story-kicker{color:var(--ak-color-accent);font-family:var(--ak-font-mono);font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.14em}`,
  `.ak-story-title{font-weight:700;line-height:1.1;letter-spacing:-.015em;text-wrap:balance}`,
  `.ak-story-title a{color:inherit;text-decoration:none}`,
  `.ak-story-title a:hover{text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:.15em}`,
  `.ak-story[data-prominence="lead"] .ak-story-title{font-size:clamp(1.9rem,4.2vw,3.2rem);line-height:1.04}`,
  `.ak-story[data-prominence="feature"] .ak-story-title{font-size:clamp(1.35rem,2.6vw,1.95rem)}`,
  `.ak-story[data-prominence="brief"] .ak-story-title{font-size:1.12rem;line-height:1.2}`,
  `.ak-story-meta{display:flex;flex-wrap:wrap;gap:.2em .7em;color:${MUTED};${MONO_LABEL}}`,
  `.ak-story-meta > span + span::before{content:"\\00b7";margin-right:.7em}`,
  `.ak-story-summary{font-size:1.08em;line-height:1.45}`,
  `.ak-story[data-prominence="brief"] .ak-story-summary{font-size:1em}`,
  `.ak-story-body{display:flex;flex-direction:column;gap:.7em;hyphens:auto;line-height:1.6}`,
  `.ak-story-body > p{margin:0;text-wrap:pretty}`,
  `.ak-story-photo{margin:0;display:flex;flex-direction:column;gap:.4em}`,
  `.ak-story-photo img{display:block;width:100%;max-width:100%;height:auto;border:var(--ak-border-width) solid var(--ak-color-border);background:var(--ak-color-surface-raised)}`,
  `.ak-story-photo figcaption{color:${MUTED};font-size:.78rem;line-height:1.4}`,
  `.ak-story-credit{display:block;font-family:var(--ak-font-mono);font-size:.66rem;text-transform:uppercase;letter-spacing:.08em}`,
  `.ak-story-photo-fallback{margin:0;padding:${unit(1.5)};border:var(--ak-border-width) dashed var(--ak-color-border);color:${MUTED}}`,
  `.ak-story[data-prominence="brief"] + .ak-story[data-prominence="brief"]{padding-top:${unit(1.5)};border-top:var(--ak-border-width) dotted ${MUTED}}`,
  `.ak-digest{min-width:0;overflow-wrap:anywhere;border:${HAIRLINE};padding:${unit(1.5)} ${unit(2)}}`,
  `.ak-digest-title{margin:0 0 ${unit(1)};padding-bottom:${unit(1)};border-bottom:${HAIRLINE};font-family:var(--ak-font-mono);font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.14em;line-height:1.3}`,
  `.ak-digest-list{margin:0;padding:0;list-style:none}`,
  `.ak-digest-item{display:flex;flex-direction:column;gap:.15em;padding:${unit(1)} 0}`,
  `.ak-digest-item + .ak-digest-item{border-top:var(--ak-border-width) dotted ${MUTED}}`,
  `.ak-digest-date{color:var(--ak-color-accent);${MONO_LABEL};font-weight:700}`,
  `.ak-digest-title-line{font-weight:650;line-height:1.3}`,
  `.ak-digest-title-line a{color:inherit;text-decoration:none}`,
  `.ak-digest-title-line a:hover{text-decoration:underline;text-underline-offset:.15em}`,
  `.ak-digest-text{color:${MUTED};font-size:.9em;line-height:1.4}`,
  `@media print{.ak-story-photo,.ak-digest-item{break-inside:avoid}.ak-story-title{break-after:avoid}}`,
].join('\n');

const BROADSHEET_CSS = [
  `.ak-broadsheet{display:grid;grid-template-columns:minmax(0,1fr);gap:${unit(3)} 0;min-width:0}`,
  `.ak-bs-lead,.ak-bs-secondary,.ak-bs-aside{display:flex;flex-direction:column;gap:var(--ak-gap);min-width:0}`,
  `${regionChildren('.ak-bs-lead')},${regionChildren('.ak-bs-secondary')},${regionChildren('.ak-bs-aside')}{margin-top:0}`,
  // Narrow: one column in reading order; the aside is set off by a double rule.
  `.ak-bs-secondary,.ak-bs-aside{padding-top:${unit(3)};border-top:${DOUBLE}}`,
  // Tablet: lead and secondary side by side, the aside below as a wide strip.
  `@media (min-width:700px){`,
  `.ak-broadsheet:is([data-regions~="secondary"],[data-regions~="aside"]){grid-template-columns:minmax(0,3fr) minmax(0,2fr)}`,
  `.ak-bs-lead{padding-right:${unit(3)}}`,
  `.ak-bs-secondary,.ak-bs-lead + .ak-bs-aside{padding:0 0 0 ${unit(3)};border-top:0;border-left:${HAIRLINE}}`,
  `.ak-broadsheet[data-regions~="secondary"] .ak-bs-aside{grid-column:1 / -1;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:start;gap:var(--ak-gap) ${unit(3)};margin-top:${unit(3)};padding:${unit(3)} 0 0;border-top:${DOUBLE};border-left:0}`,
  `}`,
  // Desktop: lead, secondary and rail in three ruled columns.
  `@media (min-width:1100px){`,
  `.ak-broadsheet[data-regions~="secondary"][data-regions~="aside"]{grid-template-columns:minmax(0,46fr) minmax(0,30fr) minmax(0,24fr)}`,
  `.ak-broadsheet[data-regions~="secondary"] .ak-bs-aside{grid-column:auto;display:flex;flex-direction:column;margin-top:0;padding:0 0 0 ${unit(3)};border-top:0;border-left:${HAIRLINE}}`,
  `.ak-bs-secondary{padding-right:${unit(3)}}`,
  `}`,
].join('\n');

export const EDITORIAL_FEATURES: readonly FeatureModule[] = [
  { name: 'masthead', marker: '.ak-masthead{', css: MASTHEAD_CSS },
  { name: 'story', marker: '.ak-story{', css: STORY_CSS },
  { name: 'broadsheet', marker: '.ak-broadsheet{', css: BROADSHEET_CSS },
];
