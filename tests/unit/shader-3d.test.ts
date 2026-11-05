import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { export3dPosterSvg } from '../../src/blocks/three/poster-export.js';
import { shaderParams, shaderPoster } from '../../src/blocks/three/shader-3d.js';
import {
  fbm,
  POST_COMPAT,
  PRESET_DEFAULTS,
  SHADER_FRAGMENT,
  SHADER_PRESETS,
  SHADER_VERTEX,
  seedOffset,
} from '../../src/blocks/three/shader-fx.js';
import { catalog } from '../../src/registry/registry.js';
import { compile } from '../../src/render/render.js';
import { normalizeSpec } from '../../src/spec/normalize.js';

const fixture = (name: string) =>
  readFileSync(new URL(`../../fixtures/3d/${name}.yaml`, import.meta.url), 'utf8');

function spec(extra: Record<string, unknown> = {}, state?: Record<string, unknown>) {
  return {
    version: 1,
    meta: { title: 'Shader' },
    ...(state ? { state } : {}),
    blocks: [{ type: 'shader-3d', id: 's', summary: 'A glowing surface.', ...extra }],
  };
}

function diagnostics(input: unknown) {
  return normalizeSpec(input).diagnostics.filter((d) => d.severity === 'error');
}
const errors = (input: unknown) => diagnostics(input).map((d) => `${d.path}: ${d.message}`);

function params(extra: Record<string, unknown> = {}, state?: Record<string, unknown>) {
  const ir = normalizeSpec(spec(extra, state)).ir;
  const node = ir?.nodes.find((n) => n.type === 'shader-3d');
  if (!ir || !node) throw new Error('no node');
  return shaderParams(node, ir.state);
}

describe('shader-3d params', () => {
  it('takes every setting from the preset when the spec names only the preset', () => {
    for (const preset of SHADER_PRESETS) {
      const { post, ...rest } = PRESET_DEFAULTS[preset];
      expect(params({ preset })).toMatchObject({ ...rest, preset, post, seed: 1, speed: 1 });
    }
  });

  it('lets the spec set shape, tones, parameters, passes and seed', () => {
    expect(
      params({
        preset: 'noise',
        shape: 'torus',
        colors: ['success'],
        intensity: 1.5,
        scale: 2,
        progress: 0.2,
        speed: 0,
        post: ['vignette', 'grain'],
        seed: 9,
      }),
    ).toMatchObject({
      shape: 'torus',
      colors: ['success', 'success'],
      intensity: 1.5,
      scale: 2,
      progress: 0.2,
      speed: 0,
      post: ['grain', 'vignette'],
      seed: 9,
    });
    expect(params({ post: ['none'] }).post).toEqual([]);
  });

  it('reads bound state for the preset and parameters, clamped to range', () => {
    const resolved = params(
      {
        preset: 'fresnel',
        bind: { preset: 'state.look', progress: 'state.reveal', scale: 'state.s' },
      },
      { look: 'dissolve', reveal: 0.7, s: 99 },
    );
    expect(resolved).toMatchObject({ preset: 'dissolve', progress: 0.7, scale: 4 });
    // The dissolve keeps only the passes it supports from the chain.
    expect(resolved.post.every((pass) => POST_COMPAT.dissolve.includes(pass))).toBe(true);
  });
});

describe('shader-3d validation', () => {
  it('rejects unknown presets, out-of-range numbers and repeated or misplaced entries', () => {
    expect(errors(spec({ preset: 'raymarch' }))).toHaveLength(1);
    expect(errors(spec({ progress: 1.5 }))).toHaveLength(1);
    expect(errors(spec({ intensity: -1 }))).toHaveLength(1);
    expect(errors(spec({ post: ['bloom', 'bloom'] }))).toEqual([
      expect.stringContaining('pass "bloom" is listed twice'),
    ]);
    expect(errors(spec({ post: ['none', 'bloom'] }))).toEqual([
      expect.stringContaining('must be the only entry'),
    ]);
    expect(errors(spec({ controls: ['progress', 'progress'] }))).toHaveLength(1);
    expect(errors(spec({ bind: { progress: 'window.x' } }))).toEqual([
      expect.stringContaining('is not a state path'),
    ]);
    expect(errors(spec({ preset: 'hologram', post: ['scanlines', 'chromatic'], seed: 4 }))).toEqual(
      [],
    );
  });

  it('rejects a pass the preset does not support, naming the ones it does', () => {
    const found = diagnostics(spec({ preset: 'dissolve', post: ['chromatic'] }));
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('does not suit the dissolve preset');
    expect(found[0]?.details).toMatchObject({ fix: 'use any of: bloom, grain, vignette' });
    expect(errors(spec({ preset: 'noise', post: ['scanlines'] }))).toHaveLength(1);
  });

  it('rejects shader source under any key, and any prop outside the closed set', () => {
    for (const key of ['shader', 'glsl', 'wgsl', 'vertexShader', 'fragmentShader', 'GLSL']) {
      const found = diagnostics(spec({ [key]: 'void main(){gl_FragColor=vec4(1.0);}' }));
      expect(found.map((d) => d.code)).toContain('POLICY_VIOLATION');
    }
    // Nested inside the bind map too.
    expect(diagnostics(spec({ bind: { shader: 'state.x' } })).map((d) => d.code)).toContain(
      'POLICY_VIOLATION',
    );
    for (const key of ['source', 'code', 'uniforms', 'program'])
      expect(errors(spec({ [key]: 'void main(){}' }))).toHaveLength(1);
    // A preset name is a closed enum, so source in its place is refused too.
    expect(errors(spec({ preset: 'void main(){}' }))).toHaveLength(1);
  });
});

