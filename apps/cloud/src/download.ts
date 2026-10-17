/**
 * Signed downloads for stored pages: what the remote MCP `artifact-export` tool
 * hands back instead of the bytes.
 *
 * A download URL names one stored object (a page, its retained spec, or a PNG
 * or PDF made from it) and carries an expiry and an HMAC-SHA256 signature over
 * both, keyed by the `DOWNLOAD_SIGNING_KEY` secret. The route needs no bearer:
 * minting a URL required the owner's bearer, the signature proves it was
 * minted here, and the route still checks the object's own expiry, so a
 * revoked share or an expired artifact stops downloading even while its URL
 * is unexpired.
 *
 * PNG and PDF are made once through Browser Run and stored beside the page with
 * its owner and expiry, so exporting the same page twice costs one browser call.
 */

import type { Env } from './bindings.js';
import { DOWNLOAD_URL_TTL_SECONDS, MIN_SIGNING_KEY_LENGTH } from './config.js';
import { exportArtifact } from './screenshot.js';
import {
  keyOf,
  readStored,
  type SiblingSuffix,
  type StoredKind,
  shareIdPattern,
} from './share.js';
import type { ArtifactExportFormat } from '../../../src/mcp/mcp-tool-definitions.js';

export const DOWNLOAD_ROUTE = '/v1/download/';

const FORMATS: Readonly<
  Record<ArtifactExportFormat, { suffix?: SiblingSuffix; contentType: string; ext: string }>
> = {
  html: { contentType: 'text/html; charset=utf-8', ext: 'html' },
  png: { suffix: 'png', contentType: 'image/png', ext: 'png' },
  pdf: { suffix: 'pdf', contentType: 'application/pdf', ext: 'pdf' },
  // The retained spec keeps the content type it was stored with.
  spec: { suffix: 'spec', contentType: 'application/yaml; charset=utf-8', ext: 'yaml' },
};

function isFormat(value: string): value is ArtifactExportFormat {
  return Object.hasOwn(FORMATS, value);
}

function isKind(value: string): value is StoredKind {
  return value === 'artifact' || value === 'share';
}

let cachedKey: { secret: string; key: Promise<CryptoKey> } | undefined;

/** The HMAC key, imported once per isolate; undefined when no usable secret is set. */
function signingKey(env: Env): Promise<CryptoKey> | undefined {
  const secret = env.DOWNLOAD_SIGNING_KEY ?? '';
  if (secret.length < MIN_SIGNING_KEY_LENGTH) return undefined;
  if (cachedKey?.secret !== secret) {
    cachedKey = {
      secret,
      key: crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign', 'verify'],
      ),
    };
  }
  return cachedKey.key;
}

export function downloadsEnabled(env: Env): boolean {
  return signingKey(env) !== undefined;
}

interface DownloadTarget {
  kind: StoredKind;
  id: string;
  format: ArtifactExportFormat;
  /** Unix seconds. */
  exp: number;
}

function signedBytes(target: DownloadTarget): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    `ak-render-download\n${target.kind}\n${target.id}\n${target.format}\n${target.exp}`,
  );
}

