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

import { mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  AUDIT_ORIGIN,
  launchPlaywrightChromium,
  type RouteLike,
  serveVirtualPage,
} from '../audit/ui-audit-browser.js';
import { ExportError, type ExportFormat } from './export-errors.js';
import {
  measureFrameSignal,
  probeScenes,
  unsignalledFrames,
  withHighQuality,
} from './export-ready.js';

export {
  EXPORT_FORMATS,
  ExportError,
  type ExportErrorCode,
  type ExportFormat,
} from './export-errors.js';

export const DEFAULT_EXPORT_TIMEOUT_MS = 60_000;
export const MAX_EXPORT_TIMEOUT_MS = 300_000;

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
  route(url: string, handler: (route: RouteLike) => Promise<void>): Promise<void>;
  goto(url: string, options: { waitUntil: string; timeout: number }): Promise<unknown>;
  evaluate<R>(fn: () => R | Promise<R>): Promise<R>;
  waitForFunction(
    fn: () => boolean,
    arg: undefined,
    options: { timeout: number },
  ): Promise<unknown>;
  on(event: 'pageerror', handler: (error: Error) => void): void;
  screenshot(options: { type: 'png'; fullPage: boolean; timeout: number }): Promise<Buffer>;
  pdf(options: {
    printBackground: boolean;
    format: string;
    margin: Record<string, string>;
  }): Promise<Buffer>;
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
  /** Device pixel ratio of the capture; 2 keeps edges and the frozen frame crisp. */
  scale?: number;
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
  quality: 'high';
  scenes: number;
  /** Pixel size and sampled pixel signal of each frozen 3D frame. */
  frames: { width: number; height: number; colors: number; lit: number }[];
  blockedRequests: number;
  missingAssets: number;
}

/** Load a Playwright driver; Chrome alone is not enough to drive a capture. */
export async function driverAvailable(): Promise<boolean> {
  for (const specifier of ['playwright-core', 'playwright', '@playwright/test']) {
    try {
      const loaded = (await import(specifier)) as { chromium?: unknown };
      if (loaded.chromium !== undefined) return true;
    } catch {
      // Not installed; try the next package.
    }
  }
  return false;
}

const DRIVER_MISSING =
  'no Playwright driver; install playwright-core (npm i playwright-core). It downloads no browser.';

const firstLine = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? 'unknown error';

const isTimeout = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'TimeoutError' || /timeout/iu.test(error.message));