describe('shader-3d output', () => {
  it('compiles to the same bytes every time, with a poster and the runtime', () => {
    const a = compile(fixture('shader-3d-presets'), { source: 'p' }).html;
    expect(compile(fixture('shader-3d-presets'), { source: 'p' }).html).toBe(a);
    expect(a.match(/class="ak-3d-poster ak-sh-poster"/gu)).toHaveLength(5);
    expect(a).toContain('data-ak-3d="shader"');
    expect(a).toContain('__akThree');
  });

  it('carries no author text into the program: the GLSL is fixed', () => {
    const html = compile(fixture('shader-3d-controls'), { source: 'c' }).html;
    expect(html).not.toContain('gl_FragColor=vec4(1.0)');
    expect(SHADER_VERTEX).not.toMatch(/\$\{/u);
    expect(SHADER_FRAGMENT).toContain('uniform int uPreset;');
  });

  it('renders disabled native controls with the bound state values', () => {
    const html = compile(fixture('shader-3d-controls'), { source: 'c' }).html;
    expect(html).toMatch(
      /<input type="range" disabled data-ak-sh-param="progress" min="0" max="1" step="0.01" value="0.38">/u,
    );
    expect(html).toContain('data-ak-sh-preset="dissolve" aria-pressed="true"');
    expect(html.match(/data-ak-sh-preset="/gu)).toHaveLength(5);
  });

  it('draws each preset differently, and one seed the same twice', () => {
    const posters = SHADER_PRESETS.map((preset) => shaderPoster(params({ preset }), 'x', 'u'));
    expect(new Set(posters).size).toBe(SHADER_PRESETS.length);
    for (const poster of posters) expect(poster.match(/<path /gu)?.length).toBeGreaterThan(20);
    const seeded = (seed: number) => shaderPoster(params({ preset: 'dissolve', seed }), 'x', 'u');
    expect(seeded(3)).toBe(seeded(3));
    expect(seeded(3)).not.toBe(seeded(4));
    expect(seedOffset(3)).not.toEqual(seedOffset(4));
    expect(Math.abs(fbm(1, 2, 3))).toBeLessThanOrEqual(1);
  });

  it('draws each post pass only when the chain asks for it', () => {
    const poster = (post: string[]) => shaderPoster(params({ preset: 'hologram', post }), 'x', 'u');
    expect(poster(['none'])).not.toContain('<filter');
    expect(poster(['scanlines'])).toContain('class="ak-sh-lines"');
    expect(poster(['grain'])).toContain('<feTurbulence');
    expect(poster(['vignette'])).toContain('<radialGradient');
    expect(poster(['bloom'])).toContain('<feGaussianBlur');
    expect(poster(['chromatic'])).toContain('<feOffset');
  });

  it('exports a standalone poster with its own night stage in both schemes', () => {
    const svg = export3dPosterSvg(fixture('shader-3d-presets'), {
      blockId: 'dissolve',
      scheme: 'auto',
    });
    expect(svg).toContain('class="ak-3d-poster ak-sh-poster"');
    expect(svg.match(/--ak-sh-night:/gu)?.length).toBeGreaterThanOrEqual(2);
    expect(export3dPosterSvg(fixture('network-3d-basic'))).not.toContain('--ak-sh-night');
  });

  it('is listed in the catalog 3d family', () => {
    const family = catalog().families.find((entry) => entry.name === '3d');
    expect(family?.types).toContain('shader-3d');
  });
});
