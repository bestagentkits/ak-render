#!/usr/bin/env node

/**
 * Release export matrix for the 3D widgets: every widget x PNG/PDF x
 * local/cloud, 20 consecutive exports per backend on 3 representative scenes,
 * and the negative cases (no WebGL, exhausted budget, blocked network, invalid
 * spec, missing or mismatched consent, rejected credentials).
 *
 *   pnpm export:matrix                        local half; cloud rows say why they did not run
 *   pnpm export:matrix -- --cloud-consent     also send each page to Browser Run
 *   pnpm export:matrix -- --repeats 5 --no-write
 *
 * Cloud reads CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN from the
 * environment (inject them from a secret store; nothing is printed).
 * `--cloud-consent` is the explicit, noninteractive approval of every upload
 * manifest listed in the report: one compiled HTML file per page, sent inline,
 * kept by nobody (`cacheTTL: 0`, no R2 object, no share).
 *
 * A row passes only when the bytes prove a live WebGL frame: locally each
 * frozen frame's sampled pixels clear the blank-frame bounds and the PDF embeds
 * the frame image; on Browser Run the capture waits on the ready selector the
 * in-page settle script sets only after the same pixel check. A poster or a
 * blank frame is a failure, and a cloud row that could not run is `blocked`,
 * never `pass`.
 *
 * Writes docs/artifacts/export-matrix.{json,md}. Exit 1 when any row that ran
 * failed; `--require-cloud` also fails when the cloud half was blocked.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, release, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = (path) => new URL(`../dist/${path}`, import.meta.url).href;

const { compile, isRenderError, VERSION } = await import(dist('index.js'));
const { createModelResolver } = await import(dist('assets/model-assets.js'));
const { createPointCloudResolver } = await import(dist('assets/point-cloud-assets.js'));
const { exportPage, ExportError, pickBrowser } = await import(dist('export/page-export.js'));
const { exportPageCloud, cloudExportManifest, probeCloudExport } = await import(
  dist('export/cloud-export.js')
);
const { MIN_FRAME_COLORS, MIN_FRAME_LIT } = await import(dist('export/export-ready.js'));

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args[at + 1];
};
const repeats = Number(option('--repeats', '20'));
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 100) {
  console.error('--repeats must be an integer from 1 to 100');
  process.exit(2);
}

/** One fixture per widget, the basic or representative case. */
const WIDGETS = [
  ['scene-3d', 'scene-3d-basic'],
  ['model-3d', 'model-3d-crate'],
  ['product-3d', 'product-3d-speaker'],
  ['particles-3d', 'particles-3d-galaxy'],
  ['text-3d', 'text-3d-hero'],
  ['shader-3d', 'shader-3d-presets'],
  ['morph-3d', 'morph-3d-shapes'],
  ['network-3d', 'network-3d-basic'],
  ['scatter-3d', 'scatter-3d-basic'],
  ['bars-3d', 'bars-3d-stacked'],
  ['globe-3d', 'globe-3d-routes'],
  ['point-cloud-3d', 'point-cloud-3d-basic'],
  ['terrain-3d', 'terrain-3d-alpine'],
  ['timeline-3d', 'timeline-3d-space'],
];
/** Representative scenes: primitives and lights, a glTF product, a data globe. */
const REPEAT_SCENES = ['scene-3d-basic', 'product-3d-speaker', 'globe-3d-routes'];
const FORMATS = ['png', 'pdf'];

const fixtureDir = join(root, 'fixtures', '3d');
const work = mkdtempSync(join(tmpdir(), 'ak-export-matrix-'));
const pages = new Map();

function compileFixture(name, source) {
  const file = join(fixtureDir, `${name}.yaml`);
  const dir = dirname(file);
  return compile(source ?? readFileSync(file, 'utf8'), {
    source: name,
    modelResolver: createModelResolver(dir),
    pointCloudResolver: createPointCloudResolver(dir),
  }).html;
}

function page(name) {
  if (!pages.has(name)) pages.set(name, compileFixture(name));
  return pages.get(name);
}

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const pngSize = (bytes) => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });
const sceneCount = (html) => (html.match(/\sdata-ak-3d[\s=>]/gu) ?? []).length;

