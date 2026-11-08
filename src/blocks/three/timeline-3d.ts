/**
 * Timeline 3D: milestones placed in order along a path in space, with a camera
 * that flies from one to the next, step and scrub controls, an annotated
 * narrative card and a bound state path. Without JS or WebGL, and in print, a
 * drawing of the same path from the overview camera, the narrative card and
 * the ordered milestone list carry the content.
 */

import { pathIndex, pathKey } from '../../diagnostics.js';
import type { IrNode } from '../../ir.js';
import { isPlainObject, type JsonValue } from '../../json.js';
import type { BlockModule, CheckContext } from '../../registry/block-module.js';
import {
  anchorProps,
  define,
  enumStr,
  idProp,
  list,
  OPTIONAL_TITLE,
  obj,
  onProp,
  str,
  txt,
} from '../../registry/define-helpers.js';
import { element, nodeAttributes, stringProp, titleHeader } from '../../render/block-helpers.js';
import { escapeAttribute, escapeText } from '../../render/escape.js';
import type { RenderContext } from '../../render/render-context.js';
import { project } from './scene-fallback.js';
import { TONES } from './scene-ir.js';
import {
  dateKey,
  floorY,
  LAYOUTS,
  type Layout,
  MARKER,
  MAX_MILESTONES,
  milestoneCamera,
  milestonePoints,
  overviewCamera,
  resolveLayout,
  type Vec3,
} from './timeline-layout.js';

export const TIMELINE_PROPS = {
  title: OPTIONAL_TITLE,
  summary: txt({
    required: true,
    maxLength: 600,
    description: 'What the timeline shows, in words; the caption and the text alternative.',
  }),
  milestones: list(
    obj({
      id: { ...idProp('Milestone id; `bind` reads and writes it.'), required: true },
      label: str({ required: true, maxLength: 120, description: 'Milestone name.' }),
      date: str({
        maxLength: 40,
        description:
          'Shown as written. ISO-like dates (`1969`, `1969-07`, `1969-07-20`) must run in order.',
      }),
      description: str({
        maxLength: 400,
        description: 'The annotation: shown in the narrative card and the list.',
      }),
      tone: enumStr(TONES, { description: 'Theme tone of the marker and the path after it.' }),
    }),
    {
      required: true,
      minItems: 2,
      maxItems: MAX_MILESTONES,
      description: 'Milestones in time order; the path visits them in this order.',
    },
  ),
  layout: enumStr(LAYOUTS, {
    default: 'auto',
    description:
      '`auto` lays up to 18 milestones along a swaying ribbon and coils more into a rising spiral.',
  }),
  bind: str({
    maxLength: 128,
    description:
      'A state path such as `state.milestone`: the chosen milestone id is written here, and a state value flies to it.',
  }),
  on: onProp('Bindings fired with `{ value }` (the milestone id) when the reader chooses one.'),
  ...anchorProps,
};

type Row = Record<string, JsonValue>;

export interface Milestone {
  id: string;
  label: string;
  date: string;
  description: string;
  tone: string;
}

export function milestonesOf(node: IrNode): Milestone[] {
  const raw = node.props.milestones;
  const rows = Array.isArray(raw) ? (raw.filter(isPlainObject) as Row[]) : [];
  return rows.map((row) => ({
    id: String(row.id),
    label: typeof row.label === 'string' ? row.label : String(row.id),
    date: typeof row.date === 'string' ? row.date : '',
    description: typeof row.description === 'string' ? row.description : '',
    tone: typeof row.tone === 'string' ? row.tone : 'accent',
  }));
}

/** The milestone shown first: the bound state's value when it names one, else the first. */
function initialIndex(node: IrNode, milestones: readonly Milestone[], state: Row): number {
  const path = stringProp(node, 'bind');
  const value = path.startsWith('state.') ? state[path.slice(6)] : undefined;
  const at = milestones.findIndex((m) => m.id === value);
  return at === -1 ? 0 : at;
}

