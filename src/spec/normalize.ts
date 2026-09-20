/**
 * Normalizer: nested authoring Page Spec -> flat internal IR.
 *
 * The author-facing shape is optimized for authoring (nested, tolerant of
 * omission, semantic). The IR is optimized for the compiler (flat, ordered,
 * every node resolved). This module owns the crossing between them, including
 * stable node IDs, slot wiring, and the cross-field checks that a per-prop
 * schema cannot express.
 */

import { type Diagnostic, DiagnosticBag, pathIndex, pathKey } from '../diagnostics.js';
import { isRenderError, RenderError } from '../errors.js';
import { derivedNodeId } from '../hash.js';
import type { IrDocument, IrNode, IrTheme } from '../ir.js';
import { isPlainObject, type JsonValue } from '../json.js';
import { NODE_ID_PATTERN, validateProps } from '../registry/prop-schema.js';
import { blockTypes, getBlockDefinition } from '../registry/registry.js';
import type { BlockDefinition, RuntimeFeature } from '../registry/roster.js';
import { VERSION } from '../version.js';
import { type BindingMap, validateBindingsDeep } from './bindings.js';
import { type BoundsReport, checkBounds } from './bounds.js';
import { scanForbiddenKeys } from './forbidden.js';
import { migrateSpec } from './migrate.js';
import { type ParseOptions, parseSpec } from './parse.js';

export interface NormalizeResult {
  ir: IrDocument;
  diagnostics: Diagnostic[];
  bounds: BoundsReport;
}

const THEME_PRESET_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LOCALE_PATTERN = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const DEFAULT_THEME_PRESET = 'editorial';
export const NETWORK_CAPABILITIES = ['media', 'fonts', 'images'] as const;

interface BuildContext {
  bag: DiagnosticBag;
  nodes: IrNode[];
  usedIds: Set<string>;
}

function requireString(
  value: unknown,
  path: string,
  bag: DiagnosticBag,
  options: { maxLength: number; pattern?: RegExp; patternHint?: string; required?: boolean },
): string | undefined {
  if (value === undefined) {
    if (options.required === true) {
      bag.add({ code: 'SPEC_VALIDATION_ERROR', path, message: 'required value is missing' });
    }
    return undefined;
  }
  if (typeof value !== 'string') {
    bag.add({ code: 'SPEC_VALIDATION_ERROR', path, message: 'expected a string' });
    return undefined;
  }
  if (value.length === 0 || value.length > options.maxLength) {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path,
      message: `expected 1-${options.maxLength} characters, received ${value.length}`,
    });
    return undefined;
  }
  if (options.pattern !== undefined && !options.pattern.test(value)) {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path,
      message: `"${value}" is not valid${options.patternHint === undefined ? '' : ` (${options.patternHint})`}`,
    });
    return undefined;
  }
  return value;
}

interface Envelope {
  meta: IrDocument['meta'];
  theme: IrTheme;
  policy: IrDocument['policy'];
  state: Record<string, JsonValue>;
  blocks: unknown[];
}

