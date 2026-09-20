import { expect, test } from '@playwright/test';
import { isExternalRequest, startNetworkAudit } from './network-audit.js';

test.describe('zero-network audit harness', () => {
  test('classifies local and embedded protocols as non-external', () => {
    expect(isExternalRequest('file:///tmp/page.html')).toBe(false);
    expect(isExternalRequest('data:text/html,<p>hi</p>')).toBe(false);
    expect(isExternalRequest('about:blank')).toBe(false);
    expect(isExternalRequest('not a url')).toBe(true);
    expect(
      isExternalRequest('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs'),
    ).toBe(true);
    expect(isExternalRequest('http://localhost:3000/x.js')).toBe(true);
  });

  test('reports zero external requests for a self-contained page', async ({ page }) => {
    const audit = startNetworkAudit(page);
    await page.setContent(
      `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Self-contained</title>
       <style>body{font-family:system-ui;margin:2rem}</style></head>
       <body><h1>Offline</h1><svg viewBox="0 0 10 10" role="img" aria-label="dot"><circle cx="5" cy="5" r="4"/></svg></body></html>`,
      { waitUntil: 'load' },
    );

    expect(await page.title()).toBe('Self-contained');
    expect(audit().external).toEqual([]);
    expect(audit().requests.every((url) => !isExternalRequest(url))).toBe(true);
  });

  test('detects an external request so the guard cannot pass vacuously', async ({ page }) => {
    const audit = startNetworkAudit(page);
    await page.setContent(
      `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Leaky</title></head>
       <body><img src="https://example.invalid/pixel.png" alt=""></body></html>`,
      { waitUntil: 'domcontentloaded' },
    );

    await expect
      .poll(() => audit().external.length, {
        timeout: 10_000,
        message: 'external request not seen',
      })
      .toBeGreaterThan(0);
  });
});
