import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, release, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { ExportError, exportPage, pickBrowser } from '../../src/export/page-export.js';
import { compile, VERSION } from '../../src/index.js';
import { browserWorkspace } from './browser-workspace.js';

// Frame time, render time, draw calls, context loss, disposal and export
// reliability for the 3D runtime. Tagged @bench, so only `pnpm bench:3d` runs
// it: that compares draws against the committed baseline, and
// `pnpm bench:3d:update` (Playwright's --update-snapshots) rewrites it.

const FIXTURES = ['scene-3d-basic', 'scene-3d-dense'] as const;
const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812, scale: 1, isMobile: true, hasTouch: true },
  { name: 'tablet', width: 768, height: 1024, scale: 1, isMobile: true, hasTouch: true },
  { name: 'desktop', width: 1440, height: 900, scale: 1, isMobile: false, hasTouch: false },
  { name: 'desktop-2x', width: 1440, height: 900, scale: 2, isMobile: false, hasTouch: false },
] as const;
const FRAMES = 120;
const EXPORT_RUNS = 5;
/** Agent calls a 3D page task takes: render the spec, export the still. Assumed, not measured. */
const ROUND_TRIPS = 2;

const fixtureDir = fileURLToPath(new URL('../../fixtures/3d/', import.meta.url));
const baselineDir = fileURLToPath(new URL('../../docs/artifacts/', import.meta.url));
const workspace = browserWorkspace('bench-3d');

interface ViewportRun {
  viewport: string;
  width: number;
  dpr: number;
  profile: string;
  frameMs: { p50: number; p95: number };
  renderMs: { p50: number; p95: number };
  calls: number;
  triangles: number;
  contextLoss: { lostState: string; restoredState: string };
  disposal: { cyclesLeak: boolean; emptyAfterUnmount: boolean; remountState: string };
}

interface FixtureRun {
  fixture: string;
  htmlBytes: number;
  agent: { specBytes: number; specTokensEstimate: number; roundTrips: number; source: 'assumed' };
  viewports: ViewportRun[];
  export: {
    format: 'png';
    browser: string;
    runs: number;
    ok: number;
    ms: { p50: number; max: number };
    errors: { code: string; message: string }[];
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const thousands = (n: number) => n.toLocaleString('en-US');
const ms = (n: number) => n.toFixed(1);

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  return round1(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0);
}

async function frameDeltas(page: Page): Promise<number[]> {
  return page.evaluate(
    (count) =>
      new Promise<number[]>((resolve) => {
        const out: number[] = [];
        let last = performance.now();
        const step = (now: number) => {
          out.push(now - last);
          last = now;
          if (out.length < count) requestAnimationFrame(step);
          else resolve(out.slice(1));
        };
        requestAnimationFrame(step);
      }),
    FRAMES,
  );
}

type Api = Record<'stats' | 'unmountAll' | 'mountAll', () => unknown>;
interface Stats {
  mounts: number;
  geometries: number;
  calls: number;
  triangles: number;
  profile: string;
  renderMs: number[];
}

const stats = (page: Page) =>
  page.evaluate(() => (window as unknown as { akRender3d: Api }).akRender3d.stats() as Stats);

async function contextLoss(page: Page) {
  return page.evaluate(async () => {
    const el = document.querySelector('[data-ak-3d]') as HTMLElement;
    const canvas = el.querySelector('canvas') as HTMLCanvasElement;
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    const ext = gl?.getExtension('WEBGL_lose_context');
    if (!ext) return { lostState: 'unsupported', restoredState: 'unsupported' };
    const wait = (state: string) =>
      new Promise<string>((resolve) => {
        const start = performance.now();
        const poll = () => {
          const now = el.getAttribute('data-ak-3d-state') ?? '';
          if (now === state || performance.now() - start > 3000) resolve(now);
          else setTimeout(poll, 20);
        };
        poll();
      });
    ext.loseContext();
    const lostState = await wait('lost');
    ext.restoreContext();
    const restoredState = await wait('ready');
    return { lostState, restoredState };
  });
}

async function disposal(page: Page) {
  const result = await page.evaluate(() => {
    const api = (window as unknown as { akRender3d: Api }).akRender3d;
    const count = () => {
      const { mounts, geometries } = api.stats() as { mounts: number; geometries: number };
      return `${mounts}/${geometries}`;
    };
    const warm = count();
    for (let i = 0; i < 10; i += 1) {
      api.unmountAll();
      api.mountAll();
    }
    const after = count();
    api.unmountAll();
    const empty = count() === '0/0';
    api.mountAll();
    return { cyclesLeak: after !== warm, emptyAfterUnmount: empty };
  });
  await expect(page.locator('[data-ak-3d]')).toHaveAttribute('data-ak-3d-state', 'ready');
  const remountState = (await page.locator('[data-ak-3d]').getAttribute('data-ak-3d-state')) ?? '';
  return { ...result, remountState };
}

async function gpuInfo(page: Page): Promise<string> {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return 'no webgl2';
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  });
}