function base64url(bytes: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function fromBase64url(value: string): Uint8Array<ArrayBuffer> | undefined {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) return undefined;
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function signedPath(key: CryptoKey, target: DownloadTarget): Promise<string> {
  const signature = await crypto.subtle.sign('HMAC', key, signedBytes(target));
  return `${DOWNLOAD_ROUTE}${target.kind}/${target.id}/${target.format}?exp=${target.exp}&sig=${base64url(signature)}`;
}

/** An artifact URL, a share URL, or a bare id (an artifact). */
export function parseArtifactRef(value: unknown): { kind: StoredKind; id: string } | undefined {
  if (typeof value !== 'string' || value.length > 512) return undefined;
  if (shareIdPattern().test(value)) return { kind: 'artifact', id: value };
  let path: string;
  try {
    path = new URL(value).pathname;
  } catch {
    return undefined;
  }
  const match = /^\/v1\/(artifact|share)\/([^/]+)$/u.exec(path);
  const kind = match?.[1] ?? '';
  const id = match?.[2] ?? '';
  return isKind(kind) && shareIdPattern().test(id) ? { kind, id } : undefined;
}

export type ExportLinksOutcome =
  | {
      ok: true;
      kind: StoredKind;
      id: string;
      expiresAt: string;
      urlsExpireAt: string;
      downloads: Partial<Record<ArtifactExportFormat, string>>;
      themeOverride?: string;
    }
  | { ok: false; code: string; message: string };

/**
 * Mint download URLs for a stored page the caller owns, making any missing PNG
 * or PDF first. `admit` is asked once, with whether a browser export is about
 * to run, so the caller counts exactly one rate-limit class per call.
 */
export async function exportLinks(
  env: Env,
  owner: string,
  ref: { kind: StoredKind; id: string },
  formats: readonly ArtifactExportFormat[],
  now: Date,
  admit: (browser: boolean) => Promise<boolean>,
): Promise<ExportLinksOutcome> {
  const key = signingKey(env);
  if (key === undefined) {
    return {
      ok: false,
      code: 'DOWNLOAD_UNAVAILABLE',
      message: 'this deployment has no download signing key, so artifact-export is disabled',
    };
  }
  const found = await readStored(env, ref.kind, ref.id, now);
  // Someone else's page answers exactly like a missing one.
  if (!found.ok || found.owner !== owner) {
    return found.ok || found.status === 404
      ? { ok: false, code: 'NOT_FOUND', message: `no such ${ref.kind}` }
      : { ok: false, code: found.code, message: found.message };
  }
  if (formats.includes('spec') && found.metadata['spec'] === undefined) {
    return {
      ok: false,
      code: 'SPEC_NOT_RETAINED',
      message: 'this page was rendered without retainSpec: true, so its spec was not kept',
    };
  }

  const missing: ('png' | 'pdf')[] = [];
  for (const format of ['png', 'pdf'] as const) {
    if (!formats.includes(format)) continue;
    if ((await env.RENDER_SHARES.get(keyOf(ref.kind, ref.id, format))) === null) {
      missing.push(format);
    }
  }
  if (missing.length > 0 && env.BROWSER === undefined) {
    return {
      ok: false,
      code: 'EXPORT_UNAVAILABLE',
      message: 'this deployment has no Browser Run binding, so png and pdf export are disabled',
    };
  }
  if (!(await admit(missing.length > 0))) {
    return {
      ok: false,
      code: 'RATE_LIMITED',
      message: `too many ${missing.length > 0 ? 'export' : 'validate'} requests`,
    };
  }
  for (const format of missing) {
    const exported = await exportArtifact(env, found.html, format === 'pdf' ? 'pdf' : 'screenshot');
    if (exported.status !== 200 || typeof exported.body === 'string') {
      return {
        ok: false,
        code: exported.code ?? 'EXPORT_FAILED',
        message: `the ${format} export failed`,
      };
    }
    await env.RENDER_SHARES.put(keyOf(ref.kind, ref.id, format), exported.body, {
      customMetadata: {
        owner: found.owner,
        createdAt: now.toISOString(),
        expiresAt: found.expiresAt,
      },
      httpMetadata: { contentType: FORMATS[format].contentType },
    });
  }

  const ceiling = Math.floor(now.getTime() / 1000) + DOWNLOAD_URL_TTL_SECONDS;
  const stored = Math.floor(Date.parse(found.expiresAt) / 1000);
  const exp = Number.isFinite(stored) ? Math.min(ceiling, stored) : ceiling;
  const downloads: Partial<Record<ArtifactExportFormat, string>> = {};
  for (const format of formats) {
    downloads[format] = await signedPath(await key, { ...ref, format, exp });
  }
  const themeOverride = found.metadata['themeOverride'];
  return {
    ok: true,
    ...ref,
    expiresAt: found.expiresAt,
    urlsExpireAt: new Date(exp * 1000).toISOString(),
    downloads,
    ...(themeOverride === undefined ? {} : { themeOverride }),
  };
}

function refusal(status: number, code: string, message: string): Response {
  return new Response(`${JSON.stringify({ code, message })}\n`, {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/**
 * `GET /v1/download/:kind/:id/:format?exp&sig`. The signature is checked before
 * any storage read, so an unsigned request costs nothing.
 */
export async function handleDownload(url: URL, env: Env, now: Date, csp: string): Promise<Response> {
  const key = signingKey(env);
  if (key === undefined) {
    return refusal(501, 'DOWNLOAD_UNAVAILABLE', 'downloads are disabled on this deployment');
  }
  const [kind = '', id = '', format = '', ...rest] = url.pathname
    .slice(DOWNLOAD_ROUTE.length)
    .split('/');
  const expText = url.searchParams.get('exp') ?? '';
  const signature = fromBase64url(url.searchParams.get('sig') ?? '');
  if (
    rest.length > 0 ||
    !isKind(kind) ||
    !shareIdPattern().test(id) ||
    !isFormat(format) ||
    !/^[1-9][0-9]{0,11}$/u.test(expText)
  ) {
    return refusal(404, 'NOT_FOUND', 'no such download');
  }
  const exp = Number(expText);
  if (
    signature === undefined ||
    !(await crypto.subtle.verify('HMAC', await key, signature, signedBytes({ kind, id, format, exp })))
  ) {
    return refusal(403, 'INVALID_SIGNATURE', 'this download link is not valid');
  }
  if (exp * 1000 <= now.getTime()) {
    return refusal(410, 'LINK_EXPIRED', 'this download link has expired; export again');
  }

  const spec = FORMATS[format];
  // The page itself carries the expiry the link must not outlive; reading it
  // first also stops a revoked share's exports from downloading.
  const page = await readStored(env, kind, id, now);
  if (!page.ok) return refusal(page.status, page.code, page.message);
  let body: string | ArrayBuffer = page.html;
  let contentType = spec.contentType;
  let ext = spec.ext;
  if (spec.suffix !== undefined) {
    const object = await env.RENDER_SHARES.get(keyOf(kind, id, spec.suffix));
    if (object === null) return refusal(404, 'NOT_FOUND', 'no such download');
    body = await object.arrayBuffer();
    contentType = object.httpMetadata?.contentType ?? contentType;
    if (format === 'spec' && page.metadata['spec'] === 'json') ext = 'json';
  }
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': contentType,
      'content-disposition': `attachment; filename="ak-render-${id}.${ext}"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'content-security-policy': csp,
    },
  });
}
