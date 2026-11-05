/**
 * The v2 semantic manifest: which drawn element is which node, relationship
 * and group of the diagram spec.
 *
 * A v2 adapter returns its SVG together with a manifest and the capabilities
 * the drawing supports. The compiler never trusts the manifest's word:
 *
 * - it is read field by field into a bounded shape; anything else is dropped;
 * - every node, relationship and group it names must be one the spec declares
 *   (`semantic-graph.ts`), so a drawing can never claim a relationship the
 *   spec does not state;
 * - every entry must bind exactly one element of the accepted markup;
 * - the compiler, not the adapter, writes the `data-ak-*` hooks the viewer and
 *   motion read, and carries labels from the spec rather than from the adapter;
 * - every `id` in the drawing, and every same-document reference to one, is
 *   prefixed with the panel scope, so two panels never share an id.
 *
 * Only the manifest's ids and element references are read. Labels, roles and
 * any other field an adapter sends are ignored.
 */

import { ATTRIBUTE_NAME, ATTRIBUTE_VALUE, WS } from './adapter-markup-fit.js';
import type { DiagramGroup, SemanticGraph } from './semantic-graph.js';

/** Interactions a v2 drawing can support; the compiler owns the runtime for each. */
export const DIAGRAM_CAPABILITIES = ['focus', 'trace', 'zoom', 'search'] as const;
export type DiagramCapability = (typeof DIAGRAM_CAPABILITIES)[number];

export interface DiagramManifestNode {
  /** A node id the spec declares. */
  readonly id: string;
  /** The drawn element's `id`; without it, the element whose `data-node-id` is `id`. */
  readonly element?: string;
}

export interface DiagramManifestEdge {
  readonly from: string;
  readonly to: string;
  /** Adapter edge id, matched against `data-edge-id` when `element` is absent. */
  readonly id?: string;
  readonly element?: string;
  /**
   * Position of the relationship in the spec's list. Needed only when the spec
   * declares several relationships between the same pair with different
   * labels; without it they are matched in declaration order.
   */
  readonly index?: number;
}

export interface DiagramManifestGroup {
  /** A group id the spec declares (boundary, lane or stage). */
  readonly id: string;
  readonly element?: string;
}

export interface DiagramManifest {
  readonly version: 2;
  readonly nodes: readonly DiagramManifestNode[];
  readonly edges?: readonly DiagramManifestEdge[];
  readonly groups?: readonly DiagramManifestGroup[];
}

/** What a v2 adapter returns instead of a bare SVG string. */
export interface DiagramRenderResult {
  readonly svg: string;
  readonly manifest: DiagramManifest;
  readonly capabilities?: Partial<Record<DiagramCapability, boolean>>;
}

/** Bounds on a manifest, so a runaway adapter cannot inflate the page or the runtime. */
export const MAX_MANIFEST_NODES = 400;
export const MAX_MANIFEST_EDGES = 1200;
export const MAX_MANIFEST_GROUPS = 100;

/** A drawn element id an adapter may reference: a plain token. */
const ELEMENT_ID = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u;
/** A spec id: any string up to 200 characters without control characters. */
const SPEC_ID_MAX = 200;
function isSpecId(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > SPEC_ID_MAX) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

