/** Text 3D: extruded, bevelled lettering from a bundled OFL font, with word or character motion. */

import { pathKey } from '../../diagnostics.js';
import type { IrNode } from '../../ir.js';
import type { BlockModule, CheckContext } from '../../registry/block-module.js';
import {
  anchorProps,
  define,
  enumStr,
  num,
  OPTIONAL_TITLE,
  str,
  txt,
} from '../../registry/define-helpers.js';
import { element, nodeAttributes, stringProp, titleHeader } from '../../render/block-helpers.js';
import { escapeAttribute, escapeText } from '../../render/escape.js';
import { TONES } from './scene-ir.js';
import {
  codePoint,
  fontOf,
  layoutText,
  MAX_TEXT_LENGTH,
  MAX_TEXT_LINES,
  missingGlyphs,
  TEXT_BEVELS,
  TEXT_FONTS,
  TEXT_MATERIALS,
  TEXT_MOTIONS,
  TEXT_SPLITS,
  type TextFont,
  type TextLayout,
  textLines,
} from './text-layout.js';

export const TEXT_PROPS = {
  title: OPTIONAL_TITLE,
  text: str({
    required: true,
    maxLength: MAX_TEXT_LENGTH,
    description: `The words to extrude; up to ${MAX_TEXT_LINES} lines split by a line break. Latin, Latin Extended and Vietnamese are drawn.`,
  }),
  summary: txt({
    maxLength: 600,
    description: 'Optional caption under the lettering.',
  }),
  font: enumStr(TEXT_FONTS, {
    default: 'display',
    description:
      'display: Bricolage Grotesque ExtraBold; serif: Fraunces Bold. Both SIL OFL, bundled.',
  }),
  material: enumStr(TEXT_MATERIALS, { default: 'satin', description: 'Surface finish.' }),
  tone: enumStr(TONES, { default: 'accent', description: 'Theme tone of the lettering.' }),
  depth: num({
    min: 0.05,
    max: 1,
    default: 0.28,
    description: 'Extrusion depth as a fraction of the font size.',
  }),
  bevel: enumStr(TEXT_BEVELS, { default: 'soft', description: 'Edge profile of each glyph.' }),
  animation: enumStr(TEXT_MOTIONS, {
    default: 'rise',
    description:
      'rise: staggered entrance, then a gentle float; wave, float and spin loop. Reduced motion shows the rest pose.',
  }),
  split: enumStr(TEXT_SPLITS, {
    default: 'character',
    description: 'Whether each character or each word moves as one.',
  }),
  ...anchorProps,
};

const pick = <T extends string>(values: readonly T[], raw: unknown, fallback: T): T =>
  (values as readonly unknown[]).includes(raw) ? (raw as T) : fallback;

export interface TextConfig extends TextLayout {
  readonly material: (typeof TEXT_MATERIALS)[number];
  readonly tone: (typeof TONES)[number];
  readonly depth: number;
  readonly bevel: (typeof TEXT_BEVELS)[number];
  readonly motion: (typeof TEXT_MOTIONS)[number];
  readonly split: (typeof TEXT_SPLITS)[number];
}

/** The laid-out text plus the finish; exactly what the runtime receives. */
export function textConfig(node: IrNode): TextConfig {
  const split = pick(TEXT_SPLITS, node.props.split, 'character');
  const layout = layoutText(
    stringProp(node, 'text'),
    pick(TEXT_FONTS, node.props.font, 'display'),
    split,
  );
  return {
    ...layout,
    material: pick(TEXT_MATERIALS, node.props.material, 'satin'),
    tone: pick(TONES, node.props.tone, 'accent'),
    depth: typeof node.props.depth === 'number' ? node.props.depth : 0.28,
    bevel: pick(TEXT_BEVELS, node.props.bevel, 'soft'),
    motion: pick(TEXT_MOTIONS, node.props.animation, 'rise'),
    split,
  };
}

