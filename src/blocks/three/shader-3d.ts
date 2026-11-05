/** Shader 3D: closed shader presets on a lit surface, with typed controls, state bindings and a poster. */

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
  obj,
  onProp,
  str,
  txt,
} from '../../registry/define-helpers.js';
import { element, nodeAttributes, stringProp, titleHeader } from '../../render/block-helpers.js';
import { escapeAttribute, escapeText } from '../../render/escape.js';
import type { RenderContext } from '../../render/render-context.js';
import { TONES } from './scene-ir.js';
import {
  CAMERA,
  compatiblePost,
  noiseDomain,
  PARAM_RANGES,
  POST_COMPAT,
  POST_PASSES,
  POSTER_GRID,
  POSTER_TIME,
  type PostPass,
  PRESET_DEFAULTS,
  pose,
  poseAt,
  SHADER_PARAMS,
  SHADER_PRESETS,
  SHADER_SHAPES,
  type ShaderParam,
  type ShaderParams,
  type ShaderPreset,
  seedOffset,
  shadeAt,
  surfaceAt,
  surfaceGrid,
} from './shader-fx.js';

export const MAX_SEED = 2147483647;
/** `post: [none]` turns every optional pass off; an omitted `post` takes the preset's chain. */
const POST_VALUES = [...POST_PASSES, 'none'] as const;
/** What a built-in control may set: the preset or one parameter. */
export const CONTROL_KINDS = ['preset', ...SHADER_PARAMS] as const;
type ControlKind = (typeof CONTROL_KINDS)[number];

const statePath = (description: string) =>
  str({ maxLength: 128, description: `${description} A state path such as \`state.look\`.` });

const paramProp = (param: ShaderParam, description: string) =>
  num({ min: PARAM_RANGES[param].min, max: PARAM_RANGES[param].max, description });

export const SHADER_PROPS = {
  title: OPTIONAL_TITLE,
  summary: txt({
    required: true,
    maxLength: 600,
    description: 'What the effect stands for, in words; the caption and the text alternative.',
  }),
  preset: enumStr(SHADER_PRESETS, {
    default: 'fresnel',
    description: 'Closed effect; it sets the surface, tones, parameters and post chain.',
  }),
  shape: enumStr(SHADER_SHAPES, {
    description: 'Surface the effect is drawn on; the preset picks one.',
  }),
  colors: list(enumStr(TONES), {
    minItems: 1,
    maxItems: 2,
    description: 'Theme tones: the body, then the glow.',
  }),
  intensity: paramProp('intensity', 'Glow strength: rim, veins, scan bands or the burning edge.'),
  scale: paramProp('scale', 'Pattern frequency of the noise, waves or scan bands.'),
  progress: paramProp(
    'progress',
    'The preset’s main dial: swell (noise), rim width (fresnel), fill (hologram), wave height (distortion), share dissolved (dissolve).',
  ),
  speed: num({
    min: PARAM_RANGES.speed.min,
    max: PARAM_RANGES.speed.max,
    default: 1,
    description: 'Time scale of the motion; 0 holds the frame.',
  }),
  post: list(enumStr(POST_VALUES), {
    minItems: 1,
    maxItems: POST_PASSES.length,
    description:
      'Post-processing passes the preset supports, applied in a fixed order; `[none]` turns them off.',
  }),
  seed: num({
    integer: true,
    min: 0,
    max: MAX_SEED,
    default: 1,
    description: 'The same seed always yields the same pattern.',
  }),
  controls: list(enumStr(CONTROL_KINDS), {
    maxItems: CONTROL_KINDS.length,
    description: 'Built-in controls under the stage: preset buttons and parameter sliders.',
  }),
  bind: obj(
    Object.fromEntries(
      CONTROL_KINDS.map((kind) => [
        kind,
        statePath(`The ${kind} is read from here, and a control writes it back.`),
      ]),
    ),
    {
      description:
        'State paths for the preset and parameters, so any control on the page can drive them.',
    },
  ),
  on: onProp('Bindings fired with `{ value, param }` when a built-in control changes the effect.'),
  ...anchorProps,
};