export interface TimelineModel {
  milestones: Milestone[];
  layout: Layout;
  points: Vec3[];
  initial: number;
  config: Record<string, JsonValue>;
}

/** Everything the runtime mounts and the drawing shows, resolved at compile time. */
export function timelineModel(node: IrNode, state: Row): TimelineModel {
  const milestones = milestonesOf(node);
  const layout = resolveLayout(
    typeof node.props.layout === 'string' ? node.props.layout : undefined,
    milestones.length,
  );
  const points = milestonePoints(layout, milestones.length);
  const camera = overviewCamera(points, layout, 16 / 9);
  const initial = initialIndex(node, milestones, state);
  const bind = stringProp(node, 'bind');
  const config: Record<string, JsonValue> = {
    camera: { position: camera.position, target: camera.target, fov: camera.fov },
    lighting: 'studio',
    // Markers are scene objects, so the shared runtime lights, stages and picks them.
    objects: milestones.map((m, i) => ({
      id: m.id,
      label: m.label,
      shape: 'sphere',
      size: MARKER,
      tone: m.tone,
      position: points[i] as Vec3,
    })),
    track: {
      layout,
      initial,
      milestones: milestones.map((m, i) => {
        const view = milestoneCamera(points, i, layout);
        return {
          id: m.id,
          label: m.label,
          date: m.date,
          description: m.description,
          tone: m.tone,
          view: { position: view.position, target: view.target },
        };
      }),
      ...(bind === '' ? {} : { bind }),
    },
  };
  return { milestones, layout, points, initial, config };
}

// ---- Drawing --------------------------------------------------------------------------------

const W = 640;
const H = 360;
const r1 = (n: number) => Math.round(n * 10) / 10;

interface Piece {
  depth: number;
  svg: string;
}

/**
 * The path from the overview camera: soft floor shadows, then segments, stems
 * and glossy markers far to near, a halo on the current milestone and labels
 * on it and on both ends. Milestones after the current one are drawn faded.
 */
