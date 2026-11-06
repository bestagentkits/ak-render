/**
 * Cloud PNG/PDF export through Cloudflare Browser Run Quick Actions.
 *
 * Same semantics as the local exporter: the page is pinned to the high-quality
 * profile, every 3D scene must draw a live WebGL frame, the frame is frozen and
 * its pixels measured before capture. Quick Actions have no evaluate, so the
 * settle step runs as a nonce-bearing inline script and Browser Run waits for
 * `html[data-ak-export="ready"]`; a scene that fails never reaches that
 * selector, so a poster or blank frame cannot be captured as success.
 *
 * Nothing leaves the machine without consent: the caller computes the upload
 * manifest (exact bytes and digest of the one HTML file sent; local assets are
 * already inlined by compile, so there are no other files) and passes its
 * digest back as the approval. No approval, or an approval for other bytes, is
 * `consent-required` before any request. Browser Run receives the page inline
 * with `cacheTTL: 0`; it is never stored, shared or published by this path.
 *
 * Free of Node built-ins (Web Crypto and fetch only) so the Worker shares the
 * request builder.
 */

import { ExportError, type ExportFormat } from './export-errors.js';
import {
  EXPORT_READY_SELECTOR,
  EXPORT_SETTLED_SELECTOR,
  type ExportReadyDetail,
  hasScenes,
  readExportOutcome,
  withExportReadyScript,
} from './export-ready.js';

export const BROWSER_RUN_API = 'https://api.cloudflare.com/client/v4';
/** Browser Run caps waitForSelector and navigation at 60 seconds each. */
export const BROWSER_RUN_MAX_WAIT_MS = 60_000;
/** Largest page this path will send; Browser Run rejects very large bodies. */
export const MAX_CLOUD_HTML_BYTES = 16 * 1024 * 1024;

export interface CloudExportManifest {
  destination: 'cloudflare-browser-run';
  format: ExportFormat;
  /** The only file sent: the compiled page, with every local asset already inlined. */
  files: [{ name: 'page.html'; bytes: number; sha256: string }];
  scenes: number;
  /** Browser Run keeps nothing: `cacheTTL: 0`, no R2 object, no share link. */
  retention: 'none';
}

export interface CaptureSettings {
  viewport?: { width: number; height: number };
  /** Device pixel ratio, 1-3; defaults to 2 like the local exporter. */
  scale?: number;
  /** One budget for the scene settle wait, at most 60 seconds on Browser Run. */
  timeoutMs?: number;
}

