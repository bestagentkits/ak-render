/**
 * Morph 3D: one lit surface that morphs between typed target shapes on a
 * timeline or when page state names a target. Without JS or WebGL, and in
 * print, a shaded drawing of the current target and the target list (each with
 * a small drawing of its shape) carry the content.
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
  num,
  OPTIONAL_TITLE,
  obj,
  onProp,
  str,
  txt,
} from '../../registry/define-helpers.js';
import { element, nodeAttributes, stringProp, titleHeader } from '../../render/block-helpers.js';
import { escapeAttribute, escapeText } from '../../render/escape.js';
import type { RenderContext } from '../../render/render-context.js';
import {
  buildMorph,
  type Detail,
  EASINGS,
  GLYPH_DETAIL,
  MAX_TARGETS,
  MIN_TARGETS,
  MORPH_SHAPES,
  POSTER_DETAIL,
  TIMELINES,
  TOPOLOGY_NAME,
  topologyBreak,
  topologyOf,
  vertexNormals,
} from './morph-sim.js';
import { SHADE_STEPS } from './morph-styles.js';
import { project, type SceneCamera, type Vec3 } from './scene-fallback.js';
import { TONES } from './scene-ir.js';

export const DEFAULT_DURATION = 1300;

export const MORPH_PROPS = {
  title: OPTIONAL_TITLE,
  summary: txt({
    required: true,
    maxLength: 600,
    description: 'What the morph shows, in words; the caption and the text alternative.',
  }),
  targets: list(
    obj({
      id: { ...idProp('Target id; `bind` reads and writes it.'), required: true },
      label: str({ maxLength: 80, description: 'Name shown on the target button.' }),
      shape: enumStr(MORPH_SHAPES, {
        required: true,
        description:
          'Closed shapes (sphere, cube, capsule, cylinder, cone, gem, blob, star) morph into each other; rings (torus, knot, twist) morph into each other.',
      }),
      tone: enumStr(TONES, { description: 'Theme tone of the surface at this target.' }),
      description: str({ maxLength: 200, description: 'Shown under the target button.' }),
    }),
    {
      required: true,
      minItems: MIN_TARGETS,
      maxItems: MAX_TARGETS,
      description: 'Shapes in timeline order; all of one topology.',
    },
  ),
  easing: enumStr(EASINGS, {
    default: 'smooth',
    description: '`spring` overshoots and settles; `snap` lands fast; `linear` is even.',
  }),
  duration: num({
    integer: true,
    min: 200,
    max: 6000,
    default: DEFAULT_DURATION,
    description: 'Milliseconds per morph.',
  }),
  timeline: enumStr(TIMELINES, {
    default: 'loop',
    description:
      '`loop` cycles the targets, `once` plays through to the last, `manual` moves only on a choice or a state change.',
  }),
  bind: str({
    maxLength: 128,
    description:
      'A state path such as `state.shape`: the chosen target id is written here, and a state value morphs to it.',
  }),
  on: onProp('Bindings fired with `{ value }` (the target id) when the reader chooses a target.'),
  ...anchorProps,
};

type Row = Record<string, JsonValue>;

export interface MorphTarget {
  id: string;
  label: string;
  shape: string;
  tone: string;
  description: string;
}

export function targetsOf(node: IrNode): MorphTarget[] {
  const raw = node.props.targets;
  const rows = Array.isArray(raw) ? (raw.filter(isPlainObject) as Row[]) : [];
  return rows.map((row) => {
    const shape = typeof row.shape === 'string' ? row.shape : 'sphere';
    return {
      id: String(row.id),
      label:
        typeof row.label === 'string' ? row.label : shape.charAt(0).toUpperCase() + shape.slice(1),
      shape,
      tone: typeof row.tone === 'string' ? row.tone : 'accent',
      description: typeof row.description === 'string' ? row.description : '',
    };
  });
}

/** The target shown first: the bound state's value when it names one, else the first. */
function initialIndex(node: IrNode, targets: readonly MorphTarget[], state: Row): number {
  const path = stringProp(node, 'bind');
  const value = path.startsWith('state.') ? state[path.slice(6)] : undefined;
  const at = targets.findIndex((t) => t.id === value);
  return at === -1 ? 0 : at;
}

