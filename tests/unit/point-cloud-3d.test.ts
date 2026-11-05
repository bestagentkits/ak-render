import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createPointCloudResolver,
  MAX_CLOUD_POINTS,
  parsePointCloudText,
} from '../../src/assets/point-cloud-assets.js';
import { cloudCamera, DROP, FIT, worldAxis } from '../../src/blocks/three/point-cloud-3d.js';
import { lodOrder, POSTER_POINTS, TABLE_ROWS } from '../../src/blocks/three/point-cloud-ir.js';
import {
  cloudRamp,
  RAMP_TONES,
  type Rgb,
  toOklch,
} from '../../src/blocks/three/point-cloud-ramp.js';
import { export3dPosterSvg } from '../../src/blocks/three/poster-export.js';
import { orbitProjector, POSTER_H, POSTER_W } from '../../src/blocks/three/scatter-3d.js';
import { RenderError } from '../../src/errors.js';
import { compile } from '../../src/render/render.js';
import { normalizeSpec } from '../../src/spec/normalize.js';
import { PRESETS } from '../../src/theme/presets.js';

const fixtureDir = fileURLToPath(new URL('../../fixtures/3d/', import.meta.url));
const fixture = (name: string) => readFileSync(join(fixtureDir, `${name}.yaml`), 'utf8');
const resolver = () => createPointCloudResolver(fixtureDir);

function cloud(extra: Record<string, unknown> = {}) {
  return {
    version: 1,
    meta: { title: 'Cloud' },
    state: { point: 'b' },
    blocks: [
      {
        type: 'point-cloud-3d',
        id: 'c',
        summary: 'Points.',
        bind: 'state.point',
        data: { x: [0, 1, 2, 9], y: [0, 1, 2, 3], z: [0, 1, 2, 3], id: ['a', 'b', 'c', 'd'] },
        axes: { x: { label: 'East', unit: 'm', max: 5 } },
        ...extra,
      },
    ],
  };
}

function errors(spec: unknown) {
  return normalizeSpec(spec)
    .diagnostics.filter((d) => d.severity === 'error')
    .map((d) => `${d.path}: ${d.message}`);
}

/** The JSON config the runtime mounts. */
function config(html: string) {
  const raw = /data-ak-scene="([^"]*)"/u.exec(html)?.[1] ?? '{}';
  return JSON.parse(raw.replace(/&quot;/gu, '"').replace(/&amp;/gu, '&'));
}
const status = (html: string) => /class="ak-pc-status"[^>]*>([^<]*)/u.exec(html)?.[1];

function renderError(run: () => unknown): RenderError {
  try {
    run();
  } catch (error) {
    if (error instanceof RenderError) return error;
    throw error;
  }
  throw new Error('expected a RenderError');
}

describe('point cloud text', () => {
  it('reads a header, comments and any separator', () => {
    const parsed = parsePointCloudText(
      '# scan\nX;Y;Z;Intensity\n1;2;3;40\n\n4, 5, 6, 50\n7\t8\t9\t60\n',
    );
    expect(parsed).toEqual({
      cloud: { x: [1, 4, 7], y: [2, 5, 8], z: [3, 6, 9], intensity: [40, 50, 60] },
      ignored: [],
    });
  });

  it('reads headerless x y z and reports undrawn header columns', () => {
    expect(parsePointCloudText('1 2 3\n4 5 6')).toMatchObject({
      cloud: { x: [1, 4], intensity: null },
    });
    expect(parsePointCloudText('z y x r\n1 2 3 9')).toEqual({
      cloud: { x: [3], y: [2], z: [1], intensity: null },
      ignored: ['r'],
    });
  });

  it('fails with the line on a ragged row, a bad value or a missing column', () => {
    expect(parsePointCloudText('1 2 3\n4 5')).toMatchObject({ line: 2 });
    expect(parsePointCloudText('1 2 3 4 5')).toMatchObject({ line: 1 });
    expect(parsePointCloudText('x y z\n1 2 NaN')).toMatchObject({ line: 2 });
    expect(parsePointCloudText('x y z\n1 2 1e13')).toMatchObject({ line: 2 });
    expect(parsePointCloudText('x y\n1 2')).toMatchObject({
      error: 'the header has no "z" column',
    });
    // An empty cell or a non-decimal value is an error, never a silent zero.
    expect(parsePointCloudText('x,y,z,intensity\n1,2,3,\n')).toMatchObject({ line: 2 });
    expect(parsePointCloudText(',1,2,3')).toMatchObject({ line: 1 });
    expect(parsePointCloudText('1 2 3 0x10')).toMatchObject({ line: 1 });
    expect(parsePointCloudText('# only a comment\n')).toMatchObject({
      error: 'the file has no points',
    });
  });

  it('refuses a cloud over the limit instead of truncating it', () => {
    const text = '1 2 3\n'.repeat(MAX_CLOUD_POINTS + 1);
    const parsed = parsePointCloudText(text);
    expect(parsed).toMatchObject({ error: 'the cloud has more than 100,000 points' });
    expect('fix' in parsed && parsed.fix).toContain('never drops points');
  });
});