function normalizeEnvelope(
  document: Record<string, unknown>,
  bag: DiagnosticBag,
): Envelope | undefined {
  const metaValue = document.meta;
  if (!isPlainObject(metaValue)) {
    bag.add({ code: 'SPEC_VALIDATION_ERROR', path: '$.meta', message: 'expected a meta object' });
    return undefined;
  }

  const title = requireString(metaValue.title, '$.meta.title', bag, {
    maxLength: 200,
    required: true,
  });
  const description = requireString(metaValue.description, '$.meta.description', bag, {
    maxLength: 400,
  });
  const locale =
    requireString(metaValue.locale, '$.meta.locale', bag, {
      maxLength: 35,
      pattern: LOCALE_PATTERN,
      patternHint: 'a language tag such as "en" or "en-US"',
    }) ?? 'en';
  const slug = requireString(metaValue.slug, '$.meta.slug', bag, { maxLength: 120 });

  for (const key of Object.keys(metaValue)) {
    if (!['title', 'description', 'locale', 'slug'].includes(key)) {
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: pathKey('$.meta', key),
        message: `unknown meta field "${key}"`,
        details: { allowed: ['title', 'description', 'locale', 'slug'] },
      });
    }
  }

  const themeValue = document.theme;
  let theme: IrTheme = { preset: DEFAULT_THEME_PRESET };
  if (themeValue !== undefined) {
    if (!isPlainObject(themeValue)) {
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: '$.theme',
        message: 'expected a theme object',
      });
    } else {
      const preset = requireString(themeValue.preset, '$.theme.preset', bag, {
        maxLength: 64,
        pattern: THEME_PRESET_PATTERN,
        patternHint: 'lowercase letters, digits, and dashes',
      });
      const extendsName = requireString(themeValue.extends, '$.theme.extends', bag, {
        maxLength: 64,
        pattern: THEME_PRESET_PATTERN,
        patternHint: 'lowercase letters, digits, and dashes',
      });
      theme = { preset: preset ?? DEFAULT_THEME_PRESET };
      if (extendsName !== undefined) theme.extends = extendsName;
      const tokens = themeValue.tokens;
      if (tokens !== undefined) {
        if (!isPlainObject(tokens)) {
          bag.add({
            code: 'SPEC_VALIDATION_ERROR',
            path: '$.theme.tokens',
            message: 'expected a token object',
          });
        } else {
          theme.tokens = tokens as JsonValue;
        }
      }
      for (const key of Object.keys(themeValue)) {
        if (!['preset', 'extends', 'tokens'].includes(key)) {
          bag.add({
            code: 'SPEC_VALIDATION_ERROR',
            path: pathKey('$.theme', key),
            message: `unknown theme field "${key}"`,
            details: { allowed: ['preset', 'extends', 'tokens'] },
          });
        }
      }
    }
  }

  const policyValue = document.policy;
  let policy: IrDocument['policy'] = { network: 'deny' };
  if (policyValue !== undefined) {
    if (!isPlainObject(policyValue)) {
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: '$.policy',
        message: 'expected a policy object',
      });
    } else {
      const network = policyValue.network;
      if (network !== undefined && network !== 'deny') {
        if (!isPlainObject(network)) {
          bag.add({
            code: 'SPEC_VALIDATION_ERROR',
            path: '$.policy.network',
            message: 'expected "deny" or an object with an "allow" list',
          });
        } else {
          const allow = network.allow;
          if (!Array.isArray(allow) || allow.length === 0) {
            bag.add({
              code: 'SPEC_VALIDATION_ERROR',
              path: '$.policy.network.allow',
              message: 'expected a non-empty list of capabilities',
              details: { allowed: [...NETWORK_CAPABILITIES] },
            });
          } else {
            const capabilities: string[] = [];
            for (let index = 0; index < allow.length; index += 1) {
              const capability = allow[index];
              if (
                typeof capability !== 'string' ||
                !(NETWORK_CAPABILITIES as readonly string[]).includes(capability)
              ) {
                bag.add({
                  code: 'POLICY_VIOLATION',
                  path: pathIndex('$.policy.network.allow', index),
                  message: `unknown network capability "${String(capability)}"`,
                  details: { allowed: [...NETWORK_CAPABILITIES] },
                });
                continue;
              }
              capabilities.push(capability);
            }
            policy = { network: { allow: capabilities } };
          }
        }
      }
      for (const key of Object.keys(policyValue)) {
        if (key !== 'network') {
          bag.add({
            code: 'SPEC_VALIDATION_ERROR',
            path: pathKey('$.policy', key),
            message: `unknown policy field "${key}"`,
            details: { allowed: ['network'] },
          });
        }
      }
    }
  }

  const stateValue = document.state;
  const state: Record<string, JsonValue> = {};
  if (stateValue !== undefined) {
    if (!isPlainObject(stateValue)) {
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: '$.state',
        message: 'expected a state object',
      });
    } else {
      for (const [key, value] of Object.entries(stateValue)) {
        if (typeof value === 'object' && value !== null) {
          bag.add({
            code: 'SPEC_VALIDATION_ERROR',
            path: pathKey('$.state', key),
            message: 'state values must be a string, number, boolean, or null',
          });
          continue;
        }
        state[key] = value as JsonValue;
      }
    }
  }

  const blocks = document.blocks;
  if (!Array.isArray(blocks) || blocks.length === 0) {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path: '$.blocks',
      message: 'expected a non-empty array of blocks',
    });
    return undefined;
  }

  return {
    meta: {
      title: title ?? 'Untitled page',
      locale,
      ...(description === undefined ? {} : { description }),
      ...(slug === undefined ? {} : { slug }),
    },
    theme,
    policy,
    state,
    blocks,
  };
}

