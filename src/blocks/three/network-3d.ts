/**
 * Network 3D: a node-link graph laid out at compile time (force, hierarchical
 * or radial), drawn by the shared 3D runtime with instanced nodes and one edge
 * batch. Picking a node writes page state, lights its neighbours and flies the
 * camera to it; a group filter reads page state. Without JS or WebGL the reader
 * gets a static SVG plan and a full node and edge table.
 */

import { pathIndex, pathKey } from '../../diagnostics.js';
import type { IrNode } from '../../ir.js';
import { isPlainObject, type JsonValue } from '../../json.js';
import type { BlockModule, CheckContext } from '../../registry/block-module.js';
import {
  anchorProps,
  bool,
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
import { LAYOUTS, type Layout, layoutGraph } from './network-layout.js';
import { project, type SceneCamera, type Vec3 } from './scene-fallback.js';
import { TONES } from './scene-ir.js';

export const MAX_NODES = 2000;
export const MAX_EDGES = 4000;
const MAX_GROUPS = 24;
/**
 * Groups without a tone take these in order, so neighbouring clusters contrast.
 * Warning is left out: it sits too close to accent in most themes. Past one
 * round, a shade (1-4) mixes the tone toward the text or the background color.
 */
const TONE_CYCLE = ['accent', 'info', 'success', 'danger', 'neutral'] as const;
const FOV = 30;
/** Poster nodes that carry a text label: the best connected, so the plan stays legible. */
const POSTER_LABELS = 14;

const statePath = (description: string) =>
  str({ maxLength: 128, description: `${description} A state path such as \`state.node\`.` });
const ref = (description: string) => str({ required: true, maxLength: 64, description });

export const NETWORK_PROPS = {
  title: OPTIONAL_TITLE,
  summary: txt({
    required: true,
    maxLength: 600,
    description: 'What the graph shows, in words; the caption and the text alternative.',
  }),
  nodes: list(
    obj({
      id: { ...idProp('Node id; selection writes it to `bind`.'), required: true },
      label: str({ maxLength: 120, description: 'Shown name; defaults to the id.' }),
      group: str({ maxLength: 64, description: 'Cluster the node belongs to.' }),
      weight: num({ min: 0.1, max: 10, default: 1, description: 'Relative node size.' }),
      description: str({ maxLength: 300, description: 'Read in the table and when selected.' }),
    }),
    { maxItems: 200, description: 'Nodes with labels and details; `nodeList` adds more tersely.' },
  ),
  nodeList: {
    kind: 'text',
    maxLength: 48000,
    description:
      'Compact nodes, one per line: `id [group] [label…]`. Use it for large graphs; it adds to `nodes`.',
  } as const,
  edges: list(
    obj({
      from: ref('Source node id.'),
      to: ref('Target node id.'),
    }),
    { maxItems: 200, description: 'Links; cycles are allowed.' },
  ),
  edgeList: {
    kind: 'text',
    maxLength: 48000,
    description:
      'Compact links as `from>to` tokens separated by spaces or new lines; adds to `edges`.',
  } as const,
  groups: list(
    obj({
      id: { kind: 'string', required: true, maxLength: 64, description: 'Group id nodes name.' },
      label: str({ maxLength: 120 }),
      tone: enumStr(TONES, { description: 'Theme color; omitted, groups cycle the palette.' }),
    }),
    { maxItems: MAX_GROUPS, description: 'Optional group labels and tones, in legend order.' },
  ),
  layout: enumStr(LAYOUTS, {
    default: 'force',
    description:
      '`force` clusters by group, `hierarchical` layers from sources, `radial` rings from `root`.',
  }),
  root: str({ maxLength: 64, description: 'Root node for `radial` and `hierarchical`.' }),
  directed: bool({ default: false, description: 'Edges run from `from` to `to`.' }),
  bind: statePath('Selection is written here; a node id set here selects it.'),
  filterBind: statePath('A group id read from here shows only that group; empty shows all.'),
  on: onProp('Bindings fired with `{ value }` (the node id) when a node is selected.'),
  ...anchorProps,
};

interface Prepared {
  ids: string[];
  labels: string[];
  descriptions: string[];
  groupOf: number[];
  groups: { id: string; label: string; tone: string; shade: number }[];
  edges: [number, number][];
  degree: number[];
  radius: number[];
  positions: Vec3[];
  camera: SceneCamera;
}

function rows(node: IrNode, key: string): Record<string, JsonValue>[] {
  const raw = node.props[key];
  return Array.isArray(raw) ? (raw.filter(isPlainObject) as Record<string, JsonValue>[]) : [];
}
const TOKEN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** `nodes` plus the parsed `nodeList` lines; malformed lines are the check's to report. */
function nodeRowsOf(node: IrNode): Record<string, JsonValue>[] {
  const out = rows(node, 'nodes');
  const raw = node.props.nodeList;
  if (typeof raw !== 'string') return out;
  for (const line of raw.split('\n')) {
    const [id, group, ...label] = line.trim().split(/\s+/);
    if (id === undefined || id === '' || !TOKEN.test(id)) continue;
    const row: Record<string, JsonValue> = { id };
    if (group !== undefined) row.group = group;
    if (label.length > 0) row.label = label.join(' ');
    out.push(row);
  }
  return out;
}

/** `edges` plus the parsed `edgeList` tokens. */
function edgeRowsOf(node: IrNode): Record<string, JsonValue>[] {
  const out = rows(node, 'edges');
  const raw = node.props.edgeList;
  if (typeof raw !== 'string') return out;
  for (const token of raw.split(/[\s,]+/)) {
    const [from, to, extra] = token.split('>');
    if (from && to && extra === undefined) out.push({ from, to });
  }
  return out;
}

const text = (value: JsonValue | undefined, fallback = '') =>
  typeof value === 'string' && value !== '' ? value : fallback;

/** The camera looks from a side that suits the layout: layers read best face on, rings from above. */
const VIEW: Record<Layout, Vec3> = {
  force: [0.62, 0.42, 0.66],
  hierarchical: [0.32, 0.22, 0.92],
  radial: [0.2, 0.86, 0.47],
};

const cache = new WeakMap<IrNode, Prepared>();

/** Resolve groups, ids, degrees, sizes and the compile-time layout once per node. */
function prepare(node: IrNode): Prepared {
  const hit = cache.get(node);
  if (hit) return hit;
  const nodeRows = nodeRowsOf(node);
  const declared = rows(node, 'groups');
  const groups: Prepared['groups'] = [];
  const groupIndex = new Map<string, number>();
  const addGroup = (id: string, label: string, tone?: string) => {
    if (groupIndex.has(id)) return;
    groupIndex.set(id, groups.length);
    const k = groups.length;
    groups.push({
      id,
      label,
      tone: tone ?? (TONE_CYCLE[k % TONE_CYCLE.length] as string),
      shade: tone ? 0 : Math.floor(k / TONE_CYCLE.length) % 5,
    });
  };
  for (const g of declared) {
    const id = text(g.id);
    addGroup(id, text(g.label, id), typeof g.tone === 'string' ? g.tone : undefined);
  }
  const ids = nodeRows.map((n) => text(n.id));
  const groupOf = nodeRows.map((n) => {
    const id = text(n.group, '');
    addGroup(id, id === '' ? 'Ungrouped' : id);
    return groupIndex.get(id) as number;
  });
  const index = new Map<string, number>();
  ids.forEach((id, i) => {
    if (!index.has(id)) index.set(id, i);
  });
  const edges: [number, number][] = [];
  const degree = ids.map(() => 0);
  for (const e of edgeRowsOf(node)) {
    const a = index.get(text(e.from));
    const b = index.get(text(e.to));
    if (a === undefined || b === undefined || a === b) continue;
    edges.push([a, b]);
    degree[a] = (degree[a] ?? 0) + 1;
    degree[b] = (degree[b] ?? 0) + 1;
  }
  const layout = (LAYOUTS as readonly string[]).includes(String(node.props.layout))
    ? (node.props.layout as Layout)
    : 'force';
  const laid = layoutGraph(
    ids.map((id, i) => ({ id, group: groups[groupOf[i] ?? 0]?.id ?? '' })),
    edges.map(([a, b]) => ({ from: ids[a] as string, to: ids[b] as string })),
    layout,
    typeof node.props.root === 'string' ? node.props.root : undefined,
  );
  // A force layout is a ball; widen it on the floor plane so it fills a 16:9 stage.
  const positions: Vec3[] =
    layout === 'force'
      ? laid.map(([x, y, z]) => [Math.round(x * 140) / 100, y, Math.round(z * 140) / 100])
      : laid;
  // Smaller graphs get larger nodes, so twelve nodes do not float as specks.
  const base = Math.min(0.45, Math.max(0.08, 1.1 / Math.cbrt(ids.length)));
  const radius = nodeRows.map((n, i) => {
    const weight = typeof n.weight === 'number' ? n.weight : 1;
    const r = base * (0.8 + 0.22 * Math.sqrt(degree[i] ?? 0)) * Math.sqrt(weight);
    return Math.round(Math.min(base * 3, r) * 1000) / 1000;
  });
  // Frame the laid-out graph: the closest distance at which every node, with
  // its radius, still projects inside 88% of the 16:9 stage.
  const direction = VIEW[layout];
  const round = (n: number) => Math.round(n * 100) / 100;
  const at = (distance: number): SceneCamera => ({
    position: direction.map((v) => v * distance) as Vec3,
    target: [0, 0, 0],
    fov: FOV,
  });
  const fits = (camera: SceneCamera) =>
    positions.every((point, i) => {
      const p = project(point, camera);
      if (p === null) return false;
      const r = ((radius[i] ?? 0) / p.depth) * (180 / Math.tan(((FOV / 2) * Math.PI) / 180));
      return (
        p.x - r > 640 * 0.06 && p.x + r < 640 * 0.94 && p.y - r > 360 * 0.06 && p.y + r < 360 * 0.94
      );
    });
  let near = 1;
  let far = 400;
  for (let step = 0; step < 30; step += 1) {
    const mid = (near + far) / 2;
    if (fits(at(mid))) far = mid;
    else near = mid;
  }
  const camera = at(far);
  camera.position = camera.position.map(round) as Vec3;
  const prepared: Prepared = {
    ids,
    labels: nodeRows.map((n, i) => text(n.label, ids[i])),
    descriptions: nodeRows.map((n) => text(n.description)),
    groupOf,
    groups,
    edges,
    degree,
    radius,
    positions,
    camera,
  };
  cache.set(node, prepared);
  return prepared;
}

/** The data the runtime mounts: positions, sizes and indices, all resolved by the compiler. */
export function networkConfig(node: IrNode): Record<string, JsonValue> {
  const p = prepare(node);
  const config: Record<string, JsonValue> = {
    ids: p.ids,
    labels: p.labels,
    group: p.groupOf,
    groups: p.groups.map((g) => ({ id: g.id, label: g.label, tone: g.tone, shade: g.shade })),
    radius: p.radius,
    position: p.positions.flat(),
    edges: p.edges.flat(),
    camera: { position: p.camera.position, target: p.camera.target, fov: p.camera.fov },
  };
  for (const key of ['bind', 'filterBind'] as const) {
    const value = node.props[key];
    if (typeof value === 'string') config[key] = value;
  }
  return config;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** A static plan through the runtime's own camera: every edge, every node, the hubs labelled. */
function networkPoster(p: Prepared, label: string): string {
  const H = 360;
  const f = H / 2 / Math.tan(((p.camera.fov / 2) * Math.PI) / 180);
  const at = p.positions.map((pos) => project(pos, p.camera));
  const dense = p.ids.length > 200;
  const path = p.edges
    .map(([a, b]) => {
      const u = at[a];
      const v = at[b];
      return u && v ? `M${r1(u.x)} ${r1(u.y)}L${r1(v.x)} ${r1(v.y)}` : '';
    })
    .join('');
  const order = p.ids
    .map((_, i) => i)
    .filter((i) => at[i])
    .sort((a, b) => (at[b]?.depth ?? 0) - (at[a]?.depth ?? 0) || a - b);
  const dots = order
    .map((i) => {
      const point = at[i] as { x: number; y: number; depth: number };
      const r = Math.max(1.2, ((p.radius[i] ?? 0.1) / point.depth) * f);
      return `<circle class="ak-3d-mark ak-net-dot"${toneAttrs(p.groups[p.groupOf[i] ?? 0])} cx="${r1(point.x)}" cy="${r1(point.y)}" r="${r1(r)}"/>`;
    })
    .join('');
  const hubs = p.ids
    .map((_, i) => i)
    .filter((i) => at[i])
    .sort((a, b) => (p.degree[b] ?? 0) - (p.degree[a] ?? 0) || a - b)
    .slice(0, POSTER_LABELS)
    .map((i) => {
      const point = at[i] as { x: number; y: number; depth: number };
      const r = Math.max(1.2, ((p.radius[i] ?? 0.1) / point.depth) * f);
      return `<text x="${r1(point.x)}" y="${r1(point.y - r - 5)}">${escapeText(p.labels[i] ?? '')}</text>`;
    })
    .join('');
  return `<svg class="ak-3d-poster ak-net-poster" viewBox="0 0 640 ${H}" role="img" aria-label="${escapeAttribute(
    label,
  )}" preserveAspectRatio="xMidYMid meet"><path class="ak-net-links${dense ? ' ak-net-dense' : ''}" d="${path}"/>${dots}<g class="ak-net-labels">${hubs}</g></svg>`;
}

function toneAttrs(group: { tone: string; shade: number } | undefined): string {
  const tone = group?.tone ?? 'accent';
  return group?.shade
    ? ` data-tone="${tone}" data-ak-net-shade="${group.shade}"`
    : ` data-tone="${tone}"`;
}

function legend(p: Prepared, filterable: boolean): string {
  if (p.groups.length < 2 && !filterable) return '';
  const counts = p.groups.map(() => 0);
  for (const g of p.groupOf) counts[g] = (counts[g] ?? 0) + 1;
  const chip = (inner: string, value: string | null, group?: Prepared['groups'][number]) => {
    const swatch = group ? `<span class="ak-net-swatch"${toneAttrs(group)}></span>` : '';
    return filterable
      ? `<li><button type="button" disabled data-ak-net-filter="${escapeAttribute(value ?? '')}" aria-pressed="false">${swatch}${inner}</button></li>`
      : `<li><span>${swatch}${inner}</span></li>`;
  };
  const items = p.groups.map((g, i) =>
    chip(
      `<span>${escapeText(g.label)}</span><span class="ak-net-count">${counts[i] ?? 0}</span>`,
      g.id,
      g,
    ),
  );
  if (filterable)
    items.unshift(chip(`<span>All</span><span class="ak-net-count">${p.ids.length}</span>`, null));
  return `<ul class="ak-net-legend" aria-label="Groups">${items.join('')}</ul>`;
}

/** Every node with its group and links: the graph in full for no-JS, print and assistive tech. */
function nodeTable(p: Prepared, directed: boolean, selected: string): string {
  const outs = p.ids.map(() => [] as number[]);
  const ins = p.ids.map(() => [] as number[]);
  for (const [a, b] of p.edges) {
    outs[a]?.push(b);
    (directed ? ins[b] : outs[b])?.push(a);
  }
  const names = (list: number[]) =>
    list.length === 0
      ? '<span class="ak-net-none">—</span>'
      : list.map((j) => escapeText(p.labels[j] ?? '')).join(', ');
  const head = directed
    ? '<th scope="col">Node</th><th scope="col">Group</th><th scope="col">Links</th><th scope="col">Links to</th><th scope="col">Linked from</th>'
    : '<th scope="col">Node</th><th scope="col">Group</th><th scope="col">Links</th><th scope="col">Connected to</th>';
  const body = p.ids
    .map((id, i) => {
      const group = p.groups[p.groupOf[i] ?? 0];
      const description = p.descriptions[i]
        ? `<span class="ak-3d-note">${escapeText(p.descriptions[i] ?? '')}</span>`
        : '';
      const links = directed
        ? `<td>${names(outs[i] ?? [])}</td><td>${names(ins[i] ?? [])}</td>`
        : `<td>${names(outs[i] ?? [])}</td>`;
      return `<tr data-ak-net-row="${escapeAttribute(id)}" data-ak-net-group="${escapeAttribute(group?.id ?? '')}"><th scope="row"><button type="button" disabled data-ak-3d-pick="${escapeAttribute(id)}" aria-pressed="${
        id === selected ? 'true' : 'false'
      }"><span class="ak-3d-name">${escapeText(p.labels[i] ?? id)}</span>${description}</button></th><td><span class="ak-net-swatch"${toneAttrs(group)}></span>${escapeText(group?.label ?? '')}</td><td>${p.degree[i] ?? 0}</td>${links}</tr>`;
    })
    .join('');
  return `<div class="ak-net-table" tabindex="0" role="region" aria-label="Nodes and links"><table><caption>${p.ids.length} nodes, ${p.edges.length} links</caption><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export function renderNetwork(node: IrNode, context: RenderContext): string {
  const p = prepare(node);
  const summary = stringProp(node, 'summary');
  const bind = stringProp(node, 'bind');
  const initial = bind.startsWith('state.') ? context.ir.state[bind.slice(6)] : undefined;
  const selected = typeof initial === 'string' ? initial : '';
  return element(
    'figure',
    nodeAttributes(node, {
      class: 'ak-block ak-3d ak-net',
      'data-ak-3d': 'network',
      'data-ak-3d-state': 'static',
      'data-ak-scene': JSON.stringify(networkConfig(node)),
    }),
    [
      titleHeader(node),
      `<div class="ak-3d-stage">${networkPoster(p, summary)}</div>`,
      `<figcaption class="ak-3d-caption">${escapeText(summary)}</figcaption>`,
      legend(p, typeof node.props.filterBind === 'string'),
      nodeTable(p, node.props.directed === true, selected),
    ].join(''),
  );
}

/** Duplicate node and group ids, edges and groups that name nothing, self-links, an unknown root. */
export function checkNetwork(node: IrNode, { bag }: CheckContext): void {
  const report = (path: string, message: string) =>
    bag.add({ code: 'SPEC_VALIDATION_ERROR', path, nodeId: node.id, message });
  const nodesPath = pathKey(node.path, 'nodes');
  const listPath = pathKey(node.path, 'nodeList');
  const ids = new Set<string>();
  const listed = rows(node, 'nodes').length;
  const all = nodeRowsOf(node);
  if (all.length === 0)
    report(nodesPath, 'a graph needs at least one node in `nodes` or `nodeList`');
  if (all.length > MAX_NODES) report(nodesPath, `a graph holds at most ${MAX_NODES} nodes`);
  all.forEach((n, i) => {
    const id = text(n.id);
    if (ids.has(id))
      report(
        i < listed ? pathKey(pathIndex(nodesPath, i), 'id') : listPath,
        `node id "${id}" is used twice`,
      );
    ids.add(id);
  });
  const rawNodes = node.props.nodeList;
  if (typeof rawNodes === 'string')
    rawNodes.split('\n').forEach((line, i) => {
      const id = line.trim().split(/\s+/)[0] ?? '';
      if (id !== '' && !TOKEN.test(id))
        report(
          listPath,
          `line ${i + 1}: "${id}" is not a node id (lowercase letters, digits, dashes)`,
        );
    });
  const rawEdges = node.props.edgeList;
  if (typeof rawEdges === 'string')
    for (const token of rawEdges.split(/[\s,]+/)) {
      if (token === '') continue;
      const parts = token.split('>');
      if (parts.length !== 2 || !parts[0] || !parts[1])
        report(pathKey(node.path, 'edgeList'), `"${token}" is not a \`from>to\` link`);
    }
  if (edgeRowsOf(node).length > MAX_EDGES)
    report(pathKey(node.path, 'edges'), `a graph holds at most ${MAX_EDGES} links`);
  const declared = rows(node, 'groups');
  const groupIds = new Set<string>();
  declared.forEach((g, i) => {
    const id = text(g.id);
    if (groupIds.has(id))
      report(
        pathKey(pathIndex(pathKey(node.path, 'groups'), i), 'id'),
        `group "${id}" is listed twice`,
      );
    groupIds.add(id);
  });
  if (declared.length > 0)
    all.forEach((n, i) => {
      if (typeof n.group === 'string' && !groupIds.has(n.group))
        report(
          i < listed ? pathKey(pathIndex(nodesPath, i), 'group') : listPath,
          `group "${n.group}" is not listed in groups`,
        );
    });
  const groupsUsed = new Set(all.map((n) => text(n.group)));
  if (groupsUsed.size > MAX_GROUPS)
    report(pathKey(node.path, 'nodes'), `nodes use at most ${MAX_GROUPS} groups`);
  const listedEdges = rows(node, 'edges').length;
  edgeRowsOf(node).forEach((e, i) => {
    const inList = i < listedEdges;
    const path = inList
      ? pathIndex(pathKey(node.path, 'edges'), i)
      : pathKey(node.path, 'edgeList');
    const at = (end: string) => (inList ? pathKey(path, end) : path);
    for (const end of ['from', 'to'] as const) {
      const value = text(e[end]);
      if (!ids.has(value)) report(at(end), `"${value}" is not a node id in this graph`);
    }
    if (text(e.from) !== '' && e.from === e.to)
      report(at('to'), `edge links "${text(e.from)}" to itself`);
  });
  const root = node.props.root;
  if (typeof root === 'string' && !ids.has(root))
    report(pathKey(node.path, 'root'), `root "${root}" is not a node id in this graph`);
}

export const network3dBlock: BlockModule = {
  definition: define({
    type: 'network-3d',
    category: 'media',
    tags: ['3d', 'webgl', 'graph', 'network', 'topology', 'interactive'],
    useCases: ['explore a dependency or service graph', 'show clusters in a network'],
    purpose: 'Interactive 3D node-link graph with a compile-time layout and group clusters.',
    summary:
      'Network 3D: nodes, edges, groups; force, hierarchical or radial layout; pick, neighbours, filter.',
    props: NETWORK_PROPS,
    runtimeFeatures: ['three'],
    actions: ['set-value'],
    a11y: 'A static SVG plan and a table of every node with its links render without JS or WebGL; each node is a button, and the canvas is keyboard navigable.',
  }),
  render: renderNetwork,
  check: checkNetwork,
};