interface Artifact {
  meta: Record<string, string | boolean>;
  fixtures: FixtureRun[];
}

function markdown(artifact: Artifact): string {
  const { meta } = artifact;
  const lines = [
    '# 3D benchmark',
    '',
    'Produced by `pnpm bench:3d:update` (`tests/browser/bench-3d.spec.ts`); `pnpm bench:3d` re-runs it',
    'and fails when draw calls or triangles drift from this baseline.',
    '',
    `- **Frame ms** is the gap between ${FRAMES} animation frames. It is vsync-capped (16.7 ms at 60 Hz), so it shows dropped frames, not headroom.`,
    '- **Render ms** times `renderer.render` alone on the CPU side of the call; it is the cost to compare.',
    '- **Draws** and **triangles** come from `renderer.info`; they are not a GPU memory measurement.',
    '- **Profile** is the runtime quality tier and device pixel ratio: `low` (coarse pointer) has no shadows or antialiasing, so rows with different profiles are not comparable.',
    meta.softwareGpu
      ? '- **Software renderer.** This baseline ran on a software GPU (SwiftShader), headless; real hardware is faster. Compare runs on the same machine only.'
      : '- Hardware GPU.',
    '',
    Object.entries(meta)
      .map(([key, value]) => `- ${key}: ${value}`)
      .join('\n'),
    '',
    '| Fixture | Viewport | Profile | Frame p50 / p95 ms | Render p50 / p95 ms | Draws | Triangles | Context loss | 10-cycle leak |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |',
  ];
  for (const fixture of artifact.fixtures) {
    for (const run of fixture.viewports) {
      lines.push(
        `| ${fixture.fixture} | ${run.viewport} ${run.width} | ${run.profile} | ${ms(run.frameMs.p50)} / ${ms(run.frameMs.p95)} | ${ms(run.renderMs.p50)} / ${ms(run.renderMs.p95)} | ${thousands(run.calls)} | ${thousands(run.triangles)} | ${run.contextLoss.lostState} → ${run.contextLoss.restoredState} | ${run.disposal.cyclesLeak ? 'yes' : 'no'} |`,
      );
    }
  }
  lines.push(
    '',
    `Agent cost is assumed, not measured: spec tokens are bytes / 4 and a page task is ${ROUND_TRIPS} calls (render, export). User tokens are not measured here; \`pnpm bench:agent\` measures live-model tokens.`,
    '',
    `| Fixture | Spec bytes | Spec tokens (assumed) | Round-trips (assumed) | HTML bytes | PNG export ok | Export p50 ms | Export max ms (n=${EXPORT_RUNS}) |`,
    '| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: |',
  );
  for (const f of artifact.fixtures) {
    lines.push(
      `| ${f.fixture} | ${thousands(f.agent.specBytes)} | ${thousands(f.agent.specTokensEstimate)} | ${f.agent.roundTrips} | ${thousands(f.htmlBytes)} | ${f.export.ok}/${f.export.runs} | ${ms(f.export.ms.p50)} | ${ms(f.export.ms.max)} |`,
    );
  }
  lines.push('', 'Export time includes launching the browser.');
  return `${lines.join('\n')}\n`;
}

