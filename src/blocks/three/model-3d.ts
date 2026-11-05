/** Model 3D: a glTF 2.0 model with orbit, clips, variants and hotspots; a static plan or poster without JS or WebGL. */

import type { ModelInfo, ResolvedModelAsset } from '../../assets/model-assets.js';
import { pathIndex, pathKey } from '../../diagnostics.js';
import type { IrNode } from '../../ir.js';
import type { JsonValue } from '../../json.js';
import type { BlockModule, CheckContext } from '../../registry/block-module.js';
import {
  anchorProps,
  define,
  enumStr,
  idProp,
  LABEL,
  list,
  OPTIONAL_TITLE,
  obj,
  onProp,
  str,
  txt,
  urlProp,
} from '../../registry/define-helpers.js';
import { element, nodeAttributes, stringProp, titleHeader } from '../../render/block-helpers.js';
import { escapeAttribute, escapeText } from '../../render/escape.js';
import type { RenderContext } from '../../render/render-context.js';
import { frameCamera, placeObjects, scenePoster, vec } from './scene-fallback.js';
import { cameraProp, LIGHTING, vec3 } from './scene-ir.js';

const MAX_HOTSPOTS = 24;

const statePath = (description: string) =>
  str({ maxLength: 128, description: `${description} A state path such as \`state.part\`.` });

export const MODEL_PROPS = {
  title: OPTIONAL_TITLE,
  summary: txt({
    required: true,
    maxLength: 600,
    description: 'What the model shows, in words; the caption and the text alternative.',
  }),
  src: urlProp({
    required: true,
    asset: 'models',
    rejectBlocked: true,
    description:
      'A .glb or .gltf beside the spec (inlined at compile time) or an allowed remote URL under the `models` capability.',
  }),
  poster: urlProp({
    asset: 'images',
    description:
      'Still image shown without JS or WebGL and in print; omitted, the compiler draws a plan.',
  }),
  hotspots: list(
    obj({
      id: {
        ...idProp('Hotspot id; `bind` receives it when the hotspot is chosen.'),
        required: true,
      },
      label: { ...LABEL, required: true },
      description: str({ maxLength: 300, description: 'Read in the hotspot list.' }),
      position: { ...vec3('Point on the model [x, y, z], in model units.'), required: true },
    }),
    { maxItems: MAX_HOTSPOTS, description: 'Numbered points of interest pinned to the model.' },
  ),
  lighting: enumStr(LIGHTING, { default: 'studio', description: 'Light rig preset.' }),
  camera: cameraProp(),
  bind: statePath('The chosen hotspot id is written here, and choosing by state highlights it.'),
  clipBind: statePath('The playing animation clip name is read from and written here.'),
  variantBind: statePath('The KHR_materials_variants name is read from and written here.'),
  on: onProp('Bindings fired with `{ value }` (the hotspot id) when a hotspot is chosen.'),
  ...anchorProps,
};

type Vec3 = [number, number, number];

function hotspotsOf(node: IrNode): Record<string, JsonValue>[] {
  const value = node.props.hotspots;
  return Array.isArray(value)
    ? value.filter(
        (h): h is Record<string, JsonValue> =>
          h !== null && typeof h === 'object' && !Array.isArray(h),
      )
    : [];
}

function stateValue(node: IrNode, prop: string, state: Record<string, JsonValue>): string {
  const path = stringProp(node, prop);
  const value = path.startsWith('state.') ? state[path.slice(6)] : undefined;
  return typeof value === 'string' ? value : '';
}

/** The model's extent: its bounds when the compiler read them, else a unit cube. */
function extentOf(info: ModelInfo | undefined): { center: Vec3; size: number } {
  const bounds = info?.bounds;
  if (bounds === undefined) return { center: [0, 0.5, 0], size: 1 };
  const center = [0, 1, 2].map(
    (axis) => ((bounds.min[axis] ?? 0) + (bounds.max[axis] ?? 0)) / 2,
  ) as Vec3;
  const size = Math.max(
    ...[0, 1, 2].map((axis) => (bounds.max[axis] ?? 0) - (bounds.min[axis] ?? 0)),
    1e-3,
  );
  return { center, size };
}

/** The plan objects: the model's bounding volume and one marker per hotspot. */
function planObjects(node: IrNode, info: ModelInfo | undefined): Record<string, JsonValue>[] {
  const { center, size } = extentOf(info);
  return [
    { id: '__model', label: '', shape: 'box', size, position: center, tone: 'neutral' },
    ...hotspotsOf(node).map((hotspot, index) => ({
      id: String(hotspot.id),
      label: `${index + 1}`,
      shape: 'sphere',
      size: size * 0.09,
      position: vec(hotspot.position, [0, 0, 0]),
      tone: 'accent',
    })),
  ];
}

/**
 * What the camera frames: the eight corners of the model's real bounds (a flat
 * model is not a cube) and the hotspots, as points.
 */
function framingObjects(node: IrNode, info: ModelInfo | undefined): Record<string, JsonValue>[] {
  const bounds = info?.bounds ?? { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] };
  const corners = Array.from({ length: 8 }, (_, corner) => ({
    id: `__corner-${corner}`,
    shape: 'sphere',
    size: 1e-3,
    position: [0, 1, 2].map((axis) =>
      (corner >> axis) & 1 ? (bounds.max[axis] ?? 0) : (bounds.min[axis] ?? 0),
    ),
  }));
  const points = hotspotsOf(node).map((hotspot) => ({
    id: String(hotspot.id),
    shape: 'sphere',
    size: 1e-3,
    position: vec(hotspot.position, [0, 0, 0]),
  }));
  return [...corners, ...points];
}