/** Image XObjects in a PDF that are at least as large as a frozen 3D frame. */
function pdfFrameImages(bytes, minWidth) {
  return [...bytes.toString('latin1').matchAll(/\/Width (\d+)[\s\S]{0,200}?\/Height (\d+)/gu)]
    .map((match) => ({ width: Number(match[1]), height: Number(match[2]) }))
    .filter((image) => image.width >= minWidth);
}

const codeOf = (error) => (error instanceof ExportError ? error.code : 'unexpected');
const messageOf = (error) => String(error instanceof Error ? error.message : error).split('\n')[0];

// ---------------------------------------------------------------- local

async function localExport(name, format, extra = {}) {
  const html = extra.html ?? page(name);
  const out = join(work, `${name}-${format}-${Date.now()}.${format}`);
  const receipt = await exportPage({
    html,
    format,
    out,
    baseDir: fixtureDir,
    ...extra.options,
  });
  const bytes = readFileSync(out);
  rmSync(out, { force: true });
  const scenes = sceneCount(html);
  const problems = [];
  if (receipt.scenes !== scenes) problems.push(`receipt has ${receipt.scenes} of ${scenes} scenes`);
  if (receipt.frames.length !== scenes) problems.push(`${receipt.frames.length} frames frozen`);
  for (const frame of receipt.frames) {
    if (frame.colors < MIN_FRAME_COLORS || frame.lit < MIN_FRAME_LIT) {
      problems.push(`blank frame (${frame.colors} colors, lit ${frame.lit})`);
    }
  }
  if (format === 'png') {
    if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') problems.push('not a PNG');
  } else {
    if (bytes.subarray(0, 5).toString() !== '%PDF-') problems.push('not a PDF');
    const minWidth = Math.min(...receipt.frames.map((frame) => frame.width));
    if (pdfFrameImages(bytes, minWidth).length < scenes) problems.push('PDF lacks the frame image');
  }
  return {
    status: problems.length === 0 ? 'pass' : 'fail',
    ms: receipt.ms,
    bytes: bytes.length,
    sha256: format === 'png' ? sha(bytes) : undefined,
    ...(format === 'png' ? { image: pngSize(bytes) } : {}),
    scenes,
    frames: receipt.frames,
    renderer: receipt.renderer,
    browser: receipt.browser.version,
    ...(problems.length > 0 ? { detail: problems.join('; ') } : {}),
  };
}

// ---------------------------------------------------------------- cloud

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
const apiToken = process.env.CLOUDFLARE_API_TOKEN ?? '';
const consent = flag('--cloud-consent');
const approvals = [];

/** Why the cloud half cannot run, or undefined when it can. */
async function cloudBlocker() {
  if (flag('--local-only')) return 'skipped: --local-only';
  if (accountId === '' || apiToken === '') {
    return 'blocked: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set';
  }
  if (!consent)
    return 'blocked: consent-required (pass --cloud-consent to approve the upload manifests)';
  // A page with no scene costs one cheap call and proves the token and product.
  const probe = '<!DOCTYPE html><html lang="en"><head></head><body><p>probe</p></body></html>';
  try {
    await exportPageCloud({
      html: probe,
      format: 'png',
      accountId,
      apiToken,
      approvedSha256: (await cloudExportManifest(probe, 'png')).files[0].sha256,
      scale: 1,
    });
    return undefined;
  } catch (error) {
    return `blocked: ${codeOf(error)} (${messageOf(error)})`;
  }
}

async function cloudExport(name, format) {
  const html = page(name);
  const manifest = await cloudExportManifest(html, format);
  approvals.push({ page: name, format, ...manifest.files[0], scenes: manifest.scenes });
  const { bytes, receipt } = await exportPageCloud({
    html,
    format,
    accountId,
    apiToken,
    approvedSha256: manifest.files[0].sha256,
  });
  const buffer = Buffer.from(bytes);
  const problems = [];
  if (format === 'pdf' && pdfFrameImages(buffer, 1).length < manifest.scenes) {
    problems.push('PDF lacks the frame image');
  }
  return {
    status: problems.length === 0 ? 'pass' : 'fail',
    ms: receipt.ms,
    bytes: buffer.length,
    sha256: format === 'png' ? sha(buffer) : undefined,
    ...(format === 'png' ? { image: pngSize(buffer) } : {}),
    scenes: manifest.scenes,
    ...(problems.length > 0 ? { detail: problems.join('; ') } : {}),
  };
}

