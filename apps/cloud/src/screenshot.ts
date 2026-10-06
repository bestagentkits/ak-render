/**
 * Screenshot and PDF export through Browser Run.
 *
 * Browser Run is used for nothing else. It is a rendering surface for export
 * and visual verification, not a fetch proxy and not a second compile path, so
 * the only content that reaches it is an artifact this worker already compiled
 * from the caller's own spec, passed inline as HTML (never a URL to fetch).
 *
 * The binding is optional: a deployment without it answers 501 rather than
 * silently degrading, because a missing export capability is a deployment fact
 * the caller should see.
 */

import type { Env } from './bindings.js';

export type ExportFormat = 'screenshot' | 'pdf';

export interface ExportOutcome {
  status: number;
  contentType: string;
  body: ArrayBuffer | string;
  code?: string;
}

export const EXPORT_UNAVAILABLE: ExportOutcome = {
  status: 501,
  contentType: 'application/json',
  code: 'EXPORT_UNAVAILABLE',
  body: JSON.stringify({
    code: 'EXPORT_UNAVAILABLE',
    message: 'this deployment has no Browser Run binding, so screenshot and PDF export are disabled',
  }),
};

function exportFailed(message: string): ExportOutcome {
  return {
    status: 502,
    contentType: 'application/json',
    code: 'EXPORT_FAILED',
    body: JSON.stringify({ code: 'EXPORT_FAILED', message }),
  };
}

/**
 * Quick Action options per format. The page is offline, so no wait tuning is
 * needed. `cacheTTL: 0` keeps Browser Run from caching a caller's page.
 */
function optionsFor(html: string, format: ExportFormat): Record<string, unknown> {
  if (format === 'pdf') {
    return {
      html,
      cacheTTL: 0,
      viewport: { width: 1280, height: 900 },
      pdfOptions: { format: 'a4', printBackground: true },
    };
  }
  return {
    html,
    cacheTTL: 0,
    viewport: { width: 1440, height: 900 },
    screenshotOptions: { fullPage: true, type: 'png' },
  };
}

export async function exportArtifact(
  env: Env,
  html: string,
  format: ExportFormat,
): Promise<ExportOutcome> {
  if (env.BROWSER === undefined) return EXPORT_UNAVAILABLE;

  let response: Response;
  try {
    response = await env.BROWSER.quickAction(format, optionsFor(html, format));
  } catch {
    return exportFailed('the browser binding could not be reached');
  }
  if (!response.ok) {
    return exportFailed(`the browser binding answered ${response.status}`);
  }

  return {
    status: 200,
    contentType: format === 'pdf' ? 'application/pdf' : 'image/png',
    body: await response.arrayBuffer(),
  };
}
