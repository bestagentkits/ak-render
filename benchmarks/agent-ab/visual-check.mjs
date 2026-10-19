/**
 * The visual check a run's page gets: open it from `file://` in Chromium at a
 * phone and a desktop width, in light and dark, and record horizontal overflow
 * and any network request the page attempts. A document wider than a 375 px
 * viewport is the critical mobile overflow the issue's target counts.
 *
 * This is a structural smoke check, not the full `audit-ui` audit: it stays
 * here until that audit ships and can replace it.
 */

import { pathToFileURL } from 'node:url';

export const VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 1440, height: 900 },
];
const SCHEMES = ['light', 'dark'];

/**
 * Chromium from Playwright's cache, or the binary named by
 * `AK_RENDER_CHROMIUM` when the pinned build is not installed on this machine.
 * The browser never inherits the model API keys the harness holds.
 */
export async function openBrowser() {
  const { chromium } = await import('@playwright/test');
  const executablePath = process.env.AK_RENDER_CHROMIUM;
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !/_API_KEY$/u.test(name)),
  );
  return chromium.launch(executablePath ? { executablePath, env } : { env });
}

export async function visualCheck(browser, file) {
  const findings = [];
  let networkRequests = 0;
  for (const viewport of VIEWPORTS) {
    for (const colorScheme of SCHEMES) {
      const context = await browser.newContext({ viewport, colorScheme });
      // The page must be offline; abort and count anything it tries to fetch.
      await context.route(/^(?!file:)/u, (route) => {
        networkRequests += 1;
        return route.abort();
      });
      const page = await context.newPage();
      try {
        await page.goto(pathToFileURL(file).href, { waitUntil: 'load', timeout: 30_000 });
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        if (overflow > 0) {
          findings.push({
            rule: 'horizontal-overflow',
            severity: viewport.width <= 375 ? 'critical' : 'major',
            viewport: viewport.width,
            colorScheme,
            overflowPx: overflow,
          });
        }
      } finally {
        await context.close();
      }
    }
  }
  return {
    findings,
    networkRequests,
    criticalMobileOverflow: findings.some((finding) => finding.severity === 'critical'),
  };
}