// ---------------------------------------------------------------- run

async function attempt(run) {
  try {
    return await run();
  } catch (error) {
    return { status: 'fail', code: codeOf(error), detail: messageOf(error) };
  }
}

const log = (line) => process.stderr.write(`${line}\n`);
const blocker = await cloudBlocker();
log(`cloud: ${blocker ?? 'ready'}`);

const combos = [];
for (const [widget, fixture] of WIDGETS) {
  for (const format of FORMATS) {
    const local = await attempt(() => localExport(fixture, format));
    combos.push({ widget, fixture, format, backend: 'local', ...local });
    log(`local ${widget} ${format}: ${local.status}${local.detail ? ` (${local.detail})` : ''}`);
    const cloud =
      blocker === undefined
        ? await attempt(() => cloudExport(fixture, format))
        : { status: 'blocked', detail: blocker };
    combos.push({ widget, fixture, format, backend: 'cloud', ...cloud });
    if (blocker === undefined) log(`cloud ${widget} ${format}: ${cloud.status}`);
  }
}

const percentile = (values, p) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};

const repeatRows = [];
for (const backend of ['local', 'cloud']) {
  for (const fixture of REPEAT_SCENES) {
    if (backend === 'cloud' && blocker !== undefined) {
      repeatRows.push({
        backend,
        fixture,
        runs: repeats,
        passed: 0,
        status: 'blocked',
        detail: blocker,
      });
      continue;
    }
    const runs = [];
    for (let i = 0; i < repeats; i += 1) {
      runs.push(
        await attempt(() =>
          backend === 'local' ? localExport(fixture, 'png') : cloudExport(fixture, 'png'),
        ),
      );
    }
    const passed = runs.filter((run) => run.status === 'pass');
    const failures = runs.filter((run) => run.status !== 'pass');
    const ms = passed.map((run) => run.ms);
    repeatRows.push({
      backend,
      fixture,
      runs: repeats,
      passed: passed.length,
      status: passed.length === repeats ? 'pass' : 'fail',
      msP50: percentile(ms, 50),
      msP95: percentile(ms, 95),
      distinctPng: new Set(passed.map((run) => run.sha256)).size,
      ...(failures.length > 0
        ? { failures: failures.map((run) => `${run.code ?? 'check'}: ${run.detail}`) }
        : {}),
    });
    log(`repeat ${backend} ${fixture}: ${passed.length}/${repeats}`);
  }
}

// Negative cases: each must fail with its stable code and write nothing.
async function expectFailure(id, backend, expected, run, assert) {
  try {
    await run();
    return { id, backend, expected, status: 'fail', detail: 'the export succeeded' };
  } catch (error) {
    const code = codeOf(error);
    const extra = assert === undefined ? undefined : assert(error);
    const ok = expected.includes(code) && extra === undefined;
    return {
      id,
      backend,
      expected,
      code,
      status: ok ? 'pass' : 'fail',
      detail: extra ?? messageOf(error),
    };
  }
}

const basic = page('scene-3d-basic');
const remoteModel = readFileSync(join(fixtureDir, 'model-3d-crate.yaml'), 'utf8').replace(
  'models/crate.glb',
  'https://cdn.example.test/m/crate.glb',
);
const cases = [];
cases.push(
  await expectFailure('no-webgl', 'local', ['webgl-unavailable'], () =>
    localExport('scene-3d-basic', 'png', {
      options: { timeoutMs: 30_000, launchArgs: ['--disable-webgl', '--disable-webgl2'] },
    }),
  ),
  await expectFailure('exhausted-budget', 'local', ['timeout'], () =>
    localExport('scene-3d-dense', 'png', { options: { timeoutMs: 300 } }),
  ),
  await expectFailure('blocked-network', 'local', ['scene-error', 'timeout', 'load-failed'], () =>
    localExport('model-3d-crate', 'png', {
      html: compileFixture(
        'model-3d-crate',
        `${remoteModel}policy:\n  network:\n    allow: [models]\n`,
      ),
      options: { timeoutMs: 20_000 },
    }),
  ),
  await expectFailure('invalid-spec', 'local', ['invalid-spec'], async () => {
    try {
      compileFixture('scene-3d-basic', 'version: 1\nblocks:\n  - type: scene-3d\n    id: x\n');
    } catch (error) {
      if (isRenderError(error)) throw new ExportError('invalid-spec', messageOf(error));
      throw error;
    }
  }),
);

