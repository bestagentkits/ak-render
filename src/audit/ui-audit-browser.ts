/**
 * The publication audit-ui preset: real-browser checks of a compiled page.
 *
 * The page is served to Chromium from a virtual origin that only this process
 * answers. Every other request is aborted and reported, so the audit makes
 * zero network requests whatever the page asks for. Only HTML the audit
 * compiled itself runs with JavaScript; any other page is measured with
 * JavaScript off, so no script beyond the compiled runtime ever executes.
 *
 * Playwright is an optional dependency, loaded on demand; the quick preset and
 * the rest of the package never need it.
 */

import { mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { IrDocument } from '../ir.js';
import {
  exerciseControls,
  type InteractionProblem,
  measurePage,
  type ProbeLocation,
  type ProbeOptions,
  type ProbeResult,
  SMALL_TEXT_PX,
  TOUCH_TARGET_PX,
} from './ui-audit-probe.js';
import {
  type UiAuditCheck,
  type UiAuditMode,
  type UiColorScheme,
  type UiFinding,
  uiFinding,
} from './ui-audit-report.js';

/** The origin the audited page is served from; `.invalid` never resolves. */
export const AUDIT_ORIGIN = 'http://page.ak-render.invalid';

export const DEFAULT_UI_AUDIT_TIMEOUT_MS = 60_000;
export const MAX_UI_AUDIT_TIMEOUT_MS = 300_000;

/** The screen viewports every publication audit measures. */
export const UI_AUDIT_VIEWPORTS: readonly { width: number; height: number }[] = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
];

/** A4 at 96 dpi, the page box print emulation lays out against. */
const PRINT_VIEWPORT = { width: 794, height: 1123 };

const MAX_ELEMENTS = 6000;
const MAX_CONTROLS = 12;
const MAX_ASSET_BYTES = 16 * 1024 * 1024;

interface CheckPlan {
  viewport: { width: number; height: number };
  scheme: UiColorScheme;
  mode: UiAuditMode;
  probe: PlanProbe;
  interactions: boolean;
}

/** What a check measures; the limits are the same for every check. */
type PlanProbe = Omit<ProbeOptions, 'maxElements' | 'smallTextPx' | 'targetPx'>;

const NONE: PlanProbe = {
  overflow: false,
  chartLabels: false,
  tables: false,
  contrast: false,
  smallText: false,
  touchTargets: false,
  images: false,
  motion: false,
  disclosures: false,
};

/** The check matrix, in report order. */
export function uiAuditPlan(scripts: boolean): CheckPlan[] {
  const plans: CheckPlan[] = [];
  for (const scheme of ['light', 'dark'] as const) {
    for (const viewport of UI_AUDIT_VIEWPORTS) {
      const phone = viewport.width === 375;
      const desktop = viewport.width === 1440;
      plans.push({
        viewport,
        scheme,
        mode: 'screen',
        probe: {
          ...NONE,
          overflow: true,
          chartLabels: true,
          tables: phone,
          contrast: desktop,
          smallText: phone && scheme === 'light',
          touchTargets: phone && scheme === 'light',
          images: desktop && scheme === 'light',
          disclosures: phone && scheme === 'light',
        },
        interactions: scripts && desktop && scheme === 'light',
      });
    }
  }
  const phone = UI_AUDIT_VIEWPORTS[0] ?? { width: 375, height: 812 };
  if (scripts) {
    plans.push({
      viewport: phone,
      scheme: 'light',
      mode: 'no-js',
      probe: { ...NONE, overflow: true },
      interactions: false,
    });
  }
  plans.push({
    viewport: phone,
    scheme: 'light',
    mode: 'reduced-motion',
    probe: { ...NONE, motion: true },
    interactions: false,
  });
  plans.push({
    viewport: PRINT_VIEWPORT,
    scheme: 'light',
    mode: 'print',
    probe: { ...NONE, overflow: true },
    interactions: false,
  });
  return plans;
}

