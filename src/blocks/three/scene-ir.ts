/**
 * The nested 3D scene IR shared by the 3D blocks.
 *
 * A scene is typed data: closed shape, material, light and tone vocabularies,
 * bounded vectors and counts, and id references that the check resolves. There
 * is no shader source, script or callback anywhere in it; the runtime owns how
 * each preset is drawn.
 */

import { pathIndex, pathKey } from '../../diagnostics.js';
import type { IrNode } from '../../ir.js';
import { isPlainObject, type JsonValue } from '../../json.js';
import type { CheckContext } from '../../registry/block-module.js';
import { enumStr, idProp, LABEL, list, num, obj, str } from '../../registry/define-helpers.js';
import type { PropSchema } from '../../registry/prop-schema.js';

export const SHAPES = [
  'box',
  'sphere',
  'cylinder',
  'cone',
  'torus',
  'torus-knot',
  'plane',
  'icosahedron',
  'group',
] as const;
export const MATERIALS = ['standard', 'matte', 'metal', 'glass', 'wireframe', 'emissive'] as const;
export const TONES = ['accent', 'neutral', 'success', 'warning', 'danger', 'info'] as const;
export const LIGHTING = ['studio', 'soft', 'dramatic', 'night'] as const;
export const ANIMATED = ['rotation', 'position', 'scale'] as const;

export const MAX_OBJECTS = 200;
export const MAX_DEPTH = 8;
const COORD = 1000;

export const vec3 = (description: string, min = -COORD, max = COORD): PropSchema =>
  list(num({ min, max }), { minItems: 3, maxItems: 3, description });

export const cameraProp = (): PropSchema =>
  obj(
    {
      position: vec3('Camera position [x, y, z]; default [4, 3, 6].'),
      target: vec3('Point the camera looks at; default the origin.'),
    },
    { description: 'Camera; omitted, the compiler frames the scene.' },
  );

export const objectSchema = (): PropSchema =>
  obj({
    id: {
      ...idProp('Object id; a `select` binding receives it as the event value.'),
      required: true,
    },
    label: LABEL,
    description: str({
      maxLength: 300,
      description: 'Read in the static fallback and by assistive technology.',
    }),
    shape: enumStr(SHAPES, {
      default: 'box',
      description: '`group` draws nothing and only transforms its children.',
    }),
    parent: str({
      maxLength: 64,
      description: 'Id of a parent object; its transform applies to this one.',
    }),
    size: num({
      min: 0.01,
      max: 100,
      default: 1,
      description: 'Uniform base size in scene units.',
    }),
    position: vec3('Position relative to the parent [x, y, z].'),
    rotation: vec3('Rotation in degrees [x, y, z].', -360, 360),
    scale: vec3('Scale per axis [x, y, z].', 0.01, 100),
    material: enumStr(MATERIALS, { default: 'standard' }),
    tone: enumStr(TONES, { default: 'accent', description: 'Theme color the material takes.' }),
  });

export const timelineSchema = (): PropSchema =>
  obj({
    target: { kind: 'string', required: true, maxLength: 64, description: 'Object id to animate.' },
    property: enumStr(ANIMATED, { required: true }),
    to: { ...vec3('End value; rotation in degrees.'), required: true },
    duration: num({
      min: 100,
      max: 60000,
      default: 2000,
      description: 'Milliseconds; rotation spins on, position and scale ease back and forth.',
    }),
  });

export const viewSchema = (): PropSchema =>
  obj({
    value: {
      kind: 'string',
      required: true,
      maxLength: 64,
      description: 'State value that selects this view.',
    },
    camera: cameraProp(),
    focus: str({ maxLength: 64, description: 'Object id highlighted in this view.' }),
  });

/** Every drawn object is pickable except a plane, which serves as ground or backdrop. */
export function isPickable(object: Record<string, JsonValue>): boolean {
  return object.shape !== 'plane' && object.shape !== 'group';
}

export function objectsOf(node: IrNode): Record<string, JsonValue>[] {
  const raw = node.props.objects;
  return Array.isArray(raw) ? (raw.filter(isPlainObject) as Record<string, JsonValue>[]) : [];
}

function listOf(node: IrNode, key: string): Record<string, JsonValue>[] {
  const raw = node.props[key];
  return Array.isArray(raw) ? (raw.filter(isPlainObject) as Record<string, JsonValue>[]) : [];
}

/** Duplicate ids, unknown parents, parent cycles and depth, unknown timeline and view targets. */
export function checkScene(node: IrNode, { bag }: CheckContext): void {
  const objects = objectsOf(node);
  const objectsPath = pathKey(node.path, 'objects');
  const index = new Map<string, number>();
  const report = (path: string, message: string) =>
    bag.add({ code: 'SPEC_VALIDATION_ERROR', path, nodeId: node.id, message });

  objects.forEach((object, i) => {
    const id = typeof object.id === 'string' ? object.id : '';
    if (index.has(id))
      report(pathKey(pathIndex(objectsPath, i), 'id'), `object id "${id}" is used twice`);
    else index.set(id, i);
  });
  objects.forEach((object, i) => {
    if (typeof object.parent !== 'string') return;
    const path = pathKey(pathIndex(objectsPath, i), 'parent');
    if (!index.has(object.parent)) {
      report(path, `parent "${object.parent}" is not an object id in this scene`);
      return;
    }
    const seen = new Set<string>([String(object.id)]);
    let cursor: string | undefined = object.parent;
    let depth = 1;
    while (cursor !== undefined) {
      if (seen.has(cursor)) {
        report(path, `parent chain of "${String(object.id)}" forms a cycle`);
        return;
      }
      seen.add(cursor);
      depth += 1;
      const next: JsonValue | undefined = objects[index.get(cursor) ?? -1]?.parent;
      cursor = typeof next === 'string' && index.has(next) ? next : undefined;
    }
    if (depth > MAX_DEPTH) report(path, `objects nest at most ${MAX_DEPTH} levels deep`);
  });
  const known = (key: string, field: string) =>
    listOf(node, key).forEach((entry, i) => {
      const ref = entry[field];
      if (typeof ref === 'string' && !index.has(ref)) {
        report(
          pathKey(pathIndex(pathKey(node.path, key), i), field),
          `"${ref}" is not an object id in this scene`,
        );
      }
    });
  known('timeline', 'target');
  known('views', 'focus');
  const values = new Set<string>();
  listOf(node, 'views').forEach((view, i) => {
    const value = String(view.value);
    if (values.has(value)) {
      report(
        pathKey(pathIndex(pathKey(node.path, 'views'), i), 'value'),
        `view "${value}" is listed twice`,
      );
    }
    values.add(value);
  });
}
