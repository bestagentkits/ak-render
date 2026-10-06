/**
 * Filter bar: a group of controls that filters the rows of one filterable
 * block. Each child control names a row field and an enumerated operator;
 * the runtime ANDs them over the target's `data-ak-row` values. The compiler
 * adds the result count and a Reset button.
 */

import { pathKey } from '../../diagnostics.js';
import type { IrNode } from '../../ir.js';
import type { BlockModule, CheckContext } from '../../registry/block-module.js';
import { anchorProps, define, OPTIONAL_TITLE } from '../../registry/define-helpers.js';
import type { PropSchema } from '../../registry/prop-schema.js';
import { element, nodeAttributes, stringProp, titleHeader } from '../../render/block-helpers.js';
import { escapeText } from '../../render/escape.js';
import { FILTER_BAR_TYPE, requiresJsNote } from './control-shared.js';

/** Child types a filter-bar accepts: the controls plus the core `search`. */
export const FILTER_BAR_ACCEPTS = [
  'select',
  'checkbox',
  'radio-group',
  'switch',
  'text-input',
  'number-input',
  'date-input',
  'search',
] as const;

const TARGET: PropSchema = {
  kind: 'string',
  id: true,
  required: true,
  description: 'Id of the filterable block (data-table, kanban, log-viewer…) to filter.',
};

/** How the count names the target's rows. */
function rowNoun(target: IrNode | undefined): string {
  return target?.type === 'data-table' ? 'rows' : 'items';
}

/** Ids of the blocks a filter-bar may target, in document order. */
function filterableIds(context: CheckContext): string[] {
  return [...context.byId.values()]
    .filter((node) => context.registry.byType.get(node.type)?.filterable === true)
    .map((node) => node.id);
}

/** Action targets a `search` child binds, which must be the bar's own target. */
function searchTargets(search: IrNode): string[] {
  return Object.values(search.bindings)
    .flat()
    .map((action) => action.target)
    .filter((target): target is string => typeof target === 'string');
}

export const filterBarBlock: BlockModule = {
  definition: define({
    type: FILTER_BAR_TYPE,
    kind: 'semantic',
    category: 'interaction',
    tags: ['filter', 'rows', 'controls', 'dataset', 'toolbar'],
    useCases: ['filter table rows by status or field', 'narrow a board or log'],
    purpose: 'Controls that filter one filterable block.',
    summary:
      'Filter bar: 1-8 controls (field + match) filtering a target; adds a live count and Reset.',
    props: { target: TARGET, title: OPTIONAL_TITLE, ...anchorProps },
    slots: { children: { accepts: FILTER_BAR_ACCEPTS, min: 1, max: 8 } },
    runtimeFeatures: ['controls', 'filter-bar'],
    a11y: 'Labelled region of native controls; the result count is announced politely and Reset is a real button.',
  }),
  render: (node, context) => {
    const targetId = stringProp(node, 'target');
    const target = context.byId(targetId);
    const total = target?.data?.rows.length;
    const noun = rowNoun(target);
    return element(
      'section',
      nodeAttributes(node, {
        class: 'ak-block ak-filter-bar',
        'aria-label': stringProp(node, 'title', 'Filters'),
        'data-ak-filter-bar': true,
        'data-ak-filter-target': targetId,
        'data-ak-filter-noun': noun,
      }),
      [
        titleHeader(node, 3),
        `<div class="ak-filter-controls">${context.renderChildren(node)}</div>`,
        '<div class="ak-filter-footer">',
        `<p class="ak-filter-count" data-ak-filter-count>${
          total === undefined ? '' : escapeText(`${total} ${noun}`)
        }</p>`,
        '<button type="button" class="ak-btn ak-filter-reset" data-ak-filter-reset>Reset</button>',
        '</div>',
        requiresJsNote(),
      ].join(''),
    );
  },
  check: (node, context) => {
    const { bag, byId } = context;
    const targetId = node.props.target;
    if (typeof targetId === 'string') {
      const target = byId.get(targetId);
      const filterable =
        target !== undefined && context.registry.byType.get(target.type)?.filterable === true;
      if (!filterable) {
        bag.add({
          code: 'SPEC_VALIDATION_ERROR',
          path: pathKey(node.path, 'target'),
          nodeId: node.id,
          message:
            target === undefined
              ? `no block has the id "${targetId}"`
              : `a ${target.type} block cannot be filtered`,
          details: { allowed: filterableIds(context) },
        });
      }
    }
    for (const childId of node.children) {
      const child = byId.get(childId);
      if (child?.type !== 'search') continue;
      if (searchTargets(child).some((target) => target !== targetId)) {
        bag.add({
          code: 'SPEC_VALIDATION_ERROR',
          path: pathKey(child.path, 'on'),
          nodeId: child.id,
          message: 'a search inside a filter-bar filters the bar target only',
          details: { allowed: typeof targetId === 'string' ? [targetId] : [] },
        });
      }
    }
  },
};