export type ManifestRead =
  | {
      readonly ok: true;
      readonly manifest: DiagramManifest;
      readonly capabilities: DiagramCapability[];
    }
  | { readonly ok: false; readonly reason: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalElement(value: unknown): string | undefined | false {
  if (value === undefined) return undefined;
  return typeof value === 'string' && ELEMENT_ID.test(value) ? value : false;
}

/** Read an adapter's v2 result into the bounded manifest shape, or say why it cannot be read. */
export function readManifest(result: unknown): ManifestRead {
  if (!isObject(result)) return { ok: false, reason: 'v2 result is not an object' };
  const raw = result.manifest;
  if (!isObject(raw) || raw.version !== 2) {
    return { ok: false, reason: 'manifest is missing or not version 2' };
  }
  if (!Array.isArray(raw.nodes)) return { ok: false, reason: 'manifest has no nodes' };
  const edges = raw.edges === undefined ? [] : raw.edges;
  const groups = raw.groups === undefined ? [] : raw.groups;
  if (!Array.isArray(edges) || !Array.isArray(groups)) {
    return { ok: false, reason: 'manifest edges and groups must be lists' };
  }
  if (
    raw.nodes.length > MAX_MANIFEST_NODES ||
    edges.length > MAX_MANIFEST_EDGES ||
    groups.length > MAX_MANIFEST_GROUPS
  ) {
    return { ok: false, reason: 'manifest exceeds its size bounds' };
  }
  const nodes: DiagramManifestNode[] = [];
  for (const item of raw.nodes) {
    const element = isObject(item) ? optionalElement(item.element) : false;
    if (!isObject(item) || !isSpecId(item.id) || element === false) {
      return { ok: false, reason: 'manifest node needs a spec id and an optional element token' };
    }
    nodes.push(element === undefined ? { id: item.id } : { id: item.id, element });
  }
  const readEdges: DiagramManifestEdge[] = [];
  for (const item of edges) {
    const element = isObject(item) ? optionalElement(item.element) : false;
    const id = isObject(item) ? item.id : undefined;
    const index = isObject(item) ? item.index : undefined;
    if (
      index !== undefined &&
      !(typeof index === 'number' && Number.isInteger(index) && index >= 0)
    ) {
      return { ok: false, reason: 'manifest edge index must be a non-negative integer' };
    }
    if (
      !isObject(item) ||
      typeof item.from !== 'string' ||
      typeof item.to !== 'string' ||
      element === false ||
      (id !== undefined && !isSpecId(id)) ||
      (element === undefined && id === undefined)
    ) {
      return { ok: false, reason: 'manifest edge needs from, to and an element or id' };
    }
    readEdges.push({
      from: item.from,
      to: item.to,
      ...(typeof id === 'string' ? { id } : {}),
      ...(element === undefined ? {} : { element }),
      ...(typeof index === 'number' ? { index } : {}),
    });
  }
  const readGroups: DiagramManifestGroup[] = [];
  for (const item of groups) {
    const element = isObject(item) ? optionalElement(item.element) : false;
    if (!isObject(item) || !isSpecId(item.id) || element === false) {
      return { ok: false, reason: 'manifest group needs a spec id and an optional element token' };
    }
    readGroups.push(element === undefined ? { id: item.id } : { id: item.id, element });
  }
  const declared = isObject(result.capabilities) ? result.capabilities : {};
  const capabilities = DIAGRAM_CAPABILITIES.filter((name) => declared[name] === true);
  return {
    ok: true,
    manifest: { version: 2, nodes, edges: readEdges, groups: readGroups },
    capabilities,
  };
}

/**
 * Check the manifest against the graph the spec declares. Returns a reason when
 * it names a node, relationship or group the spec does not state, or names one
 * twice.
 */
export function checkManifestAgainstGraph(
  manifest: DiagramManifest,
  graph: SemanticGraph,
): string | undefined {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const seenNodes = new Set<string>();
  for (const node of manifest.nodes) {
    if (!nodeIds.has(node.id)) return `manifest node "${node.id}" is not declared by the spec`;
    if (seenNodes.has(node.id)) return `manifest node "${node.id}" is listed twice`;
    seenNodes.add(node.id);
  }
  // Relationships are matched as a multiset of (from, to): two declared edges
  // between the same pair may be drawn twice, a third may not.
  const available = new Map<string, number>();
  for (const edge of graph.edges) {
    const key = `${edge.from}\u0000${edge.to}`;
    available.set(key, (available.get(key) ?? 0) + 1);
  }
  const usedIndices = new Set<number>();
  for (const edge of manifest.edges ?? []) {
    if (edge.index !== undefined) {
      const declared = graph.edges[edge.index];
      if (declared === undefined || declared.from !== edge.from || declared.to !== edge.to) {
        return `manifest relationship index ${edge.index} is not "${edge.from}" -> "${edge.to}" in the spec`;
      }
      if (usedIndices.has(edge.index))
        return `manifest relationship index ${edge.index} is listed twice`;
      usedIndices.add(edge.index);
    }
    const key = `${edge.from}\u0000${edge.to}`;
    const left = available.get(key) ?? 0;
    if (left === 0) {
      return `manifest relationship "${edge.from}" -> "${edge.to}" is not declared by the spec`;
    }
    available.set(key, left - 1);
  }
  const groupIds = new Set(graph.groups.map((group) => group.id).filter((id) => id !== ''));
  const seenGroups = new Set<string>();
  for (const group of manifest.groups ?? []) {
    if (!groupIds.has(group.id)) return `manifest group "${group.id}" is not declared by the spec`;
    if (seenGroups.has(group.id)) return `manifest group "${group.id}" is listed twice`;
    seenGroups.add(group.id);
  }
  return undefined;
}

const START_TAG = new RegExp(
  `<([A-Za-z][A-Za-z0-9:-]*)((?:${WS}+${ATTRIBUTE_NAME}${ATTRIBUTE_VALUE})*)(${WS}*\\/?>)`,
  'gu',
);
const ATTRIBUTE = new RegExp(
  `(${WS}+)(${ATTRIBUTE_NAME})(?:(${WS}*=${WS}*)("[^"]*"|'[^']*'|[^\\t\\n\\f\\r "'=<>\`]+))?`,
  'gu',
);
const STYLE_BODY = /(<style\b[^>]*>)([^<]*)(<\/style)/giu;
const URL_FRAGMENT = /url\(\s*(['"]?)#([A-Za-z0-9_.:-]+)\1\s*\)/giu;

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
};

function decode(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos|#39);/gu, (_, name: string) => ENTITIES[name] ?? '');
}

function encode(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/"/gu, '&quot;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;');
}

function unquote(value: string | undefined): string {
  if (value === undefined) return '';
  const first = value[0];
  return first === '"' || first === "'" ? value.slice(1, -1) : value;
}

/** Attributes whose value is a space-separated list of element ids. */
const ID_LIST_ATTRIBUTES: ReadonlySet<string> = new Set(['aria-labelledby', 'aria-describedby']);

interface Binding {
  readonly attributes: string;
  bound: boolean;
}

export interface BoundManifest {
  readonly markup: string;
  readonly nodes: number;
  readonly edges: number;
  readonly groups: number;
}

export type BindResult =
  | { readonly ok: true; readonly bound: BoundManifest }
  | { readonly ok: false; readonly reason: string };

function nodeHook(id: string, label: string): string {
  return ` data-ak-node="${encode(id)}" data-ak-label="${encode(label)}"`;
}

function edgeHook(index: number, from: string, to: string, label: string): string {
  return ` data-ak-edge="${index}" data-ak-from="${encode(from)}" data-ak-to="${encode(to)}" data-ak-label="${encode(label)}"`;
}

function groupHook(group: DiagramGroup): string {
  return ` data-ak-group="${encode(group.id)}" data-ak-label="${encode(group.label)}" data-ak-members="${encode(group.members.join(' '))}"`;
}

/**
 * Write the compiler's hooks onto the elements the manifest names, and prefix
 * every id and same-document reference with the panel scope.
 *
 * The markup has already passed the trust boundary, so it is a well-formed
 * fragment whose stylesheets contain no `<`; start tags can be read in order.
 */
export function bindManifest(
  markup: string,
  manifest: DiagramManifest,
  graph: SemanticGraph,
  scope: string,
): BindResult {
  const prefix = `${scope}-`;
  const nodeLabels = new Map(graph.nodes.map((node) => [node.id, node.label]));
  const groupsById = new Map(graph.groups.map((group) => [group.id, group]));
  // Spec relationship positions per pair; indexed manifest entries claim theirs
  // first, the rest take the remaining positions in declaration order.
  const pool = new Map<string, number[]>();
  graph.edges.forEach((edge, index) => {
    const key = `${edge.from}\u0000${edge.to}`;
    pool.set(key, [...(pool.get(key) ?? []), index]);
  });
  for (const edge of manifest.edges ?? []) {
    if (edge.index === undefined) continue;
    const key = `${edge.from}\u0000${edge.to}`;
    pool.set(
      key,
      (pool.get(key) ?? []).filter((index) => index !== edge.index),
    );
  }

  const byElement = new Map<string, Binding>();
  const byAttribute = new Map<string, Binding>();
  const all: Binding[] = [];
  let listedTwice: string | undefined;
  const add = (key: { element?: string }, fallbackKey: string, attributes: string): void => {
    const binding: Binding = { attributes, bound: false };
    all.push(binding);
    const map = key.element === undefined ? byAttribute : byElement;
    const lookup = key.element ?? fallbackKey;
    if (map.has(lookup)) listedTwice ??= key.element ?? fallbackKey.replace('\u0000', ' ');
    map.set(lookup, binding);
  };
  for (const node of manifest.nodes) {
    add(node, `data-node-id\u0000${node.id}`, nodeHook(node.id, nodeLabels.get(node.id) ?? ''));
  }
  (manifest.edges ?? []).forEach((edge, index) => {
    const key = `${edge.from}\u0000${edge.to}`;
    const position = edge.index ?? pool.get(key)?.shift();
    const label = position === undefined ? '' : (graph.edges[position]?.label ?? '');
    add(edge, `data-edge-id\u0000${edge.id ?? ''}`, edgeHook(index, edge.from, edge.to, label));
  });
  for (const group of manifest.groups ?? []) {
    const declared = groupsById.get(group.id);
    if (declared !== undefined) add(group, `data-group-id\u0000${group.id}`, groupHook(declared));
  }

  if (listedTwice !== undefined) {
    return { ok: false, reason: `manifest names element ${listedTwice} more than once` };
  }
  let invalidId: string | undefined;
  let duplicate: string | undefined;
  const rewritten = markup.replace(
    START_TAG,
    (_tag, name: string, attributeList: string, close: string) => {
      let hook = '';
      const claim = (binding: Binding | undefined, label: string): void => {
        if (binding === undefined) return;
        if (binding.bound) {
          duplicate ??= label;
          return;
        }
        binding.bound = true;
        hook += binding.attributes;
      };
      const attributes = attributeList.replace(
        ATTRIBUTE,
        (
          whole,
          space: string,
          attrName: string,
          equals: string | undefined,
          raw: string | undefined,
        ) => {
          const lowered = attrName.toLowerCase();
          const value = decode(unquote(raw));
          if (lowered === 'id') {
            if (!ELEMENT_ID.test(value)) invalidId ??= value;
            claim(byElement.get(value), `element "${value}"`);
            return `${space}${attrName}${equals ?? '='}"${encode(prefix + value)}"`;
          }
          if (
            lowered === 'data-node-id' ||
            lowered === 'data-edge-id' ||
            lowered === 'data-group-id'
          ) {
            claim(byAttribute.get(`${lowered}\u0000${value}`), `${lowered} "${value}"`);
            return whole;
          }
          if ((lowered === 'href' || lowered.endsWith(':href')) && value.startsWith('#')) {
            return `${space}${attrName}${equals ?? '='}"#${encode(prefix + value.slice(1))}"`;
          }
          if (ID_LIST_ATTRIBUTES.has(lowered)) {
            const ids = value.split(/[\t\n\f\r ]+/u).filter((token) => token !== '');
            return `${space}${attrName}="${encode(ids.map((token) => prefix + token).join(' '))}"`;
          }
          const scoped = value.replace(
            URL_FRAGMENT,
            (_m, _q, id: string) => `url(#${prefix}${id})`,
          );
          return raw === undefined || scoped === value
            ? whole
            : `${space}${attrName}${equals ?? '='}"${encode(scoped)}"`;
        },
      );
      return `<${name}${attributes}${hook}${close}`;
    },
  );
  if (invalidId !== undefined) {
    return {
      ok: false,
      reason: `drawn id "${invalidId.slice(0, 40)}" is not a plain token ([A-Za-z][A-Za-z0-9_.:-]*)`,
    };
  }
  if (duplicate !== undefined)
    return { ok: false, reason: `manifest ${duplicate} matches more than one element` };
  const unbound = all.findIndex((binding) => !binding.bound);
  if (unbound !== -1)
    return { ok: false, reason: 'a manifest entry matches no element in the drawing' };
  const scoped = rewritten.replace(
    STYLE_BODY,
    (_m, open: string, body: string, close: string) =>
      `${open}${body.replace(URL_FRAGMENT, (_u, _q, id: string) => `url(#${prefix}${id})`)}${close}`,
  );
  return {
    ok: true,
    bound: {
      markup: scoped,
      nodes: manifest.nodes.length,
      edges: manifest.edges?.length ?? 0,
      groups: manifest.groups?.length ?? 0,
    },
  };
}
