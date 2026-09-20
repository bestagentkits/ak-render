import { describe, expect, it } from 'vitest';
import { DiagnosticBag } from '../../src/diagnostics.js';
import { isRenderError, type RenderError } from '../../src/index.js';
import { checkBounds, LIMITS } from '../../src/spec/bounds.js';
import { migrateSpec, supportedVersions } from '../../src/spec/migrate.js';
import { parseSpec } from '../../src/spec/parse.js';

function bag(): DiagnosticBag {
  return new DiagnosticBag();
}

describe('input boundary', () => {
  it('parses JSON and YAML into the same document', () => {
    const json = parseSpec('{"version":1,"meta":{"title":"T"},"blocks":[]}');
    const yaml = parseSpec('version: 1\nmeta:\n  title: T\nblocks: []\n');
    expect(json).toEqual(yaml);
  });

  it('treats YAML as a superset of JSON without needing the format flag', () => {
    expect(parseSpec('[{"type":"text"}]')).toEqual([{ type: 'text' }]);
    expect(parseSpec('version: 1')).toEqual({ version: 1 });
  });

  it('passes an already-parsed object through untouched', () => {
    const document = { version: 1, blocks: [] };
    expect(parseSpec(document)).toBe(document);
  });

  it('reports invalid JSON with the source label', () => {
    try {
      parseSpec('{"version":}', { source: 'page.json', format: 'json' });
      throw new Error('expected a parse error');
    } catch (error) {
      expect(isRenderError(error)).toBe(true);
      const renderError = error as RenderError;
      expect(renderError.code).toBe('SPEC_PARSE_ERROR');
      expect(renderError.message).toContain('page.json');
    }
  });

  it('reports invalid YAML with the parser message and source label', () => {
    try {
      parseSpec('version: 1\nmeta: *undefined-anchor\n', { source: 'page.yaml' });
      throw new Error('expected a parse error');
    } catch (error) {
      const renderError = error as RenderError;
      expect(isRenderError(error)).toBe(true);
      expect(renderError.code).toBe('SPEC_PARSE_ERROR');
      expect(renderError.message).toContain('page.yaml');
    }
  });

  it('bounds YAML alias expansion so a small document cannot inflate', () => {
    const bomb = [
      'a: &a ["x","x","x","x","x","x","x","x","x"]',
      'b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]',
      'c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b]',
      'd: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c]',
      'e: [*d,*d,*d,*d,*d,*d,*d,*d,*d]',
    ].join('\n');
    expect(() => parseSpec(bomb)).toThrowError(/alias/i);
  });
});

describe('bounds', () => {
  it('accepts a document inside every limit', () => {
    const document = { version: 1, meta: { title: 'ok' }, blocks: [{ type: 'text', text: 'hi' }] };
    const diagnostics = bag();
    const report = checkBounds(document, diagnostics);
    expect(diagnostics.hasErrors).toBe(false);
    expect(report.blocks).toBe(1);
    expect(report.depth).toBeGreaterThan(1);
  });

  it('rejects excessive depth', () => {
    let deep: unknown = 'leaf';
    for (let index = 0; index < LIMITS.maxDepth + 4; index += 1) deep = { nested: deep };
    const diagnostics = bag();
    checkBounds(deep, diagnostics);
    expect(diagnostics.errors().some((item) => item.code === 'SPEC_BOUNDS_ERROR')).toBe(true);
    expect(diagnostics.errors()[0]?.message).toContain('nests');
  });

  it('rejects a list beyond the item limit with a positioned path', () => {
    const diagnostics = bag();
    checkBounds({ items: new Array(LIMITS.maxListItems + 1).fill('x') }, diagnostics);
    const error = diagnostics.errors().find((item) => item.message.includes('limit is'));
    expect(error?.path).toBe('$.items');
    expect(error?.code).toBe('SPEC_BOUNDS_ERROR');
  });

  it('rejects a document larger than the serialized byte limit', () => {
    const diagnostics = bag();
    checkBounds({ blob: 'x'.repeat(LIMITS.maxSerializedBytes + 1) }, diagnostics);
    expect(diagnostics.errors().some((item) => item.path === '$')).toBe(true);
  });

  it('rejects more blocks than the block limit', () => {
    const blocks = new Array(LIMITS.maxBlocks + 1).fill({ type: 'text', text: 'x' });
    const diagnostics = bag();
    checkBounds({ blocks }, diagnostics);
    expect(diagnostics.errors().some((item) => item.message.includes('blocks array'))).toBe(true);
  });
});

describe('schema versioning and migrations', () => {
  it('migrates the pre-versioning shape into the v1 envelope', () => {
    const diagnostics = bag();
    const result = migrateSpec({ blocks: [{ type: 'text', text: 'hi' }] }, diagnostics);
    expect(diagnostics.hasErrors).toBe(false);
    expect(result?.originalVersion).toBe(0);
    expect(result?.applied).toEqual(['v0->v1']);
    expect(result?.document.version).toBe(1);
    expect(result?.document.policy).toEqual({ network: 'deny' });
  });

  it('migrates a bare block array as well', () => {
    const diagnostics = bag();
    const result = migrateSpec([{ type: 'text', text: 'hi' }], diagnostics);
    expect(result?.document.version).toBe(1);
    expect(result?.document.meta).toEqual({ title: 'Untitled page', locale: 'en' });
  });

  it('leaves a current-version document untouched', () => {
    const document = { version: 1, meta: { title: 'T' }, blocks: [] };
    const diagnostics = bag();
    const result = migrateSpec(document, diagnostics);
    expect(result?.applied).toEqual([]);
    expect(result?.document).toEqual(document);
  });

  it('rejects a version newer than this compiler supports', () => {
    const diagnostics = bag();
    const result = migrateSpec({ version: 99, blocks: [] }, diagnostics);
    expect(result).toBeUndefined();
    expect(diagnostics.errors()[0]?.code).toBe('SPEC_VALIDATION_ERROR');
    expect(diagnostics.errors()[0]?.details?.supported).toEqual(supportedVersions());
  });

  it('rejects a non-numeric version', () => {
    const diagnostics = bag();
    expect(migrateSpec({ version: 'one', blocks: [] }, diagnostics)).toBeUndefined();
    expect(diagnostics.errors()[0]?.path).toBe('$.version');
  });

  it('rejects a non-object document', () => {
    const diagnostics = bag();
    expect(migrateSpec('nope', diagnostics)).toBeUndefined();
    expect(diagnostics.errors()[0]?.path).toBe('$');
  });
});
