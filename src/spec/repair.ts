/**
 * `repair()` — apply the suggested fixes that provably keep the author's
 * meaning, then validate again.
 *
 * Only a diagnostic whose single suggestion is `safe` is touched. Guesses
 * between near names, deletions, data changes and invented values are never
 * applied: they stay in the returned diagnostics, with their `fixes`, for the
 * author to choose. Each fix is kept only when it clears its own diagnostic
 * and raises no new error outside the value it edited.
 */

import {
  type Document,
  isMap,
  isNode,
  isScalar,
  isSeq,
  parseDocument,
  stringify,
  YAMLSeq,
} from 'yaml';
import type { Diagnostic, DiagnosticFix, PatchOperation } from '../diagnostics.js';
import { isRenderError } from '../errors.js';
import { isJsonValue, type JsonValue } from '../json.js';
import { applyPatch, jsonEqual } from './json-patch.js';
import { type ParseOptions, parseSpec } from './parse.js';
import { type ValidateResult, type ValidateSummary, validate } from './validate.js';

/** The only mode: semantics-preserving edits. Named so a wider mode stays additive. */
export type RepairMode = 'safe';

export interface RepairOptions extends ParseOptions {
  mode?: RepairMode;
}

export interface RepairChange {
  rule: string;
  /** Spec path of the diagnostic the change cleared. */
  path: string;
  /** The diagnostic message the change cleared. */
  message: string;
  patch: PatchOperation[];
}

export interface RepairResult {
  /** The repaired spec validates without errors. */
  ok: boolean;
  /** At least one change was applied. */
  changed: boolean;
  changes: RepairChange[];
  /** What remains after the repair, with `fixes` for every guess left to the author. */
  diagnostics: Diagnostic[];
  summary: ValidateSummary;
  /** The repaired document; absent when the input could not be parsed. */
  spec?: JsonValue;
  /**
   * The repaired spec as text in the input's format, present when the input
   * was text and something changed. YAML keeps its comments and layout.
   */
  text?: string;
}

/** Upper bound on revalidations, which bounds the work one repair call can cost. */
export const REPAIR_MAX_ATTEMPTS = 200;

interface Candidate {
  diagnostic: Diagnostic;
  fix: DiagnosticFix;
}

/** Fixes can unlock deeper checks (a wrapped block is then validated), so repair runs in passes. */
const MAX_PASSES = 8;

export function repair(input: unknown, options: RepairOptions = {}): RepairResult {
  const mode = options.mode ?? 'safe';
  if (mode !== 'safe') throw new TypeError(`unknown repair mode "${String(mode)}"`);

  let parsed: unknown;
  try {
    parsed = parseSpec(input, options);
  } catch (error) {
    if (!isRenderError(error)) throw error;
    const report = validate(input, { ...options, suggest: true });
    return {
      ok: false,
      changed: false,
      changes: [],
      diagnostics: report.diagnostics,
      summary: report.summary,
    };
  }
  if (!isJsonValue(parsed)) {
    const report = validate(parsed, { suggest: true });
    return {
      ok: false,
      changed: false,
      changes: [],
      diagnostics: report.diagnostics,
      summary: report.summary,
    };
  }

  let spec: JsonValue = parsed;
  let report = validate(spec, { suggest: true });
  const changes: RepairChange[] = [];

  let attempts = 0;
  for (let pass = 0; pass < MAX_PASSES && attempts < REPAIR_MAX_ATTEMPTS; pass += 1) {
    const candidates = report.diagnostics
      .map((diagnostic) => ({ diagnostic, fix: onlySafeFix(diagnostic) }))
      .filter((candidate): candidate is Candidate => candidate.fix !== undefined)
      .slice(0, REPAIR_MAX_ATTEMPTS - attempts);
    if (candidates.length === 0) break;

    // The common case costs one revalidation: every fix of the pass at once.
    // Only when the batch is refused is each fix tried on its own.
    attempts += 1;
    const batch = applyAll(spec, candidates);
    const batchReport = batch === undefined ? undefined : validate(batch, { suggest: true });
    let accepted: Candidate[] = [];
    if (
      batch !== undefined &&
      batchReport !== undefined &&
      clears(candidates, report, batchReport)
    ) {
      spec = batch;
      report = batchReport;
      accepted = candidates;
    } else {
      for (const candidate of candidates) {
        if (attempts >= REPAIR_MAX_ATTEMPTS) break;
        const next = applyPatch(spec, candidate.fix.patch);
        if (next === undefined) continue;
        attempts += 1;
        const after = validate(next, { suggest: true });
        if (!clears([candidate], report, after)) continue;
        spec = next;
        report = after;
        accepted.push(candidate);
      }
    }
    if (accepted.length === 0) break;
    for (const { diagnostic, fix } of accepted) {
      changes.push({
        rule: fix.rule,
        path: fix.path,
        message: diagnostic.message,
        patch: fix.patch,
      });
    }
  }

  const result: RepairResult = {
    ok: report.ok,
    changed: changes.length > 0,
    changes,
    diagnostics: report.diagnostics,
    summary: report.summary,
    spec,
  };
  if (typeof input === 'string' && changes.length > 0) {
    result.text = repairedText(input, spec, changes, options);
  }
  return result;
}

