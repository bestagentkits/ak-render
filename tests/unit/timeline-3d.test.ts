import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { export3dPosterSvg } from '../../src/blocks/three/poster-export.js';
import {
  dateKey,
  fitDistance,
  milestoneCamera,
  milestonePoints,
  overviewDir,
  resolveLayout,
  type Vec3,
} from '../../src/blocks/three/timeline-layout.js';
import { compile } from '../../src/render/render.js';
import { normalizeSpec } from '../../src/spec/normalize.js';

/** Compiling inlines the 3D runtime; slow CI runners need more than the default. */
const SLOW = 30_000;
const fixture = (name: string) =>
  readFileSync(new URL(`../../fixtures/3d/${name}.yaml`, import.meta.url), 'utf8');

function spec(block: Record<string, unknown>, state: Record<string, unknown> = {}) {
  return {
    version: 1,
    meta: { title: 'Timeline' },
    state,
    blocks: [{ type: 'timeline-3d', id: 't', summary: 'A timeline.', ...block }],
  };
}
const three = [
  { id: 'a', label: 'A', date: '2001' },
  { id: 'b', label: 'B', date: '2002-05' },
  { id: 'c', label: 'C', date: '2002-05-09', tone: 'warning' },
];
function errors(input: unknown) {
  return normalizeSpec(input)
    .diagnostics.filter((d) => d.severity === 'error')
    .map((d) => `${d.path}: ${d.message}`);
}
interface Config {
  objects: { id: string; position: number[] }[];
  track: { layout: string; initial: number; bind?: string; milestones: { id: string }[] };
}
function sceneOf(html: string): Config {
  const raw = (/data-ak-scene="([^"]*)"/u.exec(html)?.[1] ?? '{}')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
  return JSON.parse(raw);
}

describe('timeline-3d contract', () => {
  it(
    'compiles the 100-milestone fixture in order, deterministically, with an ordered fallback list',
    () => {
      const first = compile(fixture('timeline-3d-hundred'), { source: 'x' }).html;
      expect(compile(fixture('timeline-3d-hundred'), { source: 'x' }).html).toBe(first);
      const config = sceneOf(first);
      expect(config.track.layout).toBe('spiral');
      const ids = config.track.milestones.map((m) => m.id);
      expect(ids).toHaveLength(100);
      expect(ids).toEqual(
        Array.from({ length: 100 }, (_, i) => `s${String(i + 1).padStart(3, '0')}`),
      );
      expect(config.objects.map((o) => o.id)).toEqual(ids);
      const listed = [...first.matchAll(/data-ak-tl-milestone="([^"]+)"/gu)].map((m) => m[1]);
      expect(listed).toEqual(ids);
      expect(first).toContain('<ol class="ak-tl-list"');
      // The bound sprint is current; the scrubber and card start there.
      expect(config.track.initial).toBe(49);
      expect(first).toContain('data-ak-tl-current="s050"');
      expect(first).toContain('value="50"');
      expect(first).toContain('050 / 100');
      expect(first).toMatch(/<svg class="ak-3d-poster ak-tl-poster"/u);
    },
    SLOW,
  );

  it(
    'rejects duplicate ids and dates out of order',
    () => {
      expect(errors(spec({ milestones: [three[0], { ...three[1], id: 'a' }] }))).toEqual([
        expect.stringContaining('milestone id "a" is used twice'),
      ]);
      const late = errors(spec({ milestones: [three[2], three[0]] }));
      expect(late).toEqual([expect.stringContaining('must run in time order')]);
      expect(late[0]).toContain('milestones[1].date');
      // Free-text dates are shown as written and never ordered.
      expect(errors(spec({ milestones: [{ ...three[1], date: 'Q3' }, three[0]] }))).toEqual([]);
      expect(errors(spec({ milestones: [three[0]] }))).not.toEqual([]);
    },
    SLOW,
  );

  it(
    'escapes author text and exports a label-free poster',
    () => {
      const html = compile(spec({ milestones: [{ id: 'x', label: '<b>&' }, three[1]] })).html;
      expect(html).toContain('&lt;b&gt;&amp;');
      expect(html).not.toContain('<b>&');
      const svg = export3dPosterSvg(fixture('timeline-3d-space'), {
        scheme: 'auto',
        labels: false,
      });
      expect(svg).toContain('class="ak-3d-poster ak-tl-poster"');
      expect(svg).toContain('.ak-tl-halo{');
      expect(svg).toContain('text{display:none}');
      expect(export3dPosterSvg(fixture('morph-3d-shapes'))).not.toContain('.ak-tl-halo');
    },
    SLOW,
  );
});

describe('timeline-3d layout', () => {
  it('chooses ribbon for few milestones and spiral for many', () => {
    expect(resolveLayout('auto', 12)).toBe('ribbon');
    expect(resolveLayout(undefined, 100)).toBe('spiral');
    expect(resolveLayout('line', 100)).toBe('line');
  });

  it('spaces spiral milestones evenly and never overlapping', () => {
    const points = milestonePoints('spiral', 100);
    for (let i = 1; i < points.length; i += 1) {
      const [a, b] = [points[i - 1] as Vec3, points[i] as Vec3];
      const gap = Math.hypot(a[0] - b[0], a[2] - b[2]);
      expect(gap).toBeGreaterThan(1.1);
      expect(gap).toBeLessThan(1.4);
    }
  });

  it('frames every milestone and looks at each close-up from the overview side', () => {
    const points = milestonePoints('ribbon', 12);
    expect(fitDistance(points, [0, 0, 0], overviewDir('ribbon'), 16 / 9)).toBeGreaterThan(5);
    const view = milestoneCamera(points, 3, 'ribbon');
    const home = overviewDir('ribbon');
    const [dx, , dz] = view.position.map((p, i) => p - (view.target[i] as number)) as Vec3;
    expect(dx * home[0] + dz * home[2]).toBeGreaterThan(0);
  });

  it('orders ISO-like dates and ignores free text', () => {
    expect(dateKey('1969') as number).toBeLessThan(dateKey('1969-07') as number);
    expect(dateKey('1969-07-20') as number).toBeGreaterThan(dateKey('1969-07') as number);
    expect(dateKey('-500') as number).toBeLessThan(dateKey('12') as number);
    expect(dateKey('Q3 2024')).toBeNull();
    expect(dateKey('2024-13')).toBeNull();
  });
});
