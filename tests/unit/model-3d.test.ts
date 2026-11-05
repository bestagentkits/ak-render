import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createModelResolver, describeGltf } from '../../src/assets/model-assets.js';
import { validate } from '../../src/index.js';
import { compile } from '../../src/render/render.js';

const fixtures = fileURLToPath(new URL('../../fixtures/3d', import.meta.url));
const base = readFileSync(join(fixtures, 'model-3d-crate.yaml'), 'utf8');
const resolver = () => createModelResolver(fixtures);
const scene = (html: string) => {
  const match = /data-ak-scene="([^"]*)"/u.exec(html);
  const raw = (match?.[1] ?? '{}')
    .replaceAll('&quot;', '"')
    .replace(/&#(\d+);/gu, (_, code: string) => String.fromCharCode(Number(code)))
    .replaceAll('&amp;', '&');
  return JSON.parse(raw);
};
const csp = (html: string) =>
  /http-equiv="Content-Security-Policy" content="([^"]*)"/u.exec(html)?.[1] ?? '';

describe('model-3d schema', () => {
  it('accepts the fixture and rejects a missing src or duplicate hotspot', () => {
    expect(validate(base).ok).toBe(true);
    expect(validate(base.replace('    src: models/crate.glb\n', '')).ok).toBe(false);
    const duplicate = base.replace('id: corner', 'id: latch');
    expect(() => compile(duplicate, { modelResolver: resolver() })).toThrow(/used twice/u);
  });
});

describe('model-3d compile', () => {
  it('inlines a local glb and lists its clips and variants', () => {
    const html = compile(base, { modelResolver: resolver() }).html;
    const config = scene(html);
    expect(config.src).toMatch(/^data:model\/gltf-binary;base64,/u);
    expect(config.clips).toEqual(['Spin', 'Lift']);
    expect(config.variants).toEqual(['oak', 'graphite', 'coral']);
    expect(html).toContain('data-ak-3d-clip="Lift"');
    expect(html).toContain('data-ak-3d-variant="coral"');
    expect(html).toMatch(/<ol class="ak-3d-objects ak-3d-hotspots">/u);
  });

  it('inlines a gltf with its buffer and texture as data URIs', () => {
    const html = compile(base.replace('crate.glb', 'crate.gltf'), {
      modelResolver: resolver(),
    }).html;
    const src = scene(html).src as string;
    const json = JSON.parse(Buffer.from(src.split(',')[1] ?? '', 'base64').toString('utf8'));
    expect(json.buffers[0].uri).toMatch(/^data:application\/octet-stream;base64,/u);
    expect(json.images[0].uri).toMatch(/^data:image\/png;base64,/u);
  });

  it('is deterministic', () => {
    const a = compile(base, { modelResolver: resolver() }).html;
    const b = compile(base, { modelResolver: resolver() }).html;
    expect(a).toBe(b);
  });

  it('fails a local model without a resolver, and a compressed one with the decoder diagnostic', () => {
    expect(() => compile(base)).toThrow(/needs a compile from a spec file/u);
    expect(() =>
      compile(base.replace('crate.glb', 'crate-draco.gltf'), { modelResolver: resolver() }),
    ).toThrow(/no bundled decoder: KHR_draco_mesh_compression/u);
  });
});

describe('model-3d CSP', () => {
  it('opens connect-src to data: and blob:, and img-src to blob:, only on a model page', () => {
    const html = compile(base, { modelResolver: resolver() }).html;
    expect(csp(html)).toContain('connect-src data: blob:;');
    expect(csp(html)).toContain('img-src data: blob: file:');
    const plain = compile(readFileSync(join(fixtures, 'scene-3d-basic.yaml'), 'utf8')).html;
    expect(csp(plain)).toContain('connect-src &#39;none&#39;');
    expect(csp(plain)).not.toContain('blob:');
  });

  it('adds an allowed remote model origin to connect-src and img-src', () => {
    const spec = `${base.replace('models/crate.glb', 'https://cdn.example.test/m/crate.glb')}policy:\n  network:\n    allow: [models]\n`;
    const html = compile(spec).html;
    expect(csp(html)).toContain('connect-src data: blob: https://cdn.example.test;');
    expect(csp(html)).toContain(
      'img-src data: blob: file: &#39;self&#39; https://cdn.example.test;',
    );
    expect(scene(html).src).toBe('https://cdn.example.test/m/crate.glb');
  });
});

describe('describeGltf', () => {
  it('reads bounds through node transforms', () => {
    const json = JSON.parse(readFileSync(join(fixtures, 'models/crate.gltf'), 'utf8'));
    const info = describeGltf(json);
    expect(info.bounds?.min).toEqual([-0.8, -0.25, -0.8]);
    expect(info.bounds?.max[1]).toBeCloseTo(0.75);
  });
});
