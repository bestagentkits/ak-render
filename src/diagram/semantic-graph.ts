/**
 * Read a diagram spec as a semantic graph.
 *
 * The `diagram-panel` spec is the ak:diagram typed IR. Each archetype names its
 * nodes, relationships and groups differently (a workflow has `steps` and
 * `transitions` in `lanes`, a sequence has `participants` and ordered
 * `messages`, and so on). This module maps every archetype onto one shape so
 * the structured fallback and the validator read the same graph.
 *
 * The mapping only renames what the spec declares. It never infers an edge, a
 * member or an order the spec does not state, and it keeps declaration order,
 * so the same spec always yields the same graph.
 */

import type { JsonValue } from '../json.js';

export interface DiagramNode {
  id: string;
  label: string;
}

export interface DiagramEdge {
  from: string;
  to: string;
  label: string;
}

export interface DiagramGroup {
  id: string;
  label: string;
  /** Member node ids in node declaration order. */
  members: string[];
}

/** Where an archetype keeps its nodes, relationships and groups. */
interface ArchetypeFields {
  readonly nodes: string;
  readonly edges: string;
  /** Edge fields read, in order, for the visible relationship label. */
  readonly edgeLabel: readonly string[];
  readonly groups?: string;
  /**
   * How a group lists its members: from a field on each node (`lane`,
   * `stage`), or from an id list on the group itself (`components`).
   */
  readonly membership?: { readonly nodeField: string } | { readonly groupField: string };
  /** The edge order is the meaning (a sequence), so it is never re-ordered. */
  readonly ordered?: boolean;
}

/** The typed archetypes, keyed by `diagram_type`; fields follow the ak:diagram schemas. */
export const DIAGRAM_ARCHETYPES: Readonly<Record<string, ArchetypeFields>> = {
  architecture: {
    nodes: 'components',
    edges: 'connections',
    edgeLabel: ['label', 'protocol'],
    groups: 'boundaries',
    membership: { groupField: 'components' },
  },
  workflow: {
    nodes: 'steps',
    edges: 'transitions',
    edgeLabel: ['label', 'condition'],
    groups: 'lanes',
    membership: { nodeField: 'lane' },
  },
  sequence: { nodes: 'participants', edges: 'messages', edgeLabel: ['label'], ordered: true },
  dataflow: {
    nodes: 'nodes',
    edges: 'flows',
    edgeLabel: ['label', 'schema_type'],
    groups: 'stages',
    membership: { nodeField: 'stage' },
  },
  lifecycle: {
    nodes: 'states',
    edges: 'transitions',
    edgeLabel: ['event', 'action'],
    groups: 'lanes',
    membership: { nodeField: 'lane' },
  },
};

export interface SemanticGraph {
  /** The declared `diagram_type` when it is a known archetype. */
  readonly type: string | undefined;
  readonly nodes: DiagramNode[];
  readonly edges: DiagramEdge[];
  readonly groups: DiagramGroup[];
  /** True when the order of `edges` carries meaning and must be shown as-is. */
  readonly ordered: boolean;
  /** Spec field names the nodes and edges were read from, for diagnostics. */
  readonly nodeFields: readonly string[];
  readonly edgeFields: readonly string[];
}

