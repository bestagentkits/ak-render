/**
 * Per-block data binding: `dataRef` or inline `data`, plus an optional
 * `transform`, materialized once at normalize time.
 *
 * The block's renderer and its `check()` only ever see the materialized rows and
 * the field list, so every block reads data the same way and every unknown
 * field is reported with the path the author wrote and the fields that exist.
 */

import { type DiagnosticBag, pathIndex, pathKey } from '../diagnostics.js';
import { isPlainObject } from '../json.js';
import { validateProp } from '../registry/prop-schema.js';
import {
  type DataRow,
  FIELD_KEY_PATTERN,
  fieldsOf,
  isDataScalar,
  type MaterializedData,
} from './dataset-types.js';
import {
  aggregateField,
  applyTransform,
  DERIVE_NEEDS_BASE,
  DERIVE_REFUSES_BASE,
  FILTER_OPERATORS,
  rollupLabelField,
  rollupRow,
  sortKeys,
  TRANSFORM_PROP_SCHEMA,
  type TransformSpec,
} from './transform-pipeline.js';
import { validateRows } from './validate-datasets.js';

export { fieldValue } from './dataset-types.js';

export interface BlockDataInput {
  dataRef?: unknown;
  data?: unknown;
  transform?: unknown;
}

/** Diagnostic for an unknown field reference; `details.allowed` lists the fields. */
export function reportUnknownField(
  field: string,
  data: MaterializedData,
  path: string,
  bag: DiagnosticBag,
  nodeId?: string,
): void {
  bag.add({
    code: 'SPEC_VALIDATION_ERROR',
    path,
    message: `unknown field "${field}"${data.source === null ? '' : ` in dataset "${data.source}"`}`,
    details: { field, allowed: [...data.fields] },
    ...(nodeId === undefined ? {} : { nodeId }),
  });
}

/** Report `field` at `path` unless the stage's field list contains it. */
function requireField(
  field: string,
  fields: readonly string[],
  source: string | null,
  path: string,
  bag: DiagnosticBag,
): boolean {
  if (fields.includes(field)) return true;
  reportUnknownField(field, { source, fields: [...fields], rows: [] }, path, bag);
  return false;
}

/**
 * Check a schema-valid transform against the fields each stage can see, and
 * the rules the prop schema cannot express. Returns false when any problem was
 * reported, in which case the transform is not applied.
 */
function checkTransform(
  spec: TransformSpec,
  sourceFields: readonly string[],
  source: string | null,
  path: string,
  bag: DiagnosticBag,
  allowTotal: boolean,
): { ok: boolean; fields: string[] } {
  let ok = true;
  let fields = [...sourceFields];

  spec.filter?.forEach((clause, index) => {
    const clausePath = pathIndex(pathKey(path, 'filter'), index);
    const operators = FILTER_OPERATORS.filter((operator) => clause[operator] !== undefined);
    if (operators.length !== 1) {
      ok = false;
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: clausePath,
        message: `a filter clause needs exactly one operator, found ${operators.length}`,
        details: { allowed: [...FILTER_OPERATORS] },
      });
    }
    const scalarValues = [clause.equals, clause.notEquals, ...(clause.in ?? [])];
    if (scalarValues.some((value) => value !== undefined && !isDataScalar(value))) {
      ok = false;
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: clausePath,
        message: 'filter values must be strings, numbers, booleans, or null',
      });
    }
    if (!requireField(clause.field, fields, source, pathKey(clausePath, 'field'), bag)) ok = false;
  });

  const groupBy = spec.groupBy;
  if (groupBy !== undefined) {
    const groupPath = pathKey(path, 'groupBy');
    if (!requireField(groupBy.field, fields, source, pathKey(groupPath, 'field'), bag)) ok = false;
    if (groupBy.aggregate !== 'count') {
      if (groupBy.value === undefined) {
        ok = false;
        bag.add({
          code: 'SPEC_VALIDATION_ERROR',
          path: pathKey(groupPath, 'value'),
          message: `aggregate "${groupBy.aggregate}" needs a numeric "value" field`,
          details: { allowed: [...fields] },
        });
      } else if (!requireField(groupBy.value, fields, source, pathKey(groupPath, 'value'), bag)) {
        ok = false;
      }
    }
    const output = aggregateField(groupBy);
    if (output === groupBy.field) {
      ok = false;
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: pathKey(groupPath, 'as'),
        message: `the aggregate field "${output}" would overwrite the group field; set "as"`,
      });
    }
    fields = [groupBy.field, output];
  }

  spec.derive?.forEach((derive, index) => {
    const derivePath = pathIndex(pathKey(path, 'derive'), index);
    if (!requireField(derive.field, fields, source, pathKey(derivePath, 'field'), bag)) ok = false;
    if (derive.base !== undefined) {
      if (DERIVE_REFUSES_BASE.includes(derive.op)) {
        ok = false;
        bag.add({
          code: 'SPEC_VALIDATION_ERROR',
          path: pathKey(derivePath, 'base'),
          message: `"${derive.op}" reads one field and takes no "base"`,
        });
      } else if (!requireField(derive.base, fields, source, pathKey(derivePath, 'base'), bag)) {
        ok = false;
      }
    } else if (DERIVE_NEEDS_BASE.includes(derive.op)) {
      ok = false;
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: pathKey(derivePath, 'base'),
        message: `"${derive.op}" needs a "base" field to divide by`,
        details: { allowed: [...fields] },
      });
    }
    const asPath = pathKey(derivePath, 'as');
    if (!FIELD_KEY_PATTERN.test(derive.as)) {
      ok = false;
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: asPath,
        message: `"${derive.as}" is not a valid field name`,
        details: { pattern: FIELD_KEY_PATTERN.source },
      });
    } else if (fields.includes(derive.as)) {
      ok = false;
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: asPath,
        message: `the derived field "${derive.as}" would overwrite an existing field; pick a new name`,
        details: { field: derive.as },
      });
    } else {
      fields = [...fields, derive.as];
    }
  });

  const keys = sortKeys(spec.sort);
  const sortIsList = Array.isArray(spec.sort);
  keys.forEach((key, index) => {
    const keyPath = sortIsList
      ? pathKey(pathIndex(pathKey(path, 'sort'), index), 'by')
      : pathKey(pathKey(path, 'sort'), 'by');
    if (!requireField(key.by, fields, source, keyPath, bag)) ok = false;
  });

  if (spec.select !== undefined) {
    const seen = new Set<string>();
    spec.select.forEach((field, index) => {
      const selectPath = pathIndex(pathKey(path, 'select'), index);
      if (seen.has(field)) {
        ok = false;
        bag.add({
          code: 'SPEC_VALIDATION_ERROR',
          path: selectPath,
          message: `field "${field}" is selected twice`,
        });
      }
      seen.add(field);
      if (!requireField(field, fields, source, selectPath, bag)) ok = false;
    });
    fields = [...spec.select];
  }

  const rollup = spec.rollup;
  if (rollup !== undefined && !allowTotal) {
    ok = false;
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path: pathKey(path, 'rollup'),
      message:
        'rollup adds a total row that only data-table shows; use a groupBy aggregate here instead',
    });
  } else if (rollup !== undefined) {
    const rollupPath = pathKey(path, 'rollup');
    const seen = new Set<string>();
    rollup.fields.forEach((field, index) => {
      const fieldPath = pathIndex(pathKey(rollupPath, 'fields'), index);
      if (seen.has(field)) {
        ok = false;
        bag.add({
          code: 'SPEC_VALIDATION_ERROR',
          path: fieldPath,
          message: `field "${field}" is totalled twice`,
        });
      }
      seen.add(field);
      if (!requireField(field, fields, source, fieldPath, bag)) ok = false;
    });
    if (rollup.labelField !== undefined) {
      const labelPath = pathKey(rollupPath, 'labelField');
      if (!requireField(rollup.labelField, fields, source, labelPath, bag)) ok = false;
      else if (rollup.fields.includes(rollup.labelField)) {
        ok = false;
        bag.add({
          code: 'SPEC_VALIDATION_ERROR',
          path: labelPath,
          message: `"${rollup.labelField}" is totalled, so it cannot also hold the label`,
        });
      }
    } else if (rollupLabelField(rollup, fields) === undefined) {
      ok = false;
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: pathKey(rollupPath, 'fields'),
        message: 'every field is totalled, so the total row has nowhere to put its label',
      });
    }
  }

  return { ok, fields };
}

