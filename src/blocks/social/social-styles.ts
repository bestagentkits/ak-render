/**
 * Feature sheet for `social-post` and `social-feed`.
 *
 * Token-driven only: no platform brand colours. Ink, rules and fills come from
 * `--ak-color-*`, `--ak-fill` and `color-mix()`; type from the theme stacks;
 * spacing from the space unit. The card reads fully in print, in a screenshot
 * and without JavaScript, because every count and mark is text.
 */

import type { FeatureModule } from '../../registry/block-module.js';
import { TRANSITION, UNIT } from '../../render/style-units.js';

const MUTED = 'var(--ak-color-text-muted)';
const RULE = 'var(--ak-border-width) solid var(--ak-color-border)';
const MONO_LABEL =
  'font-family:var(--ak-font-mono);font-size:.68rem;font-weight:600;letter-spacing:.1em;text-transform:uppercase';

const SOCIAL_CSS = [
  // Card
  `.ak-social-post{position:relative;display:flex;flex-direction:column;gap:${UNIT(1.5)};min-width:0;margin:0;padding:${UNIT(2.5)};border:${RULE};border-radius:var(--ak-radius-medium);background:var(--ak-fill);box-shadow:var(--ak-elevation-card);overflow-wrap:anywhere;${TRANSITION}}`,
  `.ak-social-post > *{margin:0}`,
  `.ak-social-feed .ak-social-post:hover{border-color:color-mix(in srgb,var(--ak-color-accent) 35%,var(--ak-color-border))}`,
  // Header: avatar, who/when, platform mark
  `.ak-social-head{display:flex;align-items:flex-start;gap:${UNIT(1.25)};min-width:0}`,
  `.ak-social-post .ak-avatar{flex:none;display:block;width:44px;height:44px;border-radius:50%;object-fit:cover;border:${RULE};background:var(--ak-color-surface-raised)}`,
  `.ak-social-post .ak-avatar[data-initials]{display:inline-grid;place-items:center;font-family:var(--ak-font-heading);font-size:.95rem;font-weight:650;letter-spacing:.02em;line-height:1;white-space:nowrap;overflow:hidden;color:var(--ak-color-text);background:radial-gradient(circle at 30% 25%,color-mix(in srgb,var(--ak-color-accent) 24%,var(--ak-color-surface)),color-mix(in srgb,var(--ak-color-accent) 9%,var(--ak-color-surface)))}`,
  `.ak-social-who{display:flex;flex-wrap:wrap;align-items:center;gap:0 .45em;flex:1;min-width:0;margin:0;line-height:1.35}`,
  `.ak-social-name{font-weight:700;color:var(--ak-color-text)}`,
  `.ak-social-name a{color:inherit;text-decoration:none}`,
  `.ak-social-name a:hover{text-decoration:underline;text-underline-offset:.15em}`,
  `.ak-social-verified{display:inline-grid;place-items:center;width:1.05em;height:1.05em;border-radius:50%;background:var(--ak-color-accent);color:var(--ak-color-accent-contrast)}`,
  `.ak-social-verified .ak-icon{width:.72em;height:.72em}`,
  `.ak-social-handle{color:${MUTED};font-size:.9em}`,
  `.ak-social-time{flex-basis:100%;color:${MUTED};font-size:.8rem;font-variant-numeric:tabular-nums}`,
  `.ak-social-platform{flex:none;display:inline-flex;align-items:center;gap:.4em;padding:.3em .6em;border:${RULE};border-radius:999px;color:${MUTED};${MONO_LABEL}}`,
  `.ak-social-platform .ak-icon{width:1.15em;height:1.15em;color:var(--ak-color-text)}`,
  `.ak-social-reply{color:${MUTED};font-size:.85rem}`,
  // Text
  `.ak-social-text{display:flex;flex-direction:column;gap:.6em;margin:0;line-height:1.55}`,
  `.ak-social-text > p{margin:0;text-wrap:pretty}`,
  `.ak-social-title{font-family:var(--ak-font-heading);font-size:1.12em;font-weight:700;line-height:1.3;letter-spacing:-.01em}`,
  // Media
  `.ak-social-media{display:grid;gap:${UNIT(0.5)};grid-template-columns:repeat(2,minmax(0,1fr));border-radius:var(--ak-radius-small);overflow:hidden}`,
  `.ak-social-media[data-count="1"]{grid-template-columns:minmax(0,1fr)}`,
  `.ak-social-media[data-count="3"] > :first-child{grid-row:span 2}`,
  `.ak-social-media-item{position:relative;display:flex;flex-direction:column;justify-content:center;min-width:0;min-height:0;margin:0;background:var(--ak-color-surface-raised)}`,
  `.ak-social-media-item :is(img,video){display:block;width:100%;height:100%;max-height:30rem;object-fit:cover;background:var(--ak-color-surface-raised)}`,
  `.ak-social-media[data-count="1"] .ak-social-media-item :is(img,video){height:auto;object-fit:contain}`,
  `.ak-social-media-item[data-fallback]{gap:${UNIT(1)};padding:${UNIT(1.5)};border:var(--ak-border-width) dashed var(--ak-color-border)}`,
  `.ak-social-media-item[data-fallback] img{max-height:12rem;opacity:.85}`,
  `.ak-social-media-fallback{margin:0;color:${MUTED};font-size:.85rem;line-height:1.45}`,
  `.ak-social-media-fallback strong{display:block;color:var(--ak-color-text);font-weight:600}`,
  `.ak-social-watch{align-self:flex-start;color:var(--ak-color-accent);font-weight:600}`,
  // Quoted post: inset, quieter
  `.ak-social-quoted{padding:${UNIT(1.75)};border-radius:var(--ak-radius-small);background:color-mix(in srgb,var(--ak-color-text) 3%,transparent);box-shadow:none;font-size:.94em}`,
  `.ak-social-quoted .ak-avatar{width:28px;height:28px;font-size:.62rem;letter-spacing:0}`,
  `.ak-social-quoted .ak-social-time{flex-basis:auto}`,
  `.ak-social-quoted .ak-social-time::before{content:"\\00b7";margin-right:.45em}`,
  // Footer: counts as text, then the link out
  `.ak-social-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:${UNIT(1)} ${UNIT(2)};padding-top:${UNIT(1.25)};border-top:${RULE}}`,
  `.ak-social-metrics{display:flex;flex-wrap:wrap;gap:.2em .9em;margin:0;padding:0;list-style:none;color:${MUTED};font-size:.85rem}`,
  `.ak-social-metrics data{color:var(--ak-color-text);font-weight:700;font-variant-numeric:tabular-nums}`,
  `.ak-social-asof{flex-basis:100%;font-size:.75rem}`,
  `.ak-social-link{display:inline-flex;align-items:center;min-height:44px;margin-left:auto;color:var(--ak-color-accent);font-weight:600;text-decoration:none}`,
  `.ak-social-link::after{content:"\\2197";margin-left:.3em}`,
  `.ak-social-link:hover{text-decoration:underline;text-underline-offset:.2em}`,
  `.ak-social-quoted .ak-social-foot{padding-top:${UNIT(0.75)}}`,
  `.ak-social-quoted .ak-social-link{min-height:44px;font-size:.85rem}`,
  // Layout: one featured card, or a grid in the supplied order
  `.ak-social-block[data-layout="featured"] > .ak-social-post{max-width:42rem}`,
  `.ak-social-block[data-layout="featured"] > .ak-social-post > .ak-social-text{font-size:1.08em}`,
  `.ak-social-feed{display:grid;gap:${UNIT(2)};grid-template-columns:repeat(auto-fill,minmax(min(100%,19rem),1fr));align-items:start;margin:0;padding:0;list-style:none}`,
  `.ak-social-feed > li{display:flex;min-width:0}`,
  `.ak-social-feed .ak-social-post{flex:1}`,
  `.ak-social-block > h2 + .ak-social-feed,.ak-social-block > h2 + .ak-social-post{margin-top:${UNIT(2)}}`,
  `@media (max-width:480px){.ak-social-post{padding:${UNIT(2)}}.ak-social-media{grid-template-columns:minmax(0,1fr)}.ak-social-media[data-count="3"] > :first-child{grid-row:auto}}`,
  `@media print{.ak-social-post{box-shadow:none!important;break-inside:avoid}.ak-social-link::after{content:" (" attr(href) ")";font-weight:400;font-size:.75em}}`,
].join('\n');

export const SOCIAL_FEATURES: readonly FeatureModule[] = [
  { name: 'social-post', marker: '.ak-social-post{', css: SOCIAL_CSS },
];