/** Radius of a sphere every target fits in, and the floor the surface floats over. */
const FIT_RADIUS = 1.3;
export const FLOOR_Y = -1.15;
const FOV = 30;
/** The home bearing: a little right of and above the subject. */
const BEARING: Vec3 = [0.36, 0.24, 1];

export function morphCamera(): SceneCamera {
  const l = Math.hypot(...BEARING);
  const distance = FIT_RADIUS / Math.sin(((FOV / 2) * Math.PI) / 180);
  const round = (n: number) => Number(n.toFixed(4));
  return {
    position: BEARING.map((b) => round((b / l) * distance)) as Vec3,
    target: [0, -0.08, 0],
    fov: FOV,
  };
}

/** Everything the runtime mounts, resolved at compile time. */
export function morphConfig(node: IrNode, state: Row): Record<string, JsonValue> {
  const targets = targetsOf(node);
  const camera = morphCamera();
  const duration = typeof node.props.duration === 'number' ? node.props.duration : DEFAULT_DURATION;
  const mode = typeof node.props.timeline === 'string' ? node.props.timeline : 'loop';
  const bind = stringProp(node, 'bind');
  return {
    camera: { position: camera.position, target: camera.target, fov: camera.fov },
    lighting: 'studio',
    // A stand-in the scene runtime lights and stages; the morph widget swaps in its own surface.
    objects: [{ id: 'morph', shape: 'sphere', size: -FLOOR_Y * 2 }],
    morph: {
      targets: targets.map((t) => ({ id: t.id, label: t.label, shape: t.shape, tone: t.tone })),
      topology: topologyOf(targets[0]?.shape ?? 'sphere'),
      initial: initialIndex(node, targets, state),
      easing: typeof node.props.easing === 'string' ? node.props.easing : 'smooth',
      duration,
      // Each target holds long enough to be read before the next morph starts.
      hold: Math.max(1400, Math.round(duration * 1.1)),
      mode,
      ...(bind === '' ? {} : { bind }),
    },
  };
}

// ---- Drawing --------------------------------------------------------------------------------

type V3 = [number, number, number];
const norm = (v: V3): V3 => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** The studio rig's key and fill light directions. */
const KEY = norm([0.45, 0.72, 0.54]);
const FILL = norm([-0.74, 0.37, 0.49]);
/** Lit shade steps; the step after them is the specular highlight. */
const LEVELS = SHADE_STEPS - 1;
/** The light value that maps to the brightest lit step. */
const LIGHT_TOP = 1.12;
const r1 = (n: number) => Math.round(n * 10) / 10;

interface Face {
  depth: number;
  level: number;
  points: { x: number; y: number }[];
}

/**
 * The target's faces as seen from `eye`: back faces culled, each shaded by the
 * studio key and fill light with a rim and a highlight, far faces first.
 */