export interface CloudExportOptions extends CaptureSettings {
  html: string;
  format: ExportFormat;
  accountId: string;
  apiToken: string;
  /** sha256 of the approved manifest's page; anything else is refused before upload. */
  approvedSha256?: string;
  /** Injected for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
}

export interface CloudExportReceipt {
  backend: 'cloud';
  format: ExportFormat;
  bytes: number;
  ms: number;
  scenes: number;
  sha256: string;
}

const encoder = new TextEncoder();

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const sceneCount = (html: string): number => (html.match(/\sdata-ak-3d[\s=>]/gu) ?? []).length;

/** What would leave the machine for one cloud export. Shown to the user for approval. */
export async function cloudExportManifest(
  html: string,
  format: ExportFormat,
): Promise<CloudExportManifest> {
  return {
    destination: 'cloudflare-browser-run',
    format,
    files: [
      { name: 'page.html', bytes: encoder.encode(html).length, sha256: await sha256Hex(html) },
    ],
    scenes: sceneCount(html),
    retention: 'none',
  };
}

const waitBudget = (timeoutMs: number | undefined): number =>
  Math.min(BROWSER_RUN_MAX_WAIT_MS, Math.max(1_000, timeoutMs ?? BROWSER_RUN_MAX_WAIT_MS));

/**
 * The Quick Action request body for a compiled page. Shared by this client and
 * the Worker's Browser Run binding, so both backends capture the same way.
 */
export function browserRunBody(
  html: string,
  format: ExportFormat,
  settings: CaptureSettings = {},
): Record<string, unknown> {
  const budget = waitBudget(settings.timeoutMs);
  const scenes = hasScenes(html);
  const body: Record<string, unknown> = {
    html: withExportReadyScript(html, budget),
    viewport: {
      ...(settings.viewport ?? { width: 1440, height: 900 }),
      deviceScaleFactor: settings.scale ?? 2,
    },
    gotoOptions: { waitUntil: 'load', timeout: BROWSER_RUN_MAX_WAIT_MS },
  };
  // The ready selector proves every scene drew a measured, non-blank frame.
  if (scenes) body['waitForSelector'] = { selector: EXPORT_READY_SELECTOR, timeout: budget };
  if (format === 'pdf') {
    body['pdfOptions'] = {
      format: 'a4',
      printBackground: true,
      margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' },
    };
  } else {
    body['screenshotOptions'] = { fullPage: true, type: 'png' };
  }
  return body;
}

interface ApiFailure {
  status: number;
  errors: { code?: number; message?: string }[];
}

async function readFailure(response: Response): Promise<ApiFailure> {
  let errors: ApiFailure['errors'] = [];
  try {
    const parsed = (await response.json()) as { errors?: unknown };
    if (Array.isArray(parsed.errors)) {
      errors = parsed.errors.filter(
        (entry): entry is ApiFailure['errors'][number] =>
          typeof entry === 'object' && entry !== null,
      );
    }
  } catch {
    // Not JSON; the status alone classifies it.
  }
  return { status: response.status, errors };
}

const describe = (failure: ApiFailure): string =>
  [
    `Browser Run answered ${failure.status}`,
    ...failure.errors.map((entry) =>
      `${entry.code ?? '?'}: ${String(entry.message ?? '').slice(0, 200)}`.trim(),
    ),
  ].join('; ');

const isTimeout = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');

function endpoint(accountId: string, action: 'screenshot' | 'pdf' | 'content'): string {
  if (!/^[0-9a-f]{32}$/iu.test(accountId)) {
    throw new ExportError(
      'cloud-unauthorized',
      'the Cloudflare account id is not a 32-character hex id',
    );
  }
  // The REST API takes cacheTTL as a query parameter and rejects it in the body.
  return `${BROWSER_RUN_API}/accounts/${accountId}/browser-rendering/${action}?cacheTTL=0`;
}

async function post(
  options: Pick<CloudExportOptions, 'accountId' | 'apiToken' | 'fetch'>,
  action: 'screenshot' | 'pdf' | 'content',
  body: Record<string, unknown>,
): Promise<Response> {
  const call = options.fetch ?? fetch;
  try {
    return await call(endpoint(options.accountId, action), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${options.apiToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      // Navigation and the settle wait are each capped at 60 s, plus capture.
      signal: AbortSignal.timeout(BROWSER_RUN_MAX_WAIT_MS * 2 + 30_000),
    });
  } catch (error) {
    if (error instanceof ExportError) throw error;
    if (isTimeout(error)) throw new ExportError('timeout', 'Browser Run did not answer in time');
    throw new ExportError('cloud-failed', 'Browser Run could not be reached');
  }
}

const TAXONOMY = new Set(['timeout', 'webgl-unavailable', 'scene-error', 'capture-failed']);

/**
 * Load the page once more and read the settle outcome it wrote, to name why a
 * capture never became ready. Returns undefined when the page wrote nothing.
 */
export async function probeCloudExport(
  options: Pick<
    CloudExportOptions,
    'html' | 'accountId' | 'apiToken' | 'fetch' | 'viewport' | 'scale' | 'timeoutMs'
  >,
): Promise<{ code: string; detail: Partial<ExportReadyDetail> } | undefined> {
  const body = browserRunBody(options.html, 'png', options);
  delete body['screenshotOptions'];
  body['waitForSelector'] = {
    selector: EXPORT_SETTLED_SELECTOR,
    timeout: waitBudget(options.timeoutMs),
  };
  const response = await post(options, 'content', body);
  if (!response.ok) return undefined;
  let parsed: { result?: unknown };
  try {
    parsed = (await response.json()) as { result?: unknown };
  } catch {
    return undefined;
  }
  return typeof parsed.result === 'string' ? readExportOutcome(parsed.result) : undefined;
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];

/** Export one compiled page through Browser Run. Throws ExportError; never returns a poster. */
export async function exportPageCloud(
  options: CloudExportOptions,
): Promise<{ bytes: Uint8Array; receipt: CloudExportReceipt }> {
  const started = Date.now();
  const manifest = await cloudExportManifest(options.html, options.format);
  const [file] = manifest.files;
  if (options.approvedSha256 === undefined) {
    throw new ExportError(
      'consent-required',
      `cloud export sends ${file.bytes} bytes (sha256 ${file.sha256}) to Cloudflare Browser Run; approve that manifest first`,
    );
  }
  if (options.approvedSha256 !== file.sha256) {
    throw new ExportError(
      'consent-required',
      'the approved manifest does not match this page; nothing was sent',
    );
  }
  if (file.bytes > MAX_CLOUD_HTML_BYTES) {
    throw new ExportError(
      'invalid-input',
      `the page is ${file.bytes} bytes; cloud export takes at most ${MAX_CLOUD_HTML_BYTES}`,
    );
  }
  if (options.apiToken.trim() === '') {
    throw new ExportError('cloud-unauthorized', 'no Cloudflare API token');
  }

  const response = await post(
    options,
    options.format === 'pdf' ? 'pdf' : 'screenshot',
    browserRunBody(options.html, options.format, options),
  );
  if (!response.ok) {
    const failure = await readFailure(response);
    if (failure.status === 401 || failure.status === 403) {
      throw new ExportError(
        'cloud-unauthorized',
        `${describe(failure)}; the token needs the account permission "Browser Rendering - Edit"`,
      );
    }
    if (manifest.scenes > 0 && failure.status !== 429) {
      const outcome = await probeCloudExport(options).catch(() => undefined);
      if (outcome !== undefined && TAXONOMY.has(outcome.code)) {
        throw new ExportError(
          outcome.code as 'timeout',
          `the page settled as ${outcome.code} (states: ${(outcome.detail.states ?? []).join(', ')}); the static plan is not exported as success`,
        );
      }
    }
    const timedOut = failure.errors.some((entry) =>
      /timeout|timed out/iu.test(entry.message ?? ''),
    );
    throw new ExportError(timedOut ? 'timeout' : 'cloud-failed', describe(failure));
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const magic = options.format === 'pdf' ? PDF_MAGIC : PNG_MAGIC;
  if (!magic.every((byte, index) => bytes[index] === byte)) {
    throw new ExportError('capture-failed', `Browser Run returned no ${options.format} bytes`);
  }
  return {
    bytes,
    receipt: {
      backend: 'cloud',
      format: options.format,
      bytes: bytes.length,
      ms: Date.now() - started,
      scenes: manifest.scenes,
      sha256: file.sha256,
    },
  };
}
