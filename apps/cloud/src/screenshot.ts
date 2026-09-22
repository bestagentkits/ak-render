/**
 * Screenshot and PDF export through Browser Run.
 *
 * Browser Run is used for nothing else. It is a rendering surface for export
 * and visual verification, not a fetch proxy and not a second compile path, so
 * the only content that reaches it is an artifact this worker already compiled
 * from the caller's own spec.
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

export async function exportArtifact(
  env: Env,
  html: string,
  format: ExportFormat,
): Promise<ExportOutcome> {
  if (env.BROWSER === undefined) return EXPORT_UNAVAILABLE;

  // Browser Run is addressed through its binding; the payload carries the
  // artifact and the export format only.
  const response = await env.BROWSER.fetch('https://browser-run.internal/v1/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      html,
      format,
      viewport: format === 'pdf' ? { width: 1280, height: 900 } : { width: 1440, height: 900 },
      fullPage: true,
    }),
  });

  if (!response.ok) {
    return {
      status: 502,
      contentType: 'application/json',
      code: 'EXPORT_FAILED',
      body: JSON.stringify({
        code: 'EXPORT_FAILED',
        message: `the browser binding answered ${response.status}`,
      }),
    };
  }

  return {
    status: 200,
    contentType: format === 'pdf' ? 'application/pdf' : 'image/png',
    body: await response.arrayBuffer(),
  };
}
