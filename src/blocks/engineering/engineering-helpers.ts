/**
 * Helpers shared by the engineering widgets: data-field mapping for the blocks
 * that read rows (kanban, log-viewer), scalar rows for the filter contract, and
 * the copyable code panel the api-endpoint block draws with core code markup.
 */

import type { DataRow, DataScalar } from '../../data/dataset-types.js';
import { isDataScalar } from '../../data/dataset-types.js';
import { formatValue } from '../../data/format-value.js';
import { reportUnknownField } from '../../data/resolve-block-data.js';
import { type DiagnosticBag, pathKey } from '../../diagnostics.js';
import type { IrNode } from '../../ir.js';
import { isPlainObject, type JsonValue } from '../../json.js';
import { obj, str as strProp } from '../../registry/define-helpers.js';
import type { PropSchema } from '../../registry/prop-schema.js';
import { escapeText, renderAttributes } from '../../render/escape.js';

/** Data keys a bound block reads instead of props; any diagnostic under them means a binding was attempted. */
const BINDING_KEYS = ['dataRef', 'data', 'transform'] as const;

/**
 * A `fields` prop that maps each part of a rendered item to a dataset field.
 * An omitted part reads the field of the same name.
 */
export function fieldMapProp(parts: readonly string[], description: string): PropSchema {
  return obj(Object.fromEntries(parts.map((part) => [part, strProp({ maxLength: 64 })])), {
    description,
  });
}

/** The dataset field each part reads: the authored mapping, else the part's own name. */
export function fieldMap(node: IrNode, parts: readonly string[]): Record<string, string> {
  const authored = isPlainObject(node.props.fields) ? node.props.fields : {};
  return Object.fromEntries(
    parts.map((part) => {
      const value = authored[part];
      return [part, typeof value === 'string' ? value : part];
    }),
  );
}

/**
 * True when the author bound data, whether or not the binding resolved: a
 * failed binding has already been reported under one of the binding keys.
 */
export function bindsData(node: IrNode, bag: DiagnosticBag): boolean {
  if (node.data !== undefined) return true;
  const prefixes = BINDING_KEYS.map((key) => pathKey(node.path, key));
  return bag
    .list()
    .some((item) =>
      prefixes.some(
        (prefix) =>
          item.path === prefix ||
          item.path.startsWith(`${prefix}.`) ||
          item.path.startsWith(`${prefix}[`),
      ),
    );
}

/**
 * Check that a block takes its items from exactly one source: the inline list
 * prop or a data binding. Returns false when it reported a problem.
 */
export function checkItemSource(
  node: IrNode,
  bag: DiagnosticBag,
  listKey: string,
  noun: string,
): boolean {
  const inline = Array.isArray(node.props[listKey]) && node.props[listKey].length > 0;
  const bound = bindsData(node, bag);
  if (inline && bound) {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path: pathKey(node.path, listKey),
      message: `set "${listKey}" or a data binding ("dataRef" or "data"), not both`,
      nodeId: node.id,
    });
    return false;
  }
  if (!inline && !bound) {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path: pathKey(node.path, listKey),
      message: `a ${node.type} needs ${noun}: set "${listKey}", or bind rows with "dataRef" or "data"`,
      nodeId: node.id,
    });
    return false;
  }
  return true;
}

/**
 * Report every mapped field the bound rows do not have. `required` parts are
 * always checked; optional parts only when the author mapped them explicitly,
 * so a dataset without, say, an `owner` field simply shows no owner.
 */
export function checkMappedFields(
  node: IrNode,
  bag: DiagnosticBag,
  parts: readonly string[],
  required: readonly string[],
): boolean {
  const data = node.data;
  if (data === undefined) return false;
  const authored = isPlainObject(node.props.fields) ? node.props.fields : {};
  const fields = fieldMap(node, parts);
  let ok = true;
  for (const part of parts) {
    const field = fields[part] ?? part;
    const explicit = typeof authored[part] === 'string';
    if (!required.includes(part) && !explicit) continue;
    if (data.fields.includes(field)) continue;
    ok = false;
    reportUnknownField(field, data, pathKey(pathKey(node.path, 'fields'), part), bag, node.id);
  }
  return ok;
}

/** A row's value for a mapped part, or null when the row lacks the field. */
export function partValue(row: DataRow, field: string | undefined): DataScalar {
  if (field === undefined || !Object.hasOwn(row, field)) return null;
  return row[field] ?? null;
}

/** Display text for a bound scalar; empty for null so optional parts drop out. */
export function partText(value: DataScalar): string {
  return value === null ? '' : formatValue(value);
}

/** The scalar fields of an authored item, as the row the filter contract carries. */
export function scalarRow(item: Record<string, JsonValue>): DataRow {
  const row: DataRow = {};
  for (const [key, value] of Object.entries(item)) {
    if (isDataScalar(value)) row[key] = value;
    else if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
      row[key] = value.join(', ');
    }
  }
  return row;
}

/**
 * A copy target id for a piece of a block. Node ids never contain a dot, so a
 * dotted suffix cannot collide with any authored or derived node id.
 */
export function partId(node: IrNode, part: string): string {
  return `${node.id}.${part}`;
}

/** The core code block's Copy button, aimed at one element. */
export function copyButton(target: string, label: string): string {
  return `<button type="button" class="ak-code-copy"${renderAttributes({
    'aria-label': label,
    'data-ak-on-click': JSON.stringify([{ action: 'copy', target }]),
  })}>Copy</button>`;
}

/** Split code into one span per line, as the core code block does, so lines are numbered. */
function codeLines(text: string): string {
  return text
    .replace(/\n$/u, '')
    .split('\n')
    .map((line) => `<span class="ak-line">${escapeText(line)}</span>`)
    .join('\n');
}

/** A code panel in the core code block's markup, with its own copy target. */
export function codePanel(target: string, label: string, language: string, code: string): string {
  return [
    '<div class="ak-code">',
    '<div class="ak-code-head">',
    `<span class="ak-label">${escapeText(label)}</span>`,
    `<span class="ak-code-lang">${escapeText(language)}</span>`,
    copyButton(target, `Copy ${label}`),
    '</div>',
    `<pre${renderAttributes({ 'data-ak-id': target })}><code${renderAttributes({
      class: `language-${language}`,
    })}>${codeLines(code)}</code></pre>`,
    '</div>',
  ].join('');
}
