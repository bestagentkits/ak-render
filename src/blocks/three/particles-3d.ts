/** Particles 3D: seeded, closed-form particle effects from named presets, with a poster frame. */

import { pathIndex, pathKey } from '../../diagnostics.js';
import type { IrNode } from '../../ir.js';
import type { JsonValue } from '../../json.js';
import type { BlockModule, CheckContext } from '../../registry/block-module.js';
import {
  anchorProps,
  define,
  enumStr,
  list,
  num,
  OPTIONAL_TITLE,
  txt,
} from '../../registry/define-helpers.js';
import { element, nodeAttributes, stringProp, titleHeader } from '../../render/block-helpers.js';
import { escapeAttribute, escapeText } from '../../render/escape.js';
import {
  EMITTER_SHAPES,
  FORCE_FIELDS,
  type ForceField,
  MAX_PARTICLES,
  MIN_PARTICLES,
  PARTICLE_PRESETS,
  type ParticleParams,
  type ParticlePreset,
  POSTER_TIME,
  PRESET_DEFAULTS,
  particleAt,
  SIZE_CURVES,
  spawnParticles,
} from './particles-sim.js';
import { TONES } from './scene-ir.js';

export const MAX_SEED = 2147483647;
/** The poster draws this many particles at most; the live view draws them all. */
export const POSTER_PARTICLES = 2400;

export const PARTICLES_PROPS = {
  title: OPTIONAL_TITLE,
  summary: txt({
    required: true,
    maxLength: 600,
    description: 'What the effect stands for, in words; the caption and the text alternative.',
  }),
  preset: enumStr(PARTICLE_PRESETS, {
    default: 'galaxy',
    description: 'Named effect; it sets the emitter, fields, colors, size curve and count.',
  }),
  shape: enumStr(EMITTER_SHAPES, {
    description: 'Emitter shape; the preset picks one by default.',
  }),
  fields: list(enumStr(FORCE_FIELDS), {
    minItems: 1,
    maxItems: FORCE_FIELDS.length,
    description: 'Force and noise fields, applied in a fixed order; replaces the preset fields.',
  }),
  count: num({
    integer: true,
    min: MIN_PARTICLES,
    max: MAX_PARTICLES,
    description: 'Particles drawn; the preset picks a count. Slow devices draw fewer.',
  }),
  seed: num({
    integer: true,
    min: 0,
    max: MAX_SEED,
    default: 1,
    description: 'The same seed always yields the same cloud.',
  }),
  colors: list(enumStr(TONES), {
    minItems: 1,
    maxItems: 4,
    description: 'Theme tones the color runs through over each life (core to rim when orbiting).',
  }),
  size: enumStr(SIZE_CURVES, { description: 'Size over each life; the preset picks one.' }),
  speed: num({ min: 0.1, max: 4, default: 1, description: 'Time scale of the motion.' }),
  ...anchorProps,
};

const round = (value: number) => Number(value.toFixed(2));

function presetOf(node: IrNode): ParticlePreset {
  const raw = node.props.preset;
  return (PARTICLE_PRESETS as readonly string[]).includes(raw as string)
    ? (raw as ParticlePreset)
    : 'galaxy';
}

const stringList = (value: JsonValue | undefined): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/** The preset with the spec's overrides; exactly what the runtime receives. */
export function particleParams(node: IrNode): ParticleParams {
  const preset = presetOf(node);
  const base = PRESET_DEFAULTS[preset];
  const { shape, size, count, seed, speed } = node.props;
  const fields = stringList(node.props.fields).filter((f): f is ForceField =>
    (FORCE_FIELDS as readonly string[]).includes(f),
  );
  const colors = stringList(node.props.colors);
  return {
    ...base,
    preset,
    shape: (EMITTER_SHAPES as readonly string[]).includes(shape as string)
      ? (shape as ParticleParams['shape'])
      : base.shape,
    // An omitted list normalizes to empty, so only a non-empty one replaces the preset's fields.
    fields: fields.length > 0 ? FORCE_FIELDS.filter((f) => fields.includes(f)) : base.fields,
    colors: colors.length > 0 ? colors : base.colors,
    size: (SIZE_CURVES as readonly string[]).includes(size as string)
      ? (size as ParticleParams['size'])
      : base.size,
    count: typeof count === 'number' ? count : base.count,
    seed: typeof seed === 'number' ? seed : 1,
    speed: typeof speed === 'number' ? speed : 1,
  };
}

/** A 4:3 poster: a 16:9 stage slices off empty sky, a phone's 4:3 stage shows it all. */
const W = 960;
const H = 720;
/** The live camera's field of view is set for this stage aspect and widened for narrower ones. */
const LIVE_ASPECT = 16 / 9;
/** Color steps between two stops in the poster; the live view blends continuously. */
const MIX_STEPS = 4;

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: V3): V3 => {
  const length = Math.hypot(...a) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};

/**
 * The frame at `POSTER_TIME`, projected with the live camera: the no-JS,
 * no-WebGL and print view, and the picture the live view starts from.
 */
