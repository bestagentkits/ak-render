import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { createModelResolver } from '../../src/assets/model-assets.js';
import { exportPage } from '../../src/export/page-export.js';
import { compile } from '../../src/render/render.js';
import { browserWorkspace } from './browser-workspace.js';

const fixtures = fileURLToPath(new URL('../../fixtures/3d', import.meta.url));
const base = readFileSync(join(fixtures, 'model-3d-crate.yaml'), 'utf8');
const workspace = browserWorkspace('model');
const REMOTE = 'https://models.example.test/crate.glb';

function build(spec: string): string {
  return compile(spec, { source: 'model', modelResolver: createModelResolver(fixtures) }).html;
}
function page(name: string, spec: string): string {
  return `file://${workspace.write(name, build(spec))}`;
}
const glbPage = () => page('crate-glb', base);
const gltfPage = () => page('crate-gltf', base.replace('models/crate.glb', 'models/crate.gltf'));
const remotePage = () =>
  page(
    'crate-remote',
    `${base.replace('models/crate.glb', REMOTE)}policy:\n  network:\n    allow: [models]\n`,
  );

/** Collect CSP violations from the first script on. */
async function watchCsp(p: Page): Promise<void> {
  await p.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __csp: string[] }).__csp = seen;
    document.addEventListener('securitypolicyviolation', (event) => {
      seen.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
}
const violations = (p: Page) => p.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
const model = (p: Page) => p.locator('[data-ak-3d="model"]');
const ready = (p: Page) => expect(model(p)).toHaveAttribute('data-ak-3d-state', 'ready');

test.describe('model-3d', () => {
  for (const [kind, url] of [
    ['gltf with relative files', gltfPage],
    ['glb with an embedded texture', glbPage],
  ] as const) {
    test(`loads a ${kind} offline with a clean CSP`, async ({ page: p }) => {
      const requests: string[] = [];
      p.on('request', (request) => {
        if (!/^(file|data|blob):/u.test(request.url())) requests.push(request.url());
      });
      await watchCsp(p);
      await p.goto(url());
      await ready(p);
      expect(await violations(p)).toEqual([]);
      expect(requests).toEqual([]);
      const triangles = await p.evaluate(
        () =>
          (
            window as unknown as { akRender3d: { stats(): { triangles: number } } }
          ).akRender3d.stats().triangles,
      );
      expect(triangles).toBeGreaterThan(0);
    });
  }

  test('loads an allowed remote model with a clean CSP', async ({ page: p }) => {
    await p.route(`${REMOTE}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'model/gltf-binary',
        headers: { 'access-control-allow-origin': '*' },
        body: readFileSync(join(fixtures, 'models/crate.glb')),
      }),
    );
    await watchCsp(p);
    await p.goto(remotePage());
    await ready(p);
    expect(await violations(p)).toEqual([]);
  });

  test('a page without a model keeps connect-src none', () => {
    const html = compile(readFileSync(join(fixtures, 'scene-3d-basic.yaml'), 'utf8')).html;
    expect(html).toContain('connect-src &#39;none&#39;');
    expect(build(base)).toContain('connect-src data: blob:;');
  });

  test('clip, variant and hotspot flow through page state', async ({ page: p }) => {
    await p.goto(glbPage());
    await ready(p);
    await expect(model(p)).toHaveAttribute('data-ak-3d-playing', 'Spin');
    await expect(model(p)).toHaveAttribute('data-ak-3d-finish', 'oak');
    await expect(p.locator('[data-ak-3d-pick="latch"]')).toHaveAttribute('aria-pressed', 'true');

    await p.locator('[data-ak-3d-clip="Lift"]').click();
    await expect(model(p)).toHaveAttribute('data-ak-3d-playing', 'Lift');

    const select = p.locator('[data-ak-id="finish-pick"] select');
    await select.selectOption('coral');
    await expect(model(p)).toHaveAttribute('data-ak-3d-finish', 'coral');
    await expect(p.locator('[data-ak-3d-variant="coral"]')).toHaveAttribute('aria-pressed', 'true');
    await p.locator('[data-ak-3d-variant="graphite"]').click();
    await expect(select).toHaveValue('graphite');

    await p.locator('[data-ak-3d-pin="corner"]').click();
    await expect(p.locator('[data-ak-3d-pick="corner"]')).toHaveAttribute('aria-pressed', 'true');
    await p.locator('[data-ak-3d-pick="base"]').click();
    await expect(model(p)).toHaveAttribute('data-ak-3d-selected', 'base');
  });

  test('drag orbits, shift-drag pans and the wheel zooms', async ({ page: p }) => {
    await p.emulateMedia({ reducedMotion: 'reduce' });
    await p.goto(glbPage());
    await ready(p);
    const canvas = p.locator('.ak-3d-canvas');
    const frame = () => canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
    const pin = () => p.locator('[data-ak-3d-pin="latch"]').getAttribute('style');
    const box = await canvas.boundingBox();
    if (box === null) throw new Error('no canvas');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const steps: string[] = [await frame()];
    const pins: (string | null)[] = [await pin()];
    await p.mouse.move(cx, cy);
    await p.mouse.down();
    await p.mouse.move(cx + 120, cy + 20, { steps: 4 });
    await p.mouse.up();
    steps.push(await frame());
    pins.push(await pin());
    await p.keyboard.down('Shift');
    await p.mouse.down();
    await p.mouse.move(cx + 40, cy + 60, { steps: 4 });
    await p.mouse.up();
    await p.keyboard.up('Shift');
    steps.push(await frame());
    pins.push(await pin());
    await p.mouse.wheel(0, -400);
    steps.push(await frame());
    expect(new Set(steps).size).toBe(4);
    expect(new Set(pins).size).toBe(3);
  });

  test('a compressed model fails at compile time with the decoder diagnostic', () => {
    expect(() => build(base.replace('models/crate.glb', 'models/crate-draco.gltf'))).toThrow(
      /KHR_draco_mesh_compression/u,
    );
  });

  test('a decoder or load error in the browser keeps the plan and says why', async ({
    page: p,
  }) => {
    await p.route(`${REMOTE}`, (route) => route.fulfill({ status: 404, body: '' }));
    await p.goto(remotePage());
    await expect(model(p)).toHaveAttribute('data-ak-3d-state', 'error');
    await expect(p.locator('.ak-3d-error')).toHaveText(/could not be loaded/u);
    await expect(p.locator('.ak-3d-poster')).toBeVisible();
  });

  test('without JavaScript or WebGL the plan and hotspot list carry the content', async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const p = await context.newPage();
    await p.goto(glbPage());
    await expect(p.locator('.ak-3d-poster')).toBeVisible();
    await expect(p.locator('.ak-3d-hotspots li')).toHaveCount(3);
    await expect(p.locator('.ak-3d-hotspots')).toContainText('Corner guard');
    await expect(p.locator('.ak-3d-controls')).toContainText('graphite');
    await context.close();

    const noGl = await browser.newPage();
    await noGl.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...rest: unknown[]
      ) {
        if (type === 'webgl2' || type === 'webgl') return null;
        return (original as (...args: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof original;
    });
    await noGl.goto(glbPage());
    await expect(model(noGl)).toHaveAttribute('data-ak-3d-state', 'unsupported');
    await expect(noGl.locator('.ak-3d-poster')).toBeVisible();
    await expect(noGl.locator('.ak-3d-hotspots li')).toHaveCount(3);
    await noGl.close();
  });

  test.describe('export', () => {
    test.describe.configure({ timeout: 90_000 });
    for (const format of ['png', 'pdf'] as const) {
      test(`${format} freezes the loaded model`, async () => {
        const out = join(workspace.dir(), `crate.${format}`);
        const receipt = await exportPage({ html: build(base), format, out });
        expect(receipt.frames).toHaveLength(1);
        expect(receipt.blockedRequests).toBe(0);
        const bytes = readFileSync(out);
        expect(bytes.subarray(0, 4).toString('latin1')).toBe(format === 'png' ? '\x89PNG' : '%PDF');
      });
    }
  });
});
