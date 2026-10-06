/**
 * Registry assembly and registration checks.
 *
 * A block group is code, not spec input, so a mistake in one is a programming
 * error: `buildRegistry` throws at load instead of reporting a diagnostic, and
 * the default registry is built when the module loads, so a broken group fails
 * every test rather than one page.
 */

import {
  BLOCK_CATEGORIES,
  type BlockGroup,
  type BlockModule,
  type BlockRegistry,
  type FeatureModule,
} from './block-module.js';
import type { PropSchema } from './prop-schema.js';
import { type BlockDefinition, CORE_BLOCK_DEFINITIONS, CORE_RUNTIME_FEATURES } from './roster.js';

const FEATURE_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const TAG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const METADATA_LIMITS = { tags: 6, useCases: 4, useCaseLength: 40 } as const;

function registrationError(message: string): Error {
  return new Error(`block registry: ${message}`);
}

function checkFeature(feature: FeatureModule, known: Set<string>): void {
  if (!FEATURE_NAME_PATTERN.test(feature.name)) {
    throw registrationError(`feature "${feature.name}" is not a kebab-case name`);
  }
  if (known.has(feature.name)) {
    throw registrationError(`feature "${feature.name}" is registered twice`);
  }
  if (feature.marker === '' || !feature.css.includes(feature.marker)) {
    throw registrationError(
      `feature "${feature.name}" css does not contain its marker "${feature.marker}"`,
    );
  }
  known.add(feature.name);
}

function checkMetadata(definition: BlockDefinition): void {
  const { type, category, tags, useCases } = definition;
  if (!BLOCK_CATEGORIES.includes(category)) {
    throw registrationError(`block "${type}" has unknown category "${String(category)}"`);
  }
  if (tags.length > METADATA_LIMITS.tags || tags.some((tag) => !TAG_PATTERN.test(tag))) {
    throw registrationError(
      `block "${type}" needs at most ${METADATA_LIMITS.tags} kebab-case tags`,
    );
  }
  if (
    useCases.length > METADATA_LIMITS.useCases ||
    useCases.some((useCase) => useCase === '' || useCase.length > METADATA_LIMITS.useCaseLength)
  ) {
    throw registrationError(
      `block "${type}" needs at most ${METADATA_LIMITS.useCases} use cases of 1-${METADATA_LIMITS.useCaseLength} characters`,
    );
  }
}

function containsBlocks(schema: PropSchema): boolean {
  switch (schema.kind) {
    case 'blocks':
      return true;
    case 'list':
    case 'record':
      return containsBlocks(schema.of);
    case 'object':
      return Object.values(schema.fields).some(containsBlocks);
    case 'oneOf':
      return schema.options.some(containsBlocks);
    default:
      return false;
  }
}

/**
 * A `blocks` prop may sit at the top level of a block's props or as a field of
 * a `list(obj(...))` prop, and nowhere deeper: the slot key and the IR path
 * have exactly those two shapes. `blocks` itself is the child-slot key.
 */
function checkSlotPositions(definition: BlockDefinition): void {
  const reject = (key: string): never => {
    throw registrationError(
      `block "${definition.type}" places a blocks prop at "${key}"; only a top-level prop or a field of a list of objects may hold blocks`,
    );
  };
  for (const [key, prop] of Object.entries(definition.props)) {
    if (prop.kind === 'blocks') {
      if (key === 'blocks') reject(key);
      continue;
    }
    if (prop.kind === 'list' && prop.of.kind === 'object') {
      for (const [field, schema] of Object.entries(prop.of.fields)) {
        if (schema.kind !== 'blocks' && containsBlocks(schema)) reject(`${key}[].${field}`);
      }
      continue;
    }
    if (containsBlocks(prop)) reject(key);
  }
}

/** Every `accepts` list of a definition's `blocks` props, top-level and in list items. */
function slotAccepts(definition: BlockDefinition): (readonly string[])[] {
  const lists: (readonly string[])[] = [];
  const add = (schema: PropSchema): void => {
    if (schema.kind === 'blocks' && Array.isArray(schema.accepts)) lists.push(schema.accepts);
  };
  for (const prop of Object.values(definition.props)) {
    add(prop);
    if (prop.kind === 'list' && prop.of.kind === 'object')
      Object.values(prop.of.fields).forEach(add);
  }
  const children = definition.slots?.children?.accepts;
  if (Array.isArray(children)) lists.push(children);
  return lists;
}

function checkDefinition(definition: BlockDefinition, features: Set<string>): void {
  checkMetadata(definition);
  checkSlotPositions(definition);
  for (const feature of definition.runtimeFeatures) {
    if (!features.has(feature)) {
      throw registrationError(`block "${definition.type}" uses unknown feature "${feature}"`);
    }
  }
}

/**
 * Assemble a registry from the core roster plus block groups, in order.
 * Throws on a duplicate block type or feature, a block that names an unknown
 * feature, parent or accepted type, a `blocks` prop in an unsupported
 * position, invalid catalog metadata, or a feature whose css lacks its marker.
 */
export function buildRegistry(groups: readonly BlockGroup[]): BlockRegistry {
  const featureNames = new Set<string>(CORE_RUNTIME_FEATURES);
  const features: FeatureModule[] = [];
  for (const group of groups) {
    for (const feature of group.features) {
      checkFeature(feature, featureNames);
      features.push(feature);
    }
  }

  const definitions: BlockDefinition[] = [];
  const byType = new Map<string, BlockDefinition>();
  const modules = new Map<string, BlockModule>();
  const register = (definition: BlockDefinition, module?: BlockModule): void => {
    if (byType.has(definition.type)) {
      throw registrationError(`block type "${definition.type}" is registered twice`);
    }
    checkDefinition(definition, featureNames);
    definitions.push(definition);
    byType.set(definition.type, definition);
    if (module !== undefined) modules.set(definition.type, module);
  };
  for (const definition of CORE_BLOCK_DEFINITIONS) register(definition);
  for (const group of groups) {
    for (const module of group.blocks) register(module.definition, module);
  }

  // Parents may name a block registered later, so they are checked last.
  for (const definition of definitions) {
    for (const parent of definition.parents ?? []) {
      if (parent !== 'page' && !byType.has(parent)) {
        throw registrationError(`block "${definition.type}" names unknown parent "${parent}"`);
      }
    }
    for (const accepted of slotAccepts(definition).flat()) {
      if (!byType.has(accepted)) {
        throw registrationError(`block "${definition.type}" accepts unknown type "${accepted}"`);
      }
    }
  }

  return { definitions, byType, modules, features };
}