interface NodeIdResolution {
  id: string;
  authorSupplied: boolean;
}

function resolveNodeId(
  definition: BlockDefinition,
  authorId: unknown,
  path: string,
  context: BuildContext,
): NodeIdResolution {
  if (authorId !== undefined) {
    if (typeof authorId !== 'string' || !NODE_ID_PATTERN.test(authorId)) {
      context.bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: pathKey(path, 'id'),
        message: `"${String(authorId)}" is not a valid id (lowercase letters, digits and dashes, 64 max)`,
      });
    } else if (context.usedIds.has(authorId)) {
      context.bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: pathKey(path, 'id'),
        message: `duplicate node id "${authorId}"`,
      });
    } else {
      context.usedIds.add(authorId);
      return { id: authorId, authorSupplied: true };
    }
  }

  const base = derivedNodeId(definition.type, path);
  let candidate = base;
  let suffix = 2;
  while (context.usedIds.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  context.usedIds.add(candidate);
  return { id: candidate, authorSupplied: false };
}

function buildNode(
  entry: unknown,
  parentId: string | null,
  depth: number,
  path: string,
  context: BuildContext,
): string | undefined {
  if (!isPlainObject(entry)) {
    context.bag.add({ code: 'SPEC_VALIDATION_ERROR', path, message: 'expected a block object' });
    return undefined;
  }

  const typeValue = entry.type;
  if (typeof typeValue !== 'string') {
    context.bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path: pathKey(path, 'type'),
      message: 'each block requires a "type"',
    });
    return undefined;
  }

  const definition = getBlockDefinition(typeValue);
  if (definition === undefined) {
    context.bag.add({
      code: 'SPEC_UNKNOWN_BLOCK',
      path: pathKey(path, 'type'),
      message: `unknown block type "${typeValue}"`,
      details: { type: typeValue, known: blockTypes() },
    });
    return undefined;
  }

  const childSlot = definition.slots?.children;
  const rawProps: Record<string, unknown> = {};
  let childBlocks: unknown;
  for (const [key, value] of Object.entries(entry)) {
    if (key === 'type') continue;
    if (key === 'blocks') {
      childBlocks = value;
      continue;
    }
    rawProps[key] = value;
  }
  if (childBlocks !== undefined && childSlot === undefined) {
    context.bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path: pathKey(path, 'blocks'),
      message: `block type "${typeValue}" does not accept child blocks`,
    });
  }

  const resolved = resolveNodeId(definition, entry.id, path, context);
  const validated = validateProps(definition.props, rawProps, path, context.bag);
  const withBindings = validateBindingsDeep(validated, path, context.bag);
  const props = (isPlainObject(withBindings) ? withBindings : {}) as Record<string, JsonValue>;
  const rawBindings = props.on;
  const bindings: BindingMap = isPlainObject(rawBindings)
    ? (rawBindings as unknown as BindingMap)
    : {};
  if (rawBindings !== undefined) delete props.on;

  const node: IrNode = {
    id: resolved.id,
    type: definition.type,
    typeVersion: definition.version,
    kind: definition.kind,
    path,
    parentId,
    depth,
    props,
    bindings,
    children: [],
    a11y: definition.a11y,
    runtimeFeatures: [...definition.runtimeFeatures] as RuntimeFeature[],
    assets: [...definition.assets],
    network: definition.network,
  };
  context.nodes.push(node);

  if (childSlot !== undefined && childBlocks !== undefined) {
    if (!Array.isArray(childBlocks)) {
      context.bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: pathKey(path, 'blocks'),
        message: 'expected an array of child blocks',
      });
    } else {
      const min = childSlot.min ?? 0;
      const max = childSlot.max ?? Number.MAX_SAFE_INTEGER;
      if (childBlocks.length < min || childBlocks.length > max) {
        context.bag.add({
          code: 'SPEC_VALIDATION_ERROR',
          path: pathKey(path, 'blocks'),
          message: `slot accepts ${min}-${max} child blocks, received ${childBlocks.length}`,
        });
      }
      const childPath = pathKey(path, 'blocks');
      for (let index = 0; index < childBlocks.length; index += 1) {
        const childId = buildNode(
          childBlocks[index],
          resolved.id,
          depth + 1,
          pathIndex(childPath, index),
          context,
        );
        if (childId !== undefined) node.children.push(childId);
      }
    }
  }

  return resolved.id;
}