let sent = 0;
const counting = async (...call) => {
  sent += 1;
  return fetch(...call);
};
cases.push(
  await expectFailure(
    'consent-missing',
    'cloud',
    ['consent-required'],
    () =>
      exportPageCloud({
        html: basic,
        format: 'png',
        accountId: '0'.repeat(32),
        apiToken: 'x',
        fetch: counting,
      }),
    () => (sent === 0 ? undefined : `${sent} request(s) sent without consent`),
  ),
  await expectFailure(
    'consent-mismatch',
    'cloud',
    ['consent-required'],
    () =>
      exportPageCloud({
        html: basic,
        format: 'png',
        accountId: '0'.repeat(32),
        apiToken: 'x',
        approvedSha256: '0'.repeat(64),
        fetch: counting,
      }),
    () => (sent === 0 ? undefined : `${sent} request(s) sent without consent`),
  ),
);
// A rejected credential against the live API: proves the error mapping on the real contract.
const rejected = await expectFailure(
  'rejected-token',
  'cloud',
  ['cloud-unauthorized'],
  async () => {
    const probe = '<!DOCTYPE html><html lang="en"><head></head><body></body></html>';
    await exportPageCloud({
      html: probe,
      format: 'png',
      accountId: accountId === '' ? '0'.repeat(32) : accountId,
      apiToken: 'invalid-token-for-negative-case',
      approvedSha256: (await cloudExportManifest(probe, 'png')).files[0].sha256,
    });
  },
);
cases.push(
  rejected.code === 'cloud-failed' && /could not be reached/u.test(rejected.detail)
    ? { ...rejected, status: 'blocked', detail: 'api.cloudflare.com unreachable from this machine' }
    : rejected,
);
if (blocker === undefined) {
  const probe = await probeCloudExport({ html: basic, accountId, apiToken }).catch(() => undefined);
  cases.push({
    id: 'cloud-gpu-probe',
    backend: 'cloud',
    expected: ['ready'],
    code: probe?.code ?? 'no-outcome',
    status: probe?.code === 'ready' ? 'pass' : 'fail',
    detail: JSON.stringify(probe?.detail ?? {}),
  });
}

// ---------------------------------------------------------------- report

const browser = await pickBrowser().catch(() => undefined);
const firstLocal = combos.find((row) => row.backend === 'local' && row.renderer);
const renderer = firstLocal?.renderer ?? '';
let commit = '';
try {
  commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {
  commit = 'unknown';
}
const count = (backend) => {
  const rows = combos.filter((row) => row.backend === backend);
  return {
    passed: rows.filter((row) => row.status === 'pass').length,
    failed: rows.filter((row) => row.status === 'fail').length,
    blocked: rows.filter((row) => row.status === 'blocked').length,
    total: rows.length,
  };
};
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  compilerVersion: VERSION,
  commit,
  environment: {
    os: `${platform()} ${release()} ${arch()}`,
    cpu: `${cpus()[0]?.model ?? 'unknown'} x${cpus().length}`,
    node: process.version,
    localBrowser: firstLocal?.browser ?? null,
    localBrowserSource: browser?.source ?? null,
    localRenderer: renderer,
    softwareGpu: /swiftshader|llvmpipe|software/iu.test(renderer),
    cloud: blocker ?? 'Cloudflare Browser Run Quick Actions',
  },
  thresholds: { minFrameColors: MIN_FRAME_COLORS, minFrameLit: MIN_FRAME_LIT },
  summary: {
    local: count('local'),
    cloud: count('cloud'),
    repeats: repeatRows.map(({ backend, fixture, passed, runs, status }) => ({
      backend,
      fixture,
      passed,
      runs,
      status,
    })),
  },
  combos,
  repeats: repeatRows,
  cases,
  approvals,
};

