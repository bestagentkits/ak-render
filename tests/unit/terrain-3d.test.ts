import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { terrainField, terrainModel } from '../../src/blocks/three/terrain-3d.js';
import {
  AUTO_RELIEF,
  BLOCK_SIZE,
  cellSegments,
  contourLevels,
  contourSegments,
  decodeHeights,
  encodeHeights,
  fieldFromRows,
  fitCamera,
  formatElevation,
  HOME_BEARING,
  isIndexLevel,
  niceInterval,
  rampColor,
  reliefField,
  sample,
  terrainLayout,
  toHex,
} from '../../src/blocks/three/terrain-field.js';
import type { IrNode } from '../../src/ir.js';
import { compile } from '../../src/render/render.js';
import { normalizeSpec } from '../../src/spec/normalize.js';

const FIXTURE = readFileSync(
  new URL('../../fixtures/3d/terrain-3d-alpine.yaml', import.meta.url),
  'utf8',
);
/** Compiling inlines the 3D runtime; Windows CI runners need far more than the 5 s default. */
const SLOW = 30_000;

function spec(block: Record<string, unknown>, state: Record<string, unknown> = {}) {
  return {
    version: 1,
    meta: { title: 'Terrain' },
    state,
    blocks: [{ type: 'terrain-3d', id: 't', summary: 'Some ground.', ...block }],
  };
}

/** A 5 x 4 grid whose elevation is 100 * column + 10 * row: every sample is known. */
const RAMP_ROWS = [0, 1, 2, 3].map((r) => [0, 1, 2, 3, 4].map((c) => 100 * c + 10 * r));

function errors(input: unknown) {
  return normalizeSpec(input)
    .diagnostics.filter((d) => d.severity === 'error')
    .map((d) => `${d.path}: ${d.message}`);
}

interface TerrainConfig {
  objects: unknown[];
  camera: { position: number[]; target: number[]; fov: number };
  terrain: {
    cols: number;
    rows: number;
    min: number;
    max: number;
    heights: string;
    extent: [number, number];
    vscale: number;
    ramp: string;
    interval: number;
    marks: { id: string; label: string; at: number[]; elevation: string; tone: string }[];
    flyover: boolean;
    selected?: string;
    bind?: string;
  };
}

function sceneOf(html: string): TerrainConfig {
  const match = /data-ak-scene="([^"]*)"/u.exec(html);
  const raw = (match?.[1] ?? '{}')
    .replaceAll('&quot;', '"')
    .replace(/&#(\d+);/gu, (_, code: string) => String.fromCharCode(Number(code)))
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
  return JSON.parse(raw);
}

const node = (props: Record<string, unknown>): IrNode =>
  ({ id: 't', type: 'terrain-3d', path: '$.blocks[0]', props }) as unknown as IrNode;

