/** Feature matrix block: which plan includes which feature, as a real table. */

import type { JsonValue } from '../../json.js';
import type { BlockModule } from '../../registry/block-module.js';
import {
  anchorProps,
  bool,
  itemsOf,
  LABEL,
  list,
  OPTIONAL_TITLE,
  oneOf,
  semantic,
  str as strProp,
} from '../../registry/define-helpers.js';
import {
  element,
  listProp,
  nodeAttributes,
  objectListProp,
  str,
  titleHeader,
} from '../../render/block-helpers.js';
import { escapeInlineText, escapeText } from '../../render/escape.js';
import { reportAt } from './product-helpers.js';

/** A boolean cell: an icon for the eye, the words for everyone else. */
function cell(value: JsonValue | undefined): string {
  if (value === true) {
    return '<td data-value="yes"><span class="ak-matrix-mark" aria-hidden="true"></span><span class="ak-sr">Included</span></td>';
  }
  if (value === false) {
    return '<td data-value="no"><span class="ak-matrix-mark" aria-hidden="true"></span><span class="ak-sr">Not included</span></td>';
  }
  return `<td>${escapeInlineText(typeof value === 'string' ? value : '')}</td>`;
}

export const featureMatrixBlock: BlockModule = {
  definition: semantic({
    type: 'feature-matrix',
    category: 'data',
    tags: ['comparison', 'plans', 'features', 'table'],
    useCases: ['plan feature comparison', 'product capability matrix'],
    purpose: 'Feature-by-plan comparison table.',
    summary: 'Feature matrix: rows of features against 2-5 plans; true/false render as marks.',
    props: {
      title: OPTIONAL_TITLE,
      plans: list(strProp({ maxLength: 60 }), {
        required: true,
        minItems: 2,
        maxItems: 5,
        description: 'Column labels.',
      }),
      rows: itemsOf(
        {
          feature: LABEL,
          values: list(oneOf([bool(), strProp({ maxLength: 80 })]), {
            required: true,
            minItems: 1,
            maxItems: 5,
            description: 'One value per plan, in plan order: true, false or short text.',
          }),
        },
        { minItems: 1, maxItems: 40 },
      ),
      ...anchorProps,
    },
    runtimeFeatures: ['feature-matrix'],
    a11y: 'A table with column and row headers; included and not-included marks carry visually hidden words.',
  }),
  render: (node) => {
    const plans = listProp(node, 'plans').map((plan) => str(plan));
    const title = str(node.props.title);
    const head = `<tr><th scope="col">Feature</th>${plans
      .map((plan) => `<th scope="col">${escapeText(plan)}</th>`)
      .join('')}</tr>`;
    const body = objectListProp(node, 'rows')
      .map((row) => {
        const values = Array.isArray(row.values) ? row.values : [];
        return `<tr><th scope="row">${escapeInlineText(str(row.feature))}</th>${plans
          .map((_, index) => cell(values[index]))
          .join('')}</tr>`;
      })
      .join('');
    return element(
      'section',
      nodeAttributes(node, { class: 'ak-block' }),
      `${titleHeader(node)}<div class="ak-table-wrap ak-feature-matrix"><table>${
        title === '' ? '' : `<caption class="ak-sr">${escapeText(title)}</caption>`
      }<thead>${head}</thead><tbody>${body}</tbody></table></div>`,
    );
  },
  check: (node, context) => {
    const expected = listProp(node, 'plans').length;
    objectListProp(node, 'rows').forEach((row, index) => {
      const actual = Array.isArray(row.values) ? row.values.length : 0;
      if (actual !== expected) {
        reportAt(
          context,
          node,
          `.rows[${index}].values`,
          `expected ${expected} values, one per plan, found ${actual}`,
          { expected, actual },
        );
      }
    });
  },
};