function controls(kind: 'clip' | 'variant', names: readonly string[], current: string): string {
  if (names.length === 0) return '';
  const heading = kind === 'clip' ? 'Animation' : 'Finish';
  const buttons = names
    .map(
      (name) =>
        `<button type="button" disabled data-ak-3d-${kind}="${escapeAttribute(name)}" aria-pressed="${
          name === current ? 'true' : 'false'
        }">${escapeText(name)}</button>`,
    )
    .join('');
  return `<div class="ak-3d-control" role="group" aria-label="${heading}"><span class="ak-3d-control-label">${heading}</span>${buttons}</div>`;
}

function hotspotList(node: IrNode, selected: string): string {
  const items = hotspotsOf(node)
    .map((hotspot, index) => {
      const id = String(hotspot.id);
      const description =
        typeof hotspot.description === 'string' && hotspot.description !== ''
          ? `<span class="ak-3d-note">${escapeText(hotspot.description)}</span>`
          : '';
      return `<li><button type="button" disabled data-ak-3d-pick="${escapeAttribute(id)}" aria-pressed="${
        id === selected ? 'true' : 'false'
      }"><span class="ak-3d-name"><span class="ak-3d-num" aria-hidden="true">${index + 1}</span>${escapeText(
        String(hotspot.label ?? id),
      )}</span>${description}</button></li>`;
    })
    .join('');
  return items === '' ? '' : `<ol class="ak-3d-objects ak-3d-hotspots">${items}</ol>`;
}

export function renderModel(node: IrNode, context: RenderContext): string {
  const asset: ResolvedModelAsset | undefined = context.models?.get(node.id);
  const info = asset?.kind === 'inline' ? asset.info : undefined;
  const placed = placeObjects(planObjects(node, info));
  const camera = frameCamera(placeObjects(framingObjects(node, info)), node.props.camera);
  const summary = stringProp(node, 'summary');
  const state = context.ir.state;
  const clips = info?.clips ?? [];
  const variants = info?.variants ?? [];
  const clip = stateValue(node, 'clipBind', state) || clips[0] || '';
  const variant = stateValue(node, 'variantBind', state);
  const config: Record<string, JsonValue> = {
    src: asset?.uri ?? stringProp(node, 'src'),
    camera: { position: camera.position, target: camera.target, fov: camera.fov },
    hotspots: hotspotsOf(node).map((h) => ({
      id: h.id ?? '',
      label: h.label ?? '',
      position: h.position ?? [],
    })),
    clips,
    variants,
  };
  if (clip !== '') config.clip = clip;
  for (const key of ['lighting', 'bind', 'clipBind', 'variantBind'] as const) {
    const value = node.props[key];
    if (value !== undefined) config[key] = value;
  }
  const poster = stringProp(node, 'poster');
  const still =
    poster !== ''
      ? `<img class="ak-3d-poster" src="${escapeAttribute(poster)}" alt="${escapeAttribute(summary)}">`
      : scenePoster(placed, camera, summary);
  const panel = [controls('clip', clips, clip), controls('variant', variants, variant)].join('');
  return element(
    'figure',
    nodeAttributes(node, {
      class: 'ak-block ak-3d ak-3d-model',
      'data-ak-3d': 'model',
      'data-ak-3d-state': 'static',
      'data-ak-scene': JSON.stringify(config),
    }),
    [
      titleHeader(node),
      `<div class="ak-3d-stage">${still}</div>`,
      `<figcaption class="ak-3d-caption">${escapeText(summary)}</figcaption>`,
      panel === '' ? '' : `<div class="ak-3d-controls">${panel}</div>`,
      hotspotList(node, stateValue(node, 'bind', state)),
    ].join(''),
  );
}

function checkModel(node: IrNode, { bag }: CheckContext): void {
  const seen = new Set<string>();
  hotspotsOf(node).forEach((hotspot, index) => {
    const id = String(hotspot.id);
    if (seen.has(id))
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: pathKey(pathIndex(pathKey(node.path, 'hotspots'), index), 'id'),
        nodeId: node.id,
        message: `hotspot id "${id}" is used twice`,
      });
    seen.add(id);
  });
}

export const model3dBlock: BlockModule = {
  definition: define({
    type: 'model-3d',
    category: 'media',
    tags: ['3d', 'webgl', 'gltf', 'glb', 'model', 'interactive'],
    useCases: ['show a product or part model', 'annotate a 3D model with hotspots'],
    purpose: 'glTF 2.0 model viewer with orbit, pan, zoom, clips, variants and hotspots.',
    summary: 'Model 3D: a local or allowed .glb/.gltf; clips, variants and hotspots bind to state.',
    props: MODEL_PROPS,
    runtimeFeatures: ['three'],
    actions: ['set-value'],
    a11y: 'A labelled plan or poster, the caption and a numbered hotspot list render without JS or WebGL; every control is a keyboard button.',
  }),
  render: (node, context) => renderModel(node, context),
  check: checkModel,
};