describe('terrain-3d contract', () => {
  it(
    'compiles the 256 x 256 fixture byte-identically three times with the 3D runtime',
    () => {
      const runs = [0, 1, 2].map(() => compile(FIXTURE, { source: 'terrain' }).html);
      expect(runs[1]).toBe(runs[0]);
      expect(runs[2]).toBe(runs[0]);
      const html = runs[0] as string;
      expect(html).toContain('data-ak-3d="terrain"');
      expect(html).toContain('__akThree');
      const { terrain, objects } = sceneOf(html);
      expect(objects).toEqual([]);
      expect([terrain.cols, terrain.rows]).toEqual([256, 256]);
      expect([terrain.min, terrain.max]).toEqual([820, 3120]);
      expect(terrain.heights.length).toBe(Math.ceil((256 * 256 * 2) / 3) * 4);
      expect(html).toContain('256 × 256 samples');
    },
    SLOW,
  );

  it(
    'draws the fallback: a shaded block with pins, the legend and every place with its elevation',
    () => {
      const html = compile(FIXTURE, { source: 'terrain' }).html;
      expect(html.match(/<svg class="ak-3d-poster ak-tr-poster"/gu)?.length).toBe(1);
      expect(html.match(/class="ak-3d-mark ak-tr-pin"/gu)?.length).toBe(4);
      expect(html).toContain('class="ak-tr-c ak-tr-ci"');
      expect(html).toMatch(
        /<svg class="ak-tr-ramp"[^>]*aria-label="Colour scale, low to high: 820 m to 3,120 m"/u,
      );
      expect(html).toContain(
        'Elevation 820 m to 3,120 m · contours every 250 m, heavier every 1,250 m',
      );
      expect(html.match(/data-ak-terrain-mark="/gu)?.length).toBe(4);
      const { terrain } = sceneOf(html);
      const field = terrainField(
        node(
          (parse(FIXTURE) as { blocks: { relief: unknown }[] }).blocks[0] as Record<
            string,
            unknown
          >,
        ),
      );
      // The listed elevation of each place is the heightmap's own value there.
      for (const mark of terrain.marks) {
        const value = formatElevation(
          sample(field, mark.at[0] as number, mark.at[1] as number),
          'm',
        );
        expect(mark.elevation).toBe(value);
        expect(html).toContain(`<span class="ak-tr-elev">${value}</span>`);
      }
      // The summit is the highest place listed and sits near the top of the range.
      const summit = sample(field, 0.38, 0.34);
      expect(summit).toBeGreaterThan(2700);
      expect(terrain.flyover).toBe(true);
      expect(terrain.bind).toBe('state.place');
    },
    SLOW,
  );

  it(
    'compiles a 256 x 256 grid of given elevations and ships them within one 16-bit step',
    () => {
      const rows = Array.from({ length: 256 }, (_, r) =>
        Array.from({ length: 256 }, (_, c) =>
          Math.round(400 + 300 * Math.sin(c / 20) * Math.cos(r / 31)),
        ),
      );
      const html = compile(
        spec({ heights: rows, annotations: [{ id: 'p', label: 'Probe', at: [0.5, 0.25] }] }),
      ).html;
      const { terrain } = sceneOf(html);
      expect([terrain.cols, terrain.rows]).toEqual([256, 256]);
      const field = fieldFromRows(rows);
      expect([terrain.min, terrain.max]).toEqual([field.min, field.max]);
      const decoded = decodeHeights(terrain.heights, 256, 256, terrain.min, terrain.max);
      expect(decoded).not.toBeNull();
      const step = (field.max - field.min) / 65535;
      let worst = 0;
      field.data.forEach((v, i) => {
        worst = Math.max(worst, Math.abs(v - (decoded?.data[i] as number)));
      });
      expect(worst).toBeLessThanOrEqual(step / 2 + 1e-9);
      expect(terrain.marks[0]?.elevation).toBe(formatElevation(sample(field, 0.5, 0.25), 'm'));
    },
    SLOW,
  );

  it(
    'starts on the place the bound state names',
    () => {
      const doc = parse(FIXTURE) as { state: Record<string, unknown> };
      const html = compile({ ...doc, state: { place: 'lake' } } as never).html;
      expect(sceneOf(html).terrain.selected).toBe('lake');
      expect(html).toMatch(/data-ak-terrain-mark="lake" aria-pressed="true"/u);
      const unknown = compile({ ...doc, state: { place: 'nope' } } as never).html;
      expect(sceneOf(unknown).terrain.selected).toBeUndefined();
    },
    SLOW,
  );

  it('rejects a missing or doubled source, ragged rows, a reversed range, open lines and repeated ids', () => {
    expect(errors(spec({}))).toEqual([
      '$.blocks[0].heights: give `heights` (rows of elevations) or a `relief`',
    ]);
    expect(errors(spec({ heights: RAMP_ROWS, relief: { seed: 1 } }))).toEqual([
      '$.blocks[0].relief: give `heights` or `relief`, not both',
    ]);
    expect(
      errors(
        spec({
          heights: [
            [1, 2, 3],
            [4, 5],
            [6, 7, 8],
          ],
        }),
      ),
    ).toEqual([
      '$.blocks[0].heights[1]: row 1 has 2 values and row 0 has 3; every row needs the same count',
    ]);
    expect(errors(spec({ relief: { range: [900, 100] } }))).toEqual([
      '$.blocks[0].relief.range: range [900, 100] must run low to high',
    ]);
    expect(errors(spec({ relief: { features: [{ kind: 'ridge', at: [0.1, 0.1] }] } }))).toEqual([
      '$.blocks[0].relief.features[0]: a ridge needs `to`, where it ends',
    ]);
    expect(
      errors(
        spec({
          heights: RAMP_ROWS,
          annotations: [
            { id: 'a', label: 'A', at: [0.1, 0.1] },
            { id: 'a', label: 'B', at: [0.2, 0.2] },
          ],
        }),
      ),
    ).toEqual(['$.blocks[0].annotations[1].id: annotation id "a" is used twice']);
    // Bounds the schema owns: grid size, coordinates and the ramp vocabulary.
    const tall = Array.from({ length: 257 }, () => [1, 2]);
    expect(errors(spec({ heights: tall })).length).toBeGreaterThan(0);
    expect(
      errors(spec({ heights: RAMP_ROWS, annotations: [{ id: 'a', label: 'A', at: [1.2, 0] }] }))
        .length,
    ).toBeGreaterThan(0);
    expect(errors(spec({ heights: RAMP_ROWS, ramp: 'rainbow' })).length).toBeGreaterThan(0);
    expect(() => compile(spec({}))).toThrow(/heights/u);
    expect(errors(spec({ heights: RAMP_ROWS }))).toEqual([]);
  });
});

describe('terrain-3d elevations', () => {
  it('reads known elevations back from the grid, bilinear between samples', () => {
    const field = fieldFromRows(RAMP_ROWS);
    expect([field.cols, field.rows, field.min, field.max]).toEqual([5, 4, 0, 430]);
    expect(sample(field, 0, 0)).toBe(0);
    expect(sample(field, 1, 1)).toBe(430);
    expect(sample(field, 0.5, 0)).toBe(200);
    // Column 2.5 and row 1.5: 100 * 2.5 + 10 * 1.5.
    expect(sample(field, 2.5 / 4, 1.5 / 3)).toBeCloseTo(265, 9);
    // Out-of-range coordinates clamp to the edge.
    expect(sample(field, -1, 2)).toBe(30);
  });

  it(
    'lists the elevation of each place from given heights',
    () => {
      const html = compile(
        spec({
          heights: RAMP_ROWS,
          unit: 'ft',
          annotations: [
            { id: 'low', label: 'Low', at: [0, 0] },
            { id: 'mid', label: 'Mid', at: [0.625, 0.5] },
            { id: 'high', label: 'High', at: [1, 1] },
          ],
        }),
      ).html;
      expect(sceneOf(html).terrain.marks.map((m) => m.elevation)).toEqual([
        '0 ft',
        '265 ft',
        '430 ft',
      ]);
      expect(html).toContain('Elevation 0 ft to 430 ft');
    },
    SLOW,
  );

  it('generates the same relief for the same seed, spanning exactly the asked range', () => {
    const relief = {
      seed: 5,
      resolution: 64,
      roughness: 0.5,
      range: [100, 900] as [number, number],
      features: [{ kind: 'peak', at: [0.5, 0.5] as [number, number], radius: 0.2, height: 1 }],
    };
    const a = reliefField(relief);
    const b = reliefField(relief);
    expect(a.data).toEqual(b.data);
    expect([a.cols, a.rows, a.min, a.max]).toEqual([64, 64, 100, 900]);
    expect(reliefField({ ...relief, seed: 6 }).data).not.toEqual(a.data);
    // The peak stands above the corners.
    expect(sample(a, 0.5, 0.5)).toBeGreaterThan(sample(a, 0, 0) + 300);
    // A crater is lower in its bowl than on its rim.
    const crater = reliefField({
      ...relief,
      roughness: 0,
      features: [{ kind: 'crater', at: [0.5, 0.5], radius: 0.3, height: 1 }],
    });
    expect(sample(crater, 0.5, 0.2)).toBeGreaterThan(sample(crater, 0.5, 0.5) + 200);
  });

  it('round-trips heights through the 16-bit transport, and refuses a malformed payload', () => {
    const field = fieldFromRows(RAMP_ROWS);
    const text = encodeHeights(field);
    const back = decodeHeights(text, 5, 4, field.min, field.max);
    expect(back?.data.length).toBe(field.data.length);
    // Every value comes back within half a 16-bit step of the range.
    field.data.forEach((v, i) => {
      expect(Math.abs((back?.data[i] as number) - v)).toBeLessThanOrEqual(430 / 65535 / 2 + 1e-9);
    });
    expect(decodeHeights(text.slice(1), 5, 4, 0, 430)).toBeNull();
    expect(decodeHeights(`${text.slice(0, -1)}!`, 5, 4, 0, 430)).toBeNull();
    expect(decodeHeights(text, 4, 4, 0, 430)).toBeNull();
  });

  it('formats elevations for people', () => {
    expect(formatElevation(3120, 'm')).toBe('3,120 m');
    expect(formatElevation(1234567.4, 'ft')).toBe('1,234,567 ft');
    expect(formatElevation(12.345, 'm')).toBe('12.3 m');
    expect(formatElevation(0.256, 'km')).toBe('0.26 km');
    expect(formatElevation(-42, 'm')).toBe('−42 m');
    expect(formatElevation(250, '')).toBe('250');
  });
});

describe('terrain-3d scale, contours and colour', () => {
  it('draws to true scale times the exaggeration when the width is known', () => {
    const field = fieldFromRows(RAMP_ROWS);
    const fixed = terrainLayout(field, 4000, 2);
    expect(fixed.extent).toEqual([BLOCK_SIZE, 3]);
    // 4 world units for 4000 units of ground, times 2.
    expect(fixed.vscale).toBeCloseTo(0.002, 12);
    expect(fixed.exaggeration).toBe(2);
    const auto = terrainLayout(field, 4000, undefined);
    expect(auto.exaggeration).toBe(Math.round((AUTO_RELIEF * BLOCK_SIZE) / (430 * 0.001)));
    const free = terrainLayout(field, undefined, undefined);
    expect(free.exaggeration).toBeNull();
    expect(430 * free.vscale).toBeCloseTo(AUTO_RELIEF * BLOCK_SIZE, 12);
    expect(
      terrainLayout(
        fieldFromRows([
          [5, 5],
          [5, 5],
        ]),
        undefined,
        undefined,
      ).vscale,
    ).toBe(0);
  });

  it('picks round contour intervals and marks every fifth as an index line', () => {
    expect(niceInterval(2300)).toBe(250);
    expect(niceInterval(1460)).toBe(250);
    expect(niceInterval(600)).toBe(50);
    expect(niceInterval(9)).toBe(1);
    expect(niceInterval(0.9)).toBe(0.1);
    expect(contourLevels(820, 3120, 250)).toEqual([
      1000, 1250, 1500, 1750, 2000, 2250, 2500, 2750, 3000,
    ]);
    expect(contourLevels(0, 100, 0)).toEqual([]);
    expect(isIndexLevel(1250, 250)).toBe(true);
    expect(isIndexLevel(1000, 250)).toBe(false);
  });

  it('traces contours by marching squares at the right elevation', () => {
    expect(cellSegments(0, 0, 0, 0, 5)).toEqual([]);
    expect(cellSegments(0, 10, 10, 0, 5)).toEqual([[0.5, 0, 0.5, 1]]);
    // A saddle gives two runs.
    expect(cellSegments(10, 0, 10, 0, 5)).toHaveLength(2);
    // A cone's 50 contour is a ring of radius ~ half the cone's reach.
    const n = 41;
    const rows = Array.from({ length: n }, (_, r) =>
      Array.from({ length: n }, (_, c) => 100 - 100 * Math.min(1, Math.hypot(c - 20, r - 20) / 20)),
    );
    const segments = contourSegments(fieldFromRows(rows), [50]);
    expect(segments.length / 5).toBeGreaterThan(30);
    for (let i = 0; i < segments.length; i += 5) {
      const radius = Math.hypot((segments[i] as number) - 0.5, (segments[i + 1] as number) - 0.5);
      expect(radius).toBeGreaterThan(0.22);
      expect(radius).toBeLessThan(0.28);
    }
  });

  it('maps ramps low to high, clamped', () => {
    expect(toHex(rampColor('viridis', 0))).toBe('#440154');
    expect(toHex(rampColor('viridis', 1))).toBe('#fde725');
    expect(toHex(rampColor('viridis', 2))).toBe('#fde725');
    expect(toHex(rampColor('unknown', 0))).toBe(toHex(rampColor('terrain', 0)));
  });

  it('fits the whole block in the frame along the home bearing', () => {
    const model = terrainModel(node({ heights: RAMP_ROWS, width: 4000 }));
    const fit = fitCamera(
      [
        [-2, 0, -1.5],
        [2, 1, 1.5],
      ],
      HOME_BEARING,
      16 / 9,
    );
    expect(fit.position.every(Number.isFinite)).toBe(true);
    const offset = fit.position.map((v, i) => v - (fit.target[i] as number));
    const length = Math.hypot(...offset);
    offset.forEach((v, i) => {
      expect(v / length).toBeCloseTo(HOME_BEARING[i] as number, 3);
    });
    expect(model.camera.fov).toBe(30);
  });
});