/** The subset of Playwright this module drives, typed structurally. */
export interface BrowserLike {
  newContext(options: Record<string, unknown>): Promise<ContextLike>;
  close(): Promise<void>;
}
interface ContextLike {
  route(url: string, handler: (route: RouteLike) => Promise<void>): Promise<void>;
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}
interface RouteLike {
  request(): { url(): string };
  fulfill(options: { status: number; contentType?: string; body: string | Buffer }): Promise<void>;
  abort(code?: string): Promise<void>;
}
interface PageLike {
  on(event: 'pageerror', listener: (error: Error) => void): void;
  on(event: 'console', listener: (message: { type(): string; text(): string }) => void): void;
  goto(url: string, options: { waitUntil: string; timeout: number }): Promise<unknown>;
  emulateMedia(options: Record<string, unknown>): Promise<void>;
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  evaluate<R, A>(fn: (arg: A) => R, arg: A): Promise<R>;
  screenshot(options: { path: string; fullPage: boolean; timeout: number }): Promise<unknown>;
}
interface ChromiumLike {
  launch(options: Record<string, unknown>): Promise<BrowserLike>;
}

export type BrowserLauncher = () => Promise<BrowserLike>;

/** Launch Chromium from `playwright-core`, `playwright` or `@playwright/test`, whichever is installed. */
/**
 * Chromium flags that keep traffic the route handler never sees (preconnect,
 * DNS prefetch) off the network: no name resolves, and every connection,
 * loopback included, goes to a proxy port nothing listens on. Requests
 * Playwright intercepts are answered before either applies.
 */
export const OFFLINE_CHROMIUM_ARGS: readonly string[] = [
  '--host-resolver-rules=MAP * ~NOTFOUND',
  '--proxy-server=127.0.0.1:9',
  '--proxy-bypass-list=<-loopback>',
];

export async function launchPlaywrightChromium(
  executablePath?: string,
  timeoutMs?: number,
): Promise<BrowserLike> {
  let chromium: ChromiumLike | undefined;
  let reason = 'neither playwright-core nor playwright is installed';
  for (const specifier of ['playwright-core', 'playwright', '@playwright/test']) {
    try {
      const loaded = (await import(specifier)) as { chromium?: ChromiumLike };
      if (loaded.chromium !== undefined) {
        chromium = loaded.chromium;
        break;
      }
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
    }
  }
  if (chromium === undefined) throw new Error(reason);
  return chromium.launch({
    headless: true,
    args: [...OFFLINE_CHROMIUM_ARGS],
    ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }),
    ...(executablePath === undefined ? {} : { executablePath }),
  });
}

export interface BrowserAuditInput {
  html: string;
  ir?: IrDocument;
  /** True only for HTML this audit compiled: then the compiled runtime runs. */
  scripts: boolean;
  /** Directory relative assets resolve against; nothing outside it is served. */
  baseDir?: string;
  /** Writes one screenshot per check here when set. */
  evidenceDir?: string;
  timeoutMs: number;
  /** A Chromium binary to launch instead of the one Playwright manages. */
  executablePath?: string;
  launch?: BrowserLauncher;
}

export interface BrowserAuditOutcome {
  complete: boolean;
  checks: UiAuditCheck[];
  blockedRequests: number;
  findings: UiFinding[];
}

function viewportLabel(viewport: { width: number; height: number }): string {
  return `${viewport.width}x${viewport.height}`;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.vtt': 'text/vtt',
};

function within(root: string, target: string): boolean {
  const inside = relative(root, target);
  return inside !== '' && !inside.startsWith('..') && !isAbsolute(inside);
}

/** A local asset under `baseDir`, or undefined when the path leaves it. */
function readAsset(baseDir: string, pathname: string): { body: Buffer; type: string } | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname).replace(/^\/+/u, '');
  } catch {
    return undefined;
  }
  const root = resolve(baseDir);
  const target = resolve(root, decoded);
  if (!within(root, target)) return undefined;
  const extension = /\.[a-z0-9]+$/iu.exec(target)?.[0]?.toLowerCase() ?? '';
  const type = CONTENT_TYPES[extension];
  if (type === undefined) return undefined;
  try {
    // A symlink inside the directory must not lead out of it.
    if (!within(realpathSync(root), realpathSync(target))) return undefined;
    const stat = statSync(target);
    if (!stat.isFile() || stat.size > MAX_ASSET_BYTES) return undefined;
    return { body: readFileSync(target), type };
  } catch {
    return undefined;
  }
}