const round = (value: number) => Number(value.toFixed(2));
const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (values as readonly string[]).includes(value);
const stringList = (value: JsonValue | undefined): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/** The state value at `state.a.b`, or undefined. */
function readState(state: Record<string, JsonValue>, path: string): JsonValue | undefined {
  const parts = path.split('.');
  if (parts[0] !== 'state' || parts.length < 2) return undefined;
  let cursor: JsonValue | undefined = state;
  for (const part of parts.slice(1)) {
    if (cursor === null || typeof cursor !== 'object' || Array.isArray(cursor)) return undefined;
    cursor = (cursor as Record<string, JsonValue>)[part];
  }
  return cursor;
}

/** The bound state paths, by control kind. */
export function bindings(node: IrNode): Partial<Record<ControlKind, string>> {
  const raw = node.props.bind;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Partial<Record<ControlKind, string>> = {};
  for (const kind of CONTROL_KINDS) {
    const path = (raw as Record<string, JsonValue>)[kind];
    if (typeof path === 'string' && path !== '') out[kind] = path;
  }
  return out;
}

/** The post chain the spec asked for, before the preset keeps what it supports. */
function chainOf(node: IrNode, preset: ShaderPreset): PostPass[] {
  const post = stringList(node.props.post);
  if (post.length === 0) return [...PRESET_DEFAULTS[preset].post];
  return POST_PASSES.filter((pass) => post.includes(pass));
}

const clampParam = (param: ShaderParam, value: number) =>
  Math.min(PARAM_RANGES[param].max, Math.max(PARAM_RANGES[param].min, value));

/**
 * The preset with the spec's overrides and, where a parameter is bound, the
 * initial state value: exactly what the runtime receives and the poster draws.
 */
export function shaderParams(
  node: IrNode,
  state: Record<string, JsonValue> = {},
): ShaderParams & { chain: PostPass[] } {
  const bound = bindings(node);
  const statePreset = bound.preset ? readState(state, bound.preset) : undefined;
  const preset: ShaderPreset = isOneOf(SHADER_PRESETS, statePreset)
    ? statePreset
    : isOneOf(SHADER_PRESETS, node.props.preset)
      ? node.props.preset
      : 'fresnel';
  const base = PRESET_DEFAULTS[preset];
  const value = (param: ShaderParam, fallback: number): number => {
    const fromState = bound[param] ? readState(state, bound[param]) : undefined;
    if (typeof fromState === 'number' && Number.isFinite(fromState))
      return clampParam(param, fromState);
    const authored = node.props[param];
    return typeof authored === 'number' ? authored : fallback;
  };
  const colors = stringList(node.props.colors).filter((tone) => isOneOf(TONES, tone));
  const chain = chainOf(node, preset);
  const seed = node.props.seed;
  return {
    preset,
    shape: isOneOf(SHADER_SHAPES, node.props.shape) ? node.props.shape : base.shape,
    colors: [colors[0] ?? base.colors[0], colors[1] ?? colors[0] ?? base.colors[1]],
    intensity: value('intensity', base.intensity),
    scale: value('scale', base.scale),
    progress: value('progress', base.progress),
    speed: value('speed', 1),
    post: compatiblePost(preset, chain),
    chain,
    seed: typeof seed === 'number' ? seed : 1,
    camera: CAMERA,
  };
}

/** A 4:3 poster, sliced to 16:9 on a wide stage, as the particle poster is. */
const W = 960;
const H = 720;
const LIVE_ASPECT = 16 / 9;

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
const level = (value: number, steps: number, max = 1) =>
  Math.round((Math.min(max, Math.max(0, value)) / max) * steps);

/**
 * The frame at `POSTER_TIME`, shaded with `shadeAt` and projected with the
 * live camera: the no-JS, no-WebGL and print view. Facets are painted far to
 * near; each carries tone, light, white and opacity steps the CSS mixes from
 * theme tokens, and the post passes are SVG filters and overlays.
 */