describe('point cloud files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ak-pc-'));
  mkdirSync(join(dir, 'scans'));
  writeFileSync(join(dir, 'scans', 'a.xyz'), 'x y z rgb\n1 2 3 7\n');
  writeFileSync(join(dir, 'scans', 'b.las'), '');
  mkdirSync(join(dir, 'scans', 'folder.xyz'));

  it('reads a file inside the spec directory and warns on undrawn columns', () => {
    const result = createPointCloudResolver(dir)('scans/a.xyz', '$.blocks[0].src');
    expect(result.cloud).toEqual({ x: [1], y: [2], z: [3], intensity: null });
    expect(result.diagnostics).toMatchObject([{ severity: 'warning', path: '$.blocks[0].src' }]);
  });

  it.each([
    ['../outside.xyz', 'POLICY_VIOLATION', 'leaves the spec directory'],
    ['scans/..%2F..%2Fx.xyz', 'POLICY_VIOLATION', 'leaves the spec directory'],
    ['/etc/a.xyz', 'POLICY_VIOLATION', 'must be relative'],
    ['C:/a.xyz', 'POLICY_VIOLATION', 'must be a local file'],
    ['https://example.com/a.xyz', 'POLICY_VIOLATION', 'must be a local file'],
    ['scans/b.las', 'SPEC_VALIDATION_ERROR', 'must be a .xyz'],
    ['scans/missing.xyz', 'SPEC_VALIDATION_ERROR', 'was not found'],
    // Checked before it is opened, so a pipe or device never blocks the compile.
    ['scans/folder.xyz', 'SPEC_VALIDATION_ERROR', 'is not a file'],
  ])('rejects %s', (reference, code, message) => {
    const result = createPointCloudResolver(dir)(reference, '$.blocks[0].src');
    expect(result.cloud).toBeUndefined();
    expect(result.diagnostics[0]).toMatchObject({ code, severity: 'error' });
    expect(result.diagnostics[0]?.message).toContain(message);
  });

  it('bounds the bytes per file and per page', () => {
    const tight = createPointCloudResolver(dir, { perFileBytes: 30, perPageBytes: 30 });
    expect(tight('scans/a.xyz', '$').cloud).toBeDefined();
    expect(tight('scans/a.xyz', '$').diagnostics[0]?.code).toBe('SPEC_BOUNDS_ERROR');
    const small = createPointCloudResolver(dir, { perFileBytes: 4, perPageBytes: 40 });
    expect(small('scans/a.xyz', '$').diagnostics[0]?.message).toContain('limit per file');
  });

  it('needs a resolver: a plain compile never touches the disk', () => {
    const error = renderError(() =>
      compile(cloud({ data: undefined, src: 'scans/a.xyz' }), { source: 's' }),
    );
    expect(error.message).toContain('needs a compile from a spec file');
    expect(error.path).toBe('$.blocks[0].src');
  });
});

describe('point-cloud-3d validation', () => {
  it('accepts the inline example', () => {
    expect(errors(cloud())).toEqual([]);
  });

  it('needs exactly one source', () => {
    expect(errors(cloud({ data: undefined }))).toEqual([
      '$.blocks[0]: needs points: a src file or data columns x, y and z',
    ]);
    expect(errors(cloud({ src: 'a.xyz' }))).toEqual([
      '$.blocks[0]: set either src or data, not both',
    ]);
  });

  it('checks columns, ids, the clip box and the budget', () => {
    expect(
      errors(
        cloud({
          data: { x: [1, 2], y: [1], z: [1, 2], id: ['a', 'a'] },
          axes: { z: { label: 'Z', min: 3, max: 3 } },
          budget: 10,
        }),
      ),
    ).toEqual(
      expect.arrayContaining([
        '$.blocks[0].data.y: column "y" has 1 values; x has 2',
        '$.blocks[0].data.id[1]: point id "a" is used twice',
        '$.blocks[0].axes.z: min must be below max',
        expect.stringContaining('$.blocks[0].budget'),
      ]),
    );
  });

  it('lets an inline column hold more than the usual list bound', () => {
    const n = 500;
    const column = Array.from({ length: n }, (_, i) => i);
    expect(errors(cloud({ data: { x: column, y: column, z: column, intensity: column } }))).toEqual(
      [],
    );
  });
});