function shadedFaces(
  shape: string,
  detail: Detail,
  eye: V3,
  toScreen: (p: V3) => { x: number; y: number; depth: number } | null,
): Face[] {
  const { grid, targets } = buildMorph([shape], detail);
  const positions = targets[0] as Float32Array;
  const normals = vertexNormals(positions, grid.quads);
  const at = (i: number): V3 => [
    positions[i * 3] as number,
    positions[i * 3 + 1] as number,
    positions[i * 3 + 2] as number,
  ];
  const faces: Face[] = [];
  for (let q = 0; q < grid.quads.length; q += 4) {
    const ids = [0, 1, 2, 3].map((k) => grid.quads[q + k] as number);
    const corners = ids.map(at);
    const center = corners
      .reduce<V3>((s, c) => [s[0] + c[0], s[1] + c[1], s[2] + c[2]], [0, 0, 0])
      .map((v) => v / 4) as V3;
    const n = norm(
      ids.reduce<V3>(
        (s, i) => [
          s[0] + (normals[i * 3] as number),
          s[1] + (normals[i * 3 + 1] as number),
          s[2] + (normals[i * 3 + 2] as number),
        ],
        [0, 0, 0],
      ),
    );
    const view = norm([eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]]);
    const facing = dot(n, view);
    if (facing <= 0) continue;
    const points = corners.map(toScreen);
    if (points.some((p) => p === null)) continue;
    const screen = points as { x: number; y: number; depth: number }[];
    // Cull by the projected winding too, so silhouettes of folded rings stay clean.
    const area = screen.reduce((s, p, i) => {
      const next = screen[(i + 1) % screen.length] as { x: number; y: number };
      return s + p.x * next.y - next.x * p.y;
    }, 0);
    if (area > 0) continue;
    const half = norm([KEY[0] + view[0], KEY[1] + view[1], KEY[2] + view[2]]);
    const light =
      0.14 +
      0.78 * Math.max(0, dot(n, KEY)) +
      0.22 * Math.max(0, dot(n, FILL)) +
      0.3 * (1 - facing) ** 3;
    const specular = Math.max(0, dot(n, half)) ** 40;
    // The sheen rides the lit steps so it fades out softly; only its core takes the highlight step.
    const level =
      specular > 0.97
        ? LEVELS
        : Math.min(
            LEVELS - 1,
            Math.max(0, Math.round(((light + 0.5 * specular) / LIGHT_TOP) * (LEVELS - 1))),
          );
    faces.push({
      depth: screen.reduce((s, p) => s + p.depth, 0) / 4,
      level,
      points: screen,
    });
  }
  return faces.sort((a, b) => b.depth - a.depth);
}

const facePaths = (faces: readonly Face[], round: (n: number) => number) =>
  faces
    .map(
      (f) =>
        `<path data-l="${f.level}" d="M${f.points.map((p) => `${round(p.x)},${round(p.y)}`).join('L')}Z"/>`,
    )
    .join('');

const W = 640;
const H = 360;

/** The target as the live view first shows it: same camera, same light, same floor. */
export function morphPoster(target: MorphTarget, label: string, uid: string): string {
  const camera = morphCamera();
  const faces = shadedFaces(target.shape, POSTER_DETAIL, camera.position, (p) =>
    project(p, camera),
  );
  const floor = project([0, FLOOR_Y, 0], camera);
  const edge = project([1, FLOOR_Y, 0], camera);
  const rx = floor && edge ? Math.abs(edge.x - floor.x) * 1.05 : 120;
  const id = (part: string) => `ak-mo-${part}-${uid}`;
  const shadow = floor
    ? `<ellipse class="ak-mo-shadow" cx="${r1(floor.x)}" cy="${r1(floor.y)}" rx="${r1(rx)}" ry="${r1(rx * 0.2)}" fill="url(#${id('floor')})"/>`
    : '';
  // The faces draw once crisp; a blurred copy masked to their outline smooths the shade
  // steps into gradients while the silhouette stays sharp.
  return `<svg class="ak-3d-poster ak-mo-poster" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeAttribute(
    label,
  )}" preserveAspectRatio="xMidYMid meet"><defs><radialGradient id="${id('floor')}"><stop offset="0" stop-opacity=".34"/><stop offset="1" stop-opacity="0"/></radialGradient><filter id="${id('soft')}" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="4"/></filter><g id="${id('faces')}" class="ak-3d-mark ak-mo-surface" data-tone="${escapeAttribute(
    target.tone,
  )}">${facePaths(faces, r1)}</g><mask id="${id('outline')}" class="ak-mo-outline"><use href="#${id('faces')}"/></mask></defs>${shadow}<use href="#${id('faces')}"/><g mask="url(#${id('outline')})"><use href="#${id('faces')}" filter="url(#${id('soft')})"/></g></svg>`;
}

/** A small orthographic drawing of a target shape, for its button. */
export function morphGlyph(target: MorphTarget): string {
  const size = 44;
  const forward = norm([-BEARING[0], -BEARING[1], -BEARING[2]]);
  const right = norm([forward[2] * -1, 0, forward[0]]);
  const up: V3 = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ];
  const k = size / 2 / FIT_RADIUS;
  const eye: V3 = [-forward[0] * 100, -forward[1] * 100, -forward[2] * 100];
  const faces = shadedFaces(target.shape, GLYPH_DETAIL, eye, (p) => ({
    x: size / 2 + dot(p, right) * k,
    y: size / 2 - dot(p, up) * k,
    depth: dot([p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]], forward),
  }));
  return `<svg class="ak-mo-glyph" viewBox="0 0 ${size} ${size}" aria-hidden="true" focusable="false"><g class="ak-3d-mark ak-mo-surface" data-tone="${escapeAttribute(
    target.tone,
  )}">${facePaths(faces, (n) => Math.round(n * 2) / 2)}</g></svg>`;
}

