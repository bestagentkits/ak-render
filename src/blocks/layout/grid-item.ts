/** Grid item block: explicit placement of child blocks inside a 12-track grid. */

import { pathKey } from '../../diagnostics.js';
import type { BlockModule } from '../../registry/block-module.js';
import { define, enumStr, num } from '../../registry/define-helpers.js';
import { element, nodeAttributes } from '../../render/block-helpers.js';
import { defaultTrackSpan } from './grid.js';
import { GRID_TRACKS, LAYOUT_TRACKS_FEATURE } from './layout-styles.js';

const track = (description: string) =>
  num({ integer: true, min: 1, max: GRID_TRACKS, description });

/** An integer prop as an attribute value, or undefined when unset. */
const attribute = (value: unknown): string | undefined =>
  typeof value === 'number' ? String(value) : undefined;

export const gridItemBlock: BlockModule = {
  definition: define({
    type: 'grid-item',
    category: 'layout',
    tags: ['span', 'columns', 'responsive', 'dashboard'],
    useCases: ['8/4 dashboard split', 'wide chart beside a narrow list'],
    parents: ['grid'],
    purpose: 'Places its child blocks across tracks of a 12-track grid.',
    summary: 'Grid item: spans 1–12 tracks of its grid, with tablet and mobile spans.',
    runtimeFeatures: [LAYOUT_TRACKS_FEATURE],
    props: {
      span: track('Tracks of 12 to span. Default 12 / the grid columns.'),
      tabletSpan: track('Span at 768px and below. Default: span.'),
      mobileSpan: track('Span at 480px and below. Default 12 (full width).'),
      rowSpan: num({
        integer: true,
        min: 1,
        max: 4,
        description: 'Rows to span; wide screens only.',
      }),
      start: track('First track; wide screens only.'),
      align: enumStr(['start', 'center', 'end', 'stretch']),
    },
    slots: { children: { accepts: '*', min: 1, max: 40 } },
  }),
  render: (node, context) => {
    const parent = node.parentId === null ? undefined : context.byId(node.parentId);
    const span = typeof node.props.span === 'number' ? node.props.span : defaultTrackSpan(parent);
    return element(
      'div',
      nodeAttributes(node, {
        class: 'ak-block ak-grid-item',
        'data-ak-span': String(span),
        'data-ak-tablet-span': attribute(node.props.tabletSpan),
        'data-ak-mobile-span': attribute(node.props.mobileSpan),
        'data-ak-row-span': attribute(node.props.rowSpan),
        'data-ak-start': attribute(node.props.start),
        'data-align': typeof node.props.align === 'string' ? node.props.align : undefined,
      }),
      context.renderChildren(node),
    );
  },
  check: (node, { bag, byId }) => {
    const start = node.props.start;
    if (typeof start !== 'number') return;
    const parent = node.parentId === null ? undefined : byId.get(node.parentId);
    const span = typeof node.props.span === 'number' ? node.props.span : defaultTrackSpan(parent);
    if (start + span - 1 > GRID_TRACKS) {
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: pathKey(node.path, 'start'),
        nodeId: node.id,
        message: `"start: ${start}" with a span of ${span} runs past track ${GRID_TRACKS}`,
        details: { start, span, maxStart: GRID_TRACKS - span + 1 },
      });
    }
  },
};
