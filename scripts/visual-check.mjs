#!/usr/bin/env node
// Render a spec at the review viewports, build one low-res contact sheet and
// print measured 3D framing numbers, so a polish round reads one image and one
// line instead of seven full-size captures.
// Usage: node scripts/visual-check.mjs <spec> [--out dir]
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pickBrowser } from '../dist/export/page-export.js';

const args = process.argv.slice(2);
const spec = args[0];
if (!spec) {
  console.error('usage: node scripts/visual-check.mjs <spec> [--out dir]');
  process.exit(2);
}
const outIndex = args.indexOf('--out');
const out = resolve(outIndex > -1 ? args[outIndex + 1] : 'out/visual-check');
mkdirSync(out, { recursive: true });

const cli = resolve('dist/cli.js');
const shots = [];
for (const scheme of ['light', 'dark']) {
  for (const width of [1440, 768, 375]) {
    const file = join(out, `s-${width}-${scheme}.png`);
    execFileSync(process.execPath, [
      cli,
      'export',
      spec,
      '--format',
      'png',
      '--out',
      file,
      '--scheme',
      scheme,
      '--width',
      String(width),
      '--scale',
      '1',
    ]);
    shots.push({ label: `${width} ${scheme}`, file });
  }
}
const pdf = join(out, 'page.pdf');
execFileSync(process.execPath, [cli, 'export', spec, '--format', 'pdf', '--out', pdf]);

const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: (await pickBrowser()).path });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // Framing of each frozen 3D frame: subject bounding box against the stage corner colour.
  const htmlFile = join(out, 'page.html');
  execFileSync(process.execPath, [cli, spec, '--out', htmlFile]);
  const html = readFileSync(htmlFile, 'utf8');
  await page.setContent(html.replace('<html', '<html data-ak-3d-quality="high"'));
  await page
    .waitForFunction(() => window.akRender3d?.ready?.(), null, { timeout: 30000 })
    .catch(() => {});
  const metrics = await page.evaluate(async () => {
    window.akRender3d?.freeze?.();
    const frames = [...document.querySelectorAll('.ak-3d-frame')];
    return Promise.all(
      frames.map(async (img) => {
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        const { data, width, height } = g.getImageData(0, 0, c.width, c.height);
        const bg = [data[0], data[1], data[2]];
        let x0 = width,
          y0 = height,
          x1 = -1,
          y1 = -1;
        for (let y = 0; y < height; y += 2) {
          for (let x = 0; x < width; x += 2) {
            const i = (y * width + x) * 4;
            const d =
              Math.abs(data[i] - bg[0]) +
              Math.abs(data[i + 1] - bg[1]) +
              Math.abs(data[i + 2] - bg[2]);
            if (d > 60) {
              if (x < x0) x0 = x;
              if (x > x1) x1 = x;
              if (y < y0) y0 = y;
              if (y > y1) y1 = y;
            }
          }
        }
        if (x1 < 0) return { fill: 0, offsetX: 0, offsetY: 0 };
        const round = (n) => Math.round(n * 100) / 100;
        return {
          fill: round((x1 - x0) / width),
          offsetX: round((x0 + x1) / 2 / width - 0.5),
          offsetY: round((y0 + y1) / 2 / height - 0.5),
        };
      }),
    );
  });

  // One contact sheet of every capture at thumbnail size.
  const tiles = shots
    .map(
      ({ label, file }) =>
        `<figure><img src="data:image/png;base64,${readFileSync(file).toString('base64')}"><figcaption>${label}</figcaption></figure>`,
    )
    .join('');
  await page.setContent(
    `<style>body{margin:8px;font:12px sans-serif;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;align-items:start}figure{margin:0}img{width:100%;border:1px solid #ccc}</style>${tiles}`,
  );
  await page.waitForLoadState('load');
  const sheet = join(out, 'sheet.png');
  await page.screenshot({ path: sheet, fullPage: true });

  console.log(JSON.stringify({ sheet, pdf, frames: metrics }));
} finally {
  await browser.close();
}