const md = [];
md.push('# 3D export release matrix', '');
md.push(
  'Produced by `pnpm export:matrix` (`scripts/export-matrix.mjs`). Measurements, not targets.',
  'A row passes only when the frozen WebGL frame carries drawn pixels (local: sampled',
  `frame colors >= ${MIN_FRAME_COLORS} and lit share >= ${MIN_FRAME_LIT}; PDF embeds the frame image;`,
  'cloud: Browser Run waited on the ready selector the in-page settle script sets only after',
  'the same pixel check). A cloud row that could not run is `blocked`, never `pass`.',
  '',
);
md.push(`- generated: ${report.generatedAt}`, `- compiler: ${VERSION}`, `- commit: ${commit}`);
for (const [key, value] of Object.entries(report.environment)) md.push(`- ${key}: ${value}`);
const s = report.summary;
md.push(
  '',
  '## Summary',
  '',
  `- local: ${s.local.passed}/${s.local.total} pass, ${s.local.failed} fail`,
  `- cloud: ${s.cloud.passed}/${s.cloud.total} pass, ${s.cloud.failed} fail, ${s.cloud.blocked} blocked`,
  ...repeatRows.map(
    (row) => `- repeats ${row.backend} ${row.fixture}: ${row.passed}/${row.runs} (${row.status})`,
  ),
  '',
  '## Combinations',
  '',
  '| Widget | Fixture | Format | Backend | Status | ms | Bytes | Frames (colors / lit) | Detail |',
  '| --- | --- | --- | --- | --- | ---: | ---: | --- | --- |',
);
for (const row of combos) {
  const frames = (row.frames ?? [])
    .map((f) => `${f.width}x${f.height} ${f.colors}/${f.lit}`)
    .join(', ');
  md.push(
    `| ${row.widget} | ${row.fixture} | ${row.format} | ${row.backend} | ${row.status} | ${row.ms ?? ''} | ${row.bytes ?? ''} | ${frames} | ${(row.code ? `${row.code}: ` : '') + (row.detail ?? '')} |`,
  );
}
md.push(
  '',
  `## ${repeats} consecutive PNG exports`,
  '',
  '| Backend | Fixture | Passed | ms p50 / p95 | Distinct PNG hashes | Status |',
  '| --- | --- | ---: | --- | ---: | --- |',
);
for (const row of repeatRows) {
  md.push(
    `| ${row.backend} | ${row.fixture} | ${row.passed}/${row.runs} | ${row.msP50 ?? '-'} / ${row.msP95 ?? '-'} | ${row.distinctPng ?? '-'} | ${row.status}${row.detail ? ` (${row.detail})` : ''}${row.failures ? ` ${row.failures.join('; ')}` : ''} |`,
  );
}
md.push(
  '',
  '## Cases',
  '',
  '| Case | Backend | Expected | Got | Status |',
  '| --- | --- | --- | --- | --- |',
);
for (const row of cases) {
  md.push(
    `| ${row.id} | ${row.backend} | ${row.expected.join(' or ')} | ${row.code ?? '-'} | ${row.status} |`,
  );
}
md.push(
  '',
  'R2 consent, TTL, revoke and expiry for stored cloud artifacts are covered by',
  '`tests/unit/cloud-artifact-export.test.ts`; frame time, draw calls, context loss and the',
  '10-cycle leak check by `pnpm bench:3d` ([benchmark-3d.md](benchmark-3d.md)).',
  '',
);

if (!flag('--no-write')) {
  const dir = join(root, 'docs', 'artifacts');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'export-matrix.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(dir, 'export-matrix.md'), md.join('\n'));
}
rmSync(work, { recursive: true, force: true });

const failed =
  combos.some((row) => row.status === 'fail') ||
  repeatRows.some((row) => row.status === 'fail') ||
  cases.some((row) => row.status === 'fail') ||
  (flag('--require-cloud') && blocker !== undefined);
console.log(
  `export matrix: local ${s.local.passed}/${s.local.total}, cloud ${s.cloud.passed}/${s.cloud.total} (${s.cloud.blocked} blocked), cases ${cases.filter((c) => c.status === 'pass').length}/${cases.length}`,
);
process.exit(failed ? 1 : 0);
