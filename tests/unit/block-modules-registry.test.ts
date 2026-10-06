import { describe, expect, it } from 'vitest';
import { BLOCK_GROUPS } from '../../src/blocks/index.js';
import {
  BLOCK_CATEGORIES,
  type BlockGroup,
  type BlockModule,
  type FeatureModule,
} from '../../src/registry/block-module.js';
import {
  blocks,
  define,
  itemsOf,
  list,
  OPTIONAL_TITLE,
  obj,
} from '../../src/registry/define-helpers.js';
import { propSchemaToJsonSchema } from '../../src/registry/prop-schema.js';
import { BLOCK_DEFINITIONS, buildRegistry, DEFAULT_REGISTRY } from '../../src/registry/registry.js';

function probe(type: string, overrides: Partial<BlockModule['definition']> = {}): BlockModule {
  return {
    definition: define({
      type,
      category: 'content',
      tags: ['probe'],
      useCases: ['registry test'],
      purpose: 'Registry probe.',
      summary: 'Probe block.',
      props: { title: OPTIONAL_TITLE },
      ...overrides,
    }),
    render: () => '<div></div>',
  };
}

const FEATURE: FeatureModule = {
  name: 'probe',
  marker: '.ak-probe',
  css: '.ak-probe{display:block}',
};

function group(blocks: BlockModule[], features: FeatureModule[] = []): BlockGroup {
  return { name: 'probe', blocks, features };
}

describe('block registry', () => {
  it('registers every built-in block once, core roster first', () => {
    const types = BLOCK_DEFINITIONS.map((definition) => definition.type);
    expect(new Set(types).size).toBe(types.length);
    expect(types[0]).toBe('page');
    for (const blockGroup of BLOCK_GROUPS) {
      for (const module of blockGroup.blocks) {
        expect(DEFAULT_REGISTRY.modules.get(module.definition.type)).toBe(module);
      }
    }
  });

  it('gives every block a category, tags and use cases within bounds', () => {
    for (const definition of BLOCK_DEFINITIONS) {
      expect(BLOCK_CATEGORIES, definition.type).toContain(definition.category);
      expect(definition.tags.length, definition.type).toBeLessThanOrEqual(6);
      expect(definition.useCases.length, definition.type).toBeLessThanOrEqual(4);
      expect(definition.useCases.length, definition.type).toBeGreaterThan(0);
    }
  });

  it('accepts a valid group and appends it after the built-ins', () => {
    const registry = buildRegistry([...BLOCK_GROUPS, group([probe('probe')], [FEATURE])]);
    expect(registry.definitions.at(-1)?.type).toBe('probe');
    expect(registry.features).toEqual([FEATURE]);
  });

  it('rejects a duplicate block type', () => {
    expect(() => buildRegistry([group([probe('heading')])])).toThrow(
      /"heading" is registered twice/,
    );
    expect(() => buildRegistry([group([probe('probe'), probe('probe')])])).toThrow(
      /registered twice/,
    );
  });

  it('rejects a duplicate feature, including a core one', () => {
    expect(() => buildRegistry([group([], [FEATURE, FEATURE])])).toThrow(
      /"probe" is registered twice/,
    );
    expect(() =>
      buildRegistry([group([], [{ ...FEATURE, name: 'tabs', marker: '.ak-probe' }])]),
    ).toThrow(/"tabs" is registered twice/);
  });

  it('rejects a feature whose css lacks its marker', () => {
    expect(() => buildRegistry([group([], [{ ...FEATURE, css: '.ak-other{}' }])])).toThrow(
      /does not contain its marker/,
    );
  });

  it('rejects a block that names an unknown feature or parent', () => {
    expect(() => buildRegistry([group([probe('probe', { runtimeFeatures: ['nope'] })])])).toThrow(
      /unknown feature "nope"/,
    );
    expect(() => buildRegistry([group([probe('probe', { parents: ['nowhere'] })])])).toThrow(
      /unknown parent "nowhere"/,
    );
  });

  it('rejects invalid catalog metadata', () => {
    expect(() => buildRegistry([group([probe('probe', { tags: ['Not Kebab'] })])])).toThrow(/tags/);
    expect(() =>
      buildRegistry([group([probe('probe', { tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })])]),
    ).toThrow(/tags/);
    expect(() => buildRegistry([group([probe('probe', { useCases: ['x'.repeat(41)] })])])).toThrow(
      /use cases/,
    );
    expect(() =>
      buildRegistry([
        group([
          probe('probe', { category: 'misc' as unknown as BlockModule['definition']['category'] }),
        ]),
      ]),
    ).toThrow(/unknown category/);
  });

  it('allows blocks props only at the top level or as a list item field', () => {
    const at = (props: BlockModule['definition']['props']) =>
      buildRegistry([group([probe('probe', { props })])]);
    expect(() => at({ aside: blocks() })).not.toThrow();
    expect(() => at({ items: itemsOf({ blocks: blocks() }) })).not.toThrow();
    expect(() => at({ blocks: blocks() })).toThrow(/blocks prop at "blocks"/);
    expect(() => at({ box: obj({ inner: blocks() }) })).toThrow(/blocks prop at "box"/);
    expect(() => at({ items: itemsOf({ deep: list(blocks()) }) })).toThrow(/"items\[\]\.deep"/);
    expect(() => at({ aside: blocks({ accepts: ['nope'] }) })).toThrow(
      /accepts unknown type "nope"/,
    );
  });

  it('projects a blocks prop to a JSON Schema list of blocks', () => {
    expect(propSchemaToJsonSchema(blocks({ maxItems: 6 }))).toEqual({
      type: 'array',
      minItems: 1,
      maxItems: 6,
      items: { $ref: '#/$defs/block' },
    });
  });
});
