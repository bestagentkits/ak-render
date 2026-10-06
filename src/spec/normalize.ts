/**
 * Normalizer: nested authoring Page Spec -> flat internal IR.
 *
 * The author-facing shape is optimized for authoring (nested, tolerant of
 * omission, semantic). The IR is optimized for the compiler (flat, ordered,
 * every node resolved). This module owns the crossing between them, including
 * stable node IDs, slot wiring, and the cross-field checks that a per-prop
 * schema cannot express.
 */

import { checkSeriesLengths } from '../blocks/chart/chart.js';
import type { DataRow } from '../data/dataset-types.js';
import { type BlockDataInput, resolveBlockData } from '../data/resolve-block-data.js';
import { validateDatasets } from '../data/validate-datasets.js';
import { type Diagnostic, DiagnosticBag, pathIndex, pathKey } from '../diagnostics.js';
import { isRenderError, RenderError } from '../errors.js';
import { derivedNodeId } from '../hash.js';
import type { IrDocument, IrNode, IrTheme, NetworkPolicy } from '../ir.js';
import { isPlainObject, type JsonValue } from '../json.js';
import type { BlockRegistry, CheckContext } from '../registry/block-module.js';
import { NODE_ID_PATTERN, validateProps } from '../registry/prop-schema.js';
import { blockTypes, DEFAULT_REGISTRY, getBlockDefinition } from '../registry/registry.js';
import type { BlockDefinition, RuntimeFeature } from '../registry/roster.js';
import { slotKey } from '../render/render-context.js';
import { validateThemeRecipes } from '../theme/recipes.js';
import { VERSION } from '../version.js';
import { assetAllowed, assetReferences } from './asset-references.js';
import { type BindingMap, validateBindingsDeep } from './bindings.js';
import { type BoundsReport, checkBounds, LIMITS } from './bounds.js';
import { validateCondition } from './conditions.js';
import { scanForbiddenKeys } from './forbidden.js';
import { migrateSpec } from './migrate.js';
import { blockedReason } from './network-policy.js';
import { type ParseOptions, parseSpec } from './parse.js';
import { EMBED_PROVIDER_NAMES, isEmbedProvider } from './providers.js';

export interface NormalizeResult {
  ir: IrDocument;
  diagnostics: Diagnostic[];
  bounds: BoundsReport;
}

const THEME_PRESET_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LOCALE_PATTERN = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const DEFAULT_THEME_PRESET = 'editorial';
const THEME_FIELDS: readonly string[] = ['preset', 'extends', 'tokens', 'dark', 'recipes'];
export const NETWORK_CAPABILITIES = ['media', 'fonts', 'images'] as const;

interface BuildContext {
  bag: DiagnosticBag;
  nodes: IrNode[];
  usedIds: Set<string>;
  registry: BlockRegistry;
  state: Record<string, JsonValue>;
  datasets: Record<string, DataRow[]>;
}