/** The poster canvas matches the stage's 16:9; a phone's 4:3 stage letterboxes it. */
const W = 960;
const H = 540;
const r2 = (value: number) => Math.round(value * 100) / 100;

/**
 * The rest pose, drawn as the live camera sees it: the face, and behind it the
 * extrusion receding toward a vanishing point below the text, so the sides
 * show below each glyph as they do from the live camera's low angle.
 */
export function textPoster(config: TextConfig, label: string, uid: string): string {
  const scale = Math.min((W * 0.84) / Math.max(config.width, 0.5), (H * 0.62) / config.height, 300);
  const cx = W / 2;
  const cy = H / 2;
  const unit = scale / config.unitsPerEm;
  // Outlines are scaled into poster pixels (y down) here, not by a transform, so a
  // gradient on the face spans each line from cap height to baseline.
  const toPixels = (d: string) => {
    let axis = 0;
    return d.replace(/-?\d+(?:\.\d+)?/gu, (n) => {
      const value = Math.round(Number(n) * unit * (axis++ % 2 === 0 ? 10 : -10)) / 10;
      return String(value === 0 ? 0 : value);
    });
  };
  const defs = config.glyphs
    .map((d, i) => `<path id="ak-tx-${uid}-g${i}" d="${toPixels(d)}"/>`)
    .join('');
  const uses = config.units
    .flatMap((u) =>
      u.items.map(
        ([g, x, y]) =>
          `<use href="#ak-tx-${uid}-g${g}" x="${r2(cx + (u.cx + x) * scale)}" y="${r2(cy - (u.cy + y) * scale)}"/>`,
      ),
    )
    .join('');
  const face = `ak-tx-${uid}-face`;
  // The extrusion: copies scaled toward a point far above, back to front, darkening with distance.
  const layers = Math.max(4, Math.min(18, Math.round(config.depth * 48)));
  const vanishY = H * 3.2;
  const shrink = config.depth * 0.045;
  const sides: string[] = [];
  for (let i = layers; i >= 1; i -= 1) {
    const k = 1 - (shrink * i) / layers;
    const tx = r2(cx * (1 - k));
    const ty = r2(vanishY * (1 - k));
    sides.push(
      `<use href="#${face}" class="ak-tx-side${i === layers ? ' ak-tx-back' : ''}" transform="matrix(${r2(k * 10000) / 10000} 0 0 ${r2(k * 10000) / 10000} ${tx} ${ty})"/>`,
    );
  }
  const shadowY = r2(cy + (config.height / 2) * scale + 26);
  const shadowRx = r2(Math.max(config.width * scale * 0.46, 60));
  const fill = `ak-tx-${uid}-fill`;
  const glow = `ak-tx-${uid}-glow`;
  const soft = `ak-tx-${uid}-soft`;
  return `<svg class="ak-3d-poster ak-tx-poster" data-material="${config.material}" data-tone="${config.tone}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeAttribute(
    label,
  )}" preserveAspectRatio="xMidYMid meet"><defs>${defs}<g id="${face}">${uses}</g><linearGradient id="${fill}" x1="0" y1="${r2(-0.74 * scale)}" x2="0" y2="${r2(0.04 * scale)}" gradientUnits="userSpaceOnUse"><stop offset="0" class="ak-tx-s0"/><stop offset=".48" class="ak-tx-s1"/><stop offset=".52" class="ak-tx-s2"/><stop offset="1" class="ak-tx-s3"/></linearGradient><filter id="${soft}" x="-30%" y="-200%" width="160%" height="500%"><feGaussianBlur stdDeviation="14"/></filter><filter id="${glow}" x="-20%" y="-40%" width="140%" height="180%"><feGaussianBlur stdDeviation="9"/></filter></defs><ellipse class="ak-tx-shadow" cx="${cx}" cy="${shadowY}" rx="${shadowRx}" ry="16" filter="url(#${soft})"/><use href="#${face}" class="ak-tx-glow" filter="url(#${glow})"/><g class="ak-tx-sides">${sides.join('')}</g><use href="#${face}" class="ak-tx-face" fill="url(#${fill})"/><use href="#${face}" class="ak-tx-edge"/></svg>`;
}