class BudgetExceeded extends Error {}

/** A probe result with nothing measured, for findings that come from controls alone. */
const NO_MEASUREMENT: ProbeResult = {
  scrollWidth: 0,
  clientWidth: 0,
  overflow: [],
  clippedLabels: [],
  wideTables: [],
  contrast: [],
  smallText: [],
  touchTargets: [],
  brokenImages: [],
  motion: [],
  visibleBlocks: [],
};

/**
 * The browser's echo of a failed load. The routed abort (with its URL) or the
 * broken-image check already reports it, so it is neither a request nor a
 * script error.
 */
const LOAD_FAILED_MESSAGE = /^Failed to load resource\b/u;

/** A request the page's own CSP refused before it reached the route handler. */
const REFUSED_MESSAGE = /^Refused to (?:load|connect|frame|apply)/u;

export async function runBrowserAudit(input: BrowserAuditInput): Promise<BrowserAuditOutcome> {
  const deadline = Date.now() + input.timeoutMs;
  const remaining = (): number => {
    const left = deadline - Date.now();
    if (left <= 0) throw new BudgetExceeded('budget exceeded');
    return left;
  };
  const nodes = new Map((input.ir?.nodes ?? []).map((node) => [node.id, node]));
  const place = (location: ProbeLocation): Pick<UiFinding, 'path' | 'nodeId' | 'blockType'> => {
    if (location.nodeId === undefined) return { path: input.ir === undefined ? 'html' : '$' };
    const node = nodes.get(location.nodeId);
    return node === undefined
      ? { path: 'html', nodeId: location.nodeId }
      : { path: node.path, nodeId: node.id, blockType: node.type };
  };

  const findings: UiFinding[] = [];
  const checks = new Map<CheckPlan, UiAuditCheck>();
  const blocked = new Set<string>();
  let blockedRequests = 0;
  let complete = true;

  if (!input.scripts) {
    findings.push(
      uiFinding('audit/scripts-disabled', {
        message:
          'the page is not compiler output this audit produced, so it ran with JavaScript off',
        path: 'html',
        evidence: 'scripts=disabled',
      }),
    );
  }

  let browser: BrowserLike;
  let launchTimer: ReturnType<typeof setTimeout> | undefined;
  const launching = (
    input.launch ?? (() => launchPlaywrightChromium(input.executablePath, input.timeoutMs))
  )();
  try {
    browser = await Promise.race([
      launching,
      new Promise<never>((_, reject) => {
        launchTimer = setTimeout(
          () => reject(new Error(`the browser did not start within ${input.timeoutMs}ms`)),
          input.timeoutMs,
        );
      }),
    ]);
  } catch (error) {
    // A browser that starts after the budget ran out is closed, not leaked.
    void launching.then((late) => late.close()).catch(() => undefined);
    findings.push(
      uiFinding('audit/browser-unavailable', {
        message: `no browser could be launched: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
        path: '$',
        evidence: 'launch failed',
      }),
    );
    return { complete: false, checks: [], blockedRequests, findings };
  } finally {
    clearTimeout(launchTimer);
  }

  const answer = async (handle: RouteLike): Promise<void> => {
    const url = handle.request().url();
    let parsed: URL | undefined;
    try {
      parsed = new URL(url);
    } catch {
      parsed = undefined;
    }
    if (parsed?.origin === AUDIT_ORIGIN) {
      if (parsed.pathname === '/' || parsed.pathname === '/index.html') {
        await handle.fulfill({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: input.html,
        });
        return;
      }
      const asset =
        input.baseDir === undefined ? undefined : readAsset(input.baseDir, parsed.pathname);
      if (asset !== undefined) {
        await handle.fulfill({ status: 200, contentType: asset.type, body: asset.body });
        return;
      }
      await handle.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
      return;
    }
    blockedRequests += 1;
    blocked.add(url.slice(0, 200));
    await handle.abort('blockedbyclient');
  };

  // Once the budget closes the browser, pending answers reject; that is expected.
  const route = (handle: RouteLike): Promise<void> => answer(handle).catch(() => undefined);

  /** Open the page once for a group of checks that share scheme and scripting. */
  const open = async (
    scheme: UiColorScheme,
    scripts: boolean,
  ): Promise<{ page: PageLike; context: ContextLike; errors: string[] }> => {
    const context = await browser.newContext({
      viewport: UI_AUDIT_VIEWPORTS[0],
      javaScriptEnabled: scripts,
      colorScheme: scheme,
      reducedMotion: 'no-preference',
      serviceWorkers: 'block',
      acceptDownloads: false,
      deviceScaleFactor: 1,
      locale: 'en-US',
      timezoneId: 'UTC',
    });
    await context.route('**/*', route);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message.split('\n')[0] ?? 'error'));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      if (LOAD_FAILED_MESSAGE.test(text)) return;
      if (REFUSED_MESSAGE.test(text)) {
        blocked.add(text.slice(0, 200));
        return;
      }
      errors.push(text.split('\n')[0] ?? 'error');
    });
    await page.goto(`${AUDIT_ORIGIN}/`, { waitUntil: 'load', timeout: remaining() });
    await page.evaluate(() => document.fonts.ready.then(() => undefined), undefined);
    return { page, context, errors };
  };

  const measure = async (
    page: PageLike,
    plan: CheckPlan,
    errors: string[],
  ): Promise<ProbeResult> => {
    remaining();
    await page.setViewportSize(plan.viewport);
    await page.emulateMedia({
      media: plan.mode === 'print' ? 'print' : 'screen',
      colorScheme: plan.scheme,
      reducedMotion: plan.mode === 'reduced-motion' ? 'reduce' : 'no-preference',
    });
    const measured = await page.evaluate(measurePage, {
      ...plan.probe,
      maxElements: MAX_ELEMENTS,
      smallTextPx: SMALL_TEXT_PX,
      targetPx: TOUCH_TARGET_PX,
    });
    const viewport = viewportLabel(plan.viewport);
    const check: UiAuditCheck = { viewport, scheme: plan.scheme, mode: plan.mode };
    if (input.evidenceDir !== undefined) {
      const name = `audit-${viewport}-${plan.scheme}-${plan.mode}.png`;
      mkdirSync(input.evidenceDir, { recursive: true });
      await page.screenshot({
        path: join(input.evidenceDir, name),
        fullPage: true,
        timeout: remaining(),
      });
      check.evidenceRef = name;
    }
    checks.set(plan, check);
    const at = {
      viewport,
      scheme: plan.scheme,
      mode: plan.mode,
      ...(check.evidenceRef === undefined ? {} : { evidenceRef: check.evidenceRef }),
    };
    findings.push(...findingsFor(plan, measured, [], errors.splice(0), at, place));
    return measured;
  };

  // A hung page (an evaluate never returns) is stopped by closing the
  // browser, which rejects whatever is pending.
  let timedOut = false;
  const timer = setTimeout(
    () => {
      timedOut = true;
      void browser.close().catch(() => undefined);
    },
    Math.max(0, deadline - Date.now()),
  );
  const plans = uiAuditPlan(input.scripts);
  try {
    let visibleWithScript: Set<string> | undefined;
    for (const scheme of ['light', 'dark'] as const) {
      const group = plans.filter((plan) => plan.scheme === scheme && plan.mode !== 'no-js');
      const { page, context, errors } = await open(scheme, input.scripts);
      try {
        for (const plan of group) {
          const measured = await measure(page, plan, errors);
          if (plan.mode === 'screen' && plan.viewport.width === 375 && scheme === 'light') {
            visibleWithScript = new Set(measured.visibleBlocks);
          }
        }
        // Controls change page state (and the theme toggle starts colour
        // transitions), so they run after every measurement of the page.
        for (const plan of group.filter((item) => item.interactions)) {
          await page.setViewportSize(plan.viewport);
          await page.emulateMedia({
            media: 'screen',
            colorScheme: scheme,
            reducedMotion: 'no-preference',
          });
          const problems = await page.evaluate(exerciseControls, MAX_CONTROLS);
          const check = checks.get(plan);
          const at = {
            viewport: viewportLabel(plan.viewport),
            scheme: plan.scheme,
            mode: plan.mode,
            ...(check?.evidenceRef === undefined ? {} : { evidenceRef: check.evidenceRef }),
          };
          findings.push(
            ...findingsFor(plan, NO_MEASUREMENT, problems, errors.splice(0), at, place),
          );
        }
      } finally {
        await context.close().catch(() => undefined);
      }
    }
    for (const plan of plans.filter((item) => item.mode === 'no-js')) {
      const { page, context, errors } = await open(plan.scheme, false);
      try {
        const measured = await measure(page, plan, errors);
        const without = new Set(measured.visibleBlocks);
        const viewport = viewportLabel(plan.viewport);
        for (const id of [...(visibleWithScript ?? [])].sort()) {
          if (without.has(id)) continue;
          findings.push(
            uiFinding('ui/no-js-hidden', {
              message: 'this block has a rendered box with JavaScript and none without it',
              ...place({ nodeId: id, selector: '' }),
              viewport,
              scheme: plan.scheme,
              mode: plan.mode,
              evidence: `data-ak-id=${id} visible(js)=true visible(no-js)=false`,
            }),
          );
        }
      } finally {
        await context.close().catch(() => undefined);
      }
    }
  } catch (error) {
    complete = false;
    const budget = timedOut || error instanceof BudgetExceeded || /timeout/iu.test(String(error));
    findings.push(
      uiFinding(budget ? 'audit/budget-exceeded' : 'audit/aborted', {
        message: budget
          ? `the audit did not finish within ${input.timeoutMs}ms; ${checks.size} check(s) completed`
          : `the audit stopped: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
        path: '$',
        evidence: `completed=${checks.size} timeoutMs=${input.timeoutMs}`,
      }),
    );
  } finally {
    clearTimeout(timer);
    await browser.close().catch(() => undefined);
  }

  for (const url of [...blocked].sort()) {
    findings.push(
      uiFinding('audit/network-request', {
        message: 'the page tried to reach the network; the audit blocked it',
        path: input.ir === undefined ? 'html' : '$',
        evidence: url,
      }),
    );
  }
  const ran = plans.flatMap((plan) => {
    const check = checks.get(plan);
    return check === undefined ? [] : [check];
  });
  return { complete, checks: ran, blockedRequests, findings };
}

