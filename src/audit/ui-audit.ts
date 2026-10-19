/**
 * audit-ui: visual quality audit of the compiled artifact.
 *
 * Two bounded presets:
 *
 * - **quick** reads the resolved theme and the compiled markup. No browser, no
 *   script, synchronous; cheap enough to run after every render.
 * - **publication** adds real-browser checks across 375, 768 and 1440 px in
 *   light and dark, print, no-JS and reduced motion, under a time budget and
 *   with every network request blocked.
 *
 * Given a Page Spec the audit compiles it itself, so findings carry spec paths
 * and the compiled runtime is the only script that runs. Given compiled HTML,
 * findings carry markup locations and the page runs with JavaScript off.
 * `validate` never launches a browser; `verifyDocument` and the motion audit
 * stay the fast compiler checks.
 */

import {
  type BrowserLauncher,
  DEFAULT_UI_AUDIT_TIMEOUT_MS,
  MAX_UI_AUDIT_TIMEOUT_MS,
  runBrowserAudit,
} from './ui-audit-browser.js';
import {
  auditUiQuick,
  preparedQuickFindings,
  prepareUiInput,
  type UiQuickOptions,
} from './ui-audit-quick.js';
import { buildUiReport, type UiAuditReport } from './ui-audit-report.js';
import type { UiAuditPreset } from './ui-audit-rules.js';

export { auditUiQuick, isHtmlInput, type UiQuickOptions } from './ui-audit-quick.js';

export interface UiAuditOptions extends UiQuickOptions {
  preset?: UiAuditPreset;
  /** Directory the page's relative assets resolve against (publication only). */
  baseDir?: string;
  /** Write one screenshot per browser check into this directory (publication only). */
  evidenceDir?: string;
  /** Budget for the browser checks, in milliseconds. */
  timeoutMs?: number;
  /** A Chromium binary to launch instead of the one Playwright manages (publication only). */
  executablePath?: string;
  /** Override the browser launcher; tests and hosts with their own browser use it. */
  launch?: BrowserLauncher;
}

/**
 * Browsers one process runs at once. An MCP server answers calls
 * concurrently, so without a bound N publication calls would start N browsers;
 * the rest wait their turn, and the wait is not charged to their budget.
 */
export const MAX_CONCURRENT_UI_AUDITS = 2;

let running = 0;
const waiting: (() => void)[] = [];

async function withBrowserSlot<T>(task: () => Promise<T>): Promise<T> {
  if (running < MAX_CONCURRENT_UI_AUDITS) running += 1;
  else await new Promise<void>((resolve) => waiting.push(resolve));
  try {
    return await task();
  } finally {
    // Hand the slot straight to the next caller so none can jump the queue.
    const next = waiting.shift();
    if (next === undefined) running -= 1;
    else next();
  }
}

/** Clamp a caller's budget into the supported range. */
export function uiAuditTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs)) return DEFAULT_UI_AUDIT_TIMEOUT_MS;
  return Math.min(MAX_UI_AUDIT_TIMEOUT_MS, Math.max(1_000, Math.round(timeoutMs)));
}

/**
 * Audit a Page Spec or a compiled page. The publication preset includes every
 * quick finding. Throws a `RenderError` for an invalid spec.
 */
export async function auditUi(
  input: unknown,
  options: UiAuditOptions = {},
): Promise<UiAuditReport> {
  if ((options.preset ?? 'quick') === 'quick') return auditUiQuick(input, options);
  const prepared = prepareUiInput(input, options);
  const timeoutMs = uiAuditTimeout(options.timeoutMs);
  const browser = await withBrowserSlot(() =>
    runBrowserAudit({
      html: prepared.html,
      ...(prepared.compiled === undefined ? {} : { ir: prepared.compiled.ir }),
      scripts: prepared.input === 'spec',
      ...(options.baseDir === undefined ? {} : { baseDir: options.baseDir }),
      ...(options.evidenceDir === undefined ? {} : { evidenceDir: options.evidenceDir }),
      timeoutMs,
      ...(options.launch === undefined ? {} : { launch: options.launch }),
      ...(options.executablePath === undefined ? {} : { executablePath: options.executablePath }),
    }),
  );
  return buildUiReport(
    {
      preset: 'publication',
      input: prepared.input,
      complete: browser.complete,
      scripts: prepared.input === 'spec' ? 'compiled-runtime' : 'disabled',
      checks: browser.checks,
      budget: { timeoutMs, network: 'blocked' },
      blockedRequests: browser.blockedRequests,
    },
    [...preparedQuickFindings(prepared), ...browser.findings],
  );
}
