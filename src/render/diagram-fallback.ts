/**
 * Structured diagram fallback.
 *
 * Without an adapter a diagram still has to read as a diagram. When the
 * connections form one simple chain (every node has at most one way in and one
 * way out, and the chain visits every node), the nodes are drawn as a flow with
 * labelled connectors. Any other graph is shown as a set of nodes plus an
 * explicit connection list, because drawing arrows between nodes that are not
 * connected would state something the spec does not.
 */

import type { JsonValue } from '../json.js';
import { escapeText } from './escape.js';

export interface DiagramNode {
  id: string;
  label: string;
}

export interface DiagramEdge {
  from: string;
  to: string;
  label: string;
}

/** Order nodes along the single chain the edges describe, or return undefined when they do not form one. */
export function chainOrder(nodes: DiagramNode[], edges: DiagramEdge[]): DiagramNode[] | undefined {
  if (nodes.length < 2 || edges.length !== nodes.length - 1) return undefined;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  if (byId.size !== nodes.length) return undefined;
  const next = new Map<string, string>();
  const incoming = new Set<string>();
  for (const edge of edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) return undefined;
    if (next.has(edge.from) || incoming.has(edge.to)) return undefined;
    next.set(edge.from, edge.to);
    incoming.add(edge.to);
  }
  const start = nodes.find((node) => !incoming.has(node.id));
  if (start === undefined) return undefined;
  const ordered: DiagramNode[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined = start.id;
  while (cursor !== undefined && !seen.has(cursor)) {
    seen.add(cursor);
    const node = byId.get(cursor);
    if (node !== undefined) ordered.push(node);
    cursor = next.get(cursor);
  }
  return ordered.length === nodes.length ? ordered : undefined;
}

function nodeMarkup(node: DiagramNode): string {
  const label = node.label === '' ? node.id : node.label;
  return `<span class="ak-flow-node"><span class="ak-flow-name">${escapeText(label)}</span><code>${escapeText(node.id)}</code></span>`;
}

function flowMarkup(ordered: DiagramNode[], edges: DiagramEdge[]): string {
  const edgeFrom = new Map(edges.map((edge) => [edge.from, edge]));
  const items = ordered.map((node, index) => {
    const edge = index < ordered.length - 1 ? edgeFrom.get(node.id) : undefined;
    const connector =
      edge === undefined
        ? ''
        : `<span class="ak-flow-edge"><span class="ak-sr">then to ${escapeText(edge.to)}</span>${
            edge.label === ''
              ? ''
              : `<span class="ak-flow-edge-label">${escapeText(edge.label)}</span>`
          }</span>`;
    return `<li>${nodeMarkup(node)}${connector}</li>`;
  });
  return `<ol class="ak-flow">${items.join('')}</ol>`;
}

function graphMarkup(nodes: DiagramNode[], edges: DiagramEdge[]): string {
  const nodeList =
    nodes.length === 0
      ? ''
      : `<ul class="ak-flow-nodes">${nodes.map((node) => `<li>${nodeMarkup(node)}</li>`).join('')}</ul>`;
  const edgeList =
    edges.length === 0
      ? ''
      : `<ul class="ak-flow-links">${edges
          .map(
            (edge) =>
              `<li><code>${escapeText(edge.from)}</code><span class="ak-flow-arrow" aria-hidden="true">\u2192</span><span class="ak-sr">to</span><code>${escapeText(
                edge.to,
              )}</code>${edge.label === '' ? '' : `<span class="ak-flow-link-label">${escapeText(edge.label)}</span>`}</li>`,
          )
          .join('')}</ul>`;
  return `${nodeList}${edgeList}`;
}

function text(value: JsonValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

/** Render the fallback body for the described nodes and connections. */
export function renderDiagramFallback(
  described: Record<string, JsonValue>[],
  connections: Record<string, JsonValue>[],
): string {
  const nodes = described.map((item) => ({ id: text(item.id), label: text(item.label) }));
  const edges = connections.map((item) => ({
    from: text(item.from),
    to: text(item.to),
    label: text(item.label),
  }));
  const ordered = chainOrder(nodes, edges);
  return ordered === undefined ? graphMarkup(nodes, edges) : flowMarkup(ordered, edges);
}