function numberProp(node: IrNode, key: string): number | undefined {
  const value = node.props[key];
  return typeof value === 'number' ? value : undefined;
}

function stringProp(node: IrNode, key: string): string | undefined {
  const value = node.props[key];
  return typeof value === 'string' ? value : undefined;
}

/** Checks that need more than one field, or more than one node. */
function postChecks(nodes: IrNode[], bag: DiagnosticBag): void {
  let previousHeadingLevel: number | undefined;

  for (const node of nodes) {
    if (node.type === 'heading') {
      const level = numberProp(node, 'level') ?? 2;
      if (previousHeadingLevel === undefined && level > 1) {
        bag.add({
          code: 'SPEC_VALIDATION_ERROR',
          severity: 'warning',
          message: 'the first heading is not a level-1 heading',
          path: node.path,
          nodeId: node.id,
        });
      } else if (previousHeadingLevel !== undefined && level > previousHeadingLevel + 1) {
        bag.add({
          code: 'SPEC_VALIDATION_ERROR',
          severity: 'warning',
          message: `heading level jumps from ${previousHeadingLevel} to ${level}`,
          path: node.path,
          nodeId: node.id,
        });
      }
      previousHeadingLevel = level;
      continue;
    }

    if (node.type === 'slider') {
      const min = numberProp(node, 'min') ?? 0;
      const max = numberProp(node, 'max') ?? 100;
      const step = numberProp(node, 'step') ?? 1;
      if (max <= min) {
        bag.add({
          code: 'SPEC_VALIDATION_ERROR',
          message: `slider max (${max}) must be greater than min (${min})`,
          path: pathKey(node.path, 'max'),
          nodeId: node.id,
        });
      }
      if (step > max - min) {
        bag.add({
          code: 'SPEC_VALIDATION_ERROR',
          message: `slider step (${step}) is larger than its range (${max - min})`,
          path: pathKey(node.path, 'step'),
          nodeId: node.id,
        });
      }
    }

    if (node.type === 'table') {
      const columns = node.props.columns;
      const rows = node.props.rows;
      if (Array.isArray(columns) && Array.isArray(rows)) {
        for (let index = 0; index < rows.length; index += 1) {
          const row = rows[index];
          if (Array.isArray(row) && row.length !== columns.length) {
            bag.add({
              code: 'SPEC_VALIDATION_ERROR',
              severity: 'warning',
              message: `row has ${row.length} cells but the table declares ${columns.length} columns`,
              path: pathIndex(pathKey(node.path, 'rows'), index),
              nodeId: node.id,
            });
          }
        }
      }
    }

    if (node.type === 'chart' || node.type === 'progress') {
      const labels = node.props.labels;
      const series = node.props.series;
      if (Array.isArray(labels) && Array.isArray(series)) {
        for (let index = 0; index < series.length; index += 1) {
          const entry = series[index];
          if (!isPlainObject(entry)) continue;
          const values = entry.values;
          if (Array.isArray(values) && values.length !== labels.length) {
            bag.add({
              code: 'SPEC_VALIDATION_ERROR',
              severity: 'warning',
              message: `series "${String(entry.label ?? index)}" has ${values.length} values for ${labels.length} labels`,
              path: pathIndex(pathKey(node.path, 'series'), index),
              nodeId: node.id,
            });
          }
        }
      }
    }

    if (node.type === 'button' && Object.keys(node.bindings).length === 0) {
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        severity: 'warning',
        message: 'button declares no action bindings and will render inert',
        path: node.path,
        nodeId: node.id,
      });
    }

    if (node.type === 'link') {
      const href = stringProp(node, 'href');
      if (href?.startsWith('http://')) {
        bag.add({
          code: 'POLICY_VIOLATION',
          severity: 'warning',
          message: 'insecure http:// link',
          path: pathKey(node.path, 'href'),
          nodeId: node.id,
        });
      }
    }

    if (node.type === 'diagram-panel') {
      const spec = node.props.spec;
      if (!isPlainObject(spec)) {
        bag.add({
          code: 'SPEC_VALIDATION_ERROR',
          message: 'diagram spec must be an object',
          path: pathKey(node.path, 'spec'),
          nodeId: node.id,
        });
      }
    }
  }
}

