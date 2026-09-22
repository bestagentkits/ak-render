import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compile, isRenderError, type RenderError } from '../../src/index.js';
import { blockTypes, getBlockDefinition } from '../../src/registry/registry.js';
import { CHART_KINDS } from '../../src/registry/roster.js';

const rejectedDir = fileURLToPath(new URL('../../fixtures/rejected', import.meta.url));
const rejected = readdirSync(rejectedDir).filter((name) => name.endsWith('.yaml'));

/**
 * The initial widget coverage the epic names, grouped the way the issue groups
 * it. This is a completeness check on the catalog: a category that loses its
 * block fails here rather than being discovered by an author.
 */
const ISSUE_CATALOG: Record<string, readonly string[]> = {
  layout: ['page', 'section', 'stack', 'grid', 'split', 'spacer', 'divider'],
  typography: ['heading', 'text', 'rich-text', 'quote', 'code', 'badge', 'kbd', 'key-value'],
  information: ['card', 'alert', 'callout', 'stats', 'progress', 'steps', 'timeline'],
  collections: ['list', 'table', 'tabs', 'accordion', 'carousel', 'gallery'],
  media: ['image', 'video', 'audio'],
};

describe('issue catalog coverage', () => {
  const available = new Set(blockTypes());

  for (const [group, types] of Object.entries(ISSUE_CATALOG)) {
    it(`covers every ${group} block`, () => {
      const missing = types.filter((type) => !available.has(type));
      expect(missing).toEqual([]);
    });
  }

  it('covers every named chart kind', () => {
    expect([...CHART_KINDS].sort()).toEqual([
      'area',
      'bar',
      'donut',
      'line',
      'pie',
      'progress',
      'sparkline',
    ]);
  });

  it('exposes a diagram panel for the adapter path', () => {
    expect(available.has('diagram-panel')).toBe(true);
    const definition = getBlockDefinition('diagram-panel');
    expect(definition?.kind).toBe('semantic');
    expect(definition?.summary).toMatch(/adapter/u);
  });

  it('declares the network capability of every media block honestly', () => {
    for (const type of ['image', 'gallery', 'video', 'audio']) {
      expect(getBlockDefinition(type)?.network, type).toBe('optional');
    }
    // A chart draws locally; it must never claim a network capability.
    expect(getBlockDefinition('chart')?.network).toBe('none');
  });
});

describe('injection fixtures are rejected', () => {
  it('has at least one rejected fixture', () => {
    expect(rejected.length).toBeGreaterThan(0);
  });

  for (const fixture of rejected) {
    it(`rejects ${fixture}`, () => {
      const source = readFileSync(`${rejectedDir}/${fixture}`, 'utf8');
      try {
        const result = compile(source, { source: fixture });
        throw new Error(`expected a rejection, but compiled ${result.bytes} bytes`);
      } catch (error) {
        expect(isRenderError(error), fixture).toBe(true);
        expect((error as RenderError).code, fixture).toBe('POLICY_VIOLATION');
        expect((error as RenderError).path, fixture).toMatch(/\$/u);
      }
    });
  }

  it('names the offending key in the diagnostic', () => {
    const source = readFileSync(`${rejectedDir}/arbitrary-iframe.yaml`, 'utf8');
    try {
      compile(source);
      throw new Error('expected a rejection');
    } catch (error) {
      const message = (error as RenderError).message.toLowerCase();
      expect(message).toMatch(/iframe|forbidden/u);
    }
  });

  it('never emits an iframe even for a spec that asks for one', () => {
    // A page cannot contain a frame, so there is no code path that could accept
    // the fixture: this asserts the rejection is structural, not incidental.
    const source = readFileSync(`${rejectedDir}/arbitrary-iframe.yaml`, 'utf8');
    expect(() => compile(source)).toThrowError();
    expect(source).toContain('<iframe');
  });
});