export function particlesPoster(params: ParticleParams, label: string, uid: string): string {
  const count = Math.min(params.count, POSTER_PARTICLES);
  const spawn = spawnParticles(params, count);
  const eye = params.camera.position;
  const forward = unit(sub(params.camera.target, eye));
  const right = unit(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  // The same widened vertical field the runtime uses on a 4:3 stage, so both keep one width.
  const tanV = (Math.tan(((params.camera.fov / 2) * Math.PI) / 180) * LIVE_ASPECT) / (W / H);
  const tanH = tanV * (W / H);
  const focal = H / (2 * tanV);
  const out: number[] = [];
  const marks: { depth: number; x: number; y: number; r: number; bucket: string }[] = [];
  const stops = params.colors.length;
  for (let i = 0; i < count; i += 1) {
    particleAt(params, spawn, i, POSTER_TIME, out);
    const rel = sub([out[0] ?? 0, out[1] ?? 0, out[2] ?? 0], eye);
    const depth = dot(rel, forward);
    if (depth < 0.2) continue;
    const sx = dot(rel, right) / (depth * tanH);
    const sy = dot(rel, up) / (depth * tanV);
    if (Math.abs(sx) > 1.05 || Math.abs(sy) > 1.05) continue;
    const alpha = out[6] ?? 0;
    if (alpha < 0.08) continue;
    const k = Math.min(1, Math.max(0, out[4] ?? 0)) * (stops - 1);
    const segment = Math.min(Math.floor(k), Math.max(stops - 2, 0));
    const mix = stops === 1 ? 0 : Math.round((k - segment) * MIX_STEPS);
    const level = Math.min(3, Math.floor(alpha * 4));
    marks.push({
      depth,
      x: round(W / 2 + (sx * W) / 2),
      y: round(H / 2 - (sy * H) / 2),
      r: round(Math.max(0.6, (params.grain * (out[5] ?? 1) * focal) / depth) * 0.42),
      bucket: `${segment}:${mix}:${level}`,
    });
  }
  // Far marks first, so near ones paint over them, as the depth buffer would.
  marks.sort((a, b) => b.depth - a.depth);
  const groups = new Map<string, (typeof marks)[number][]>();
  for (const mark of marks) {
    const members = groups.get(mark.bucket) ?? [];
    members.push(mark);
    groups.set(mark.bucket, members);
  }
  const layer = (glow: boolean) =>
    [...groups.keys()]
      .sort()
      .map((bucket) => {
        const [segment = 0, mix = 0, level = 0] = bucket.split(':').map(Number);
        const from = params.colors[segment] ?? 'accent';
        const to = params.colors[Math.min(segment + 1, stops - 1)] ?? from;
        const members = groups.get(bucket) ?? [];
        // The glow layer takes every third mark at nearly three times its size, blurred, under the crisp marks.
        const shown = glow
          ? members
              .filter((_, i) => i % 3 === 0)
              .map((m) => `<circle cx="${m.x}" cy="${m.y}" r="${round(m.r * 2.8)}"/>`)
          : members.map((m) => `<circle cx="${m.x}" cy="${m.y}" r="${m.r}"/>`);
        return `<g data-a="${escapeAttribute(from)}" data-b="${escapeAttribute(to)}" data-k="${mix}" data-o="${level}">${shown.join('')}</g>`;
      })
      .join('');
  const filter = `ak-pt-glow-${uid}`;
  return `<svg class="ak-3d-poster ak-pt-poster" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeAttribute(
    label,
  )}" preserveAspectRatio="xMidYMid slice"><defs><filter id="${filter}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="7"/></filter></defs><g class="ak-pt-glow" filter="url(#${filter})">${layer(
    true,
  )}</g><g class="ak-pt-marks">${layer(false)}</g></svg>`;
}

/** Thousands with a comma, independent of the compiling machine's locale. */
const grouped = (value: number) => String(value).replace(/\B(?=(\d{3})+(?!\d))/gu, ',');

function renderParticles(node: IrNode): string {
  const params = particleParams(node);
  const summary = stringProp(node, 'summary');
  const uid = node.id.replace(/[^A-Za-z0-9_-]/gu, '-');
  const name = params.preset.charAt(0).toUpperCase() + params.preset.slice(1);
  return element(
    'figure',
    nodeAttributes(node, {
      class: 'ak-block ak-3d ak-pt',
      'data-ak-3d': 'particles',
      'data-ak-3d-state': 'static',
      'data-ak-scene': JSON.stringify(params),
    }),
    [
      titleHeader(node),
      `<div class="ak-3d-stage">${particlesPoster(params, summary, uid)}</div>`,
      `<figcaption class="ak-3d-caption">${escapeText(summary)}<span class="ak-pt-meta">${escapeText(
        `${name} · ${grouped(params.count)} particles · seed ${params.seed}`,
      )}</span></figcaption>`,
    ].join(''),
  );
}

/** Each field once: the fields apply in a fixed order, so a repeat would mean nothing. */
export function checkParticles(node: IrNode, { bag }: CheckContext): void {
  const seen = new Set<string>();
  stringList(node.props.fields).forEach((value, i) => {
    if (seen.has(value))
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: pathIndex(pathKey(node.path, 'fields'), i),
        nodeId: node.id,
        message: `field "${value}" is listed twice`,
      });
    seen.add(value);
  });
}

export const particles3dBlock: BlockModule = {
  definition: define({
    type: 'particles-3d',
    category: 'media',
    tags: ['3d', 'motion'],
    useCases: ['ambient hero effect', 'galaxy, fountain or snow backdrop'],
    purpose: 'Seeded 3D particle effect from a named preset.',
    summary: 'Seeded 3D particle effect presets.',
    props: PARTICLES_PROPS,
    runtimeFeatures: ['three'],
    actions: [],
    a11y: 'Decorative motion only: the summary is the text alternative, a poster of the same frame renders without JS or WebGL and in print, reduced motion shows that frame still, and a pause button stops the live effect.',
  }),
  render: renderParticles,
  check: checkParticles,
};
