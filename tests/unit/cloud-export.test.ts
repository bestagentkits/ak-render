import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { exportArtifact } from '../../apps/cloud/src/screenshot.js';
import {
  BROWSER_RUN_API,
  browserRunBody,
  cloudExportManifest,
  exportPageCloud,
} from '../../src/export/cloud-export.js';
import { ExportError } from '../../src/export/export-errors.js';
import {
  EXPORT_READY_SELECTOR,
  readExportOutcome,
  unsignalledFrames,
  withExportReadyScript,
} from '../../src/export/export-ready.js';
import { compile } from '../../src/render/render.js';

const ACCOUNT = '0123456789abcdef0123456789abcdef';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PDF = new TextEncoder().encode('%PDF-1.7 body');

let html = '';
const scenePage = (): string => {
  if (html === '') {
    const spec = readFileSync(
      new URL('../../fixtures/3d/scene-3d-basic.yaml', import.meta.url),
      'utf8',
    );
    html = compile(spec, { source: 'scene-3d-basic' }).html;
  }
  return html;
};
const plainPage = '<!DOCTYPE html><html lang="en"><head></head><body><p>hi</p></body></html>';

interface Call {
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

function fakeFetch(...responses: Response[]): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      headers: init?.headers as Record<string, string>,
    });
    const next = responses.shift();
    if (next === undefined) throw new Error('unexpected request');
    return next;
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

async function approved(page: string, format: 'png' | 'pdf' = 'png'): Promise<string> {
  return (await cloudExportManifest(page, format)).files[0].sha256;
}

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('export-ready page preparation', () => {
  it('inlines the settle script under the page nonce and pins high quality', () => {
    const page = scenePage();
    const nonce = /<script\b[^>]*\snonce="([^"]+)"/u.exec(page)?.[1];
    const prepared = withExportReadyScript(page, 30_000);
    expect(prepared).toContain('data-ak-3d-quality="high"');
    expect(prepared).toContain(`<script nonce="${nonce}">`);
    expect(prepared).toContain('data-ak-export');
    expect(prepared.indexOf('settleForExport')).toBeLessThan(prepared.lastIndexOf('</body>'));
    // The CSP is untouched: the script runs because it carries the page's own nonce.
    expect(prepared).toContain(`nonce-${nonce}`);
  }, 20_000);

  it('leaves a page without scenes alone apart from the quality pin', () => {
    expect(withExportReadyScript(plainPage, 1000)).toBe(
      plainPage.replace('<html lang="en">', '<html lang="en" data-ak-3d-quality="high">'),
    );
  });

  it('reads the outcome and its escaped detail back out of serialized HTML', () => {
    const detail = JSON.stringify({ states: ['ready'], renderer: 'A & "B"' })
      .replace(/&/gu, '&amp;')
      .replace(/"/gu, '&quot;');
    const outcome = readExportOutcome(
      `<html lang="en" data-ak-export-detail="${detail}" data-ak-export="ready"><body></body></html>`,
    );
    expect(outcome).toEqual({ code: 'ready', detail: { states: ['ready'], renderer: 'A & "B"' } });
    expect(readExportOutcome('<html lang="en"></html>')).toBeUndefined();
  });

  it('treats a near-uniform frame as blank', () => {
    expect(
      unsignalledFrames([
        { colors: 900, lit: 0.6 },
        { colors: 1, lit: 0 },
        { colors: 40, lit: 0.001 },
      ]),
    ).toEqual([1, 2]);
  });
});

describe('Browser Run request contract', () => {
  it('waits for the ready selector on a 3D page and matches local capture settings', () => {
    const body = browserRunBody(scenePage(), 'pdf', { timeoutMs: 90_000, scale: 1 });
    expect(body['cacheTTL']).toBe(0);
    expect(body['viewport']).toEqual({ width: 1440, height: 900, deviceScaleFactor: 1 });
    // Browser Run caps the selector wait at 60 s.
    expect(body['waitForSelector']).toEqual({ selector: EXPORT_READY_SELECTOR, timeout: 60_000 });
    expect(body['pdfOptions']).toMatchObject({ format: 'a4', printBackground: true });
    expect(body['screenshotOptions']).toBeUndefined();
    expect(String(body['html'])).toContain('data-ak-export');
  }, 20_000);

  it('does not wait for scenes on a page that has none', () => {
    const body = browserRunBody(plainPage, 'png');
    expect(body['waitForSelector']).toBeUndefined();
    expect(body['screenshotOptions']).toEqual({ fullPage: true, type: 'png' });
  });
});

