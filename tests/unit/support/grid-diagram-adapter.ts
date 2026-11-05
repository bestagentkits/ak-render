/**
 * A reference v2 diagram adapter for tests and visual fixtures only.
 *
 * It is not a layout engine and is never exported from the package (ADR 0003):
 * it ranks nodes by their longest path from a source, places each rank in a
 * column, draws straight relationships and boxes around declared groups, and
 * returns the SVG with a v2 manifest. That is enough to exercise the contract,
 * the viewer and the motion end to end with deterministic geometry.
 */

import { readDiagramGraph } from '../../../src/diagram/semantic-graph.js';
import type { DiagramAdapter, DiagramRenderResult } from '../../../src/index.js';
import type { JsonValue } from '../../../src/json.js';

const NODE_W = 168;
const NODE_H = 56;
const GAP_X = 96;
const GAP_Y = 32;
const PAD = 32;

function esc(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
}

/** Longest-path rank from the sources, ignoring edges that close a cycle. */
function ranks(ids: string[], edges: { from: string; to: string }[]): Map<string, number> {
  const rank = new Map(ids.map((id) => [id, 0]));
  const order = new Map(ids.map((id, index) => [id, index]));
  for (let pass = 0; pass < ids.length; pass += 1) {
    let changed = false;
    for (const edge of edges) {
      const from = rank.get(edge.from);
      const to = rank.get(edge.to);
      if (from === undefined || to === undefined) continue;
      // A back edge (to an earlier-declared node) does not push its target.
      if ((order.get(edge.to) ?? 0) <= (order.get(edge.from) ?? 0)) continue;
      if (to < from + 1) {
        rank.set(edge.to, from + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return rank;
}

export interface GridAdapterOptions {
  /** Leave relationships out of the manifest. */
  nodesOnly?: boolean;
  /** Add a manifest relationship the spec does not declare. */
  fabricate?: boolean;
  capabilities?: DiagramRenderResult['capabilities'];
}

export function renderGrid(spec: JsonValue, title: string, options: GridAdapterOptions = {}) {
  const graph = readDiagramGraph(
    typeof spec === 'object' && spec !== null && !Array.isArray(spec) ? spec : {},
  );
  const ids = graph.nodes.map((node) => node.id);
  const rank = ranks(ids, graph.edges);
  const rows = new Map<number, number>();
  const at = new Map<string, { x: number; y: number }>();
  for (const id of ids) {
    const column = rank.get(id) ?? 0;
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    at.set(id, { x: PAD + column * (NODE_W + GAP_X), y: PAD + 28 + row * (NODE_H + GAP_Y) });
  }
  const columns = Math.max(1, ...[...rank.values()].map((value) => value + 1));
  const maxRows = Math.max(1, ...rows.values());
  const width = PAD * 2 + columns * NODE_W + (columns - 1) * GAP_X;
  const height = PAD * 2 + 28 + maxRows * NODE_H + (maxRows - 1) * GAP_Y;

  const groups = graph.groups
    .filter((group) => group.id !== '' && group.members.length > 0)
    .map((group, index) => {
      const boxes = group.members.flatMap((id) => {
        const point = at.get(id);
        return point === undefined ? [] : [point];
      });
      const x = Math.min(...boxes.map((box) => box.x)) - 12;
      const y = Math.min(...boxes.map((box) => box.y)) - 26;
      const w = Math.max(...boxes.map((box) => box.x)) + NODE_W + 12 - x;
      const h = Math.max(...boxes.map((box) => box.y)) + NODE_H + 12 - y;
      return {
        id: group.id,
        svg: `<g id="g-${index}" class="grp"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12"/><text x="${x + 12}" y="${y + 17}">${esc(group.label || group.id)}</text></g>`,
      };
    });

  const edges = graph.edges.map((edge, index) => {
    const a = at.get(edge.from);
    const b = at.get(edge.to);
    if (a === undefined || b === undefined) return '';
    const x1 = a.x + NODE_W;
    const y1 = a.y + NODE_H / 2;
    const x2 = b.x;
    const y2 = b.y + NODE_H / 2;
    const back = x2 <= x1;
    const d = back
      ? `M${a.x + NODE_W / 2} ${a.y + NODE_H} C${a.x + NODE_W / 2} ${a.y + NODE_H + 40} ${b.x + NODE_W / 2} ${b.y + NODE_H + 40} ${b.x + NODE_W / 2} ${b.y + NODE_H + 4}`
      : `M${x1} ${y1} C${x1 + GAP_X / 2} ${y1} ${x2 - GAP_X / 2} ${y2} ${x2 - 4} ${y2}`;
    const label =
      edge.label === ''
        ? ''
        : `<text class="el" x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 6}" text-anchor="middle">${esc(edge.label)}</text>`;
    return `<g class="edge" data-edge-id="e${index}"><path d="${d}" marker-end="url(#arrow)"/>${label}</g>`;
  });

  const nodes = graph.nodes.map((node, index) => {
    const point = at.get(node.id) ?? { x: 0, y: 0 };
    return `<g id="n-${index}" class="node"><rect x="${point.x}" y="${point.y}" width="${NODE_W}" height="${NODE_H}" rx="10"/><text x="${point.x + 14}" y="${point.y + 33}">${esc(node.label || node.id)}</text></g>`;
  });

  const svg = `<svg class="grid-diagram" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}"><style>.grid-diagram{font:500 13px system-ui,sans-serif}.grp rect{fill:none;stroke:currentColor;stroke-opacity:.25;stroke-dasharray:4 4}.grp text{fill:currentColor;opacity:.7;font-size:11px}.node rect{fill:var(--ak-color-surface,#fff);stroke:var(--ak-color-border,#999)}.node text{fill:currentColor}.edge path{fill:none;stroke:currentColor;stroke-opacity:.6;stroke-width:1.5}.el{fill:currentColor;font-size:11px;opacity:.75}#arrow path{fill:currentColor}</style><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8z"/></marker></defs>${groups.map((group) => group.svg).join('')}${edges.join('')}${nodes.join('')}</svg>`;

  const result: DiagramRenderResult = {
    svg,
    manifest: {
      version: 2,
      nodes: graph.nodes.map((node, index) => ({ id: node.id, element: `n-${index}` })),
      edges: options.nodesOnly
        ? []
        : [
            ...graph.edges.map((edge, index) => ({
              from: edge.from,
              to: edge.to,
              id: `e${index}`,
            })),
            ...(options.fabricate && ids.length > 1
              ? [{ from: ids[ids.length - 1] as string, to: ids[0] as string, element: 'n-0' }]
              : []),
          ],
      groups: groups.map((group) => ({
        id: group.id,
        element: group.svg.slice(7, group.svg.indexOf('"', 7)),
      })),
    },
    capabilities: options.capabilities ?? { focus: true, trace: true, zoom: true, search: true },
  };
  return result;
}

export function gridDiagramAdapter(options: GridAdapterOptions = {}): DiagramAdapter {
  return {
    name: 'grid-reference',
    version: '1.0.0',
    contract: 2,
    render: ({ spec, title }) => renderGrid(spec, title, options),
  };
}
