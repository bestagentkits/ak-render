/**
 * Schema-viewer block: a data shape drawn as a tree from dotted field paths.
 *
 * `user.address.city` nests under `user` and `user.address`. A parent the
 * author did not list becomes an implicit object node. Children keep the
 * authored order of their first mention, so the tree is deterministic. Nodes
 * with children are native `<details>`, open by default, so the whole shape
 * reads without script and in print.
 */

import { pathIndex, pathKey } from '../../diagnostics.js';
import type { IrNode } from '../../ir.js';
import type { BlockModule } from '../../registry/block-module.js';
import {
  anchorProps,
  bool,
  define,
  itemsOf,
  OPTIONAL_TITLE,
  str as strProp,
  txt,
} from '../../registry/define-helpers.js';
import {
  element,
  nodeAttributes,
  objectListProp,
  str,
  titleHeader,
} from '../../render/block-helpers.js';
import { escapeInlineText, escapeText } from '../../render/escape.js';

interface SchemaField {
  type: string;
  required: boolean;
  description: string;
}

interface SchemaNode {
  name: string;
  field: SchemaField | undefined;
  children: Map<string, SchemaNode>;
}

function newNode(name: string): SchemaNode {
  return { name, field: undefined, children: new Map() };
}

/** Build the tree from dotted paths; later duplicates and empty segments are skipped (a check reports them). */
export function buildSchemaTree(fields: readonly Record<string, unknown>[]): SchemaNode {
  const root = newNode('');
  for (const entry of fields) {
    const path = typeof entry.path === 'string' ? entry.path : '';
    const segments = path.split('.');
    if (segments.some((segment) => segment === '')) continue;
    let cursor = root;
    for (const segment of segments) {
      let next = cursor.children.get(segment);
      if (next === undefined) {
        next = newNode(segment);
        cursor.children.set(segment, next);
      }
      cursor = next;
    }
    if (cursor.field !== undefined) continue;
    cursor.field = {
      type: typeof entry.type === 'string' ? entry.type : '',
      required: entry.required === true,
      description: typeof entry.description === 'string' ? entry.description : '',
    };
  }
  return root;
}

function nodeLine(node: SchemaNode): string {
  const field = node.field;
  const type = field === undefined ? 'object' : field.type;
  return `<span class="ak-schema-name">${escapeText(node.name)}</span><span${
    field === undefined ? ' class="ak-schema-type" data-implicit' : ' class="ak-schema-type"'
  }>${escapeText(type)}</span>${
    field?.required === true ? '<span class="ak-schema-required">required</span>' : ''
  }`;
}

function description(node: SchemaNode): string {
  const text = node.field?.description ?? '';
  return text === '' ? '' : `<p class="ak-schema-desc">${escapeInlineText(text)}</p>`;
}

function renderChildren(parent: SchemaNode): string {
  const items = [...parent.children.values()].map((child) => {
    if (child.children.size === 0) {
      return `<li><div class="ak-schema-row">${nodeLine(child)}</div>${description(child)}</li>`;
    }
    return `<li><details open><summary class="ak-schema-row">${nodeLine(child)}</summary>${description(
      child,
    )}${renderChildren(child)}</details></li>`;
  });
  return `<ul>${items.join('')}</ul>`;
}

function renderSchemaViewer(node: IrNode): string {
  const tree = buildSchemaTree(objectListProp(node, 'fields'));
  return element(
    'section',
    nodeAttributes(node, { class: 'ak-block ak-schema-block' }),
    `${titleHeader(node)}<div class="ak-schema">${renderChildren(tree)}</div>`,
  );
}

export const schemaViewerBlock: BlockModule = {
  definition: define({
    type: 'schema-viewer',
    kind: 'semantic',
    category: 'engineering',
    tags: ['schema', 'data-model', 'fields', 'types'],
    useCases: ['payload shape', 'config reference', 'data model review'],
    purpose: 'Data shape reference: typed fields from dotted paths, drawn as a collapsible tree.',
    summary:
      'Schema viewer: up to 120 typed fields from dotted paths as a tree; missing parents become objects.',
    props: {
      title: OPTIONAL_TITLE,
      fields: itemsOf(
        {
          path: strProp({
            required: true,
            maxLength: 200,
            description: 'Dotted path, such as user.email.',
          }),
          type: strProp({ required: true, maxLength: 60 }),
          required: bool(),
          description: txt({ maxLength: 400 }),
        },
        { minItems: 1, maxItems: 120 },
      ),
      ...anchorProps,
    },
    runtimeFeatures: ['schema-viewer'],
    sizing: {
      sizes: ['medium', 'large'],
      default: 'medium',
      responsive: 'Indentation stays narrow so deep paths fit a phone; long names and types wrap.',
    },
    a11y: 'Nested lists mirror the shape; branches are native disclosures that start open; required is text.',
  }),
  render: renderSchemaViewer,
  check(node, { bag }) {
    const seen = new Set<string>();
    objectListProp(node, 'fields').forEach((field, index) => {
      const path = str(field.path);
      const at = pathKey(pathIndex(pathKey(node.path, 'fields'), index), 'path');
      if (path.split('.').some((segment) => segment === '')) {
        bag.add({
          code: 'SPEC_VALIDATION_ERROR',
          path: at,
          message: `"${path}" has an empty segment; use dotted names such as user.email`,
          nodeId: node.id,
        });
        return;
      }
      if (seen.has(path)) {
        bag.add({
          code: 'SPEC_VALIDATION_ERROR',
          path: at,
          message: `field path "${path}" is listed twice`,
          nodeId: node.id,
        });
      }
      seen.add(path);
    });
  },
};