function renderText(node: IrNode): string {
  const config = textConfig(node);
  const text = config.lines.join('\n');
  const summary = stringProp(node, 'summary');
  const uid = node.id.replace(/[^A-Za-z0-9_-]/gu, '-');
  // A character the font lacks draws as its box, so the caption spells the text out.
  const copy =
    config.missing.length > 0
      ? `<span class="ak-tx-copy">${escapeText(config.lines.join(' '))}</span>`
      : '';
  const caption =
    summary || copy
      ? `<figcaption class="ak-3d-caption">${copy}${summary ? escapeText(summary) : ''}</figcaption>`
      : '';
  return element(
    'figure',
    nodeAttributes(node, {
      class: 'ak-block ak-3d ak-tx',
      'data-ak-3d': 'text',
      'data-ak-3d-state': 'static',
      'data-material': config.material,
      'data-tone': config.tone,
      'data-ak-scene': JSON.stringify(config),
    }),
    [
      titleHeader(node),
      `<div class="ak-3d-stage">${textPoster(config, text, uid)}</div>`,
      caption,
    ].join(''),
  );
}

/**
 * Text needs ink and at most three lines; a character neither font draws is a
 * warning that names it, since the box glyph stands in for it.
 */
export function checkText(node: IrNode, { bag }: CheckContext): void {
  const raw = stringProp(node, 'text');
  const path = pathKey(node.path, 'text');
  if (!raw.trim()) {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path,
      nodeId: node.id,
      message: 'text-3d needs text to draw',
      details: { fix: 'Set `text` to the words to extrude.' },
    });
    return;
  }
  const lines = textLines(raw);
  if (lines.length > MAX_TEXT_LINES) {
    bag.add({
      code: 'SPEC_BOUNDS_ERROR',
      path,
      nodeId: node.id,
      message: `text has ${lines.length} lines; at most ${MAX_TEXT_LINES} are drawn`,
      details: { fix: `Join the text into ${MAX_TEXT_LINES} lines or fewer.` },
    });
  }
  const font = pick(TEXT_FONTS, node.props.font, 'display');
  const missing = missingGlyphs(raw, fontOf(font));
  if (missing.length > 0) {
    const other: TextFont = font === 'display' ? 'serif' : 'display';
    const otherDraws = missingGlyphs(raw, fontOf(other)).length === 0;
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      severity: 'warning',
      path,
      nodeId: node.id,
      message: `font "${font}" has no glyph for ${missing
        .slice(0, 8)
        .map((ch) => `"${ch}" (${codePoint(ch)})`)
        .join(
          ', ',
        )}${missing.length > 8 ? ` and ${missing.length - 8} more` : ''}; a box stands in and the caption spells the text out`,
      details: {
        missing: missing.map(codePoint),
        fix: otherDraws
          ? `Set \`font: ${other}\`, which draws every character.`
          : 'Use Latin, Latin Extended or Vietnamese characters, or move the rest into `summary`.',
      },
    });
  }
}

export const text3dBlock: BlockModule = {
  definition: define({
    type: 'text-3d',
    category: 'media',
    tags: ['3d', 'motion'],
    useCases: ['hero wordmark', 'extruded headline', 'launch title'],
    purpose: 'Extruded, bevelled 3D lettering with word or character motion.',
    summary: 'Extruded 3D text with materials and motion.',
    props: TEXT_PROPS,
    runtimeFeatures: ['three'],
    actions: [],
    a11y: 'The text is the label of the poster and the live canvas; without JS or WebGL and in print the same lettering renders as an SVG, reduced motion shows the rest pose, and a pause button stops looping motion.',
  }),
  render: renderText,
  check: checkText,
};