/**
 * Resolve a block's data. Returns undefined when the block binds no data or the
 * binding is invalid (the problem is reported). `total` says whether the block
 * shows a `rollup` total; elsewhere a rollup is an error rather than ignored.
 */
export function resolveBlockData(
  input: BlockDataInput,
  datasets: Record<string, DataRow[]>,
  path: string,
  bag: DiagnosticBag,
  options: { total?: boolean } = {},
): MaterializedData | undefined {
  const { dataRef, data, transform } = input;
  if (dataRef !== undefined && data !== undefined) {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path: pathKey(path, 'dataRef'),
      message: 'set either "dataRef" or "data", not both',
    });
    return undefined;
  }
  if (dataRef === undefined && data === undefined) {
    if (transform !== undefined) {
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: pathKey(path, 'transform'),
        message: 'a transform needs "dataRef" or "data" to apply to',
      });
    }
    return undefined;
  }

  let source: string | null = null;
  let rows: DataRow[];
  if (dataRef !== undefined) {
    const refPath = pathKey(path, 'dataRef');
    const known = Object.keys(datasets);
    if (typeof dataRef !== 'string') {
      bag.add({ code: 'SPEC_VALIDATION_ERROR', path: refPath, message: 'expected a dataset name' });
      return undefined;
    }
    const named = Object.hasOwn(datasets, dataRef) ? datasets[dataRef] : undefined;
    if (named === undefined) {
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: refPath,
        message: `unknown dataset "${dataRef}"`,
        details: { dataRef, known },
      });
      return undefined;
    }
    source = dataRef;
    rows = named;
  } else {
    rows = validateRows(data, pathKey(path, 'data'), bag);
  }

  const sourceFields = fieldsOf(rows);
  if (transform === undefined) return { source, fields: sourceFields, rows: [...rows] };

  const transformPath = pathKey(path, 'transform');
  const attempt = bag.errorCount;
  validateProp(TRANSFORM_PROP_SCHEMA, transform, transformPath, bag);
  if (bag.errorCount > attempt || !isPlainObject(transform)) return undefined;
  // The author's value, not validateProp's output: the validated copy fills
  // optional lists with `[]`, which would read as "select nothing" or "in
  // nothing". The schema already rejected every unknown key and wrong type.
  const spec = transform as unknown as TransformSpec;
  const checked = checkTransform(
    spec,
    sourceFields,
    source,
    transformPath,
    bag,
    options.total === true,
  );
  if (!checked.ok) return undefined;
  const transformed = applyTransform(rows, spec);
  return {
    source,
    fields: checked.fields,
    rows: transformed,
    ...(spec.rollup === undefined
      ? {}
      : { total: rollupRow(transformed, spec.rollup, checked.fields) }),
  };
}
