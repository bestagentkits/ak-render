/** Grid block: a responsive grid container. */

import { pathKey } from '../../diagnostics.js';
import type { IrNode } from '../../ir.js';
import type { BlockModule, CheckContext } from '../../registry/block-module.js';
import { anchorProps, define, enumStr, num, oneOf } from '../../registry/define-helpers.js';
import { element, nodeAttributes, stringProp } from '../../render/block-helpers.js';
import {
  GRID_TRACKS,
  LAYOUT_OPTIONS_FEATURE,
  MIN_ITEM_WIDTHS,
  useFeature,
} from './layout-styles.js';

const DEFAULT_COLUMNS = 3;

/** `columns` as authored: a track count of 1–12, or `auto`. */
function gridColumns(node: IrNode): number | 'auto' {
  const value = node.props.columns;
  if (value === 'auto') return 'auto';
  if (typeof value !== 'number') return DEFAULT_COLUMNS;
  return Math.min(Math.max(Math.trunc(value), 1), GRID_TRACKS);
}

/** True when a grid holds at least one `grid-item`, which switches it to 12 tracks. */
export function isTrackedGrid(node: IrNode, byId: (id: string) => IrNode | undefined): boolean {
  return node.children.some((id) => byId(id)?.type === 'grid-item');
}

/**
 * The column count a tracked grid uses to size children without an explicit
 * span: `auto` has no fixed count there, so it falls back to the default.
 */
function trackedColumns(node: IrNode): number {
  const columns = gridColumns(node);
  return columns === 'auto' ? DEFAULT_COLUMNS : columns;
}

/** The span of a tracked grid's child that sets none: 12 / columns, at least 1. */
export function defaultTrackSpan(grid: IrNode | undefined): number {
  const columns = grid === undefined ? DEFAULT_COLUMNS : trackedColumns(grid);
  return Math.max(1, Math.floor(GRID_TRACKS / columns));
}

function checkGrid(node: IrNode, { bag, byId }: CheckContext): void {
  const columns = gridColumns(node);
  const tracked = isTrackedGrid(node, (id) => byId.get(id));
  const minItemWidth = node.props.minItemWidth;
  if (minItemWidth !== undefined && columns !== 'auto') {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      severity: 'warning',
      path: pathKey(node.path, 'minItemWidth'),
      nodeId: node.id,
      message: '"minItemWidth" applies only with "columns: auto"; it is ignored',
    });
  }
  if (tracked && columns === 'auto') {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      severity: 'warning',
      path: pathKey(node.path, 'columns'),
      nodeId: node.id,
      message: `a grid with grid items uses 12 tracks; "columns: auto" falls back to ${DEFAULT_COLUMNS} columns for children without a span`,
    });
  }
  const usesOptions =
    columns === 'auto' ||
    columns > 6 ||
    stringProp(node, 'gap', 'normal') !== 'normal' ||
    stringProp(node, 'align', 'stretch') !== 'stretch';
  if (usesOptions) useFeature(node, LAYOUT_OPTIONS_FEATURE);
}

export const gridBlock: BlockModule = {
  definition: define({
    type: 'grid',
    category: 'layout',
    tags: ['container', 'columns', 'responsive'],
    useCases: ['side-by-side cards', 'multi-column layout'],
    purpose: 'Responsive grid container.',
    summary: 'Grid: children in N columns that collapse on narrow viewports.',
    props: {
      columns: oneOf([num({ integer: true, min: 1, max: 12 }), enumStr(['auto'])], {
        description:
          'Columns, 1–12, or `auto` to fit as many as `minItemWidth` allows. Default 3. With grid-item children the grid has 12 tracks.',
      }),
      minItemWidth: enumStr(Object.keys(MIN_ITEM_WIDTHS), {
        description: 'Smallest card width with `columns: auto`. Default medium.',
      }),
      gap: enumStr(['tight', 'normal', 'loose'], { default: 'normal' }),
      align: enumStr(['start', 'center', 'end', 'stretch'], { default: 'stretch' }),
      ...anchorProps,
    },
    slots: { children: { accepts: '*', min: 1, max: 200 } },
  }),
  render: (node, context) => {
    const tracked = isTrackedGrid(node, context.byId);
    const columns = tracked ? trackedColumns(node) : gridColumns(node);
    const gap = stringProp(node, 'gap', 'normal');
    const align = stringProp(node, 'align', 'stretch');
    return element(
      'div',
      nodeAttributes(node, {
        class: 'ak-block ak-grid',
        'data-ak-columns': String(columns),
        'data-ak-tracks': tracked ? String(GRID_TRACKS) : undefined,
        'data-ak-min': columns === 'auto' ? stringProp(node, 'minItemWidth', 'medium') : undefined,
        'data-gap': gap === 'normal' ? undefined : gap,
        'data-align': align === 'stretch' ? undefined : align,
      }),
      context.renderChildren(node),
    );
  },
  check: checkGrid,
};