export function timelinePoster(model: TimelineModel, label: string, uid: string): string {
  const { milestones, points, initial } = model;
  const camera = overviewCamera(points, model.layout, 16 / 9);
  const reference = Math.hypot(
    camera.position[0] - camera.target[0],
    camera.position[1] - camera.target[1],
    camera.position[2] - camera.target[2],
  );
  const screen = points.map((p) => project(p, camera));
  const ground = floorY(points);
  const floor = points.map((p) => project([p[0], ground, p[2]], camera));
  const f = H / 2 / Math.tan((camera.fov * Math.PI) / 360);
  const radius = (depth: number) => ((MARKER / 2) * f) / depth;
  const gloss = `ak-tl-gloss-${uid}`;
  const shade = (i: number) =>
    `data-tone="${escapeAttribute(milestones[i]?.tone ?? 'accent')}"${i > initial ? ' data-ak-future=""' : ''}`;

  const shadows = floor
    .map((p, i) => {
      const at = screen[i];
      if (p === null || at === null || at === undefined) return '';
      const r = radius(p.depth) * 1.5;
      return `<ellipse class="ak-tl-shadow" cx="${r1(p.x)}" cy="${r1(p.y)}" rx="${r1(r)}" ry="${r1(r * 0.36)}"/>`;
    })
    .join('');

  const pieces: Piece[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const a = screen[i];
    if (a === null || a === undefined) continue;
    const b = screen[i + 1];
    if (b !== null && b !== undefined) {
      const depth = (a.depth + b.depth) / 2;
      pieces.push({
        depth,
        svg: `<line class="ak-3d-mark ak-tl-seg" ${shade(i + 1)} x1="${r1(a.x)}" y1="${r1(a.y)}" x2="${r1(b.x)}" y2="${r1(b.y)}" stroke-width="${r1(Math.max(1.2, (2.6 * reference) / depth))}"/>`,
      });
    }
    const r = radius(a.depth);
    const base = floor[i];
    const stem =
      base === null || base === undefined
        ? ''
        : `<line class="ak-tl-stem" x1="${r1(a.x)}" y1="${r1(a.y)}" x2="${r1(base.x)}" y2="${r1(base.y)}"/>`;
    const halo =
      i === initial
        ? `<circle class="ak-tl-halo" cx="${r1(a.x)}" cy="${r1(a.y)}" r="${r1(r * 2.4)}"/>`
        : '';
    pieces.push({
      // A marker sits just in front of the segments that meet it.
      depth: a.depth - 0.01,
      svg: `${stem}${halo}<circle class="ak-3d-mark ak-tl-dot" ${shade(i)} cx="${r1(a.x)}" cy="${r1(a.y)}" r="${r1(i === initial ? r * 1.35 : r)}"/><circle class="ak-tl-sheen" cx="${r1(a.x - r * 0.3)}" cy="${r1(a.y - r * 0.32)}" r="${r1(r * 0.55)}" fill="url(#${gloss})"/>`,
    });
  }
  // Far to near; equal depths keep path order, so the drawing is the same on every compile.
  const body = pieces
    .map((piece, order) => ({ ...piece, order }))
    .sort((a, b) => b.depth - a.depth || a.order - b.order)
    .map((piece) => piece.svg)
    .join('');

  const tags = [...new Set([0, milestones.length - 1, initial])]
    .map((i) => {
      const at = screen[i];
      const milestone = milestones[i];
      if (at === null || at === undefined || milestone === undefined) return '';
      const x = r1(Math.min(W - 70, Math.max(70, at.x)));
      const y = r1(Math.max(28, at.y - radius(at.depth) * (i === initial ? 3 : 1.8) - 8));
      const heading = milestone.date === '' ? milestone.label : milestone.date;
      const name =
        i === initial && milestone.date !== ''
          ? `<text class="ak-tl-tag-name" x="${x}" y="${r1(y - 16)}">${escapeText(milestone.label)}</text>`
          : '';
      return `<g class="ak-tl-tag"${i === initial ? ' data-ak-current=""' : ''}>${name}<text x="${x}" y="${y}">${escapeText(heading)}</text></g>`;
    })
    .join('');

  return `<svg class="ak-3d-poster ak-tl-poster" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeAttribute(
    label,
  )}" preserveAspectRatio="xMidYMid meet"><defs><radialGradient id="${gloss}"><stop offset="0" stop-color="#fff" stop-opacity=".75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>${shadows}${body}${tags}</svg>`;
}

const pad = (n: number, width: number) => String(n).padStart(width, '0');

/** The annotation for one milestone: step, date, name and note. */
export function narrative(milestone: Milestone, index: number, count: number): string {
  const width = String(count).length;
  const date =
    milestone.date === '' ? '' : `<span class="ak-tl-date">${escapeText(milestone.date)}</span>`;
  const note =
    milestone.description === ''
      ? ''
      : `<span class="ak-tl-text">${escapeText(milestone.description)}</span>`;
  return `<span class="ak-tl-step">${pad(index + 1, width)} / ${count}</span>${date}<span class="ak-tl-title">${escapeText(
    milestone.label,
  )}</span>${note}`;
}

function navigation(milestones: readonly Milestone[], current: number): string {
  const count = milestones.length;
  const shown = milestones[current];
  const valueText = shown === undefined ? '' : `${current + 1} of ${count}: ${shown.label}`;
  return `<div class="ak-3d-control ak-tl-nav" role="group" aria-label="Milestone navigation"><button type="button" disabled data-ak-tl-step="-1" aria-label="Previous milestone">Prev</button><input type="range" class="ak-tl-scrub" disabled data-ak-tl-scrub min="1" max="${count}" step="1" value="${current + 1}" aria-label="Milestone" aria-valuetext="${escapeAttribute(
    valueText,
  )}"><button type="button" disabled data-ak-tl-step="1" aria-label="Next milestone">Next</button><button type="button" disabled data-ak-tl-overview aria-pressed="true">Overview</button></div>`;
}

