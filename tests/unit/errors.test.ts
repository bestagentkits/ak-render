import { describe, expect, it } from 'vitest';
import { isRenderError, RenderError } from '../../src/index.js';

describe('RenderError', () => {
  it('carries a stable code plus optional spec location', () => {
    const error = new RenderError('SPEC_VALIDATION_ERROR', 'unknown block type "carusel"', {
      path: 'blocks[3].type',
      nodeId: 'n4',
      details: { allowed: ['carousel'] },
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('RenderError');
    expect(error.code).toBe('SPEC_VALIDATION_ERROR');
    expect(error.path).toBe('blocks[3].type');
    expect(error.nodeId).toBe('n4');
    expect(error.message).toBe('unknown block type "carusel"');
  });

  it('serializes to a JSON-safe payload without undefined keys', () => {
    const bare = new RenderError('SPEC_PARSE_ERROR', 'invalid YAML');
    expect(bare.toJSON()).toEqual({
      name: 'RenderError',
      code: 'SPEC_PARSE_ERROR',
      message: 'invalid YAML',
    });

    const located = new RenderError('POLICY_VIOLATION', 'network denied', {
      path: 'blocks[0].url',
    });
    expect(Object.keys(located.toJSON())).toEqual(['name', 'code', 'message', 'path']);
  });

  it('is narrowly detectable across a thrown-value boundary', () => {
    expect(isRenderError(new RenderError('INTERNAL_ERROR', 'boom'))).toBe(true);
    expect(isRenderError(new Error('boom'))).toBe(false);
    expect(isRenderError('boom')).toBe(false);
    expect(isRenderError(undefined)).toBe(false);
  });

  it('preserves the underlying cause without leaking it into the message', () => {
    const cause = new TypeError('bad input');
    const error = new RenderError('SPEC_PARSE_ERROR', 'could not parse spec', { cause });
    expect(error.cause).toBe(cause);
    expect(error.message).toBe('could not parse spec');
  });
});
