/**
 * Structured diagram fallback.
 *
 * Without an adapter a diagram still has to read as a diagram. It reads the
 * semantic graph of any ak:diagram archetype (see `semantic-graph.ts`):
 *
 * - A sequence keeps its messages in their declared, numbered order.
 * - Declared groups (boundaries, lanes, stages) list their member nodes under
 *   the group label, followed by the explicit connection list.
 * - When the connections form one simple chain (every node has at most one way
 *   in and one way out, and the chain visits every node), the nodes are drawn
 *   as a flow with labelled connectors.
 * - Any other graph is shown as a set of nodes plus an explicit connection
 *   list, because drawing arrows between nodes that are not connected would
 *   state something the spec does not.
 */

import type {
  DiagramEdge,
  DiagramGroup,
  DiagramNode,
  SemanticGraph,
} from '../diagram/semantic-graph.js';
import { escapeAttribute, escapeText } from './escape.js';

export type { DiagramEdge, DiagramNode } from '../diagram/semantic-graph.js';

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

function nodeList(nodes: DiagramNode[]): string {
  return nodes.length === 0
    ? ''
    : `<ul class="ak-flow-nodes">${nodes.map((node) => `<li>${nodeMarkup(node)}</li>`).join('')}</ul>`;
}

function linkList(edges: DiagramEdge[], ordered: boolean): string {
  if (edges.length === 0) return '';
  const tag = ordered ? 'ol' : 'ul';
  const items = edges
    .map(
      (edge) =>
        `<li><code>${escapeText(edge.from)}</code><span class="ak-flow-arrow" aria-hidden="true">\u2192</span><span class="ak-sr">to</span><code>${escapeText(
          edge.to,
        )}</code>${edge.label === '' ? '' : `<span class="ak-flow-link-label">${escapeText(edge.label)}</span>`}</li>`,
    )
    .join('');
  return `<${tag} class="ak-flow-links${ordered ? ' ak-flow-steps' : ''}">${items}</${tag}>`;
}

function groupedMarkup(nodes: DiagramNode[], groups: DiagramGroup[]): string {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const grouped = new Set<string>();
  const sections = groups
    .filter((group) => group.members.length > 0)
    .map((group) => {
      const members = group.members.flatMap((id) => {
        grouped.add(id);
        const node = byId.get(id);
        return node === undefined ? [] : [node];
      });
      const label = group.label === '' ? group.id : group.label;
      return `<div class="ak-flow-group" role="group" aria-label="${escapeAttribute(label)}"><p class="ak-flow-group-label">${escapeText(label)}</p>${nodeList(members)}</div>`;
    });
  const rest = nodes.filter((node) => !grouped.has(node.id));
  return `<div class="ak-flow-groups">${sections.join('')}${
    rest.length === 0 ? '' : `<div class="ak-flow-group">${nodeList(rest)}</div>`
  }</div>`;
}

/** Render the fallback body for a diagram's semantic graph. */
export function renderDiagramFallback(graph: SemanticGraph): string {
  const { nodes, edges, groups, ordered } = graph;
  if (ordered) return `${nodeList(nodes)}${linkList(edges, true)}`;
  if (groups.some((group) => group.members.length > 0)) {
    return `${groupedMarkup(nodes, groups)}${linkList(edges, false)}`;
  }
  const chain = chainOrder(nodes, edges);
  return chain === undefined
    ? `${nodeList(nodes)}${linkList(edges, false)}`
    : flowMarkup(chain, edges);
}