function milestoneList(milestones: readonly Milestone[], current: number): string {
  const items = milestones
    .map((m, i) => {
      const date = m.date === '' ? '' : `<span class="ak-tl-date">${escapeText(m.date)}</span>`;
      const note =
        m.description === '' ? '' : `<span class="ak-3d-note">${escapeText(m.description)}</span>`;
      return `<li><button type="button" disabled data-ak-tl-milestone="${escapeAttribute(m.id)}" aria-pressed="${
        i === current ? 'true' : 'false'
      }"><span class="ak-3d-mark ak-tl-swatch" data-tone="${escapeAttribute(m.tone)}" aria-hidden="true"></span>${date}<span class="ak-3d-name">${escapeText(
        m.label,
      )}</span>${note}</button></li>`;
    })
    .join('');
  return `<ol class="ak-tl-list" aria-label="Milestones">${items}</ol>`;
}

export function renderTimeline(node: IrNode, context: RenderContext): string {
  const model = timelineModel(node, context.ir.state);
  const { milestones, initial } = model;
  const summary = stringProp(node, 'summary');
  const uid = node.id.replace(/[^A-Za-z0-9_-]/gu, '-');
  const shown = milestones[initial];
  return element(
    'figure',
    nodeAttributes(node, {
      class: 'ak-block ak-3d ak-tl',
      'data-ak-3d': 'timeline',
      'data-ak-3d-state': 'static',
      'data-ak-tl-current': shown?.id ?? '',
      'data-ak-scene': JSON.stringify(model.config),
    }),
    [
      titleHeader(node),
      `<div class="ak-tl-view"><div class="ak-3d-stage">${timelinePoster(model, summary, uid)}</div>`,
      `<div class="ak-tl-card" aria-live="polite">${
        shown === undefined ? '' : narrative(shown, initial, milestones.length)
      }</div></div>`,
      navigation(milestones, initial),
      `<figcaption class="ak-3d-caption">${escapeText(summary)}</figcaption>`,
      milestoneList(milestones, initial),
    ].join(''),
  );
}

/** Unique milestone ids, and ISO-like dates in time order, so the path visits them in order. */
export function checkTimeline(node: IrNode, { bag }: CheckContext): void {
  const milestones = milestonesOf(node);
  const base = pathKey(node.path, 'milestones');
  const seen = new Set<string>();
  let last: { key: number; date: string } | null = null;
  milestones.forEach((m, i) => {
    if (seen.has(m.id))
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: pathKey(pathIndex(base, i), 'id'),
        nodeId: node.id,
        message: `milestone id "${m.id}" is used twice`,
      });
    seen.add(m.id);
    const key = m.date === '' ? null : dateKey(m.date);
    if (key === null) return;
    if (last !== null && key < last.key)
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: pathKey(pathIndex(base, i), 'date'),
        nodeId: node.id,
        message: `milestones must run in time order: "${m.date}" comes before "${last.date}" listed above it`,
      });
    last = { key, date: m.date };
  });
}

export const timeline3dBlock: BlockModule = {
  definition: define({
    type: 'timeline-3d',
    category: 'media',
    tags: ['3d', 'webgl', 'milestones', 'narrative', 'interactive'],
    useCases: ['tell a history as a path through space', 'step through milestones in order'],
    purpose:
      'Milestones in order along a path in space, with a flying camera, step and scrub controls and a narrative card.',
    summary: 'Timeline: spatial milestones, camera path, steps, state.',
    props: TIMELINE_PROPS,
    runtimeFeatures: ['three'],
    actions: ['set-value'],
    a11y: 'A drawing of the path, the narrative card and the ordered milestone list render without JS or WebGL and in print; Prev, Next, the scrubber and the list work by keyboard and touch, and reduced motion moves the camera at once.',
  }),
  render: renderTimeline,
  check: checkTimeline,
};
