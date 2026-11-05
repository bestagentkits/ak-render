import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compile } from '../../src/render/render.js';
import { normalizeSpec } from '../../src/spec/normalize.js';

const FIXTURE = readFileSync(
  new URL('../../fixtures/3d/scene-3d-basic.yaml', import.meta.url),
  'utf8',
);

function scene(objects: unknown[], extra: Record<string, unknown> = {}) {
  return {
    version: 1,
    meta: { title: '3D' },
    blocks: [{ type: 'scene-3d', id: 's', summary: 'A scene.', objects, ...extra }],
  };
}

function errors(spec: unknown) {
  return normalizeSpec(spec)
    .diagnostics.filter((d) => d.severity === 'error')
    .map((d) => `${d.path}: ${d.message}`);
}

const box = (id: string, extra: Record<string, unknown> = {}) => ({ id, label: id, ...extra });

describe('scene-3d contract', () => {
  it('accepts the fixture and compiles byte-identically three times', () => {
    const runs = [0, 1, 2].map(() => compile(FIXTURE, { source: 'scene' }).html);
    expect(runs[1]).toBe(runs[0]);
    expect(runs[2]).toBe(runs[0]);
    expect(runs[0]).toContain('__akThree');
    expect(runs[0]).toContain('data-ak-3d="scene"');
  });

  it('ships no 3D runtime on a page without a 3D block', () => {
    const html = compile({
      version: 1,
      meta: { title: 'Plain' },
      blocks: [{ type: 'text', text: 'Hi' }],
    }).html;
    expect(html).not.toContain('__akThree');
    expect(html).not.toContain('.ak-3d{');
  });

  it('rejects duplicate ids, unknown parents and parent cycles with exact paths', () => {
    expect(errors(scene([box('a'), box('a')]))).toEqual([
      '$.blocks[0].objects[1].id: object id "a" is used twice',
    ]);
    expect(errors(scene([box('a', { parent: 'nope' })]))).toEqual([
      '$.blocks[0].objects[0].parent: parent "nope" is not an object id in this scene',
    ]);
    const cycle = errors(scene([box('a', { parent: 'b' }), box('b', { parent: 'a' })]));
    expect(cycle).toContain('$.blocks[0].objects[0].parent: parent chain of "a" forms a cycle');
  });

  it('bounds nesting depth', () => {
    const chain = Array.from({ length: 10 }, (_, i) =>
      box(`n${i}`, i === 0 ? {} : { parent: `n${i - 1}` }),
    );
    expect(errors(scene(chain)).some((e) => e.includes('nest at most 8 levels'))).toBe(true);
  });

  it('resolves timeline, view and selection references', () => {
    const found = errors(
      scene([box('a')], {
        timeline: [{ target: 'ghost', property: 'rotation', to: [0, 90, 0] }],
        views: [{ value: 'v', focus: 'ghost' }, { value: 'v' }],
      }),
    );
    expect(found).toEqual([
      '$.blocks[0].timeline[0].target: "ghost" is not an object id in this scene',
      '$.blocks[0].views[0].focus: "ghost" is not an object id in this scene',
      '$.blocks[0].views[1].value: view "v" is listed twice',
    ]);
  });

  it('rejects shader source, unknown presets and out-of-range vectors', () => {
    expect(errors(scene([box('a', { shader: 'void main(){}' })])).join('\n')).toMatch(
      /objects\[0\]\.shader/,
    );
    expect(errors(scene([box('a', { fragmentShader: 'x' })])).join('\n')).toMatch(/fragmentShader/);
    expect(errors(scene([box('a', { shape: 'teapot' })])).join('\n')).toMatch(
      /objects\[0\]\.shape/,
    );
    expect(errors(scene([box('a', { position: [0, 0] })])).join('\n')).toMatch(
      /objects\[0\]\.position/,
    );
    expect(errors(scene([box('a', { position: [0, 0, 1e9] })])).join('\n')).toMatch(
      /objects\[0\]\.position/,
    );
    const poisoned = JSON.parse('{"id":"a","label":"a","__proto__":{"polluted":true}}');
    expect(errors(scene([poisoned])).join(' ')).toMatch(/__proto__/);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('renders a readable static plan and object list without JavaScript', () => {
    const html = compile(FIXTURE, { source: 'scene' }).html;
    expect(html).toMatch(/<svg class="ak-3d-poster"[^>]*role="img"/);
    expect(html).toContain('<text');
    expect(html).toContain('Core router');
    expect(html).toContain('data-ak-3d-pick="edge-a"');
    // A group draws nothing and is not listed; a non-selectable object is plain text.
    expect(html).not.toContain('data-ak-3d-pick="rig"');
    expect(html).not.toContain('data-ak-3d-pick="base"');
  });
});
