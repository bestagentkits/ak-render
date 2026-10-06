/** Prop schemas for chart encodings and overlays. Descriptions stay terse: `describe` carries them. */

import { FORMAT_FIELDS } from '../../data/format-value.js';
import {
  enumStr,
  itemsOf,
  LABEL,
  list,
  num,
  obj,
  oneOf,
  str,
} from '../../registry/define-helpers.js';
import type { PropSchema } from '../../registry/prop-schema.js';

export const CHART_SORTS = ['none', 'ascending', 'descending'] as const;

const FIELD = str({ maxLength: 64, description: 'Field of the bound rows.' });

/** One encoding: the field it reads, how it is titled and formatted, and optional bounds. */
const ENCODING_FIELDS: Record<string, PropSchema> = {
  field: FIELD,
  label: str({ maxLength: 80 }),
  ...FORMAT_FIELDS,
  min: num(),
  max: num(),
};

/** A category name or a number on a numeric x axis. */
const X_POSITION = oneOf([str({ maxLength: 80 }), num()], { required: true });

export const CHART_ENCODING_PROPS: Record<string, PropSchema> = {
  x: obj(ENCODING_FIELDS),
  y: obj(ENCODING_FIELDS),
  value: obj(ENCODING_FIELDS, {
    description: 'Magnitude for heatmap, funnel, gauge, treemap, pie.',
  }),
  bins: num({ integer: true, min: 2, max: 30, description: 'Histogram only.' }),
  markers: list(obj({ x: X_POSITION, label: str({ required: true, maxLength: 80 }) }), {
    maxItems: 6,
  }),
  annotations: list(
    obj({
      x: X_POSITION,
      y: num({ required: true }),
      text: str({ required: true, maxLength: 160 }),
    }),
    { maxItems: 8 },
  ),
  sort: enumStr(CHART_SORTS, { description: 'bar, stacked-bar, funnel, treemap.' }),
  target: num({ description: 'Gauge only.' }),
};

/** `series`: inline `[{ label, values }]`, or `{ field }` to pivot bound rows. */
export const SERIES_PROP: PropSchema = oneOf([
  itemsOf(
    { label: LABEL, values: list(num(), { required: true, minItems: 1, maxItems: 200 }) },
    { minItems: 1 },
  ),
  obj({ field: str({ required: true, maxLength: 64 }) }),
]);