export function shaderPoster(params: ShaderParams, label: string, uid: string): string {
  const seed = seedOffset(params.seed);
  const { tilt, spin } = poseAt(params.shape, POSTER_TIME);
  const [segU, segV] = POSTER_GRID[params.shape];
  const grid = surfaceGrid(params.shape, segU, segV);
  const eye = params.camera.position;
  const forward = unit(sub(params.camera.target, eye));
  const right = unit(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const tanV = (Math.tan(((params.camera.fov / 2) * Math.PI) / 180) * LIVE_ASPECT) / (W / H);
  const tanH = tanV * (W / H);

  const count = (segU + 1) * (segV + 1);
  const world: V3[] = [];
  const normals: V3[] = [];
  const domain: V3[] = [];
  const screen: { x: number; y: number; depth: number }[] = [];
  for (let i = 0; i < count; i += 1) {
    const p: V3 = [
      grid.position[i * 3] ?? 0,
      grid.position[i * 3 + 1] ?? 0,
      grid.position[i * 3 + 2] ?? 0,
    ];
    const n: V3 = [
      grid.normal[i * 3] ?? 0,
      grid.normal[i * 3 + 1] ?? 0,
      grid.normal[i * 3 + 2] ?? 1,
    ];
    const surface = surfaceAt(p, n, params, seed, POSTER_TIME);
    const w = pose(surface.p, tilt, spin);
    world.push(w);
    normals.push(pose(surface.n, tilt, spin));
    domain.push(noiseDomain(p, params, seed, POSTER_TIME));
    const rel = sub(w, eye);
    const depth = dot(rel, forward);
    screen.push({
      x: W / 2 + ((dot(rel, right) / (depth * tanH)) * W) / 2,
      y: H / 2 - ((dot(rel, up) / (depth * tanV)) * H) / 2,
      depth,
    });
  }

  // Closed opaque surfaces hide their back faces; a cut, open or see-through one shows them.
  const showBack =
    params.shape === 'plane' || params.preset === 'dissolve' || params.preset === 'hologram';
  const additive = params.preset === 'hologram';
  const facets: { depth: number; d: string; cls: string }[] = [];
  const avg = (vs: readonly [V3, V3, V3, V3]): V3 => [
    (vs[0][0] + vs[1][0] + vs[2][0] + vs[3][0]) / 4,
    (vs[0][1] + vs[1][1] + vs[2][1] + vs[3][1]) / 4,
    (vs[0][2] + vs[1][2] + vs[2][2] + vs[3][2]) / 4,
  ];
  for (let j = 0; j < segV; j += 1) {
    for (let i = 0; i < segU; i += 1) {
      const ids = [
        j * (segU + 1) + i,
        j * (segU + 1) + i + 1,
        (j + 1) * (segU + 1) + i + 1,
        (j + 1) * (segU + 1) + i,
      ];
      const corners = ids.map((id) => screen[id] as (typeof screen)[number]);
      if (corners.some((c) => c.depth < 0.2)) continue;
      const centre = avg(ids.map((id) => world[id] as V3) as [V3, V3, V3, V3]);
      const normal = unit(avg(ids.map((id) => normals[id] as V3) as [V3, V3, V3, V3]));
      const view = unit(sub(eye, centre));
      if (!showBack && dot(normal, view) < 0) continue;
      const q = avg(ids.map((id) => domain[id] as V3) as [V3, V3, V3, V3]);
      const shade = shadeAt(params, normal, view, centre[1], q, POSTER_TIME);
      if (shade.alpha < 0) continue;
      const total = shade.a + shade.b;
      const tone = total > 0 ? shade.b / total : 0;
      // Light past full strength turns toward white, as the live tone mapper does.
      const white = shade.w + Math.max(0, total - 1) * 0.5;
      const cls = `k${level(tone, 8)} s${level(total, 40)} w${level(white, 8, 0.6)}${
        additive ? ` o${level(shade.alpha, 10)}` : ''
      }`;
      const d = `M${corners.map((c) => `${round(c.x)} ${round(c.y)}`).join('L')}Z`;
      facets.push({ depth: dot(sub(centre, eye), forward), d, cls });
    }
  }
  facets.sort((a, b) => b.depth - a.depth);
  // Consecutive facets of one shade share a path; the order still paints far to near.
  const paths: string[] = [];
  let runCls = '';
  let run = '';
  for (const facet of facets) {
    if (facet.cls !== runCls && run) {
      paths.push(`<path class="${runCls}" d="${run}"/>`);
      run = '';
    }
    runCls = facet.cls;
    run += facet.d;
  }
  if (run) paths.push(`<path class="${runCls}" d="${run}"/>`);

  const post = params.post;
  const fx = `ak-sh-fx-${uid}`;
  const filterSteps: string[] = [];
  if (post.includes('chromatic')) {
    filterSteps.push(
      '<feColorMatrix in="SourceGraphic" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="r"/><feOffset in="r" dx="-3" result="r"/>',
      '<feColorMatrix in="SourceGraphic" values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" result="g"/>',
      '<feColorMatrix in="SourceGraphic" values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" result="b"/><feOffset in="b" dx="3" result="b"/>',
      '<feBlend in="r" in2="g" mode="screen" result="rg"/><feBlend in="rg" in2="b" mode="screen" result="base"/>',
    );
  }
  if (post.includes('bloom')) {
    const from = filterSteps.length > 0 ? 'base' : 'SourceGraphic';
    filterSteps.push(
      `<feColorMatrix in="${from}" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0.5 0.9 0.2 0 -0.72" result="hi"/><feGaussianBlur in="hi" stdDeviation="14" result="glow"/><feBlend in="glow" in2="${from}" mode="screen"/>`,
    );
  }
  const defs: string[] = [];
  if (filterSteps.length > 0)
    defs.push(
      `<filter id="${fx}" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">${filterSteps.join('')}</filter>`,
    );
  const overlays: string[] = [];
  if (post.includes('scanlines')) {
    defs.push(
      `<pattern id="ak-sh-lines-${uid}" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="2.2"/></pattern>`,
    );
    overlays.push(
      `<rect class="ak-sh-lines" width="${W}" height="${H}" fill="url(#ak-sh-lines-${uid})"/>`,
    );
  }
  if (post.includes('grain')) {
    defs.push(
      `<filter id="ak-sh-grain-${uid}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${
        params.seed % 9973
      }" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>`,
    );
    overlays.push(
      `<rect class="ak-sh-grain" width="${W}" height="${H}" filter="url(#ak-sh-grain-${uid})"/>`,
    );
  }
  if (post.includes('vignette')) {
    defs.push(
      `<radialGradient id="ak-sh-vig-${uid}" cx="50%" cy="50%" r="72%"><stop offset="0.45" stop-opacity="0"/><stop offset="1" stop-opacity="0.7"/></radialGradient>`,
    );
    overlays.push(
      `<rect class="ak-sh-vig" width="${W}" height="${H}" fill="url(#ak-sh-vig-${uid})"/>`,
    );
  }
  const filterAttr = filterSteps.length > 0 ? ` filter="url(#${fx})"` : '';
  return `<svg class="ak-3d-poster ak-sh-poster" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeAttribute(
    label,
  )}" preserveAspectRatio="xMidYMid slice" data-a="${escapeAttribute(params.colors[0])}" data-b="${escapeAttribute(
    params.colors[1],
  )}">${defs.length > 0 ? `<defs>${defs.join('')}</defs>` : ''}<g class="ak-sh-mesh${
    additive ? ' ak-sh-additive' : ''
  }"${filterAttr}>${paths.join('')}</g>${overlays.join('')}</svg>`;
}

const title = (value: string) => value.charAt(0).toUpperCase() + value.slice(1).replace('-', ' ');
const formatValue = (value: number) => String(round(value));

function controlsHtml(node: IrNode, params: ShaderParams): string {
  const kinds = CONTROL_KINDS.filter((kind) => stringList(node.props.controls).includes(kind));
  if (kinds.length === 0) return '';
  const parts: string[] = [];
  if (kinds.includes('preset')) {
    const buttons = SHADER_PRESETS.map(
      (preset) =>
        `<button type="button" disabled data-ak-sh-preset="${preset}" aria-pressed="${
          preset === params.preset ? 'true' : 'false'
        }">${title(preset)}</button>`,
    ).join('');
    parts.push(
      `<div class="ak-sh-presets" role="group" aria-label="Effect preset">${buttons}</div>`,
    );
  }
  for (const param of SHADER_PARAMS) {
    if (!kinds.includes(param)) continue;
    const { min, max, step } = PARAM_RANGES[param];
    const value = formatValue(params[param]);
    parts.push(
      `<div class="ak-sh-control"><label><span>${title(param)}</span><input type="range" disabled data-ak-sh-param="${param}" min="${min}" max="${max}" step="${step}" value="${value}"></label><output>${value}</output></div>`,
    );
  }
  return `<div class="ak-sh-controls">${parts.join('')}</div>`;
}

function renderShader(node: IrNode, context: RenderContext): string {
  const params = shaderParams(node, context.ir.state);
  const summary = stringProp(node, 'summary');
  const uid = node.id.replace(/[^A-Za-z0-9_-]/gu, '-');
  const passes = params.post.length > 0 ? params.post.join(', ') : 'no post-processing';
  const config = { ...params, bind: bindings(node) };
  return element(
    'figure',
    nodeAttributes(node, {
      class: 'ak-block ak-3d ak-sh',
      'data-ak-3d': 'shader',
      'data-ak-3d-state': 'static',
      'data-ak-scene': JSON.stringify(config),
    }),
    [
      titleHeader(node),
      `<div class="ak-3d-stage">${shaderPoster(params, summary, uid)}</div>`,
      `<figcaption class="ak-3d-caption">${escapeText(summary)}<span class="ak-sh-meta">${escapeText(
        `${title(params.preset)} · ${title(params.shape)} · ${passes} · seed ${params.seed}`,
      )}</span></figcaption>`,
      controlsHtml(node, params),
    ].join(''),
  );
}

/**
 * Each pass and control once, `none` alone, every pass one the preset
 * supports, and bindings that name state.
 */
export function checkShader(node: IrNode, { bag, state }: CheckContext): void {
  // Passes are judged against the preset the page starts with, which bound state may set.
  const preset = shaderParams(node, state).preset;
  const repeats = (key: 'post' | 'controls', what: string) => {
    const seen = new Set<string>();
    stringList(node.props[key]).forEach((value, i) => {
      if (seen.has(value))
        bag.add({
          code: 'SPEC_VALIDATION_ERROR',
          path: pathIndex(pathKey(node.path, key), i),
          nodeId: node.id,
          message: `${what} "${value}" is listed twice`,
        });
      seen.add(value);
    });
  };
  repeats('post', 'pass');
  repeats('controls', 'control');
  const post = stringList(node.props.post);
  post.forEach((pass, i) => {
    const path = pathIndex(pathKey(node.path, 'post'), i);
    if (pass === 'none') {
      if (post.length > 1)
        bag.add({
          code: 'SPEC_VALIDATION_ERROR',
          path,
          nodeId: node.id,
          message: '"none" turns every pass off, so it must be the only entry',
        });
      return;
    }
    if (isOneOf(POST_PASSES, pass) && !POST_COMPAT[preset].includes(pass))
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path,
        nodeId: node.id,
        message: `pass "${pass}" does not suit the ${preset} preset`,
        details: { fix: `use any of: ${POST_COMPAT[preset].join(', ')}` },
      });
  });
  for (const [kind, path] of Object.entries(bindings(node))) {
    if (!/^state\.[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/u.test(path))
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: pathKey(pathKey(node.path, 'bind'), kind),
        nodeId: node.id,
        message: `"${path}" is not a state path`,
        details: { fix: 'write it as state.<name>, for example state.look' },
      });
  }
}

export const shader3dBlock: BlockModule = {
  definition: define({
    type: 'shader-3d',
    category: 'media',
    tags: ['3d', 'motion', 'interactive'],
    useCases: ['striking hero visual', 'reveal effect driven by a control'],
    purpose:
      'Closed shader effect preset on a lit 3D surface, with typed controls and post-processing.',
    summary: 'Shader effect presets with typed controls.',
    props: SHADER_PROPS,
    runtimeFeatures: ['three'],
    actions: ['set-value'],
    a11y: 'Decorative motion only: the summary is the text alternative, a poster of the same frame renders without JS or WebGL and in print, reduced motion shows that frame still, a pause button stops the live effect, and controls are labelled native buttons and sliders.',
  }),
  render: renderShader,
  check: checkShader,
};