test('3D benchmark @bench', async ({ browser, browserName }, testInfo) => {
  test.setTimeout(400_000);
  const results: FixtureRun[] = [];
  let gpu = '';
  const exportBrowser = (await pickBrowser()).path;

  for (const name of FIXTURES) {
    const spec = readFileSync(join(fixtureDir, `${name}.yaml`), 'utf8');
    const html = compile(spec, { source: name }).html;
    const url = `file://${workspace.write(name, html)}`;
    const viewports: ViewportRun[] = [];

    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: viewport.scale,
        isMobile: viewport.isMobile,
        hasTouch: viewport.hasTouch,
      });
      const page = await context.newPage();
      await page.goto(url);
      await page.locator('[data-ak-3d]').scrollIntoViewIfNeeded();
      await expect(page.locator('[data-ak-3d]')).toHaveAttribute('data-ak-3d-state', 'ready');
      if (gpu === '') gpu = await gpuInfo(page);
      const deltas = await frameDeltas(page);
      const { calls, triangles, profile, renderMs } = await stats(page);
      viewports.push({
        viewport: viewport.name,
        width: viewport.width,
        dpr: viewport.scale,
        profile,
        frameMs: { p50: quantile(deltas, 0.5), p95: quantile(deltas, 0.95) },
        renderMs: { p50: quantile(renderMs, 0.5), p95: quantile(renderMs, 0.95) },
        calls,
        triangles,
        contextLoss: await contextLoss(page),
        disposal: await disposal(page),
      });
      await context.close();
    }

    const times: number[] = [];
    const errors: { code: string; message: string }[] = [];
    const outDir = join(tmpdir(), 'ak-render-bench-3d-export');
    mkdirSync(outDir, { recursive: true });
    for (let run = 0; run < EXPORT_RUNS; run += 1) {
      const start = performance.now();
      try {
        await exportPage({
          html,
          baseDir: fixtureDir,
          format: 'png',
          out: join(outDir, `${name}-${run}.png`),
          scale: 1,
        });
      } catch (error) {
        errors.push({
          code: error instanceof ExportError ? error.code : 'unknown',
          message: error instanceof Error ? error.message : String(error),
        });
      }
      times.push(performance.now() - start);
    }

    const specBytes = Buffer.byteLength(spec);
    results.push({
      fixture: name,
      htmlBytes: Buffer.byteLength(html),
      agent: {
        specBytes,
        specTokensEstimate: Math.round(specBytes / 4),
        roundTrips: ROUND_TRIPS,
        source: 'assumed',
      },
      viewports,
      export: {
        format: 'png',
        browser: exportBrowser,
        runs: EXPORT_RUNS,
        ok: EXPORT_RUNS - errors.length,
        ms: { p50: quantile(times, 0.5), max: round1(Math.max(...times)) },
        errors,
      },
    });
  }

  const artifact = {
    artifact: 'benchmark-3d',
    producer: 'tests/browser/bench-3d.spec.ts',
    measuredAt: new Date().toISOString(),
    compiler: { name: '@bestagentkits/render', version: VERSION },
    meta: {
      browser: `${browserName} ${browser.version()}`,
      headless: testInfo.project.use.headless !== false,
      gpu,
      softwareGpu: /swiftshader|llvmpipe|software/i.test(gpu),
      os: `${platform()} ${release()} ${arch()}`,
      cpu: `${cpus()[0]?.model ?? 'unknown'} x${cpus().length}`,
      emulation: '375 and 768 use mobile and touch emulation in desktop Chromium, not real devices',
    },
    fixtures: results,
  };

  const update = ['all', 'changed'].includes(testInfo.config.updateSnapshots);
  const baselinePath = join(baselineDir, 'benchmark-3d.json');
  const outDir = update ? baselineDir : join(tmpdir(), 'ak-render-bench-3d');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'benchmark-3d.json'), `${JSON.stringify(artifact, null, 2)}\n`);
  writeFileSync(join(outDir, 'benchmark-3d.md'), markdown(artifact));

  for (const fixture of results) {
    expect(fixture.export.errors, `${fixture.fixture} export`).toEqual([]);
    for (const run of fixture.viewports) {
      const label = `${fixture.fixture} ${run.viewport}`;
      expect(run.calls, `${label} draws`).toBeGreaterThan(0);
      expect(run.contextLoss, `${label} context loss`).toEqual({
        lostState: 'lost',
        restoredState: 'ready',
      });
      expect(run.disposal, `${label} disposal`).toEqual({
        cyclesLeak: false,
        emptyAfterUnmount: true,
        remountState: 'ready',
      });
    }
  }

  if (!update && existsSync(baselinePath)) {
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Artifact;
    const draws = (fixtures: FixtureRun[]) =>
      fixtures.flatMap((f) =>
        f.viewports.map((v) => `${f.fixture} ${v.viewport}: ${v.calls} calls, ${v.triangles} tris`),
      );
    expect(draws(results), 'draws drifted; run pnpm bench:3d:update if intended').toEqual(
      draws(baseline.fixtures),
    );
  }
});