/** sRGB hex to linear channels, as the runtime reads theme colours. */
function linear(hex: string): Rgb {
  const channel = (k: number) => {
    const c = Number.parseInt(hex.slice(1 + k * 2, 3 + k * 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return [channel(0), channel(1), channel(2)];
}

describe('point-cloud-3d colour ramp', () => {
  const schemes = Object.values(PRESETS).flatMap((preset) => [
    [`${preset.name} light`, preset.light] as const,
    [`${preset.name} dark`, preset.dark] as const,
  ]);
  it.each(schemes)('%s: every step keeps its colour and lightness runs one way', (_, tokens) => {
    const stops = RAMP_TONES.map((tone) => linear(String(tokens[`color-${tone}`])));
    const ink = linear(String(tokens['color-text']));
    const steps = Array.from({ length: 17 }, (_, k) => toOklch(cloudRamp(stops, ink, k / 16)));
    for (const [, chroma] of steps) expect(chroma).toBeGreaterThanOrEqual(0.08);
    const lightness = steps.map(([l]) => l);
    const rising = (lightness.at(-1) ?? 0) > (lightness[0] ?? 0);
    for (let k = 1; k < lightness.length; k += 1) {
      const step = (lightness[k] ?? 0) - (lightness[k - 1] ?? 0);
      expect(rising ? step : -step).toBeGreaterThan(-0.005);
    }
    // The top of the ramp moves toward the text: darker on a light page, lighter on a dark one.
    const [textLightness] = toOklch(ink);
    expect(rising).toBe((textLightness ?? 0) > (lightness[0] ?? 0));
  });
});

describe('point-cloud-3d layout', () => {
  it('frames the box in the stage, centred just below the middle', () => {
    for (const half of [
      [1, 0.18, 0.75],
      [1, 1, 1],
      [0.4, 1, 0.4],
    ] as const) {
      const { orbit, target } = cloudCamera([...half]);
      const at = orbitProjector(orbit, target);
      const corners = [-1, 1].flatMap((x) =>
        [-1, 1].flatMap((y) => [-1, 1].map((z) => at([x * half[0], y * half[1], z * half[2]]))),
      );
      const xs = corners.map((p) => p.x);
      const ys = corners.map((p) => p.y);
      const width = (Math.max(...xs) - Math.min(...xs)) / POSTER_W;
      const height = (Math.max(...ys) - Math.min(...ys)) / POSTER_H;
      // One side of the window is filled, and nothing leaves it.
      expect(Math.max(width / FIT[0], height / FIT[1])).toBeGreaterThan(0.95);
      expect(Math.max(width / FIT[0], height / FIT[1])).toBeLessThanOrEqual(1);
      const cx = (Math.max(...xs) + Math.min(...xs)) / 2 / POSTER_W;
      const cy = (Math.max(...ys) + Math.min(...ys)) / 2 / POSTER_H;
      expect(Math.abs(cx - 0.5)).toBeLessThan(0.01);
      expect(Math.abs(cy - 0.5 - DROP)).toBeLessThan(0.01);
    }
  });

  it('orders points so every prefix spreads over the cloud', () => {
    // Eight corners of the cube, listed corner-major with a cluster at each.
    const corners: [number, number, number][] = [];
    for (const a of [-0.9, 0.9])
      for (const b of [-0.9, 0.9])
        for (const c of [-0.9, 0.9])
          for (let k = 0; k < 4; k += 1) corners.push([a + k * 0.01, b, c]);
    const order = lodOrder(
      corners.map((_, i) => i),
      (i) => corners[i] as [number, number, number],
    );
    expect([...order].sort((p, q) => p - q)).toEqual(corners.map((_, i) => i));
    const octants = new Set(order.slice(0, 8).map((i) => Math.floor(i / 4)));
    expect(octants.size).toBe(8);
  });

  it('maps z-up survey data to the y-up world', () => {
    expect(worldAxis('z', 'z')).toEqual({ w: 1, sign: 1 });
    expect(worldAxis('z', 'y')).toEqual({ w: 2, sign: -1 });
    expect(worldAxis('y', 'y')).toEqual({ w: 1, sign: 1 });
  });

  it('keeps authored coordinates, clips by the box and keeps the selection', () => {
    const { html } = compile(cloud(), { source: 'c' });
    const c = config(html);
    expect(c.x).toEqual([0, 1, 2, 9]);
    expect(c.clipped).toBe(1);
    expect(c.order).toHaveLength(3);
    expect(c.order).not.toContain(3);
    // One uniform scale: the longest box side spans the cube.
    expect(Math.max(...c.half)).toBe(1);
    expect(status(html)).toBe('4 points; 1 outside the clip box are hidden.');
    expect(html).toContain('<dt>Selected</dt><dd>b</dd>');
    expect(html).toContain('<dt>East (m)</dt><dd>1</dd>');
    expect(html).toContain('data-ak-pc-point="d"><th scope="row">d <small class="ak-pc-clip">');
    expect(html).toContain('<tr data-ak-pc-point="b" aria-selected="true">');
  });
});

describe('point-cloud-3d fixtures', () => {
  it('compiles every fixture byte-identically twice', () => {
    for (const name of ['point-cloud-3d-basic', 'point-cloud-3d-depot']) {
      const a = compile(fixture(name), { source: name, pointCloudResolver: resolver() });
      const b = compile(fixture(name), { source: name, pointCloudResolver: resolver() });
      expect(a.hash).toBe(b.hash);
      expect(a.html).toContain('data-ak-3d="pointcloud"');
      expect(a.warnings).toEqual([]);
    }
  }, 20_000);

  it('carries all 100,000 points, counts the clipped ones and states every sample', () => {
    const { html } = compile(fixture('point-cloud-3d-100k'), {
      source: '100k',
      pointCloudResolver: resolver(),
    });
    const c = config(html);
    const lines = readFileSync(join(fixtureDir, 'point-cloud/depot-100k.xyz'), 'utf8')
      .trim()
      .split('\n')
      .slice(3);
    expect(c.count).toBe(100_000);
    expect(c.x).toHaveLength(100_000);
    expect(c.order.length + c.clipped).toBe(100_000);
    expect(new Set(c.order).size).toBe(c.order.length);
    expect(c.clipped).toBeGreaterThan(0);
    expect(c.budget).toBe(60_000);
    expect(status(html)).toBe(
      `100,000 points; ${c.clipped.toLocaleString('en-US')} outside the clip box are hidden. This drawing shows an even sample of 5,000 of the ${c.order.length.toLocaleString('en-US')} in the box.`,
    );
    // The sample, with the selected point drawn once as the marked dot.
    const dots = html.match(/<circle class="q\d"/gu)?.length ?? 0;
    expect(dots).toBeGreaterThanOrEqual(POSTER_POINTS);
    expect(dots).toBeLessThanOrEqual(POSTER_POINTS + 1);
    expect(html).toContain('<g class="ak-pc-mark">');
    // The selected point is the 99,999th line: exact values, units and its own table row.
    const [x, y, z, intensity] = (lines[99_998] ?? '').split(' ').map(Number);
    expect([c.x[99_998], c.y[99_998], c.z[99_998], c.intensity[99_998]]).toEqual([
      x,
      y,
      z,
      intensity,
    ]);
    expect(html).toContain(`<dt>Elevation (m)</dt><dd>${z}</dd>`);
    expect(html).toContain('<tr data-ak-pc-point="p99999" aria-selected="true">');
    expect(html.match(/<tr data-ak-pc-point=/gu)?.length).toBe(TABLE_ROWS + 1);
    expect(html).toContain('<caption>All 100,000 points</caption>');
  }, 20_000);

  it('exports a standalone poster with the intensity ramp', () => {
    const svg = export3dPosterSvg(fixture('point-cloud-3d-basic'), {
      scheme: 'auto',
      labels: false,
    });
    expect(svg).toContain('class="ak-3d-poster ak-pc-poster"');
    expect(svg).toContain('.ak-pc .q0{--ak-pc-c:');
    expect(svg).toContain('text{display:none}');
  }, 20_000);
});