export async function exportPage(options: ExportOptions): Promise<ExportReceipt> {
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_EXPORT_TIMEOUT_MS;
  const deadline = started + timeoutMs;
  const remaining = (): number => Math.max(1, deadline - Date.now());
  const late = (step: string) =>
    new ExportError('timeout', `${step} did not finish within the ${timeoutMs}ms budget`);
  const choice = await pickBrowser(options.executablePath);
  if (!(await driverAvailable())) throw new ExportError('driver-unavailable', DRIVER_MISSING);
  // Bytes land through a sibling .partial, so a failed export leaves --out as it was.
  let outIsDir = false;
  try {
    outIsDir = statSync(options.out).isDirectory();
  } catch {
    // Nothing there yet.
  }
  if (outIsDir) throw new ExportError('write-failed', `${options.out} is a directory, not a file`);
  let browser: ExportBrowser & { version(): string };
  try {
    browser = (await launchPlaywrightChromium(choice.path, remaining(), [
      ...EXPORT_ARGS,
      ...(options.launchArgs ?? []),
    ])) as unknown as ExportBrowser & { version(): string };
  } catch (error) {
    if (Date.now() >= deadline || isTimeout(error)) throw late('launching the browser');
    throw new ExportError(
      'browser-unavailable',
      `${choice.path} did not start: ${firstLine(error)}`,
    );
  }
  let expired = false;
  const watchdog = setTimeout(() => {
    expired = true;
    void browser.close().catch(() => undefined);
  }, remaining());
  let step = 'loading the page';
  let pageError: string | undefined;
  let blockedRequests = 0;
  let missingAssets = 0;
  try {
    const page = await browser.newPage({
      viewport: options.viewport ?? { width: 1440, height: 900 },
      colorScheme: options.colorScheme ?? 'light',
      // The first, settled frame: the same pose on every export.
      reducedMotion: 'reduce',
      deviceScaleFactor: options.scale ?? 2,
      serviceWorkers: 'block',
      acceptDownloads: false,
      locale: 'en-US',
      timezoneId: 'UTC',
    });
    page.on('pageerror', (error) => {
      pageError ??= firstLine(error);
    });
    const html = withHighQuality(options.html);
    await page.route('**/*', (handle) =>
      serveVirtualPage(handle, html, options.baseDir, {
        blocked: () => {
          blockedRequests += 1;
        },
        missing: () => {
          missingAssets += 1;
        },
      }),
    );
    try {
      await page.goto(`${AUDIT_ORIGIN}/`, { waitUntil: 'load', timeout: remaining() });
      step = 'loading fonts';
      await page.waitForFunction(() => document.fonts.status === 'loaded', undefined, {
        timeout: remaining(),
      });
      step = 'drawing the 3D scenes';
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll('[data-ak-3d]')].every(
            (el) => el.getAttribute('data-ak-3d-state') !== 'static',
          ),
        undefined,
        { timeout: remaining() },
      );
    } catch (error) {
      if (expired || isTimeout(error)) {
        if (pageError !== undefined) throw new ExportError('scene-error', pageError);
        throw late(step);
      }
      throw new ExportError('load-failed', `the page did not load: ${firstLine(error)}`);
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
    let frames: ExportReceipt['frames'] = [];
    if (probe.states.length > 0) {
      step = 'freezing the 3D frames';
      const pinned = await page.evaluate(async () => {
        const api = (
          window as unknown as {
            akRender3d: { freeze(): { width: number; height: number }[] };
          }
        ).akRender3d;
        const pinned = api.freeze();
        await Promise.all(
          [...document.querySelectorAll<HTMLImageElement>('.ak-3d-frame')].map((img) =>
            img.decode(),
          ),
        );
        return pinned;
      });
      if (pinned.length !== probe.states.length) {
        throw new ExportError(
          'capture-failed',
          `froze ${pinned.length} of ${probe.states.length} 3D scene(s)`,
        );
      }
      const signals = await page.evaluate(measureFrameSignal);
      const blank = unsignalledFrames(signals);
      if (signals.length !== pinned.length || blank.length > 0) {
        throw new ExportError(
          'capture-failed',
          `${blank.length || pinned.length - signals.length} frozen 3D frame(s) carry no drawn pixels; a blank frame is not exported as success`,
        );
      }
      frames = pinned.map((size, index) => ({
        ...size,
        ...(signals[index] ?? { colors: 0, lit: 0 }),
      }));
    }
    step = 'capturing';
    let bytes: Buffer;
    try {
      bytes =
        options.format === 'png'
          ? await page.screenshot({ type: 'png', fullPage: true, timeout: remaining() })
          : await withDeadline(
              page.pdf({
                printBackground: true,
                format: 'A4',
                margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' },
              }),
              remaining(),
            );
    } catch (error) {
      if (expired || isTimeout(error)) throw late(step);
      throw new ExportError('capture-failed', firstLine(error));
    }
    writeAtomically(options.out, bytes);
    return {
      format: options.format,
      out: options.out,
      bytes: bytes.length,
      ms: Date.now() - started,
      browser: { source: choice.source, path: choice.path, version: browser.version() },
      renderer: probe.renderer,
      quality: 'high',
      scenes: probe.states.length,
      frames,
      blockedRequests,
      missingAssets,
    };
  } catch (error) {
    if (error instanceof ExportError) throw error;
    if (expired) throw late(step);
    throw new ExportError('capture-failed', firstLine(error));
  } finally {
    clearTimeout(watchdog);
    await browser.close().catch(() => undefined);
  }
}

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' })),
      ms,
    );
  });
  return Promise.race([work, expiry]).finally(() => clearTimeout(timer));
}

/** Write through a sibling `.partial` so a reader never sees half a file. */
function writeAtomically(out: string, bytes: Buffer): void {
  const partial = `${out}.partial`;
  try {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(partial, bytes);
    renameSync(partial, out);
  } catch (error) {
    rmSync(partial, { force: true });
    throw new ExportError('write-failed', `could not write ${out}: ${firstLine(error)}`);
  }
}
export interface DoctorReport {
  candidates: BrowserCandidate[];
  driver: boolean;
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
  const driver = await driverAvailable();
  let chosen: BrowserCandidate;
  try {
    chosen = await pickBrowser(explicit);
  } catch (error) {
    return { candidates, driver, webgl2: false, renderer: '', problem: (error as Error).message };
  }
  if (!driver) {
    return { candidates, driver, chosen, webgl2: false, renderer: '', problem: DRIVER_MISSING };
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
        driver,
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
      driver,
      chosen,
      webgl2: false,
      renderer: '',
      problem: String(error).split('\n')[0] ?? 'launch failed',
    };
  }
}
