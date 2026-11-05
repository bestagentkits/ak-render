/** Scene 3D: a composed, pickable Three.js scene with a static plan for no-JS, no-WebGL and print. */

import type { IrNode } from '../../ir.js';
import type { JsonValue } from '../../json.js';
import type { BlockModule } from '../../registry/block-module.js';
import {
  anchorProps,
  define,
  enumStr,
  list,
  OPTIONAL_TITLE,
  onProp,
  str,
  txt,
} from '../../registry/define-helpers.js';
import { element, nodeAttributes, stringProp, titleHeader } from '../../render/block-helpers.js';
import { escapeAttribute, escapeText } from '../../render/escape.js';
import type { RenderContext } from '../../render/render-context.js';
import { frameCamera, placeObjects, scenePoster } from './scene-fallback.js';
import {
  cameraProp,
  checkScene,
  isPickable,
  LIGHTING,
  MAX_OBJECTS,
  objectSchema,
  objectsOf,
  timelineSchema,
  viewSchema,
} from './scene-ir.js';

const statePath = (description: string) =>
  str({ maxLength: 128, description: `${description} A state path such as \`state.part\`.` });

export const SCENE_PROPS = {
  title: OPTIONAL_TITLE,
  summary: txt({
    required: true,
    maxLength: 600,
    description: 'What the scene shows, in words; the caption and the text alternative.',
  }),
  objects: list(objectSchema(), { required: true, minItems: 1, maxItems: MAX_OBJECTS }),
  lighting: enumStr(LIGHTING, {
    default: 'studio',
    description: 'Light rig preset; the key light casts shadows on the high quality profile.',
  }),
  camera: cameraProp(),
  timeline: list(timelineSchema(), {
    maxItems: 32,
    description: 'Declarative tweens; they play only when motion is allowed.',
  }),
  views: list(viewSchema(), {
    maxItems: 12,
    description: 'Named camera and focus states, chosen by `viewBind`.',
  }),
  bind: statePath('Selection is written here, and selecting by state highlights the object.'),
  viewBind: statePath('The active view value is read from here.'),
  on: onProp('Bindings fired with `{ value }` (the object id) when an object is selected.'),
  ...anchorProps,
};

/** The data the runtime mounts: defaults resolved, camera framed. */
export function sceneConfig(node: IrNode): Record<string, JsonValue> {
  const objects = objectsOf(node);
  const placed = placeObjects(objects);
  const camera = frameCamera(placed, node.props.camera);
  const config: Record<string, JsonValue> = {
    objects,
    camera: { position: camera.position, target: camera.target, fov: camera.fov },
  };
  for (const key of ['lighting', 'timeline', 'views', 'bind', 'viewBind'] as const) {
    const value = node.props[key];
    if (value !== undefined) config[key] = value;
  }
  return config;
}

/** The list every reader gets: selectable objects are buttons the runtime enables. */
/** The runtime draws a neutral plane as the shadow-catching floor. */
function isGround(object: Record<string, JsonValue>): boolean {
  return object.shape === 'plane' && (object.tone ?? 'accent') === 'neutral';
}

export function objectList(node: IrNode, state: Record<string, JsonValue>): string {
  const bind = stringProp(node, 'bind');
  const initial = bind.startsWith('state.') ? state[bind.slice(6)] : undefined;
  const selected = typeof initial === 'string' ? initial : '';
  const items = objectsOf(node)
    // A neutral plane is the floor the scene stands on, drawn as shadow only: not a part to list.
    .filter((object) => object.shape !== 'group' && !isGround(object))
    .map((object) => {
      const id = String(object.id);
      const label = escapeText(typeof object.label === 'string' ? object.label : id);
      const description =
        typeof object.description === 'string' && object.description !== ''
          ? `<span class="ak-3d-note">${escapeText(object.description)}</span>`
          : '';
      if (!isPickable(object))
        return `<li><span class="ak-3d-item"><span class="ak-3d-name">${label}</span>${description}</span></li>`;
      return `<li><button type="button" disabled data-ak-3d-pick="${escapeAttribute(id)}" aria-pressed="${
        id === selected ? 'true' : 'false'
      }"><span class="ak-3d-name">${label}</span>${description}</button></li>`;
    })
    .join('');
  return `<ul class="ak-3d-objects">${items}</ul>`;
}

export function renderScene(node: IrNode, context: RenderContext, kind: string): string {
  const config = sceneConfig(node);
  const placed = placeObjects(objectsOf(node));
  const camera = frameCamera(placed, node.props.camera);
  const summary = stringProp(node, 'summary');
  return element(
    'figure',
    nodeAttributes(node, {
      class: 'ak-block ak-3d',
      'data-ak-3d': kind,
      'data-ak-3d-state': 'static',
      'data-ak-scene': JSON.stringify(config),
    }),
    [
      titleHeader(node),
      `<div class="ak-3d-stage">${scenePoster(placed, camera, summary)}</div>`,
      `<figcaption class="ak-3d-caption">${escapeText(summary)}</figcaption>`,
      objectList(node, context.ir.state),
    ].join(''),
  );
}

export const scene3dBlock: BlockModule = {
  definition: define({
    type: 'scene-3d',
    category: 'media',
    tags: ['3d', 'webgl', 'three', 'scene', 'interactive'],
    useCases: ['explain a spatial layout', 'interactive product or system model'],
    purpose: 'Composed 3D scene from typed primitives, materials, lights and a camera.',
    summary: 'Scene 3D: nested primitives, materials, lighting, camera, views; pick writes state.',
    props: SCENE_PROPS,
    runtimeFeatures: ['three'],
    actions: ['set-value'],
    a11y: 'A labelled SVG plan and an object list of buttons render without JS or WebGL; selection works by keyboard, pointer and touch.',
  }),
  render: (node, context) => renderScene(node, context, 'scene'),
  check: checkScene,
};
