/**
 * Cross-field checks for the data table: every field a column names must exist
 * in the bound data, a sparkline needs its series fields, and a prop that only
 * one column type reads is flagged elsewhere. Link values that fail the URL
 * policy are warned about, because they render as plain text.
 */

import { fieldValue } from '../../data/dataset-types.js';
import { reportUnknownField } from '../../data/resolve-block-data.js';
import { pathIndex, pathKey } from '../../diagnostics.js';
import type { IrNode } from '../../ir.js';
import type { CheckContext } from '../../registry/block-module.js';
import { objectListProp } from '../../render/block-helpers.js';
import { safeHref } from './data-table-cells.js';
import { type ColumnType, columnType, resolveColumns } from './data-table-columns.js';

/** Column props that only one type reads, so setting them elsewhere is a mistake. */
const TYPE_ONLY_PROPS: readonly { prop: string; type: ColumnType }[] = [
  { prop: 'hrefField', type: 'link' },
  { prop: 'max', type: 'progress' },
  { prop: 'fields', type: 'sparkline' },
  { prop: 'tones', type: 'badge' },
];

function isSet(value: unknown): boolean {
  if (value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object' && value !== null) return Object.keys(value).length > 0;
  return true;
}

export function checkDataTable(node: IrNode, { bag }: CheckContext): void {
  const data = node.data;
  if (data === undefined) return;
  const columnsPath = pathKey(node.path, 'columns');
  objectListProp(node, 'columns').forEach((column, index) => {
    const path = pathIndex(columnsPath, index);
    const type = columnType(column.type);
    const field = (value: unknown, at: string): void => {
      if (typeof value === 'string' && !data.fields.includes(value)) {
        reportUnknownField(value, data, pathKey(path, at), bag, node.id);
      }
    };
    field(column.key, 'key');
    if (type === 'link') field(column.hrefField, 'hrefField');
    if (type === 'sparkline') {
      const fields = Array.isArray(column.fields) ? column.fields : [];
      if (fields.length === 0) {
        bag.add({
          code: 'SPEC_VALIDATION_ERROR',
          path: pathKey(path, 'fields'),
          nodeId: node.id,
          message: 'a sparkline column needs "fields": 2 to 24 numeric fields',
          details: { allowed: [...data.fields] },
        });
      }
      fields.forEach((name, position) => {
        field(name, `fields[${position}]`);
      });
    }
    for (const { prop, type: owner } of TYPE_ONLY_PROPS) {
      if (type !== owner && isSet(column[prop])) {
        bag.add({
          code: 'SPEC_VALIDATION_ERROR',
          severity: 'warning',
          path: pathKey(path, prop),
          nodeId: node.id,
          message: `"${prop}" applies only to ${owner} columns and is ignored here`,
        });
      }
    }
    if (column.max === 0) {
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: pathKey(path, 'max'),
        nodeId: node.id,
        message: 'a progress "max" must be greater than 0',
      });
    }
  });

  // Unsafe link targets render as plain text; say so once per value.
  resolveColumns(node).forEach((column, index) => {
    if (column.type !== 'link' || !data.fields.includes(column.hrefField)) return;
    for (const row of data.rows) {
      const value = fieldValue(row, column.hrefField);
      if (value === null || safeHref(value) !== undefined) continue;
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        severity: 'warning',
        path: pathKey(pathIndex(columnsPath, index), 'hrefField'),
        nodeId: node.id,
        message: `link "${String(value)}" is not a safe URL and renders as text`,
        details: { value },
      });
    }
  });
}