type JsonObject = Record<string, JsonValue>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objects(value: JsonValue | undefined): JsonObject[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function text(value: JsonValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

function firstText(item: JsonObject, fields: readonly string[]): string {
  for (const field of fields) {
    const value = text(item[field]);
    if (value !== '') return value;
  }
  return '';
}

function toNode(item: JsonObject): DiagramNode {
  return { id: text(item.id), label: text(item.label) };
}

function toEdge(item: JsonObject, labelFields: readonly string[]): DiagramEdge {
  return { from: text(item.from), to: text(item.to), label: firstText(item, labelFields) };
}

/** The archetype a spec declares, or undefined for an untyped or unknown spec. */
export function diagramArchetype(spec: JsonObject): string | undefined {
  const declared = spec.diagram_type;
  return typeof declared === 'string' && Object.hasOwn(DIAGRAM_ARCHETYPES, declared)
    ? declared
    : undefined;
}

function readGroups(
  spec: JsonObject,
  fields: ArchetypeFields,
  nodeItems: JsonObject[],
): DiagramGroup[] {
  if (fields.groups === undefined || fields.membership === undefined) return [];
  let groupItems = objects(spec[fields.groups]);
  // Dataflow stages declare their column with `order`; a stage without one keeps
  // its declaration position after the ordered ones. The sort is stable.
  if (fields.groups === 'stages') {
    const order = (item: JsonObject): number =>
      typeof item.order === 'number' && Number.isFinite(item.order)
        ? item.order
        : Number.POSITIVE_INFINITY;
    groupItems = [...groupItems].sort((a, b) => order(a) - order(b));
  }
  const nodeIds = nodeItems.map((item) => text(item.id));
  const membership = fields.membership;
  return groupItems.map((group) => {
    const id = text(group.id);
    let members: string[];
    if ('nodeField' in membership) {
      members = nodeItems
        .filter((item) => id !== '' && text(item[membership.nodeField]) === id)
        .map((item) => text(item.id));
    } else {
      const listed = new Set(
        (Array.isArray(group[membership.groupField])
          ? (group[membership.groupField] as JsonValue[])
          : []
        ).filter((value): value is string => typeof value === 'string'),
      );
      members = nodeIds.filter((nodeId) => listed.has(nodeId));
    }
    return { id, label: text(group.label), members };
  });
}

/**
 * Read the graph a diagram spec declares.
 *
 * A known `diagram_type` reads that archetype's fields. Any other spec keeps the
 * original untyped reading: `components` and `nodes` are nodes, and
 * `connections` and `edges` are relationships.
 */
export function readDiagramGraph(spec: JsonObject): SemanticGraph {
  const type = diagramArchetype(spec);
  if (type === undefined) {
    const nodeFields = ['components', 'nodes'];
    const edgeFields = ['connections', 'edges'];
    return {
      type,
      nodes: nodeFields.flatMap((field) => objects(spec[field]).map(toNode)),
      edges: edgeFields.flatMap((field) =>
        objects(spec[field]).map((item) => toEdge(item, ['label'])),
      ),
      groups: [],
      ordered: false,
      nodeFields,
      edgeFields,
    };
  }
  const fields = DIAGRAM_ARCHETYPES[type] as ArchetypeFields;
  const nodeItems = objects(spec[fields.nodes]);
  return {
    type,
    nodes: nodeItems.map(toNode),
    edges: objects(spec[fields.edges]).map((item) => toEdge(item, fields.edgeLabel)),
    groups: readGroups(spec, fields, nodeItems),
    ordered: fields.ordered === true,
    nodeFields: [fields.nodes],
    edgeFields: [fields.edges],
  };
}

export interface DiagramGraphIssue {
  /** Path relative to the diagram spec, e.g. `transitions[2].to`. */
  readonly path: string;
  readonly message: string;
}

/**
 * Structural problems the fallback would otherwise hide: an unknown archetype,
 * a graph with no nodes, a duplicate node id, and a relationship whose end is
 * not a declared node. These are warnings: the adapter owns the full schema.
 */
export function checkDiagramGraph(spec: JsonObject): DiagramGraphIssue[] {
  const issues: DiagramGraphIssue[] = [];
  const declared = spec.diagram_type;
  if (declared !== undefined && diagramArchetype(spec) === undefined) {
    issues.push({
      path: 'diagram_type',
      message: `diagram_type ${JSON.stringify(declared)} is not one of ${Object.keys(DIAGRAM_ARCHETYPES).join(', ')}; without an adapter only components, nodes, connections and edges are shown`,
    });
  }
  const graph = readDiagramGraph(spec);
  if (graph.nodes.length === 0) {
    issues.push({
      path: graph.nodeFields[0] ?? 'nodes',
      message: `the diagram declares no ${graph.nodeFields.join(' or ')}, so it shows nothing without an adapter`,
    });
    return issues;
  }
  const seen = new Set<string>();
  for (const field of graph.nodeFields) {
    objects(spec[field]).forEach((item, index) => {
      const id = text(item.id);
      if (id === '') {
        issues.push({ path: `${field}[${index}].id`, message: 'a diagram node needs an id' });
      } else if (seen.has(id)) {
        issues.push({
          path: `${field}[${index}].id`,
          message: `duplicate diagram node id "${id}"`,
        });
      }
      seen.add(id);
    });
  }
  for (const field of graph.edgeFields) {
    objects(spec[field]).forEach((item, index) => {
      for (const end of ['from', 'to'] as const) {
        const id = text(item[end]);
        if (!seen.has(id)) {
          issues.push({
            path: `${field}[${index}].${end}`,
            message:
              id === ''
                ? `a diagram relationship needs "${end}"`
                : `"${id}" is not a declared diagram node; declare it or fix the reference`,
          });
        }
      }
    });
  }
  return issues;
}
