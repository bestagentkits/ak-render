import { describe, expect, it } from 'vitest';
import { isRenderError, type RenderError } from '../../src/index.js';
import { FORBIDDEN_KEYS } from '../../src/spec/forbidden.js';
import { normalize } from '../../src/spec/normalize.js';
import { validate } from '../../src/spec/validate.js';

/**
 * Injection fixtures.
 *
 * Each case is a spec an author (or a model) could plausibly produce while
 * trying to smuggle executable or presentational content into the artifact.
 * The `PASSES` cases exist so this suite cannot be satisfied by rejecting
 * everything.
 */

function rejectionFor(blocks: unknown[]): RenderError {
  try {
    normalize({
      version: 1,
      meta: { title: 'Injection fixture' },
      blocks,
    });
  } catch (error) {
    if (isRenderError(error)) return error;
    throw error;
  }
  throw new Error('expected the spec to be rejected');
}

const LEGITIMATE: Record<string, unknown> = {
  version: 1,
  meta: { title: 'A legitimate page' },
  state: { mode: 'basic' },
  blocks: [
    { type: 'hero', title: 'Hello', description: 'A real page.' },
    { type: 'text', text: 'Body copy with <angle> brackets and & ampersands.' },
    { type: 'code', id: 'snippet', language: 'html', text: '<script>alert(1)</script>' },
    {
      type: 'button',
      id: 'copy',
      label: 'Copy',
      on: { click: { action: 'copy', target: 'snippet' } },
    },
  ],
};

describe('security: forbidden keys', () => {
  it('PASSES a legitimate spec, including code text that contains markup', () => {
    const result = validate(LEGITIMATE);
    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    expect(result.ok).toBe(true);
  });

  for (const key of FORBIDDEN_KEYS) {
    it(`REJECTS a block carrying "${key}"`, () => {
      const error = rejectionFor([{ type: 'text', text: 'hello', [key]: '<b>bold</b>' }]);
      // Either the forbidden-key scan or the strict unknown-prop check must fire.
      expect(['POLICY_VIOLATION', 'SPEC_VALIDATION_ERROR']).toContain(error.code);
      expect(error.path).toBe(`$.blocks[0].${key}`);
    });
  }

  it('REJECTS an inline camel-case event handler', () => {
    const error = rejectionFor([{ type: 'button', label: 'X', onClick: 'alert(1)' }]);
    expect(error.code).toBe('POLICY_VIOLATION');
    expect(error.path).toBe('$.blocks[0].onClick');
  });

  it('REJECTS a handler hidden inside a nested prop object', () => {
    const error = rejectionFor([
      {
        type: 'toolbar',
        items: [
          { type: 'button', label: 'X', onclick: 'alert(1)', on: { click: { action: 'toggle' } } },
        ],
      },
    ]);
    expect(error.code).toBe('POLICY_VIOLATION');
    expect(error.path).toBe('$.blocks[0].items[0].onclick');
  });

  it('REJECTS a handler smuggled into the diagram payload', () => {
    // The diagram payload is adapter-validated, but it is still a JSON subtree
    // in the spec, so the forbidden-key scan reaches it.
    const error = rejectionFor([
      { type: 'diagram-panel', title: 'D', spec: { schema_version: 1, rawHtml: '<b>x</b>' } },
    ]);
    expect(error.code).toBe('POLICY_VIOLATION');
    expect(error.path).toBe('$.blocks[0].spec.rawHtml');
  });

  it('REJECTS a top-level style key', () => {
    const styled = validate({
      version: 1,
      meta: { title: 'X' },
      blocks: [{ type: 'text', text: 'hi' }],
      style: 'body { display: none }',
    });
    expect(styled.ok).toBe(false);
    expect(styled.diagnostics[0]?.code).toBe('POLICY_VIOLATION');
    expect(styled.diagnostics[0]?.path).toBe('$.style');
  });
});

describe('security: URLs', () => {
  it('REJECTS a javascript: URL', () => {
    const error = rejectionFor([{ type: 'link', label: 'x', href: 'javascript:alert(1)' }]);
    expect(error.code).toBe('POLICY_VIOLATION');
    expect(error.path).toBe('$.blocks[0].href');
    expect(error.details?.scheme).toBe('javascript');
  });

  it('REJECTS a data: URL', () => {
    const error = rejectionFor([
      { type: 'image', src: 'data:image/svg+xml,<svg onload="alert(1)"/>', alt: 'x' },
    ]);
    expect(error.code).toBe('POLICY_VIOLATION');
  });

  it('REJECTS a vbscript: and file: URL', () => {
    expect(rejectionFor([{ type: 'link', label: 'x', href: 'vbscript:msgbox(1)' }]).code).toBe(
      'POLICY_VIOLATION',
    );
    expect(rejectionFor([{ type: 'link', label: 'x', href: 'file:///etc/passwd' }]).code).toBe(
      'POLICY_VIOLATION',
    );
  });

  it('PASSES a relative asset path and an allowlisted https URL', () => {
    const result = validate({
      version: 1,
      meta: { title: 'URLs' },
      blocks: [
        { type: 'image', src: 'assets/cover.svg', alt: 'cover' },
        { type: 'link', label: 'Docs', href: 'https://agentkit.best/docs' },
      ],
    });
    expect(result.ok).toBe(true);
  });
});

describe('security: actions', () => {
  it('REJECTS an unknown action', () => {
    const error = rejectionFor([
      { type: 'button', label: 'X', on: { click: { action: 'eval-js', source: 'alert(1)' } } },
    ]);
    expect(error.code).toBe('SPEC_VALIDATION_ERROR');
    expect(error.path).toBe('$.blocks[0].on.click.action');
    expect(error.details?.allowed).toContain('copy');
  });

  it('REJECTS an action that carries an extra executable-looking parameter', () => {
    const error = rejectionFor([
      {
        type: 'button',
        label: 'X',
        on: { click: { action: 'toggle', target: 'a', expression: 'document.body.remove()' } },
      },
    ]);
    expect(['SPEC_VALIDATION_ERROR', 'POLICY_VIOLATION']).toContain(error.code);
  });

  it('REJECTS more bound actions than the event limit', () => {
    const error = rejectionFor([
      {
        type: 'button',
        label: 'X',
        on: { click: new Array(9).fill({ action: 'toggle', target: 'a' }) },
      },
    ]);
    expect(error.code).toBe('SPEC_BOUNDS_ERROR');
  });
});