function findingsFor(
  plan: CheckPlan,
  measured: ProbeResult,
  problems: readonly InteractionProblem[],
  errors: readonly string[],
  at: Pick<UiFinding, 'viewport' | 'scheme' | 'mode' | 'evidenceRef'>,
  place: (location: ProbeLocation) => Pick<UiFinding, 'path' | 'nodeId' | 'blockType'>,
): UiFinding[] {
  const findings: UiFinding[] = [];
  const width = plan.viewport.width;
  if (measured.scrollWidth > measured.clientWidth + 1) {
    const offenders = measured.overflow.length > 0 ? measured.overflow : [{ selector: 'html' }];
    for (const offender of offenders) {
      findings.push(
        uiFinding('ui/horizontal-overflow', {
          message: `the page is ${measured.scrollWidth}px wide in a ${measured.clientWidth}px viewport`,
          ...place(offender),
          ...at,
          ...(plan.mode === 'print' ? { severity: 'warning' as const } : {}),
          evidence: `${offender.selector} ${'right' in offender ? `left=${offender.left} right=${offender.right} ` : ''}scrollWidth=${measured.scrollWidth} clientWidth=${measured.clientWidth}`,
        }),
      );
    }
  }
  const opened = measured.disclosureOverflow;
  if (opened !== undefined) {
    const offenders = opened.offenders.length > 0 ? opened.offenders : [{ selector: 'html' }];
    for (const offender of offenders) {
      findings.push(
        uiFinding('ui/horizontal-overflow', {
          message: `with its disclosures open, the page is ${opened.scrollWidth}px wide in a ${measured.clientWidth}px viewport`,
          ...place(offender),
          ...at,
          evidence: `details-open ${offender.selector} ${'right' in offender ? `left=${offender.left} right=${offender.right} ` : ''}scrollWidth=${opened.scrollWidth} clientWidth=${measured.clientWidth}`,
        }),
      );
    }
  }
  for (const label of measured.clippedLabels) {
    findings.push(
      uiFinding('ui/clipped-chart-label', {
        message: `chart label "${label.label}" is cut by ${label.by}px at ${width}px`,
        ...place(label),
        ...at,
        evidence: `${label.selector} overflow=${label.by}px`,
      }),
    );
  }
  for (const table of measured.wideTables) {
    const ratio = table.clientWidth === 0 ? 0 : table.scrollWidth / table.clientWidth;
    if (table.scrolls && ratio <= 2) continue;
    if (!table.scrolls && table.scrollWidth <= table.clientWidth + 1) continue;
    findings.push(
      uiFinding('ui/wide-table', {
        message: table.scrolls
          ? `table is ${table.scrollWidth}px wide in a ${table.clientWidth}px frame: more than two screens of sideways scrolling`
          : `table is ${table.scrollWidth}px wide in a ${table.clientWidth}px frame that does not scroll`,
        ...place(table),
        ...at,
        ...(table.scrolls ? {} : { severity: 'error' as const }),
        evidence: `${table.selector} scrollWidth=${table.scrollWidth} clientWidth=${table.clientWidth} scrolls=${table.scrolls}`,
      }),
    );
  }
  for (const item of measured.contrast) {
    findings.push(
      uiFinding('ui/text-contrast', {
        message: `text contrast is ${item.ratio}:1, below ${item.minimum}:1`,
        ...place(item),
        ...at,
        evidence: `${item.selector} fg=${item.foreground} bg=${item.background} ratio=${item.ratio}`,
      }),
    );
  }
  for (const item of measured.smallText) {
    findings.push(
      uiFinding('ui/small-text', {
        message: `text is ${item.size}px at ${width}px, below ${SMALL_TEXT_PX}px`,
        ...place(item),
        ...at,
        evidence: `${item.selector} font-size=${item.size}px`,
      }),
    );
  }
  for (const item of measured.touchTargets) {
    findings.push(
      uiFinding('ui/touch-target', {
        message: `control is ${item.width}×${item.height}px, below ${TOUCH_TARGET_PX}px`,
        ...place(item),
        ...at,
        evidence: `${item.selector} width=${item.width} height=${item.height}`,
      }),
    );
  }
  for (const item of measured.brokenImages) {
    findings.push(
      uiFinding('ui/broken-image', {
        message: `image "${item.source}" did not load`,
        ...place(item),
        ...at,
        evidence: `${item.selector} src=${item.source}`,
      }),
    );
  }
  for (const item of measured.motion) {
    findings.push(
      uiFinding('ui/reduced-motion', {
        message: 'the element still moves with reduced motion requested',
        ...place(item),
        ...at,
        evidence: `${item.selector} transition=${item.transition} animation=${item.animation}`,
      }),
    );
  }
  for (const problem of problems) {
    findings.push(
      uiFinding('ui/interaction-failed', {
        message: `${problem.control}: ${problem.problem}`,
        ...place(problem),
        ...at,
        evidence: `${problem.selector} ${problem.problem}`,
      }),
    );
  }
  for (const error of errors) {
    findings.push(
      uiFinding('ui/script-error', {
        message: `the page raised a script error: ${error.slice(0, 160)}`,
        path: '$',
        ...at,
        evidence: error.slice(0, 200),
      }),
    );
  }
  return findings;
}