describe('exportPageCloud', () => {
  it('refuses before any request without an approved manifest', async () => {
    const { fetch, calls } = fakeFetch();
    const error = await exportPageCloud({
      html: plainPage,
      format: 'png',
      accountId: ACCOUNT,
      apiToken: 't',
      fetch,
    }).catch((caught: unknown) => caught);
    expect((error as ExportError).code).toBe('consent-required');
    expect(calls).toHaveLength(0);
  });

  it('refuses an approval issued for other bytes', async () => {
    const { fetch, calls } = fakeFetch();
    const error = await exportPageCloud({
      html: `${plainPage} `,
      format: 'png',
      accountId: ACCOUNT,
      apiToken: 't',
      approvedSha256: await approved(plainPage),
      fetch,
    }).catch((caught: unknown) => caught);
    expect((error as ExportError).code).toBe('consent-required');
    expect(calls).toHaveLength(0);
  });

  it('posts the page inline to the screenshot action and returns PNG bytes', async () => {
    const { fetch, calls } = fakeFetch(new Response(PNG, { status: 200 }));
    const { bytes, receipt } = await exportPageCloud({
      html: plainPage,
      format: 'png',
      accountId: ACCOUNT,
      apiToken: 'secret-token',
      approvedSha256: await approved(plainPage),
      fetch,
    });
    expect(calls[0]?.url).toBe(
      `${BROWSER_RUN_API}/accounts/${ACCOUNT}/browser-rendering/screenshot`,
    );
    expect(calls[0]?.headers['authorization']).toBe('Bearer secret-token');
    expect(calls[0]?.body['html']).toContain('<p>hi</p>');
    expect(bytes).toEqual(PNG);
    expect(receipt).toMatchObject({
      backend: 'cloud',
      format: 'png',
      bytes: PNG.length,
      scenes: 0,
    });
  });

  it('uses the pdf action for PDF', async () => {
    const { fetch, calls } = fakeFetch(new Response(PDF, { status: 200 }));
    await exportPageCloud({
      html: plainPage,
      format: 'pdf',
      accountId: ACCOUNT,
      apiToken: 't',
      approvedSha256: await approved(plainPage, 'pdf'),
      fetch,
    });
    expect(calls[0]?.url.endsWith('/browser-rendering/pdf')).toBe(true);
  });

  it('maps 401 and 403 to cloud-unauthorized and names the missing permission', async () => {
    for (const status of [401, 403]) {
      const { fetch } = fakeFetch(
        jsonResponse(status, {
          success: false,
          errors: [{ code: 10000, message: 'Authentication error' }],
        }),
      );
      const error = await exportPageCloud({
        html: plainPage,
        format: 'png',
        accountId: ACCOUNT,
        apiToken: 't',
        approvedSha256: await approved(plainPage),
        fetch,
      }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ExportError);
      expect((error as ExportError).code).toBe('cloud-unauthorized');
      expect((error as ExportError).message).toContain('10000');
      expect((error as ExportError).message).toContain('Browser Rendering - Edit');
    }
  });

  it('names a scene failure from the settle outcome instead of passing the poster', async () => {
    const page = scenePage();
    const settled = `<html data-ak-export-detail="{&quot;states&quot;:[&quot;unsupported&quot;]}" data-ak-export="webgl-unavailable"></html>`;
    const { fetch, calls } = fakeFetch(
      jsonResponse(422, {
        success: false,
        errors: [{ code: 2001, message: 'waitForSelector timed out' }],
      }),
      jsonResponse(200, { success: true, result: settled }),
    );
    const error = await exportPageCloud({
      html: page,
      format: 'png',
      accountId: ACCOUNT,
      apiToken: 't',
      approvedSha256: await approved(page),
      fetch,
    }).catch((caught: unknown) => caught);
    expect((error as ExportError).code).toBe('webgl-unavailable');
    expect(calls[1]?.url.endsWith('/browser-rendering/content')).toBe(true);
    expect(calls[1]?.body['waitForSelector']).toMatchObject({ selector: 'html[data-ak-export]' });
  }, 20_000);

  it('falls back to timeout when the page never settled', async () => {
    const page = scenePage();
    const { fetch } = fakeFetch(
      jsonResponse(422, {
        success: false,
        errors: [{ message: 'Timed out waiting for selector' }],
      }),
      jsonResponse(422, { success: false, errors: [] }),
    );
    const error = await exportPageCloud({
      html: page,
      format: 'png',
      accountId: ACCOUNT,
      apiToken: 't',
      approvedSha256: await approved(page),
      fetch,
    }).catch((caught: unknown) => caught);
    expect((error as ExportError).code).toBe('timeout');
  }, 20_000);

  it('rejects bytes that are not the requested format', async () => {
    const { fetch } = fakeFetch(new Response('<html>oops</html>', { status: 200 }));
    const error = await exportPageCloud({
      html: plainPage,
      format: 'png',
      accountId: ACCOUNT,
      apiToken: 't',
      approvedSha256: await approved(plainPage),
      fetch,
    }).catch((caught: unknown) => caught);
    expect((error as ExportError).code).toBe('capture-failed');
  });

  it('rejects a malformed account id without sending anything', async () => {
    const { fetch, calls } = fakeFetch();
    const error = await exportPageCloud({
      html: plainPage,
      format: 'png',
      accountId: '../zones',
      apiToken: 't',
      approvedSha256: await approved(plainPage),
      fetch,
    }).catch((caught: unknown) => caught);
    expect((error as ExportError).code).toBe('cloud-unauthorized');
    expect(calls).toHaveLength(0);
  });

  it('maps an unreachable API to cloud-failed', async () => {
    const fetch = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof globalThis.fetch;
    const error = await exportPageCloud({
      html: plainPage,
      format: 'png',
      accountId: ACCOUNT,
      apiToken: 't',
      approvedSha256: await approved(plainPage),
      fetch,
    }).catch((caught: unknown) => caught);
    expect((error as ExportError).code).toBe('cloud-failed');
  });
});

describe('Worker Browser Run binding', () => {
  it('sends the same ready-gated body through the binding', async () => {
    const seen: { action: string; options: Record<string, unknown> }[] = [];
    const env = {
      BROWSER: {
        quickAction: async (action: string, options: Record<string, unknown>) => {
          seen.push({ action, options });
          return new Response(PNG, { status: 200 });
        },
      },
    } as unknown as Parameters<typeof exportArtifact>[0];
    const outcome = await exportArtifact(env, scenePage(), 'screenshot');
    expect(outcome.status).toBe(200);
    expect(seen[0]?.action).toBe('screenshot');
    expect(seen[0]?.options).toEqual(browserRunBody(scenePage(), 'png'));
    expect(seen[0]?.options['waitForSelector']).toMatchObject({ selector: EXPORT_READY_SELECTOR });
  }, 20_000);
});
