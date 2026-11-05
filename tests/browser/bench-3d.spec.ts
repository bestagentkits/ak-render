import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, release, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { exportPage } from '../../src/export/page-export.js';
import { compile, VERSION } from '../../src/index.js';
import { browserWorkspace } from './browser-workspace.js';

// Frame time, draw calls, context loss, disposal and export reliability for
// the 3D runtime. `pnpm bench:3d` writes the versioned baseline under
// docs/artifacts; a plain browser test run only checks that the numbers hold.

const FIXTURES = ['scene-3d-basic', 'scene-3d-dense'] as const;
const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812, isMobile: true, hasTouch: true },
  { name: 'tablet', width: 768, height: 1024, isMobile: true, hasTouch: true },
  { name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false },
] as const;
const FRAMES = 120;
const EXPORT_RUNS = 5;
const writeBaseline = process.env.npm_lifecycle_event === 'bench:3d';

const fixtureDir = fileURLToPath(new URL('../../fixtures/3d/', import.meta.url));
const artifactDir = writeBaseline
  ? fileURLToPath(new URL('../../docs/artifacts/', import.meta.url))
  : join(tmpdir(), 'ak-render-bench-3d');
const workspace = browserWorkspace('bench-3d');

interface ViewportRun {
  viewport: string;
  width: number;
  frameMs: { p50: number; p95: number };
  calls: number;
  triangles: number;
  contextLoss: { lostState: string; restoredState: string };
  disposal: { cyclesLeak: boolean; emptyAfterUnmount: boolean };
}

interface FixtureRun {
  fixture: string;
  specBytes: number;
  specTokensEstimate: number;
  htmlBytes: number;
  viewports: ViewportRun[];
  export: { format: 'png'; runs: number; ok: number; ms: { p50: number; p95: number } };
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const value = sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return Math.round(value * 100) / 100;
}

function source(name: string): string {
  return readFileSync(join(fixtureDir, `${name}.yaml`), 'utf8');
}

async function measureFrames(page: Page): Promise<{ p50: number; p95: number }> {
  const deltas = await page.evaluate(
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
  const sorted = [...deltas].sort((a, b) => a - b);
  return { p50: quantile(sorted, 0.5), p95: quantile(sorted, 0.95) };
}

type Api = Record<'stats' | 'unmountAll' | 'mountAll', () => unknown>;

async function stats(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { akRender3d: Api }).akRender3d.stats() as {
        mounts: number;
        geometries: number;
        calls: number;
        triangles: number;
      },
  );
}

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
  return page.evaluate(() => {
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
    return { cyclesLeak: after !== warm, emptyAfterUnmount: count() === '0/0' };
  });
}

async function gpuInfo(page: Page): Promise<string> {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return 'no webgl2';
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  });
}

function markdown(artifact: { meta: Record<string, string>; fixtures: FixtureRun[] }): string {
  const lines = [
    '# 3D benchmark',
    '',
    'Produced by `pnpm bench:3d` (`tests/browser/bench-3d.spec.ts`). Frame time is measured over',
    `${FRAMES} animation frames per viewport; draw calls come from \`renderer.info\`, which counts`,
    'calls and triangles, not GPU memory. Spec tokens are an estimate (bytes / 4), not a model count.',
    '',
    Object.entries(artifact.meta)
      .map(([key, value]) => `- ${key}: ${value}`)
      .join('\n'),
    '',
    '| Fixture | Viewport | Frame p50 ms | Frame p95 ms | Draw calls | Triangles | Context loss | 10-cycle leak |',
    '| --- | --- | ---: | ---: | ---: | ---: | --- | --- |',
  ];
  for (const fixture of artifact.fixtures) {
    for (const run of fixture.viewports) {
      lines.push(
        `| ${fixture.fixture} | ${run.viewport} ${run.width} | ${run.frameMs.p50} | ${run.frameMs.p95} | ${run.calls} | ${run.triangles} | ${run.contextLoss.lostState} → ${run.contextLoss.restoredState} | ${run.disposal.cyclesLeak ? 'yes' : 'no'} |`,
      );
    }
  }
  lines.push(
    '',
    '| Fixture | Spec bytes | Spec tokens (est.) | Agent round-trips | HTML bytes | PNG export ok | Export p50 ms | Export p95 ms |',
    '| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: |',
  );
  for (const f of artifact.fixtures) {
    lines.push(
      `| ${f.fixture} | ${f.specBytes} | ${f.specTokensEstimate} | 2 (render, export) | ${f.htmlBytes} | ${f.export.ok}/${f.export.runs} | ${f.export.ms.p50} | ${f.export.ms.p95} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

test.describe.configure({ mode: 'serial' });

test('3D benchmark: frame time, draw calls, context loss, disposal and export', async ({
  browser,
  browserName,
}) => {
  test.setTimeout(300_000);
  const results: FixtureRun[] = [];
  let gpu = '';

  for (const name of FIXTURES) {
    const spec = source(name);
    const html = compile(spec, { source: name }).html;
    const url = `file://${workspace.write(name, html)}`;
    const viewports: ViewportRun[] = [];

    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.isMobile,
        hasTouch: viewport.hasTouch,
      });
      const page = await context.newPage();
      await page.goto(url);
      await page.locator('[data-ak-3d]').scrollIntoViewIfNeeded();
      await expect(page.locator('[data-ak-3d]')).toHaveAttribute('data-ak-3d-state', 'ready');
      if (gpu === '') gpu = await gpuInfo(page);
      const frameMs = await measureFrames(page);
      const { calls, triangles } = await stats(page);
      viewports.push({
        viewport: viewport.name,
        width: viewport.width,
        frameMs,
        calls,
        triangles,
        contextLoss: await contextLoss(page),
        disposal: await disposal(page),
      });
      await context.close();
    }

    const times: number[] = [];
    let ok = 0;
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
        ok += 1;
      } catch {
        // A failed run counts against reliability; the table reports it.
      }
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);

    results.push({
      fixture: name,
      specBytes: Buffer.byteLength(spec),
      specTokensEstimate: Math.round(Buffer.byteLength(spec) / 4),
      htmlBytes: Buffer.byteLength(html),
      viewports,
      export: {
        format: 'png',
        runs: EXPORT_RUNS,
        ok,
        ms: { p50: quantile(times, 0.5), p95: quantile(times, 0.95) },
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
      gpu,
      os: `${platform()} ${release()} ${arch()}`,
      cpu: `${cpus()[0]?.model ?? 'unknown'} x${cpus().length}`,
      emulation: '375 and 768 use mobile + touch emulation in desktop Chromium, not real devices',
    },
    fixtures: results,
  };
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(join(artifactDir, 'benchmark-3d.json'), `${JSON.stringify(artifact, null, 2)}\n`);
  writeFileSync(join(artifactDir, 'benchmark-3d.md'), markdown(artifact));
  expect(statSync(join(artifactDir, 'benchmark-3d.json')).size).toBeGreaterThan(0);

  for (const fixture of results) {
    expect(fixture.export.ok, `${fixture.fixture} export reliability`).toBe(fixture.export.runs);
    for (const run of fixture.viewports) {
      expect(run.calls, `${fixture.fixture} ${run.viewport} draws`).toBeGreaterThan(0);
      expect(run.disposal.cyclesLeak, `${fixture.fixture} ${run.viewport} leak`).toBe(false);
      expect(run.disposal.emptyAfterUnmount).toBe(true);
      expect(run.contextLoss.restoredState).not.toBe('lost');
    }
  }
});
