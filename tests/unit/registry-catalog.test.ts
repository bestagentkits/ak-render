import { describe, expect, it } from 'vitest';
import { isRenderError, type RenderError } from '../../src/index.js';
import { getAction, listActionTypes } from '../../src/registry/actions.js';
import { blockTypes, catalog, describe as describeBlock } from '../../src/registry/registry.js';
import { BLOCK_DEFINITIONS } from '../../src/registry/roster.js';

describe('catalog and describe', () => {
  it('keeps the catalog compact: names, kinds, versions, and one-line summaries', () => {
    const listing = catalog();
    expect(listing.schemaVersion).toBe(1);
    expect(listing.blockCount).toBe(BLOCK_DEFINITIONS.length);
    expect(listing.blocks).toHaveLength(BLOCK_DEFINITIONS.length);

    const entry = listing.blocks.find((block) => block.type === 'carousel');
    expect(entry).toEqual({
      type: 'carousel',
      kind: 'primitive',
      version: 1,
      summary: 'Carousel: prev/next, keyboard, and swipe across slides.',
    });
    // The compact surface must not leak full contracts into model context.
    expect(Object.keys(entry ?? {})).toEqual(['type', 'kind', 'version', 'summary']);
  });

  it('lists the closed action vocabulary with summaries', () => {
    const listing = catalog();
    expect(listing.actions.map((action) => action.type)).toEqual(listActionTypes());
    expect(listing.actions).toHaveLength(12);
    for (const action of listing.actions) {
      expect(action.summary.length).toBeGreaterThan(10);
    }
  });

  it('describes a block with its full machine-readable contract', () => {
    const contract = describeBlock('carousel');
    expect(contract.type).toBe('carousel');
    expect(contract.version).toBe(1);
    expect(contract.purpose).toContain('Sequenced slides');
    expect(contract.props.ariaLabel?.required).toBe(true);
    expect(contract.runtimeFeatures).toEqual(['carousel']);
    expect(contract.actions).toEqual(expect.arrayContaining(['next', 'previous']));
    expect(contract.a11y).toContain('arrow-key');
    expect(contract.sizing.sizes.length).toBeGreaterThan(0);
    expect(contract.migration.length).toBeGreaterThan(10);
    expect(contract.serializer.length).toBeGreaterThan(10);
  });

  it('returns a copy so a caller cannot mutate the registry', () => {
    const first = describeBlock('text');
    const textProp = first.props.text;
    expect(textProp).toBeDefined();
    if (textProp === undefined) throw new Error('text block is missing its text prop');
    textProp.required = false;
    const second = describeBlock('text');
    expect(second.props.text?.required).toBe(true);
  });

  it('fails loudly for an unknown type instead of returning undefined', () => {
    try {
      describeBlock('nope');
      throw new Error('expected an error');
    } catch (error) {
      expect(isRenderError(error)).toBe(true);
      expect((error as RenderError).code).toBe('SPEC_UNKNOWN_BLOCK');
      expect((error as RenderError).details?.known).toContain('hero');
    }
  });

  it('registers every block type exactly once', () => {
    const types = blockTypes();
    expect(new Set(types).size).toBe(types.length);
  });

  it('gives every block the contract fields the issue requires', () => {
    for (const definition of BLOCK_DEFINITIONS) {
      expect(definition.type).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(definition.version).toBeGreaterThanOrEqual(1);
      expect(definition.purpose.length).toBeGreaterThan(10);
      expect(definition.summary.length).toBeGreaterThan(10);
      expect(definition.a11y.length).toBeGreaterThan(10);
      expect(definition.sizing.sizes.length).toBeGreaterThan(0);
      expect(definition.sizing.responsive.length).toBeGreaterThan(10);
      expect(definition.migration.length).toBeGreaterThan(10);
      expect(definition.serializer.length).toBeGreaterThan(10);
      expect(['none', 'optional']).toContain(definition.network);
    }
  });

  it('only references declared actions from block contracts', () => {
    for (const definition of BLOCK_DEFINITIONS) {
      for (const action of definition.actions) {
        expect(getAction(action)).toBeDefined();
      }
    }
  });

  it('declares a slot contract for every block that accepts children', () => {
    for (const definition of BLOCK_DEFINITIONS) {
      if (definition.slots === undefined) continue;
      for (const slot of Object.values(definition.slots)) {
        expect(slot.max ?? 0).toBeGreaterThanOrEqual(slot.min ?? 0);
      }
    }
  });

  it('marks the escape-hatch blocks as primitives and the intent blocks as semantic', () => {
    const byType = new Map(BLOCK_DEFINITIONS.map((definition) => [definition.type, definition]));
    for (const type of ['hero', 'stats', 'steps', 'timeline', 'callout', 'comparison']) {
      expect(byType.get(type)?.kind).toBe('semantic');
    }
    for (const type of ['stack', 'grid', 'spacer', 'divider', 'heading', 'table']) {
      expect(byType.get(type)?.kind).toBe('primitive');
    }
  });
});
