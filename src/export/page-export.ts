/**
 * Local PNG/PDF export of a compiled page through a real Chromium.
 *
 * The page is served from the audit's virtual origin, so it makes zero network
 * requests and local assets resolve only inside the spec's directory. 3D
 * scenes must reach a live WebGL frame before capture; a scene left on its
 * static plan fails the export instead of passing the poster off as success.
 * The browser is never downloaded: an explicit path, `AK_RENDER_CHROMIUM`, an
 * installed Chrome or Edge, or a Chromium Playwright already manages.
 */

import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { AUDIT_ORIGIN, launchPlaywrightChromium, readAsset } from '../audit/ui-audit-browser.js';

export const EXPORT_FORMATS = ['png', 'pdf'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const DEFAULT_EXPORT_TIMEOUT_MS = 60_000;

/** Why an export failed, stable for agents and scripts to branch on. */
export type ExportErrorCode =
  | 'browser-unavailable'
  | 'load-failed'
  | 'timeout'
  | 'webgl-unavailable'
  | 'scene-error'
  | 'capture-failed';

export class ExportError extends Error {
  constructor(
    readonly code: ExportErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface BrowserCandidate {
  source: 'flag' | 'env' | 'installed' | 'playwright';
  path: string;
  exists: boolean;
}

function installedPaths(): string[] {
  const env = process.env;
  if (process.platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(
      (root): root is string => typeof root === 'string' && root !== '',
    );
    return roots.flatMap((root) => [
      join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ]);
  }
  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
  }
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
  ];
}

async function playwrightPath(): Promise<string | undefined> {
  for (const specifier of ['playwright-core', 'playwright', '@playwright/test']) {
    try {
      const loaded = (await import(specifier)) as { chromium?: { executablePath(): string } };
      const path = loaded.chromium?.executablePath();
      if (typeof path === 'string' && path !== '') return path;
    } catch {
      // Not installed; try the next package.
    }
  }
  return undefined;
}

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/** Every browser the exporter would consider, in preference order. */
export async function browserCandidates(explicit?: string): Promise<BrowserCandidate[]> {
  const candidates: BrowserCandidate[] = [];
  if (explicit !== undefined)
    candidates.push({ source: 'flag', path: explicit, exists: isFile(explicit) });
  const fromEnv = process.env.AK_RENDER_CHROMIUM;
  if (fromEnv !== undefined && fromEnv !== '') {
    candidates.push({ source: 'env', path: fromEnv, exists: isFile(fromEnv) });
  }
  for (const path of installedPaths())
    candidates.push({ source: 'installed', path, exists: isFile(path) });
  const managed = await playwrightPath();
  if (managed !== undefined)
    candidates.push({ source: 'playwright', path: managed, exists: isFile(managed) });
  return candidates;
}

/** The browser an export launches; an explicit path that is missing is an error, not a fallback. */
export async function pickBrowser(explicit?: string): Promise<BrowserCandidate> {
  const candidates = await browserCandidates(explicit);
  const first = candidates[0];
  if (
    first !== undefined &&
    first.source !== 'installed' &&
    first.source !== 'playwright' &&
    !first.exists
  ) {
    throw new ExportError('browser-unavailable', `no browser at ${first.path} (${first.source})`);
  }
  const found = candidates.find((candidate) => candidate.exists);
  if (found === undefined) {
    throw new ExportError(
      'browser-unavailable',
      'no Chrome, Edge or Playwright Chromium found; install one or pass --chromium <path>. Nothing is downloaded.',
    );
  }
  return found;
}

/** WebGL is drawn by the GPU when there is one and by SwiftShader in a headless box. */
const EXPORT_ARGS = ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'];

interface ExportPage {
  route(url: string, handler: (route: ExportRoute) => Promise<void>): Promise<void>;
  goto(url: string, options: { waitUntil: string; timeout: number }): Promise<unknown>;
  evaluate<R>(fn: () => R): Promise<R>;
  waitForFunction(
    fn: () => boolean,
    arg: undefined,
    options: { timeout: number },
  ): Promise<unknown>;
  screenshot(options: { path: string; fullPage: boolean }): Promise<unknown>;
  pdf(options: { path: string; printBackground: boolean; format: string }): Promise<unknown>;
}
interface ExportRoute {
  request(): { url(): string };
  fulfill(options: { status: number; contentType?: string; body: string | Buffer }): Promise<void>;
  abort(code?: string): Promise<void>;
}
interface ExportBrowser {
  newPage(options: Record<string, unknown>): Promise<ExportPage>;
  close(): Promise<void>;
}

export interface ExportOptions {
  html: string;
  format: ExportFormat;
  out: string;
  /** Directory relative assets resolve against; nothing outside it is served. */
  baseDir?: string;
  executablePath?: string;
  timeoutMs?: number;
  viewport?: { width: number; height: number };
  colorScheme?: 'light' | 'dark';
  /** Extra Chromium flags, appended after the export defaults. */
  launchArgs?: readonly string[];
}

export interface ExportReceipt {
  format: ExportFormat;
  out: string;
  bytes: number;
  ms: number;
  browser: { source: BrowserCandidate['source']; path: string; version: string };
  renderer: string;
  scenes: number;
  blockedRequests: number;
}

/** Scene states the page reports once every 3D block has settled. */
interface SceneProbe {
  states: string[];
  renderer: string;
}

function probeScenes(): SceneProbe {
  const states = [...document.querySelectorAll('[data-ak-3d]')].map(
    (el) => el.getAttribute('data-ak-3d-state') ?? 'static',
  );
  let renderer = '';
  const gl = document.createElement('canvas').getContext('webgl2');
  if (gl !== null) {
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    renderer = String(
      gl.getParameter(debug === null ? gl.RENDERER : debug.UNMASKED_RENDERER_WEBGL),
    );
  }
  return { states, renderer };
}

export async function exportPage(options: ExportOptions): Promise<ExportReceipt> {
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_EXPORT_TIMEOUT_MS;
  const choice = await pickBrowser(options.executablePath);
  let browser: ExportBrowser & { version(): string };
  try {
    const launched = await launchPlaywrightChromium(choice.path, timeoutMs, [
      ...EXPORT_ARGS,
      ...(options.launchArgs ?? []),
    ]);
    browser = launched as unknown as ExportBrowser & { version(): string };
  } catch (error) {
    throw new ExportError(
      'browser-unavailable',
      `${choice.path} did not start: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
    );
  }
  let blockedRequests = 0;
  try {
    const page = await browser.newPage({
      viewport: options.viewport ?? { width: 1440, height: 900 },
      colorScheme: options.colorScheme ?? 'light',
      // The first, settled frame: the same pose on every export.
      reducedMotion: 'reduce',
      deviceScaleFactor: 1,
      serviceWorkers: 'block',
      acceptDownloads: false,
      locale: 'en-US',
      timezoneId: 'UTC',
    });
    await page.route('**/*', async (handle) => {
      const url = handle.request().url();
      const parsed = URL.canParse(url) ? new URL(url) : undefined;
      if (parsed?.origin === AUDIT_ORIGIN) {
        if (parsed.pathname === '/' || parsed.pathname === '/index.html') {
          await handle.fulfill({
            status: 200,
            contentType: 'text/html; charset=utf-8',
            body: options.html,
          });
          return;
        }
        const asset =
          options.baseDir === undefined ? undefined : readAsset(options.baseDir, parsed.pathname);
        await (asset === undefined
          ? handle.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' })
          : handle.fulfill({ status: 200, contentType: asset.type, body: asset.body }));
        return;
      }
      blockedRequests += 1;
      await handle.abort('blockedbyclient');
    });
    try {
      await page.goto(`${AUDIT_ORIGIN}/`, { waitUntil: 'load', timeout: timeoutMs });
      await page.evaluate(() => document.fonts.ready.then(() => true));
    } catch (error) {
      throw new ExportError(
        'load-failed',
        `the page did not load: ${String(error).split('\n')[0]}`,
      );
    }
    try {
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll('[data-ak-3d]')].every(
            (el) => el.getAttribute('data-ak-3d-state') !== 'static',
          ),
        undefined,
        { timeout: Math.max(1, timeoutMs - (Date.now() - started)) },
      );
    } catch {
      throw new ExportError('timeout', `3D scenes did not settle within ${timeoutMs}ms`);
    }
    const probe = await page.evaluate(probeScenes);
    const failed = probe.states.filter((state) => state !== 'ready');
    if (failed.length > 0) {
      const code = failed.includes('error') ? 'scene-error' : 'webgl-unavailable';
      throw new ExportError(
        code,
        `${failed.length} of ${probe.states.length} 3D scene(s) did not draw a live frame (${[...new Set(failed)].join(', ')}); the static plan is not exported as success`,
      );
    }
    if (probe.states.length > 0) {
      await page.evaluate(() =>
        (window as unknown as { akRender3d: { freeze(): number } }).akRender3d.freeze(),
      );
    }
    mkdirSync(dirname(options.out), { recursive: true });
    try {
      if (options.format === 'png') await page.screenshot({ path: options.out, fullPage: true });
      else await page.pdf({ path: options.out, printBackground: true, format: 'A4' });
    } catch (error) {
      throw new ExportError('capture-failed', String(error).split('\n')[0] ?? 'capture failed');
    }
    if (!existsSync(options.out)) throw new ExportError('capture-failed', 'no file was written');
    return {
      format: options.format,
      out: options.out,
      bytes: statSync(options.out).size,
      ms: Date.now() - started,
      browser: { source: choice.source, path: choice.path, version: browser.version() },
      renderer: probe.renderer,
      scenes: probe.states.length,
      blockedRequests,
    };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export interface DoctorReport {
  candidates: BrowserCandidate[];
  chosen?: BrowserCandidate;
  version?: string;
  webgl2: boolean;
  renderer: string;
  problem?: string;
}

/** Which browser export would use, and whether it can draw WebGL 2. */
export async function exportDoctor(
  explicit?: string,
  timeoutMs = DEFAULT_EXPORT_TIMEOUT_MS,
): Promise<DoctorReport> {
  const candidates = await browserCandidates(explicit);
  let chosen: BrowserCandidate;
  try {
    chosen = await pickBrowser(explicit);
  } catch (error) {
    return { candidates, webgl2: false, renderer: '', problem: (error as Error).message };
  }
  try {
    const browser = (await launchPlaywrightChromium(
      chosen.path,
      timeoutMs,
      EXPORT_ARGS,
    )) as unknown as ExportBrowser & {
      version(): string;
    };
    try {
      const page = await browser.newPage({});
      const probe = await page.evaluate(probeScenes);
      return {
        candidates,
        chosen,
        version: browser.version(),
        webgl2: probe.renderer !== '',
        renderer: probe.renderer,
        ...(probe.renderer === '' ? { problem: 'the browser started but has no WebGL 2' } : {}),
      };
    } finally {
      await browser.close().catch(() => undefined);
    }
  } catch (error) {
    return {
      candidates,
      chosen,
      webgl2: false,
      renderer: '',
      problem: String(error).split('\n')[0] ?? 'launch failed',
    };
  }
}
