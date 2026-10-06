/**
 * Registry assembly and registration checks.
 *
 * A block group is code, not spec input, so a mistake in one is a programming
 * error: `buildRegistry` throws at load instead of reporting a diagnostic, and
 * the default registry is built when the module loads, so a broken group fails
 * every test rather than one page.
 */

import type { BlockGroup, BlockModule, BlockRegistry, FeatureModule } from './block-module.js';
import { type BlockDefinition, CORE_BLOCK_DEFINITIONS, CORE_RUNTIME_FEATURES } from './roster.js';

const FEATURE_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

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

function checkDefinition(definition: BlockDefinition, features: Set<string>): void {
  for (const feature of definition.runtimeFeatures) {
    if (!features.has(feature)) {
      throw registrationError(`block "${definition.type}" uses unknown feature "${feature}"`);
    }
  }
}

/**
 * Assemble a registry from the core roster plus block groups, in order.
 * Throws on a duplicate block type or feature, a block that names an unknown
 * feature, or a feature whose css lacks its marker.
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

  return { definitions, byType, modules, features };
}
