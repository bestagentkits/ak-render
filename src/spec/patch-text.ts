/**
 * `patchSpecText()` — patch the source text of a spec, not just its data.
 *
 * The local spec file is canonical, so an edit keeps what the author wrote:
 * YAML comments, key order, quoting and the untouched blocks stay as they are,
 * and only the addressed nodes change. JSON keeps its indentation. The edited
 * text is checked against `patch()`'s result; if the YAML document cannot
 * express the edit in place (aliases, for one), the text is re-serialized from
 * the patched data and `preserved` is false.
 */

import { isNode, isSeq, parseDocument, stringify } from 'yaml';
import { canonicalStringify, type JsonValue } from '../json.js';
import { type PatchChange, type PatchOptions, type PatchResult, patch } from './patch.js';

export interface PatchTextResult extends PatchResult {
  /** The patched source text; the input text when nothing applied. */
  text: string;
  format: 'json' | 'yaml';
  /** False when YAML comments and layout could not be kept. */
  preserved: boolean;
}

export function patchSpecText(
  text: string,
  ops: unknown,
  options: PatchOptions = {},
): PatchTextResult {
  const format = options.format ?? (/^\s*[[{]/u.test(text) ? 'json' : 'yaml');
  const result = patch(text, ops, { ...options, format });
  if (!result.applied || result.changes.length === 0) {
    return { ...result, text, format, preserved: true };
  }
  if (format === 'json') {
    const indent = /\n([ \t]+)\S/u.exec(text)?.[1] ?? '  ';
    const ending = text.endsWith('\n') ? '\n' : '';
    return {
      ...result,
      text: `${JSON.stringify(result.spec, null, indent)}${ending}`,
      format,
      preserved: true,
    };
  }
  const edited = editYaml(text, ops as { op: string; value?: unknown }[], result);
  if (edited !== undefined) return { ...result, text: edited, format, preserved: true };
  return { ...result, text: stringify(result.spec), format, preserved: false };
}

/** Replay the resolved changes on the YAML document; undefined when it diverges. */
function editYaml(
  text: string,
  ops: readonly { op: string; value?: unknown }[],
  result: PatchResult,
): string | undefined {
  try {
    const document = parseDocument(text, { uniqueKeys: true });
    result.changes.forEach((change: PatchChange, index) => {
      const op = ops[index];
      if (change.op === 'move' || change.op === 'copy') {
        const from = keys(document, change.from ?? '');
        const node = document.getIn(from, true);
        const value = isNode(node) ? node.clone() : document.createNode(node);
        if (change.op === 'move') document.deleteIn(from);
        insert(document, keys(document, change.path), value);
        return;
      }
      const path = keys(document, change.path);
      switch (change.op) {
        case 'test':
          return;
        case 'remove':
          document.deleteIn(path);
          return;
        case 'replace':
          if (path.length === 0) insert(document, path, document.createNode(op?.value));
          else document.setIn(path, document.createNode(op?.value));
          return;
        case 'add':
          insert(document, path, document.createNode(op?.value));
          return;
      }
    });
    if (document.errors.length > 0) return undefined;
    const edited = document.toString();
    const reparsed = parseDocument(edited).toJS() as JsonValue;
    return canonicalStringify(reparsed) === canonicalStringify(result.spec) ? edited : undefined;
  } catch {
    return undefined;
  }
}

type YamlDocument = ReturnType<typeof parseDocument>;

function insert(document: YamlDocument, path: (string | number)[], node: unknown): void {
  if (path.length === 0) {
    document.contents = node as YamlDocument['contents'];
    return;
  }
  const parentPath = path.slice(0, -1);
  const parent = parentPath.length === 0 ? document.contents : document.getIn(parentPath, true);
  const key = path[path.length - 1];
  if (isSeq(parent) && typeof key === 'number') parent.items.splice(key, 0, node);
  else document.setIn(path, node);
}

/**
 * A resolved pointer to yaml `getIn` keys. A segment is a number only where
 * the node it indexes is a sequence, so a numeric-looking map key stays text.
 */
function keys(document: YamlDocument, pointer: string): (string | number)[] {
  if (pointer === '') return [];
  const path: (string | number)[] = [];
  for (const raw of pointer.slice(1).split('/')) {
    const segment = raw.replace(/~1/gu, '/').replace(/~0/gu, '~');
    const container = path.length === 0 ? document.contents : document.getIn(path, true);
    path.push(isSeq(container) && /^(?:0|[1-9][0-9]*)$/u.test(segment) ? Number(segment) : segment);
  }
  return path;
}
