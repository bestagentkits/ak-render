import { describe, expect, it } from 'vitest';
import { DiagnosticBag } from '../../src/diagnostics.js';
import { type PropSchema, validateProp } from '../../src/registry/prop-schema.js';
import { getBlockDefinition } from '../../src/registry/registry.js';
import { compile } from '../../src/render/render.js';
import { assetOrigins, assetReferences } from '../../src/spec/asset-references.js';
import { normalizeSpec } from '../../src/spec/normalize.js';
import { PROBE_REGISTRY } from './support/probe-block-group.js';

const REMOTE = 'https://img.example.com/a.png';

describe('asset references', () => {
  it('finds flagged URLs at any depth with their paths and capabilities', () => {
    const gallery = getBlockDefinition('gallery');
    const video = getBlockDefinition('video');
    if (gallery === undefined || video === undefined) throw new Error('missing definitions');
    const items = [
      { src: REMOTE, alt: 'a' },
      { src: 'local.png', alt: 'b' },
    ];
    expect(
      assetReferences(gallery.props, { items }, '$.blocks[0]').map((asset) => [
        asset.path,
        asset.capability,
      ]),
    ).toEqual([
      ['$.blocks[0].items[0].src', 'images'],
      ['$.blocks[0].items[1].src', 'images'],
    ]);
    const refs = assetReferences(
      video.props,
      { src: 'https://cdn.example.com/v.mp4', poster: REMOTE, title: 'v' },
      '$',
    );
    expect(refs.map((asset) => [asset.field, asset.capability, asset.rejectBlocked])).toEqual([
      ['src', 'media', false],
      ['poster', 'images', true],
    ]);
    expect(assetOrigins({ allow: ['images'] }, refs)).toEqual(['https://img.example.com']);
    expect(assetOrigins('deny', refs)).toEqual([]);
  });

  it('rejects a blocked poster inside a nested slot at its nested path', () => {
    const { diagnostics } = normalizeSpec(
      {
        version: 1,
        meta: { title: 'Nested poster' },
        blocks: [
          {
            type: 'probe-panel',
            aside: [{ type: 'video', src: 'clip.mp4', title: 'Clip', poster: REMOTE }],
            items: [{ title: 'One', blocks: [{ type: 'text', text: 'One.' }] }],
          },
        ],
      },
      { registry: PROBE_REGISTRY },
    );
    const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
    expect(errors.map((error) => [error.code, error.path])).toEqual([
      ['POLICY_VIOLATION', '$.blocks[0].aside[0].poster'],
    ]);
  });

  it('names an allowed remote image origin from a nested slot in the policy', () => {
    const html = compile(
      {
        version: 1,
        meta: { title: 'Nested image' },
        policy: { network: { allow: ['images'] } },
        blocks: [
          {
            type: 'probe-panel',
            items: [{ title: 'One', blocks: [{ type: 'image', src: REMOTE, alt: 'Remote shot' }] }],
          },
        ],
      },
      { registry: PROBE_REGISTRY },
    ).html;
    const csp = /http-equiv="Content-Security-Policy" content="([^"]*)"/u.exec(html)?.[1] ?? '';
    expect(csp).toContain('https://img.example.com');
  });
});

describe('oneOf diagnostics', () => {
  const textOrList: PropSchema = {
    kind: 'oneOf',
    options: [
      { kind: 'string', maxLength: 5 },
      { kind: 'list', of: { kind: 'number' }, maxItems: 2 },
    ],
  };
  const shapes: PropSchema = {
    kind: 'oneOf',
    options: [
      {
        kind: 'object',
        fields: {
          type: { kind: 'string', enum: ['circle'], required: true },
          radius: { kind: 'number', required: true },
        },
      },
      {
        kind: 'object',
        fields: {
          type: { kind: 'string', enum: ['square'], required: true },
          side: { kind: 'number', required: true },
        },
      },
    ],
  };

  function diagnose(schema: PropSchema, value: unknown) {
    const bag = new DiagnosticBag();
    validateProp(schema, value, '$.x', bag);
    return bag.list().map((diagnostic) => [diagnostic.path, diagnostic.message]);
  }

  it('reports the only option of the value shape with its own diagnostics', () => {
    expect(diagnose(textOrList, [1, 'two'])).toEqual([['$.x[1]', 'expected a finite number']]);
    expect(diagnose(textOrList, 'too long')[0]?.[0]).toBe('$.x');
    expect(diagnose(textOrList, 'too long')[0]?.[1]).not.toMatch(/allowed shape/u);
  });

  it('discriminates object options by a required type enum', () => {
    const [problem] = diagnose(shapes, { type: 'square', radius: 2 });
    expect(problem?.[0]).toMatch(/^\$\.x\.(side|radius)$/u);
    expect(problem?.[1]).not.toMatch(/allowed shape/u);
  });

  it('falls back to the generic message when the intent is ambiguous', () => {
    expect(diagnose(shapes, { type: 'triangle' })).toEqual([
      ['$.x', 'value does not match any allowed shape (2 options)'],
    ]);
    expect(diagnose(textOrList, 3)).toEqual([
      ['$.x', 'value does not match any allowed shape (2 options)'],
    ]);
  });

  it('keeps accepting values that match an option', () => {
    expect(diagnose(textOrList, 'ok')).toEqual([]);
    expect(diagnose(shapes, { type: 'circle', radius: 1 })).toEqual([]);
  });
});