export interface NormalizeOptions extends ParseOptions {
  /** Internal: the block registry to normalize against. Defaults to the built-in one. */
  registry?: BlockRegistry;
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
  datasets: Record<string, DataRow[]>;
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
      for (const key of ['tokens', 'dark'] as const) {
        const tokens = themeValue[key];
        if (tokens === undefined) continue;
        if (!isPlainObject(tokens)) {
          bag.add({
            code: 'SPEC_VALIDATION_ERROR',
            path: pathKey('$.theme', key),
            message: 'expected a token object',
          });
        } else {
          // Token names and values are checked when the theme resolves.
          theme[key] = tokens as JsonValue;
        }
      }
      if (themeValue.recipes !== undefined) {
        const recipes = validateThemeRecipes(themeValue.recipes, '$.theme.recipes', bag);
        if (Object.keys(recipes).length > 0) theme.recipes = recipes;
      }
      for (const key of Object.keys(themeValue)) {
        if (!THEME_FIELDS.includes(key)) {
          bag.add({
            code: 'SPEC_VALIDATION_ERROR',
            path: pathKey('$.theme', key),
            message: `unknown theme field "${key}"`,
            details: { allowed: [...THEME_FIELDS] },
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
            // A provider list is the second, narrower gate for remote media:
            // declaring providers means only those hosts may be referenced.
            const providerValue = network.providers;
            const providers: string[] = [];
            if (providerValue !== undefined) {
              if (!Array.isArray(providerValue) || providerValue.length === 0) {
                bag.add({
                  code: 'SPEC_VALIDATION_ERROR',
                  path: '$.policy.network.providers',
                  message: 'expected a non-empty list of provider names',
                  details: { allowed: [...EMBED_PROVIDER_NAMES] },
                });
              } else {
                for (let index = 0; index < providerValue.length; index += 1) {
                  const provider = providerValue[index];
                  if (typeof provider !== 'string' || !isEmbedProvider(provider)) {
                    bag.add({
                      code: 'POLICY_VIOLATION',
                      path: pathIndex('$.policy.network.providers', index),
                      message: `unknown media provider "${String(provider)}"`,
                      details: { allowed: [...EMBED_PROVIDER_NAMES] },
                    });
                    continue;
                  }
                  providers.push(provider);
                }
              }
            }
            for (const key of Object.keys(network)) {
              if (key !== 'allow' && key !== 'providers') {
                bag.add({
                  code: 'SPEC_VALIDATION_ERROR',
                  path: pathKey('$.policy.network', key),
                  message: `unknown network policy field "${key}"`,
                  details: { allowed: ['allow', 'providers'] },
                });
              }
            }
            policy =
              providers.length === 0
                ? { network: { allow: capabilities } }
                : { network: { allow: capabilities, providers } };
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

  const datasets = validateDatasets(document.datasets, '$.datasets', bag);

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
    datasets,
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

/** Envelope keys a data-bound block reads instead of props. */
const DATA_KEYS: readonly string[] = ['dataRef', 'data', 'transform'];

/** Where a block is being built: its parent's type and the slot's accepted types. */
interface Placement {
  parentType: string;
  accepts: readonly string[] | '*' | undefined;
}

/**
 * Enforce a slot's `accepts` list and the child's own `parents` list. Both are
 * reported at the child's `.type` path, with the allowed types.
 */
function checkPlacement(
  definition: BlockDefinition,
  placement: Placement,
  path: string,
  bag: DiagnosticBag,
): void {
  const { accepts, parentType } = placement;
  if (Array.isArray(accepts) && !accepts.includes(definition.type)) {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path: pathKey(path, 'type'),
      message: `"${parentType}" does not accept a "${definition.type}" block here`,
      details: { type: definition.type, allowed: [...accepts] },
    });
  }
  const parents = definition.parents;
  if (parents !== undefined && !parents.includes(parentType)) {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path: pathKey(path, 'type'),
      message: `a "${definition.type}" block must be placed directly inside ${parents
        .map((parent) => `"${parent}"`)
        .join(' or ')}`,
      details: { type: definition.type, allowed: [...parents] },
    });
  }
}

interface SlotList {
  key: string;
  path: string;
  entries: unknown[];
  accepts: readonly string[] | '*' | undefined;
}

/**
 * Nested slot lists in schema-key order, then item index. Only array values
 * are collected: a wrong shape was already reported by prop validation.
 */
function collectSlotLists(
  definition: BlockDefinition,
  rawProps: Record<string, unknown>,
  path: string,
): SlotList[] {
  const lists: SlotList[] = [];
  for (const [key, schema] of Object.entries(definition.props)) {
    const raw = rawProps[key];
    if (schema.kind === 'blocks') {
      if (Array.isArray(raw)) {
        lists.push({
          key: slotKey(key),
          path: pathKey(path, key),
          entries: raw,
          accepts: schema.accepts,
        });
      }
      continue;
    }
    if (schema.kind !== 'list' || schema.of.kind !== 'object' || !Array.isArray(raw)) continue;
    const fields = Object.entries(schema.of.fields).filter(([, field]) => field.kind === 'blocks');
    if (fields.length === 0) continue;
    raw.forEach((item, index) => {
      if (!isPlainObject(item)) return;
      for (const [field, fieldSchema] of fields) {
        const value = item[field];
        if (!Array.isArray(value) || fieldSchema.kind !== 'blocks') continue;
        lists.push({
          key: slotKey(key, index, field),
          path: pathKey(pathIndex(pathKey(path, key), index), field),
          entries: value,
          accepts: fieldSchema.accepts,
        });
      }
    });
  }
  return lists;
}

function buildNode(
  entry: unknown,
  parentId: string | null,
  depth: number,
  path: string,
  context: BuildContext,
  placement: Placement,
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

  const definition = getBlockDefinition(typeValue, context.registry);
  if (definition === undefined) {
    context.bag.add({
      code: 'SPEC_UNKNOWN_BLOCK',
      path: pathKey(path, 'type'),
      message: `unknown block type "${typeValue}"`,
      details: { type: typeValue, known: blockTypes(context.registry) },
    });
    return undefined;
  }
  checkPlacement(definition, placement, path, context.bag);

  const childSlot = definition.slots?.children;
  const rawProps: Record<string, unknown> = {};
  const dataInput: BlockDataInput = {};
  let childBlocks: unknown;
  let visibleWhen: unknown;
  for (const [key, value] of Object.entries(entry)) {
    if (key === 'type') continue;
    if (key === 'blocks') {
      childBlocks = value;
      continue;
    }
    if (key === 'visibleWhen') {
      visibleWhen = value;
      continue;
    }
    if (definition.data !== undefined && DATA_KEYS.includes(key)) {
      dataInput[key as keyof BlockDataInput] = value;
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
  if (visibleWhen !== undefined) {
    const condition = validateCondition(
      visibleWhen,
      pathKey(path, 'visibleWhen'),
      context.bag,
      context.state,
    );
    if (condition !== undefined) {
      node.when = condition;
      node.runtimeFeatures.push('state');
    }
  }
  if (definition.data !== undefined) {
    const data = resolveBlockData(dataInput, context.datasets, path, context.bag);
    if (data !== undefined) node.data = data;
    else if (
      definition.data.required &&
      dataInput.dataRef === undefined &&
      dataInput.data === undefined
    ) {
      context.bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: pathKey(path, 'dataRef'),
        message: `block type "${definition.type}" needs "dataRef" or "data"`,
        details: { known: Object.keys(context.datasets) },
      });
    }
  }
  context.nodes.push(node);

  const buildList = (entries: unknown[], listPath: string, accepts: Placement['accepts']) => {
    const ids: string[] = [];
    entries.forEach((child, index) => {
      const childId = buildNode(
        child,
        resolved.id,
        depth + 1,
        pathIndex(listPath, index),
        context,
        {
          parentType: definition.type,
          accepts,
        },
      );
      if (childId !== undefined) ids.push(childId);
    });
    return ids;
  };

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
      node.children = buildList(childBlocks, pathKey(path, 'blocks'), childSlot.accepts);
    }
  }

  // Nested slots are built after the children, so the IR stays depth-first
  // pre-order with every slot list in schema-key order, then item index.
  for (const list of collectSlotLists(definition, rawProps, path)) {
    const ids = buildList(list.entries, list.path, list.accepts);
    if (ids.length > 0) {
      node.slots ??= {};
      node.slots[list.key] = ids;
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
function postChecks(
  nodes: IrNode[],
  network: NetworkPolicy,
  bag: DiagnosticBag,
  registry: BlockRegistry,
  checks: CheckContext,
): void {
  let previousHeadingLevel: number | undefined;

  for (const node of nodes) {
    // A hero emits the document's <h1>, so a section heading that follows one is
    // measured against level 1 rather than treated as the first heading. Without
    // this, any hero-led page that also uses a heading block warns falsely.
    if (node.type === 'hero' && previousHeadingLevel === undefined) {
      previousHeadingLevel = 1;
    }

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

    // An asset with no visible fallback (a video poster) that the policy blocks
    // is reported here, at its own path, nested slots included, rather than
    // surfacing only after rendering as a page-level emitted-reference failure.
    const definition = registry.byType.get(node.type);
    const assets =
      definition === undefined ? [] : assetReferences(definition.props, node.props, node.path);
    for (const asset of assets) {
      if (!asset.rejectBlocked || assetAllowed(network, asset)) continue;
      bag.add({
        code: 'POLICY_VIOLATION',
        message: `remote ${asset.field} is not allowed because ${blockedReason(network, asset.capability)}; use a local ${asset.field} file or allow remote ${asset.capability} in policy.network`,
        path: asset.path,
        nodeId: node.id,
      });
    }

    // Progress shares the chart's labels/series shape; the chart module checks its own.
    if (node.type === 'progress') checkSeriesLengths(node, bag);

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

    if (node.type === 'hero' && stringProp(node, 'src') !== undefined) {
      if ((stringProp(node, 'alt') ?? '').trim() === '') {
        bag.add({
          code: 'SPEC_VALIDATION_ERROR',
          message: 'a hero with src needs alt text describing the shot',
          path: pathKey(node.path, 'alt'),
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

    registry.modules.get(node.type)?.check?.(node, checks);
  }
}

/** Build the IR without throwing: diagnostics are returned, not raised. */
export function normalizeSpec(input: unknown, options: NormalizeOptions = {}): NormalizeResult {
  const bag = new DiagnosticBag();
  const registry = options.registry ?? DEFAULT_REGISTRY;

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
  const context: BuildContext = {
    bag,
    nodes: [],
    usedIds: new Set<string>(),
    registry,
    state: envelope?.state ?? {},
    datasets: envelope?.datasets ?? {},
  };
  const rootChildren: string[] = [];

  if (envelope !== undefined) {
    for (let index = 0; index < envelope.blocks.length; index += 1) {
      const childId = buildNode(
        envelope.blocks[index],
        'page',
        1,
        pathIndex('$.blocks', index),
        context,
        { parentType: 'page', accepts: '*' },
      );
      if (childId !== undefined) rootChildren.push(childId);
    }
  }

  // The raw-document walk counts only lists under a `blocks` key. A slot prop
  // with another name is counted here, once its nodes exist.
  if (context.nodes.length > LIMITS.maxBlocks && bounds.blocks <= LIMITS.maxBlocks) {
    bag.add({
      code: 'SPEC_BOUNDS_ERROR',
      path: '$.blocks',
      message: `document declares more than ${LIMITS.maxBlocks} blocks`,
    });
  }

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
  const byId = new Map([root, ...context.nodes].map((node) => [node.id, node]));
  postChecks(context.nodes, envelope?.policy.network ?? 'deny', bag, registry, {
    bag,
    byId,
    state: context.state,
    datasets: context.datasets,
  });

  const ir: IrDocument = {
    irVersion: 1,
    specVersion: migrated.originalVersion === 0 ? 1 : migrated.originalVersion,
    compilerVersion: VERSION,
    meta: envelope?.meta ?? { title: 'Untitled page', locale: 'en' },
    theme: envelope?.theme ?? { preset: DEFAULT_THEME_PRESET },
    policy: envelope?.policy ?? { network: 'deny' },
    state: envelope?.state ?? {},
    datasets: context.datasets,
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
    datasets: {},
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
export function normalize(input: unknown, options: NormalizeOptions = {}): IrDocument {
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
