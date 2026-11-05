import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { ExportError, exportDoctor, exportPage } from '../../src/export/page-export.js';
import { compile } from '../../src/render/render.js';
import { browserWorkspace } from './browser-workspace.js';

const fixture = fileURLToPath(new URL('../../fixtures/3d/scene-3d-basic.yaml', import.meta.url));
const workspace = browserWorkspace('export');
const html = compile(readFileSync(fixture, 'utf8'), { source: 'scene-3d-basic' }).html;
const outDir = workspace.write('placeholder', '').replace(/[^\\/]+$/u, '');

test.describe('local export', () => {
  test.describe.configure({ timeout: 90_000 });

  test('PNG captures the live WebGL frame at device scale 2', async () => {
    const out = join(outDir, 'scene.png');
    const receipt = await exportPage({ html, format: 'png', out });
    expect(receipt.scenes).toBe(1);
    expect(receipt.blockedRequests).toBe(0);
    expect(receipt.missingAssets).toBe(0);
    expect(receipt.quality).toBe('high');
    expect(receipt.renderer).not.toBe('');
    // freeze() pinned exactly one frame per scene, at the stage's 16:9 and 2x pixels.
    expect(receipt.frames).toHaveLength(1);
    const [frame] = receipt.frames;
    expect(frame?.width).toBeGreaterThanOrEqual(2000);
    expect(Math.abs((frame?.width ?? 0) / (frame?.height ?? 1) - 16 / 9)).toBeLessThan(0.02);
    const bytes = readFileSync(out);
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(bytes.readUInt32BE(16)).toBe(2880);
  });

  test('PDF embeds the frozen frame, not the static plan', async () => {
    const out = join(outDir, 'scene.pdf');
    const receipt = await exportPage({ html, format: 'pdf', out });
    const bytes = readFileSync(out);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    // Gradients of the plan rasterize too, so look for the frozen frame itself:
    // a 16:9 image at the 2x frame width, which only freeze() produces.
    const images = [
      ...bytes.toString('latin1').matchAll(/\/Width (\d+)[\s\S]{0,200}?\/Height (\d+)/gu),
    ]
      .map((match) => ({ width: Number(match[1]), height: Number(match[2]) }))
      .filter(
        (image) => image.width >= 2000 && Math.abs(image.width / image.height - 16 / 9) < 0.02,
      );
    expect(images.length).toBeGreaterThanOrEqual(1);
    expect(receipt.bytes).toBe(statSync(out).size);
  });

  for (const [format, name, magic] of [
    ['png', 'a.jpg', '89504e470d0a1a0a'],
    ['png', 'noext', '89504e470d0a1a0a'],
    ['pdf', 'a.png', Buffer.from('%PDF-').toString('hex')],
  ] as const) {
    test(`--format ${format} writes ${format} bytes to ${name}`, async () => {
      const out = join(outDir, name);
      const receipt = await exportPage({ html, format, out, scale: 1 });
      expect(receipt.format).toBe(format);
      expect(
        readFileSync(out)
          .subarray(0, magic.length / 2)
          .toString('hex'),
      ).toBe(magic);
      expect(existsSync(`${out}.partial`)).toBe(false);
    });
  }

  test('--out that is a directory fails as write-failed', async () => {
    const error = await exportPage({ html, format: 'png', out: outDir }).catch(
      (caught: unknown) => caught,
    );
    expect((error as ExportError).code).toBe('write-failed');
  });
  test('a failed export leaves the older file at --out untouched', async () => {
    const out = workspace.write('stale.png', 'old');
    const error = await exportPage({
      html,
      format: 'png',
      out,
      launchArgs: ['--disable-webgl', '--disable-webgl2'],
    }).catch((caught: unknown) => caught);
    expect((error as ExportError).code).toBe('webgl-unavailable');
    expect(readFileSync(out, 'utf8')).toBe('old');
    expect(existsSync(`${out}.partial`)).toBe(false);
  });

  test('a missing local asset is counted, not silently passed', async () => {
    const withImage = compile(
      'version: 1\nmeta: { title: Asset }\nblocks:\n  - { type: image, src: missing.png, alt: Missing }\n',
      { source: 'asset' },
    ).html;
    const receipt = await exportPage({
      html: withImage,
      format: 'png',
      out: join(outDir, 'asset.png'),
      baseDir: outDir,
      scale: 1,
    });
    expect(receipt.missingAssets).toBe(1);
  });

  test('an exhausted budget is always a timeout', async () => {
    for (const timeoutMs of [200, 900]) {
      const began = Date.now();
      const error = await exportPage({
        html,
        format: 'png',
        out: join(outDir, `late-${timeoutMs}.png`),
        timeoutMs,
      }).catch((caught: unknown) => caught);
      expect((error as ExportError).code).toBe('timeout');
      expect(Date.now() - began).toBeLessThan(timeoutMs + 3000);
    }
  });
  test('without WebGL the export fails instead of shipping the poster', async () => {
    const out = join(outDir, 'blocked.png');
    const error = await exportPage({
      html,
      format: 'png',
      out,
      timeoutMs: 30_000,
      launchArgs: ['--disable-webgl', '--disable-webgl2'],
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ExportError);
    expect((error as ExportError).code).toBe('webgl-unavailable');
    expect(existsSync(out)).toBe(false);
  });
  test('doctor names the browser and its WebGL 2 renderer', async () => {
    const report = await exportDoctor();
    expect(report.chosen?.exists).toBe(true);
    expect(report.webgl2).toBe(true);
  });
});
