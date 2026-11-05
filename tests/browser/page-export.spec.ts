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

  test('PNG captures the live WebGL frame', async () => {
    const out = join(outDir, 'scene.png');
    const receipt = await exportPage({ html, format: 'png', out });
    expect(receipt.scenes).toBe(1);
    expect(receipt.blockedRequests).toBe(0);
    expect(receipt.renderer).not.toBe('');
    const head = readFileSync(out).subarray(0, 8);
    expect(head.toString('hex')).toBe('89504e470d0a1a0a');
  });

  test('PDF embeds the frozen frame, not the static plan', async () => {
    const out = join(outDir, 'scene.pdf');
    const receipt = await exportPage({ html, format: 'pdf', out });
    const bytes = readFileSync(out);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    // The frozen frame is a raster image; the plan alone would be vector only.
    expect(bytes.includes(Buffer.from('/Subtype /Image'))).toBe(true);
    expect(receipt.bytes).toBe(statSync(out).size);
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
