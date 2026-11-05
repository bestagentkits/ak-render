import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CLUSTER_LEVELS, clusterLevelAt, shownAt } from '../../src/blocks/three/globe-3d.js';
import {
  arcPoints,
  centralAngle,
  clusterMarkers,
  greatCircleKm,
  isLand,
  landDots,
  toLatLon,
  toVec,
} from '../../src/blocks/three/globe-geo.js';
import { export3dPosterSvg } from '../../src/blocks/three/poster-export.js';
import { compile } from '../../src/render/render.js';
import { normalizeSpec } from '../../src/spec/normalize.js';

/** Compiling the fixtures is slow on Windows CI runners. */
const SLOW = 60_000;

const read = (name: string) =>
  readFileSync(new URL(`../../fixtures/3d/${name}.yaml`, import.meta.url), 'utf8');

function globe(block: Record<string, unknown>, state: Record<string, unknown> = {}) {
  return {
    version: 1,
    meta: { title: 'Globe' },
    state,
    blocks: [{ type: 'globe-3d', id: 'g', summary: 'A globe.', ...block }],
  };
}

function errors(spec: unknown) {
  return normalizeSpec(spec)
    .diagnostics.filter((d) => d.severity === 'error')
    .map((d) => `${d.path}: ${d.message}`);
}

interface Config {
  ids: string[];
  lat: number[];
  lon: number[];
  arcs: number[];
  times: string[];
  center: [number, number];
  clusters: { from: number; of: number[]; centers: number[] }[];
  land: string;
}

function config(html: string): Config {
  const match = /data-ak-3d="globe"[^>]*data-ak-scene="([^"]+)"/u.exec(html);
  const raw = (match?.[1] ?? '{}')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
  return JSON.parse(raw);
}

const near = (a: number[], b: number[], tolerance = 1e-9) =>
  a.every((v, i) => Math.abs(v - (b[i] as number)) < tolerance);

describe('globe-3d geography', () => {
  it('places latitude and longitude on the unit sphere: y north, longitude 0 toward +z', () => {
    expect(near(toVec(0, 0), [0, 0, 1])).toBe(true);
    expect(near(toVec(0, 90), [1, 0, 0])).toBe(true);
    expect(near(toVec(0, -90), [-1, 0, 0])).toBe(true);
    expect(near(toVec(90, 0), [0, 1, 0])).toBe(true);
    expect(near(toVec(-90, 45), [0, -1, 0])).toBe(true);
    for (const [lat, lon] of [
      [51.47, -0.45],
      [-33.94, 151.18],
      [64.13, -21.94],
    ] as const) {
      const [back, forth] = toLatLon(toVec(lat, lon));
      expect(back).toBeCloseTo(lat, 9);
      expect(forth).toBeCloseTo(lon, 9);
    }
  });

  it('measures great-circle distances against known routes', () => {
    // London to New York, Sydney to Singapore, a quarter of the equator.
    expect(greatCircleKm([51.5074, -0.1278], [40.7128, -74.006])).toBeCloseTo(5570, -1);
    expect(greatCircleKm([-33.8688, 151.2093], [1.3521, 103.8198])).toBeCloseTo(6300, -2);
    expect(greatCircleKm([0, 0], [0, 90])).toBeCloseTo((Math.PI / 2) * 6371, 6);
    // Across the antimeridian the short way, not the long way round.
    expect(greatCircleKm([0, 179], [0, -179])).toBeCloseTo(222.4, 0);
  });

  it('draws arcs on the great circle: ends on the surface, lifted in the middle, symmetric', () => {
    const a: [number, number] = [51.47, -0.45];
    const b: [number, number] = [1.36, 103.99];
    const points = arcPoints(a, b, 40);
    expect(near(points[0] as number[], toVec(...a), 1e-9)).toBe(true);
    expect(near(points[40] as number[], toVec(...b), 1e-9)).toBe(true);
    const middle = points[20] as [number, number, number];
    expect(Math.hypot(...middle)).toBeGreaterThan(1.05);
    // The midpoint direction is equidistant from both ends.
    const mid = toLatLon(middle);
    expect(centralAngle(mid, a)).toBeCloseTo(centralAngle(mid, b), 9);
    // Every point stays in the plane of the great circle.
    const [ax, ay, az] = toVec(...a);
    const [bx, by, bz] = toVec(...b);
    const [nx, ny, nz] = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
    for (const p of points) expect(Math.abs(p[0] * nx + p[1] * ny + p[2] * nz)).toBeLessThan(1e-9);
  });

  it('knows land from sea with the bundled Natural Earth outline', () => {
    const land = [
      [50, 10],
      [23, 10],
      [-10, -50],
      [-25, 135],
      [65, 140],
      [-85, 0],
      [40, -100],
    ];
    const sea = [
      [0, -30],
      [0, -150],
      [-20, 75],
      [60, -85],
      [35, 18],
    ];
    for (const [lat, lon] of land) expect(isLand(lat as number, lon as number)).toBe(true);
    for (const [lat, lon] of sea) expect(isLand(lat as number, lon as number)).toBe(false);
    // About 29% of the surface is land; the dot lattice agrees.
    const dots = landDots(4000).length / 4000;
    expect(dots).toBeGreaterThan(0.25);
    expect(dots).toBeLessThan(0.33);
  });

  it('clusters nearby markers heaviest first and keeps the spec order on ties', () => {
    const points: [number, number][] = [
      [48.85, 2.35],
      [51.5, -0.12],
      [50.85, 4.35],
      [35.68, 139.69],
    ];
    const wide = clusterMarkers(points, [1, 5, 1, 1], 7);
    expect(wide.of).toEqual([0, 0, 0, 1]);
    expect(wide.sizes).toEqual([3, 1]);
    const tight = clusterMarkers(points, [1, 5, 1, 1], 2.5);
    expect(tight.sizes.reduce((a, b) => a + b, 0)).toBe(4);
    expect(tight.centers.length).toBeGreaterThan(wide.centers.length);
    expect(clusterLevelAt(CLUSTER_LEVELS, 7)).toBe(0);
    expect(clusterLevelAt(CLUSTER_LEVELS, 4.6)).toBe(1);
    expect(clusterLevelAt(CLUSTER_LEVELS, 3)).toBe(2);
    expect(clusterLevelAt(CLUSTER_LEVELS, 1.8)).toBe(-1);
  });

  it('filters time at the precision of the cutoff', () => {
    expect(shownAt('2019', '2020')).toBe(true);
    expect(shownAt('2021', '2020')).toBe(false);
    expect(shownAt('2020-11-30', '2020')).toBe(true);
    expect(shownAt('2020-11', '2020-10')).toBe(false);
    expect(shownAt('', '2000')).toBe(true);
    expect(shownAt('2030', '')).toBe(true);
  });
});

