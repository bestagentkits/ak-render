/**
 * Validation of the `datasets` envelope and of inline `data` rows.
 *
 * Rows are untrusted input like every other spec value: they are bounded,
 * scalar-only, and keyed by plain identifiers. Forbidden key names (`style`,
 * `template`, ...) are already reported by the document-wide forbidden-key scan,
 * which runs before this, so they are not repeated here.
 */

import { type DiagnosticBag, pathIndex, pathKey } from '../diagnostics.js';
import { isPlainObject } from '../json.js';
import { NODE_ID_PATTERN } from '../registry/prop-schema.js';
import { DATA_LIMITS, type DataRow, FIELD_KEY_PATTERN, isDataScalar } from './dataset-types.js';

/**
 * Validate a list of rows. Returns the valid rows; an invalid cell drops only
 * that cell, so one mistake yields one diagnostic instead of a cascade of
 * unknown-field reports further down.
 */
export function validateRows(value: unknown, path: string, bag: DiagnosticBag): DataRow[] {
  if (!Array.isArray(value)) {
    bag.add({ code: 'SPEC_VALIDATION_ERROR', path, message: 'expected a list of rows' });
    return [];
  }
  if (value.length === 0) {
    bag.add({ code: 'SPEC_VALIDATION_ERROR', path, message: 'a dataset needs at least one row' });
    return [];
  }
  if (value.length > DATA_LIMITS.maxRows) {
    bag.add({
      code: 'SPEC_BOUNDS_ERROR',
      path,
      message: `dataset has ${value.length} rows, limit is ${DATA_LIMITS.maxRows}`,
    });
    return [];
  }

  const rows: DataRow[] = [];
  const fields = new Set<string>();
  let fieldOverflowReported = false;
  for (let index = 0; index < value.length; index += 1) {
    const rowPath = pathIndex(path, index);
    const raw = value[index];
    if (!isPlainObject(raw)) {
      bag.add({ code: 'SPEC_VALIDATION_ERROR', path: rowPath, message: 'expected a row object' });
      continue;
    }
    const row: DataRow = {};
    for (const [key, cell] of Object.entries(raw)) {
      const cellPath = pathKey(rowPath, key);
      if (!FIELD_KEY_PATTERN.test(key)) {
        bag.add({
          code: 'SPEC_VALIDATION_ERROR',
          path: cellPath,
          message: `"${key}" is not a valid field name (letters, digits, "_" and "-", 64 max, not starting with a digit or dash, not __proto__, constructor or prototype)`,
        });
        continue;
      }
      if (!isDataScalar(cell)) {
        bag.add({
          code: 'SPEC_VALIDATION_ERROR',
          path: cellPath,
          message: 'a dataset value must be a string, a finite number, a boolean, or null',
        });
        continue;
      }
      if (typeof cell === 'string' && cell.length > DATA_LIMITS.maxStringLength) {
        bag.add({
          code: 'SPEC_BOUNDS_ERROR',
          path: cellPath,
          message: `string is ${cell.length} characters, limit is ${DATA_LIMITS.maxStringLength}`,
        });
        continue;
      }
      if (typeof cell === 'string' && cell.includes('\u0000')) {
        bag.add({
          code: 'SPEC_VALIDATION_ERROR',
          path: cellPath,
          message: 'string contains a NUL character',
        });
        continue;
      }
      if (!fields.has(key) && fields.size >= DATA_LIMITS.maxFields) {
        if (!fieldOverflowReported) {
          fieldOverflowReported = true;
          bag.add({
            code: 'SPEC_BOUNDS_ERROR',
            path: cellPath,
            message: `dataset declares more than ${DATA_LIMITS.maxFields} fields`,
          });
        }
        continue;
      }
      fields.add(key);
      row[key] = cell;
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Validate the top-level `datasets` map. Returns the valid datasets by name, in
 * declaration order.
 */
export function validateDatasets(
  value: unknown,
  path: string,
  bag: DiagnosticBag,
): Record<string, DataRow[]> {
  const datasets: Record<string, DataRow[]> = {};
  if (value === undefined) return datasets;
  if (!isPlainObject(value)) {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path,
      message: 'expected a map of dataset names to row lists',
    });
    return datasets;
  }
  const names = Object.keys(value);
  if (names.length > DATA_LIMITS.maxDatasets) {
    bag.add({
      code: 'SPEC_BOUNDS_ERROR',
      path,
      message: `spec declares ${names.length} datasets, limit is ${DATA_LIMITS.maxDatasets}`,
    });
    return datasets;
  }
  for (const name of names) {
    const datasetPath = pathKey(path, name);
    if (!NODE_ID_PATTERN.test(name)) {
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: datasetPath,
        message: `"${name}" is not a valid dataset name (lowercase letters, digits and dashes, 64 max)`,
      });
      continue;
    }
    datasets[name] = validateRows(value[name], datasetPath, bag);
  }
  return datasets;
}
