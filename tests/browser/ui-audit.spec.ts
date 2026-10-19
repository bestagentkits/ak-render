import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, type TestInfo, test } from '@playwright/test';
import { auditUi } from '../../src/audit/ui-audit.js';
import type { BrowserLike } from '../../src/audit/ui-audit-browser.js';
import { browserWorkspace } from './browser-workspace.js';

const pagesDir = fileURLToPath(new URL('../../fixtures/pages', import.meta.url));
const workspace = browserWorkspace('ui-audit');

/** Launch the browser this Playwright project is configured with. */
function launcher(info: TestInfo): () => Promise<BrowserLike> {
  const executablePath = info.project.use.launchOptions?.executablePath;
  return () =>
    chromium.launch(
      executablePath === undefined ? {} : { executablePath },
    ) as unknown as Promise<BrowserLike>;
}

const BROKEN_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Broken</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;background:#ffffff">
  <section data-ak-id="wide"><div style="width:1200px;height:20px;background:#eee">wide</div></section>
  <section data-ak-id="faint"><p style="color:#d0d0d0;background:#ffffff">Barely readable text on white.</p></section>
  <section data-ak-id="remote"><img src="https://example.com/remote.png" alt="Remote"></section>
</body></html>`;

test.describe('audit-ui publication preset', () => {
  test('finds overflow, low contrast and a blocked remote image', async () => {
    const info = test.info();
    test.setTimeout(90_000);
    const report = await auditUi(BROKEN_PAGE, { preset: 'publication', launch: launcher(info) });
    expect(report.complete).toBe(true);
    expect(report.scripts).toBe('disabled');
    const rules = new Set(report.findings.map((finding) => finding.rule));
    for (const rule of [
      'ui/horizontal-overflow',
      'ui/text-contrast',
      'audit/network-request',
      'audit/scripts-disabled',
    ]) {
      expect(rules.has(rule), rule).toBe(true);
    }
    expect(report.blockedRequests).toBeGreaterThan(0);
    const overflow = report.findings.find((finding) => finding.rule === 'ui/horizontal-overflow');
    expect(overflow).toMatchObject({ nodeId: 'wide', viewport: '375x812', mode: 'screen' });
    expect(overflow?.fix.length).toBeGreaterThan(20);
    const contrast = report.findings.find((finding) => finding.rule === 'ui/text-contrast');
    expect(contrast?.nodeId).toBe('faint');
  });

  test('passes a clean compiled fixture and writes one screenshot per check', async () => {
    const info = test.info();
    test.setTimeout(90_000);
    const evidenceDir = join(workspace.dir(), 'evidence');
    const source = readFileSync(join(pagesDir, 'plan.yaml'), 'utf8');
    const report = await auditUi(source, {
      preset: 'publication',
      source: 'plan.yaml',
      evidenceDir,
      launch: launcher(info),
    });
    expect(report.complete).toBe(true);
    expect(report.scripts).toBe('compiled-runtime');
    expect(report.counts).toEqual({ error: 0, warning: 0, info: 0 });
    expect(report.checks).toHaveLength(9);
    for (const check of report.checks) {
      expect(check.evidenceRef).toBeDefined();
      expect(existsSync(join(evidenceDir, check.evidenceRef ?? ''))).toBe(true);
    }
  });

  test('opens no connection for preconnect hints and reports a missing local image once', async () => {
    test.setTimeout(90_000);
    const executablePath = test.info().project.use.launchOptions?.executablePath;
    let connections = 0;
    const server = createServer((socket) => {
      connections += 1;
      socket.destroy();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    try {
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Hints</title>
<link rel="preconnect" href="http://127.0.0.1:${port}">
<link rel="dns-prefetch" href="//example.com">
<link rel="preconnect" href="https://example.com"></head>
<body><section data-ak-id="missing"><img src="missing.png" alt="Missing"></section></body></html>`;
      const report = await auditUi(html, {
        preset: 'publication',
        baseDir: workspace.dir(),
        ...(executablePath === undefined ? {} : { executablePath }),
      });
      expect(report.complete).toBe(true);
      expect(connections).toBe(0);
      const rules = report.findings.map((finding) => finding.rule);
      expect(rules).toContain('ui/broken-image');
      expect(rules).not.toContain('audit/network-request');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('stops at its budget and reports the audit incomplete', async () => {
    const info = test.info();
    test.setTimeout(30_000);
    const launch = launcher(info);
    // A browser whose first context takes longer than the whole budget.
    const slow = async (): Promise<BrowserLike> => {
      const browser = await launch();
      return {
        newContext: async (options) => {
          await new Promise((resolve) => setTimeout(resolve, 2_000));
          return browser.newContext(options);
        },
        close: () => browser.close(),
      };
    };
    const report = await auditUi(BROKEN_PAGE, {
      preset: 'publication',
      timeoutMs: 1_000,
      launch: slow,
    });
    expect(report.complete).toBe(false);
    expect(report.budget.timeoutMs).toBe(1_000);
    expect(report.findings.map((finding) => finding.rule)).toContain('audit/budget-exceeded');
  });
});