describe('globe-3d contract', () => {
  it(
    'compiles the routes fixture byte-identically with places, routes and distances',
    () => {
      const runs = [0, 1, 2].map(() => compile(read('globe-3d-routes'), { source: 'globe' }).html);
      expect(runs[1]).toBe(runs[0]);
      expect(runs[2]).toBe(runs[0]);
      const html = runs[0] as string;
      expect(html).toContain('data-ak-3d="globe"');
      expect(html).toContain('class="ak-3d-poster ak-globe-poster"');
      expect(html).toContain('<caption>24 places</caption>');
      expect(html).toContain('<caption>26 routes</caption>');
      expect(html).toContain('data-ak-3d-pick="sin" aria-pressed="true"');
      // Coordinates read with hemispheres, distances by great circle.
      expect(html).toContain('<td>33.94° S</td><td>151.18° E</td>');
      const km = Math.round(greatCircleKm([40.64, -73.78], [51.47, -0.45]));
      expect(html).toContain(`<td>${km.toLocaleString('en-US')} km</td>`);
      const data = config(html);
      expect(data.ids).toHaveLength(24);
      expect(data.lat[data.ids.indexOf('syd')]).toBe(-33.94);
      expect(data.lon[data.ids.indexOf('syd')]).toBe(151.18);
      expect(data.times).toEqual([
        '2016',
        '2017',
        '2018',
        '2019',
        '2020',
        '2021',
        '2022',
        '2023',
        '2024',
      ]);
      expect(data.land.split(';').length).toBeGreaterThan(100);
    },
    SLOW,
  );

  it(
    'compiles 500 markers and 200 arcs from the compact lists, every coordinate kept',
    () => {
      const source = read('globe-3d-stress');
      const first = compile(source, { source: 'stress' });
      expect(compile(source, { source: 'stress' }).html).toBe(first.html);
      const data = config(first.html);
      expect(data.ids).toHaveLength(500);
      expect(data.arcs).toHaveLength(400);
      expect(first.html).toContain('<caption>500 places</caption>');
      expect(first.html).toContain('<caption>200 routes</caption>');
      const line = /^ {6}(s\d{3}) (\S+) (\S+) /mu.exec(source) as RegExpExecArray;
      const at = data.ids.indexOf(line[1] as string);
      expect(data.lat[at]).toBe(Number(line[2]));
      expect(data.lon[at]).toBe(Number(line[3]));
      // Every marker sits in exactly one cluster at each level.
      for (const level of data.clusters) {
        expect(level.of).toHaveLength(500);
        expect(Math.max(...level.of)).toBe(level.centers.length / 2 - 1);
      }
    },
    SLOW,
  );

  it(
    'projects the poster through the home camera: the centre faces the reader, the far side is hidden',
    () => {
      const html = compile(
        globe({
          center: [10, 20],
          cluster: false,
          markers: [
            { id: 'here', lat: 10, lon: 20 },
            { id: 'far', lat: -10, lon: -160 },
            { id: 'east', lat: 10, lon: 60 },
          ],
        }),
      ).html;
      const circles = [
        ...html.matchAll(
          /class="ak-3d-mark ak-globe-marker"[^>]*><circle cx="([\d.]+)" cy="([\d.]+)"/gu,
        ),
      ];
      // The antipode is behind the globe.
      expect(circles).toHaveLength(2);
      expect(Number(circles[0]?.[1])).toBeCloseTo(320, 0);
      expect(Number(circles[0]?.[2])).toBeCloseTo(180, 0);
      // East is to the right on screen.
      expect(Number(circles[1]?.[1])).toBeGreaterThan(360);
      expect(config(html).center).toEqual([10, 20]);
    },
    SLOW,
  );

  it(
    'opens on the state: the selected marker is home, and rows past the time cutoff are out',
    () => {
      const html = compile(
        globe(
          {
            bind: 'state.place',
            timeBind: 'state.year',
            cluster: false,
            markers: [
              { id: 'old', lat: 0, lon: 0, time: '2019' },
              { id: 'mid', lat: 30, lon: 100, time: '2019-05' },
              { id: 'new', lat: 10, lon: 10, time: '2019-08' },
            ],
            arcs: [
              { from: 'old', to: 'mid' },
              { from: 'old', to: 'new' },
            ],
          },
          { place: 'mid', year: '2019-06' },
        ),
      ).html;
      expect(config(html).center).toEqual([30, 100]);
      expect(html).toMatch(/data-ak-globe-row="mid"[^>]*>/u);
      expect(/data-ak-globe-row="mid"[^>]*>/u.exec(html)?.[0]).not.toContain('data-ak-globe-out');
      expect(/data-ak-globe-row="new"[^>]*>/u.exec(html)?.[0]).toContain('data-ak-globe-out');
      expect(/data-ak-globe-arc="1"[^>]*>/u.exec(html)?.[0]).toContain('data-ak-globe-out');
      expect(/data-ak-globe-arc="0"[^>]*>/u.exec(html)?.[0]).not.toContain('data-ak-globe-out');
      // The slider stands on the last step the cutoff shows.
      expect(html).toMatch(/data-ak-globe-time aria-valuetext="2019-05"/u);
    },
    SLOW,
  );

  it(
    'gives untoned layers distinct tones',
    () => {
      const ids = ['a', 'b', 'c', 'd', 'e'];
      const html = compile(
        globe({
          layers: ids.map((id) => ({ id })),
          markers: ids.map((id, i) => ({ id, lat: i * 10, lon: 0, layer: id })),
        }),
      ).html;
      const tones = [
        ...html.matchAll(
          /data-ak-globe-layer="\w"[^>]*><span class="ak-net-swatch" data-tone="(\w+)"/gu,
        ),
      ].map((m) => m[1]);
      expect(tones).toHaveLength(5);
      expect(new Set(tones).size).toBe(5);
      expect(tones).not.toContain('warning');
    },
    SLOW,
  );

  it(
    'draws clusters with their counts on the poster when markers crowd',
    () => {
      const markers = [
        { id: 'a', lat: 48.85, lon: 2.35 },
        { id: 'b', lat: 51.5, lon: -0.12 },
        { id: 'c', lat: 50.85, lon: 4.35 },
        { id: 'd', lat: 40.71, lon: -74 },
      ];
      const clustered = compile(globe({ markers, center: [45, -20] })).html;
      expect(clustered).toMatch(
        /class="ak-3d-mark ak-globe-cluster"[^>]*><circle[^>]*\/><text[^>]*>3<\/text>/u,
      );
      const plain = compile(globe({ markers, center: [45, -20], cluster: false })).html;
      expect(plain).not.toContain('class="ak-3d-mark ak-globe-cluster"');
      expect(config(plain).clusters).toEqual([]);
    },
    SLOW,
  );

  it(
    'exports the poster as a standalone SVG with the globe styles',
    () => {
      const svg = export3dPosterSvg(
        globe({
          markers: [
            { id: 'a', lat: 1, lon: 2 },
            { id: 'b', lat: 40, lon: -70 },
          ],
          arcs: [{ from: 'a', to: 'b' }],
        }),
        { scheme: 'dark' },
      );
      expect(svg).toContain('.ak-globe-land{');
      expect(svg).toContain('class="ak-3d-mark ak-globe-arc"');
      expect(svg.startsWith('<?xml')).toBe(true);
    },
    SLOW,
  );

  it('reports duplicate ids, unknown layers and endpoints, self-routes and bad times at exact paths', () => {
    const layers = [{ id: 'hubs' }];
    expect(
      errors(
        globe({
          layers,
          markers: [
            { id: 'a', lat: 0, lon: 0, layer: 'hubs' },
            { id: 'a', lat: 1, lon: 1, layer: 'ghost' },
            { id: 'b', lat: 2, lon: 2, time: '2020-13' },
          ],
          arcs: [
            { from: 'a', to: 'nowhere' },
            { from: 'b', to: 'b' },
          ],
        }),
      ),
    ).toEqual([
      '$.blocks[0].markers[1].id: marker id "a" is used twice',
      '$.blocks[0].markers[1].layer: layer "ghost" is not listed in layers',
      '$.blocks[0].markers[2].time: "2020-13" is not a date as YYYY, YYYY-MM or YYYY-MM-DD',
      '$.blocks[0].arcs[0].to: "nowhere" is not a marker id on this globe',
      '$.blocks[0].arcs[1].to: arc links "b" to itself',
    ]);
    expect(errors(globe({ markers: [] }))).toContain(
      '$.blocks[0].markers: a globe needs at least one marker in `markers` or `markerList`',
    );
    expect(errors(globe({ markers: [{ id: 'a', lat: 95, lon: 0 }] })).join()).toMatch(/lat/u);
  });

  it(
    'reads compact lines and names the line of each problem',
    () => {
      const spec = globe({
        layers: [{ id: 'hubs' }],
        markerList:
          'a 10 20 hubs 5 2020 Alpha city\nb -5 -40 - - - Beta\nc 99 0\nd 1 2 hubs many\n',
        arcList: 'a>b hubs 3 2021\na-b\na>zz',
      });
      expect(errors(spec)).toEqual([
        '$.blocks[0].markerList: line 3: latitude "99" must be a number from -90 to 90',
        '$.blocks[0].markerList: line 4: "many" is not a value of zero or more',
        '$.blocks[0].arcList: line 2: "a-b" is not a `from>to` route',
        '$.blocks[0].arcList: line 3: "zz" is not a marker id on this globe',
      ]);
      const html = compile(
        globe({
          layers: [{ id: 'hubs' }],
          markerList: 'a 10 20 hubs 5 2020 Alpha city\nb -5 -40 - - - Beta',
          arcList: 'a>b hubs 3 2021',
        }),
      ).html;
      expect(html).toContain('<span class="ak-3d-name">Alpha city</span>');
      expect(html).toContain('<span class="ak-3d-name">Beta</span>');
      expect(html).toContain('<caption>1 route</caption>');
    },
    SLOW,
  );

  it('caps a globe at 1000 markers across both lists', () => {
    const markerList = Array.from({ length: 1001 }, (_, i) => `m${i} 0 ${(i % 360) - 180}`).join(
      '\n',
    );
    expect(errors(globe({ markerList }))).toContain(
      '$.blocks[0].markers: a globe holds at most 1000 markers',
    );
  });

  it('keeps the vocabulary closed: unknown tones and shader keys fail', () => {
    expect(
      errors(globe({ markers: [{ id: 'a', lat: 0, lon: 0 }], layers: [{ id: 'x', tone: 'neon' }] }))
        .length,
    ).toBe(1);
    expect(
      errors(globe({ markers: [{ id: 'a', lat: 0, lon: 0 }], fragmentShader: 'void main(){}' }))
        .length,
    ).toBeGreaterThan(0);
  });
});