/** Build the IR without throwing: diagnostics are returned, not raised. */
export function normalizeSpec(input: unknown, options: ParseOptions = {}): NormalizeResult {
  const bag = new DiagnosticBag();

  // The pipeline starts at the input boundary: a spec may arrive as JSON or
  // YAML text, or as an already-parsed object.
  let document: unknown = input;
  if (typeof input === 'string') {
    try {
      document = parseSpec(input, options);
    } catch (error) {
      if (isRenderError(error)) {
        bag.add({
          code: error.code,
          path: error.path ?? '$',
          message: error.message,
        });
        return { ir: emptyIr(), diagnostics: bag.list(), bounds: emptyBounds() };
      }
      throw error;
    }
  }

  const bounds = checkBounds(document, bag);
  scanForbiddenKeys(document, bag);
  const migrated = migrateSpec(document, bag);
  if (migrated === undefined) {
    return { ir: emptyIr(), diagnostics: bag.list(), bounds };
  }

  const envelope = normalizeEnvelope(migrated.document, bag);
  const context: BuildContext = { bag, nodes: [], usedIds: new Set<string>() };
  const rootChildren: string[] = [];

  if (envelope !== undefined) {
    for (let index = 0; index < envelope.blocks.length; index += 1) {
      const childId = buildNode(
        envelope.blocks[index],
        'page',
        1,
        pathIndex('$.blocks', index),
        context,
      );
      if (childId !== undefined) rootChildren.push(childId);
    }
  }

  postChecks(context.nodes, bag);

  const root: IrNode = {
    id: 'page',
    type: 'page',
    typeVersion: 1,
    kind: 'semantic',
    path: '$',
    parentId: null,
    depth: 0,
    props: envelope === undefined ? {} : { title: envelope.meta.title },
    bindings: {},
    children: rootChildren,
    a11y: 'Emits one main landmark, a document title, and a language attribute.',
    runtimeFeatures: [],
    assets: [],
    network: 'none',
  };

  const ir: IrDocument = {
    irVersion: 1,
    specVersion: migrated.originalVersion === 0 ? 1 : migrated.originalVersion,
    compilerVersion: VERSION,
    meta: envelope?.meta ?? { title: 'Untitled page', locale: 'en' },
    theme: envelope?.theme ?? { preset: DEFAULT_THEME_PRESET },
    policy: envelope?.policy ?? { network: 'deny' },
    state: envelope?.state ?? {},
    rootId: root.id,
    nodes: [root, ...context.nodes],
    warnings: bag.warnings(),
  };

  return { ir, diagnostics: bag.list(), bounds };
}

function emptyBounds(): BoundsReport {
  return { blocks: 0, nodes: 0, depth: 0, bytes: 0, longestString: 0, largestList: 0 };
}

function emptyIr(): IrDocument {
  return {
    irVersion: 1,
    specVersion: 1,
    compilerVersion: VERSION,
    meta: { title: 'Untitled page', locale: 'en' },
    theme: { preset: DEFAULT_THEME_PRESET },
    policy: { network: 'deny' },
    state: {},
    rootId: 'page',
    nodes: [],
    warnings: [],
  };
}

/**
 * Normalize or throw.
 *
 * The thrown error carries the first error's code and path, and lists every
 * diagnostic in `details.diagnostics` so a caller can render a full report.
 */
export function normalize(input: unknown, options: ParseOptions = {}): IrDocument {
  const result = normalizeSpec(input, options);
  const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  const first = errors[0];
  if (first !== undefined) {
    throw new RenderError(first.code, first.message, {
      path: first.path,
      ...(first.nodeId === undefined ? {} : { nodeId: first.nodeId }),
      // Keep the first error's own details usable (`allowed`, `scheme`, ...)
      // and attach the full ordered report alongside them.
      details: { ...(first.details ?? {}), diagnostics: errors },
    });
  }
  return result.ir;
}