/** The fix to apply: the diagnostic offers exactly one, and it is safe. */
function onlySafeFix(diagnostic: Diagnostic): DiagnosticFix | undefined {
  const fixes = diagnostic.fixes ?? [];
  const [only] = fixes;
  return fixes.length === 1 && only?.classification === 'safe' ? only : undefined;
}

function errorKey(diagnostic: Diagnostic): string {
  return `${diagnostic.code}|${diagnostic.path}|${diagnostic.message}`;
}

function within(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}.`) || path.startsWith(`${root}[`);
}

function applyAll(spec: JsonValue, candidates: readonly Candidate[]): JsonValue | undefined {
  let next: JsonValue | undefined = spec;
  for (const { fix } of candidates) {
    next = applyPatch(next, fix.patch);
    if (next === undefined) return undefined;
  }
  return next;
}

/**
 * Fixes are kept when each one's diagnostic is gone and every new error sits
 * inside a value they edited (a wrapped block is validated for the first time).
 */
function clears(
  candidates: readonly Candidate[],
  before: ValidateResult,
  after: ValidateResult,
): boolean {
  for (const { diagnostic } of candidates) {
    const remains = after.diagnostics.some(
      (item) => item.code === diagnostic.code && item.path === diagnostic.path,
    );
    if (remains) return false;
  }
  const known = new Set(before.diagnostics.map(errorKey));
  return after.diagnostics.every(
    (item) =>
      item.severity !== 'error' ||
      known.has(errorKey(item)) ||
      candidates.some(({ fix }) => within(item.path, fix.path)),
  );
}

/**
 * Serialize the repaired spec in the input's format. YAML edits are replayed
 * on the parsed document so comments and layout survive; if the replay does
 * not reproduce the repaired spec exactly, the spec is re-emitted instead.
 */
function repairedText(
  input: string,
  spec: JsonValue,
  changes: readonly RepairChange[],
  options: ParseOptions,
): string {
  const format = options.format ?? (/^\s*[[{]/u.test(input) ? 'json' : 'yaml');
  if (format === 'json') return `${JSON.stringify(spec, null, 2)}\n`;
  const document = parseDocument(input, { uniqueKeys: true });
  for (const change of changes) {
    for (const operation of change.patch) {
      if (operation.op !== 'replace') continue;
      const keys = yamlKeys(document.contents, operation.path);
      if (keys === undefined) return yamlFallback(spec);
      replaceNode(document, keys, operation.value);
    }
    if (change.patch.some((operation) => operation.op === 'move')) return yamlFallback(spec);
  }
  const text = document.toString();
  try {
    return jsonEqual(parseSpec(text, { format: 'yaml' }), spec) ? text : yamlFallback(spec);
  } catch {
    return yamlFallback(spec);
  }
}

/**
 * Replace a value in place, reusing the node the author wrote where the edit
 * allows: a scalar keeps its quoting and comment, and a value wrapped in a
 * one-item list keeps its own layout and comments as that item.
 */
function replaceNode(document: Document, keys: unknown[], value: JsonValue): void {
  const node = document.getIn(keys, true);
  if (isScalar(node) && (value === null || typeof value !== 'object')) {
    node.value = value;
    return;
  }
  if (
    isNode(node) &&
    Array.isArray(value) &&
    value.length === 1 &&
    jsonEqual(node.toJSON(), value[0])
  ) {
    const list = new YAMLSeq(document.schema);
    list.items.push(node);
    document.setIn(keys, list);
    return;
  }
  document.setIn(keys, document.createNode(value));
}

/** Pointer tokens as yaml collection keys: numbers for sequence items. */
function yamlKeys(root: unknown, pointer: string): unknown[] | undefined {
  const tokens = pointer
    .slice(1)
    .split('/')
    .map((token) => token.replace(/~1/gu, '/').replace(/~0/gu, '~'));
  const keys: unknown[] = [];
  let node: unknown = root;
  for (const token of tokens) {
    if (isSeq(node)) {
      const index = Number(token);
      keys.push(index);
      node = node.get(index, true);
    } else if (isMap(node)) {
      keys.push(token);
      node = node.get(token, true);
    } else {
      return undefined;
    }
  }
  return keys;
}

function yamlFallback(spec: JsonValue): string {
  return stringify(spec);
}