function targetList(targets: readonly MorphTarget[], current: number): string {
  const items = targets
    .map((target, i) => {
      const note =
        target.description === ''
          ? ''
          : `<span class="ak-3d-note">${escapeText(target.description)}</span>`;
      return `<li><button type="button" disabled data-ak-morph-target="${escapeAttribute(target.id)}" aria-pressed="${
        i === current ? 'true' : 'false'
      }">${morphGlyph(target)}<span class="ak-mo-text"><span class="ak-3d-name">${escapeText(
        target.label,
      )}</span>${note}</span></button></li>`;
    })
    .join('');
  return `<ol class="ak-3d-objects ak-mo-targets" aria-label="Shapes">${items}</ol>`;
}

export function renderMorph(node: IrNode, context: RenderContext): string {
  const config = morphConfig(node, context.ir.state);
  const targets = targetsOf(node);
  const morph = config.morph as Row;
  const current = typeof morph.initial === 'number' ? morph.initial : 0;
  const summary = stringProp(node, 'summary');
  const uid = node.id.replace(/[^A-Za-z0-9_-]/gu, '-');
  const shown = targets[current] ?? targets[0];
  const sequence = targets.map((t) => t.label).join(' → ');
  return element(
    'figure',
    nodeAttributes(node, {
      class: 'ak-block ak-3d ak-mo',
      'data-ak-3d': 'morph',
      'data-ak-3d-state': 'static',
      'data-ak-morph-current': shown?.id ?? '',
      'data-ak-scene': JSON.stringify(config),
    }),
    [
      titleHeader(node),
      `<div class="ak-3d-stage">${shown ? morphPoster(shown, summary, uid) : ''}</div>`,
      `<figcaption class="ak-3d-caption">${escapeText(summary)}<span class="ak-mo-meta">${escapeText(sequence)}</span></figcaption>`,
      targetList(targets, current),
    ].join(''),
  );
}

/** Unique target ids, and one topology across every target, so each morph has a real path. */
export function checkMorph(node: IrNode, { bag }: CheckContext): void {
  const targets = targetsOf(node);
  const base = pathKey(node.path, 'targets');
  const seen = new Set<string>();
  targets.forEach((target, i) => {
    if (seen.has(target.id))
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: pathKey(pathIndex(base, i), 'id'),
        nodeId: node.id,
        message: `target id "${target.id}" is used twice`,
      });
    seen.add(target.id);
  });
  const shapes = targets.map((t) => t.shape);
  const broken = topologyBreak(shapes);
  if (broken !== -1) {
    const first = shapes[0] ?? 'sphere';
    const odd = shapes[broken] ?? 'sphere';
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path: pathKey(pathIndex(base, broken), 'shape'),
      nodeId: node.id,
      message: `invalid topology: "${odd}" is ${TOPOLOGY_NAME[topologyOf(odd)]} and "${first}" is ${TOPOLOGY_NAME[topologyOf(first)]}, so no morph joins them; keep every target closed or every target a ring`,
    });
  }
}

export const morph3dBlock: BlockModule = {
  definition: define({
    type: 'morph-3d',
    category: 'media',
    tags: ['3d', 'webgl', 'motion', 'morph', 'interactive'],
    useCases: ['morph a hero shape between states', 'show one form becoming another'],
    purpose: 'Lit surface that morphs between typed target shapes on a timeline or page state.',
    summary: 'Morph: shape targets, easing, timeline, state.',
    props: MORPH_PROPS,
    runtimeFeatures: ['three'],
    actions: ['set-value'],
    a11y: 'A shaded drawing of the current target and the target list, each with its own drawing, render without JS or WebGL and in print; reduced motion morphs at once and holds still, a pause button stops a looping timeline, and every target button works by keyboard.',
  }),
  render: renderMorph,
  check: checkMorph,
};
