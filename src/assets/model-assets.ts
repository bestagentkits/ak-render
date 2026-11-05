/**
 * Local 3D model assets, resolved on the compiler side (Node only).
 *
 * A model reference is either a remote URL, which the compiler never fetches
 * (only the browser does, and only through the `models` network capability),
 * or a path relative to the spec's directory. A local `.glb`, or a `.gltf`
 * whose buffers and textures are relative files, is inlined as data URIs so the
 * page stays offline and its bytes stay deterministic.
 *
 * Every local read is confined to `baseDir`: absolute paths, `..` escapes and
 * symlinks that leave it are rejected before any byte is read. Sizes are capped
 * per asset and per page, and only an allowlist of extensions and MIME types is
 * accepted. Diagnostics carry the JSON path of the prop and the reference the
 * author wrote.
 *
 * This module touches the file system, so it must never be imported by the
 * Worker or the browser runtime.
 */

import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { type Diagnostic, DiagnosticBag, pathIndex, pathKey } from '../diagnostics.js';
import type { NetworkPolicy } from '../ir.js';
import { blockedReason, isRemote, networkAllows } from '../spec/network-policy.js';

/** Size bounds for inlined model assets, in bytes. */
export interface ModelAssetLimits {
  /** Largest single file (model, buffer or texture) the compiler inlines. */
  readonly perAssetBytes: number;
  /** Largest total of inlined model bytes on one page. */
  readonly perPageBytes: number;
}

export const MODEL_ASSET_LIMITS: ModelAssetLimits = {
  perAssetBytes: 16 * 1024 * 1024,
  perPageBytes: 32 * 1024 * 1024,
};

/** Extensions the resolver accepts, with the MIME type each is inlined as. */
export const MODEL_ASSET_TYPES: Readonly<Record<string, string>> = {
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ktx2': 'image/ktx2',
};

/** Extensions a model reference itself may have; the rest are only sub-resources. */
const MODEL_EXTENSIONS = ['.glb', '.gltf'] as const;

/** MIME types a `data:` URI inside a glTF may declare. */
const ALLOWED_DATA_MIMES = new Set([
  ...Object.values(MODEL_ASSET_TYPES),
  'application/gltf-buffer',
]);

/**
 * glTF extensions the bundled runtime can decode. Draco, Meshopt and KTX2
 * decoders are not bundled, so a model that requires one cannot render.
 */
export const SUPPORTED_GLTF_EXTENSIONS: readonly string[] = [];

/** Running total of inlined bytes for one page; share one across a page's models. */
export interface ModelAssetBudget {
  usedBytes: number;
}

export function createModelAssetBudget(): ModelAssetBudget {
  return { usedBytes: 0 };
}

export interface ResolveModelAssetOptions {
  /** The spec's directory; every local read stays inside it. */
  baseDir: string;
  /** JSON path of the prop holding the reference, e.g. `$.blocks[0].src`. */
  path: string;
  policy: NetworkPolicy;
  /** Page-wide budget; defaults to a fresh one (a single-model page). */
  budget?: ModelAssetBudget;
  limits?: ModelAssetLimits;
}

export type ResolvedModelAsset =
  | {
      kind: 'inline';
      /** `data:` URI with every local sub-resource inlined. */
      uri: string;
      mime: string;
      /** Bytes read from disk for this model. */
      bytes: number;
      /** Allowed remote origins the model's own URIs fetch from, sorted. */
      connectOrigins: string[];
    }
  | { kind: 'remote'; uri: string; connectOrigins: string[] };

export interface ModelAssetResult {
  asset?: ResolvedModelAsset;
  diagnostics: Diagnostic[];
}

interface Context {
  readonly options: ResolveModelAssetOptions;
  readonly reference: string;
  readonly root: string;
  readonly budget: ModelAssetBudget;
  readonly limits: ModelAssetLimits;
  readonly bag: DiagnosticBag;
  readonly origins: Set<string>;
  /** Bytes read for this model; committed to the budget only on success. */
  bytes: number;
}

/** Resolve one model reference. Never touches the network. */
export function resolveModelAsset(
  reference: string,
  options: ResolveModelAssetOptions,
): ModelAssetResult {
  const bag = new DiagnosticBag();
  const ctx: Context = {
    options,
    reference,
    root: resolve(options.baseDir),
    budget: options.budget ?? createModelAssetBudget(),
    limits: options.limits ?? MODEL_ASSET_LIMITS,
    bag,
    origins: new Set(),
    bytes: 0,
  };

  if (isRemote(reference)) {
    if (!gateRemote(ctx, reference, undefined)) return { diagnostics: bag.list() };
    return {
      asset: { kind: 'remote', uri: reference, connectOrigins: [...ctx.origins].sort() },
      diagnostics: bag.list(),
    };
  }

  const ext = extname(reference).toLowerCase();
  if (!(MODEL_EXTENSIONS as readonly string[]).includes(ext)) {
    fail(ctx, 'SPEC_VALIDATION_ERROR', `model "${reference}" must be a .glb or .gltf file`, {
      allowed: [...MODEL_EXTENSIONS],
    });
    return { diagnostics: bag.list() };
  }
  const file = confine(ctx, ctx.root, reference, undefined);
  if (file === undefined) return { diagnostics: bag.list() };
  const data = readBounded(ctx, file, reference, undefined);
  if (data === undefined) return { diagnostics: bag.list() };

  const inlined = ext === '.glb' ? checkGlb(ctx, data) : inlineGltf(ctx, data, dirname(file));
  if (inlined === undefined || bag.hasErrors) return { diagnostics: bag.list() };

  ctx.budget.usedBytes += ctx.bytes;
  const mime = MODEL_ASSET_TYPES[ext] as string;
  return {
    asset: {
      kind: 'inline',
      uri: `data:${mime};base64,${inlined.toString('base64')}`,
      mime,
      bytes: ctx.bytes,
      connectOrigins: [...ctx.origins].sort(),
    },
    diagnostics: bag.list(),
  };
}

function fail(
  ctx: Context,
  code: Diagnostic['code'],
  message: string,
  details: Record<string, unknown> = {},
): void {
  ctx.bag.add({
    code,
    path: ctx.options.path,
    message,
    details: { reference: ctx.reference, ...details },
  });
}

/** Remote URLs pass only the `models` gate; the compiler records the origin, never fetches. */
function gateRemote(ctx: Context, uri: string, gltfPath: string | undefined): boolean {
  const where = gltfPath === undefined ? {} : { gltfPath, uri };
  let url: URL | undefined;
  try {
    url = new URL(uri);
  } catch {
    url = undefined;
  }
  if (url === undefined || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
    fail(ctx, 'POLICY_VIOLATION', `model URI "${uri}" must be a relative path or an http(s) URL`, {
      ...where,
    });
    return false;
  }
  if (!networkAllows(ctx.options.policy, 'models', uri, '')) {
    fail(
      ctx,
      'POLICY_VIOLATION',
      `remote model URI "${uri}" is blocked: ${blockedReason(ctx.options.policy, 'models')}`,
      { ...where, capability: 'models' },
    );
    return false;
  }
  ctx.origins.add(url.origin);
  return true;
}

/**
 * Resolve `relativePath` against `from` and prove it stays inside the root,
 * both lexically and after symlinks are followed.
 */
function confine(
  ctx: Context,
  from: string,
  relativePath: string,
  gltfPath: string | undefined,
): string | undefined {
  const where = gltfPath === undefined ? {} : { gltfPath, uri: relativePath };
  if (
    relativePath === '' ||
    isAbsolute(relativePath) ||
    /^[\\/]/u.test(relativePath) ||
    /^[a-zA-Z]:/u.test(relativePath) ||
    relativePath.includes('\0')
  ) {
    fail(
      ctx,
      'POLICY_VIOLATION',
      `model path "${relativePath}" must be relative to the spec`,
      where,
    );
    return undefined;
  }
  const candidate = resolve(from, relativePath);
  if (!inside(ctx.root, candidate)) {
    fail(ctx, 'POLICY_VIOLATION', `model path "${relativePath}" leaves the spec directory`, where);
    return undefined;
  }
  let real: string;
  let realRoot: string;
  try {
    real = realpathSync(candidate);
    realRoot = realpathSync(ctx.root);
  } catch {
    fail(ctx, 'SPEC_VALIDATION_ERROR', `model file "${relativePath}" was not found`, where);
    return undefined;
  }
  if (!inside(realRoot, real)) {
    fail(
      ctx,
      'POLICY_VIOLATION',
      `model path "${relativePath}" resolves through a link outside the spec directory`,
      where,
    );
    return undefined;
  }
  return real;
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function readBounded(
  ctx: Context,
  file: string,
  shown: string,
  gltfPath: string | undefined,
): Buffer | undefined {
  const where = gltfPath === undefined ? {} : { gltfPath, uri: shown };
  let size: number;
  try {
    const stat = statSync(file);
    if (!stat.isFile()) {
      fail(ctx, 'SPEC_VALIDATION_ERROR', `model path "${shown}" is not a file`, where);
      return undefined;
    }
    size = stat.size;
  } catch {
    fail(ctx, 'SPEC_VALIDATION_ERROR', `model file "${shown}" was not found`, where);
    return undefined;
  }
  if (size > ctx.limits.perAssetBytes) {
    fail(
      ctx,
      'SPEC_BOUNDS_ERROR',
      `model file "${shown}" is ${size} bytes, over the ${ctx.limits.perAssetBytes}-byte limit per asset`,
      { ...where, bytes: size, limit: ctx.limits.perAssetBytes },
    );
    return undefined;
  }
  const total = ctx.budget.usedBytes + ctx.bytes + size;
  if (total > ctx.limits.perPageBytes) {
    fail(
      ctx,
      'SPEC_BOUNDS_ERROR',
      `model assets on this page total ${total} bytes, over the ${ctx.limits.perPageBytes}-byte limit per page`,
      { ...where, bytes: total, limit: ctx.limits.perPageBytes },
    );
    return undefined;
  }
  try {
    const data = readFileSync(file);
    ctx.bytes += data.length;
    return data;
  } catch {
    fail(ctx, 'SPEC_VALIDATION_ERROR', `model file "${shown}" could not be read`, where);
    return undefined;
  }
}

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"

/** Validate a GLB container and its JSON chunk; a GLB is inlined as-is. */
function checkGlb(ctx: Context, data: Buffer): Buffer | undefined {
  if (
    data.length < 20 ||
    data.readUInt32LE(0) !== GLB_MAGIC ||
    data.readUInt32LE(4) !== 2 ||
    data.readUInt32LE(8) !== data.length
  ) {
    fail(ctx, 'SPEC_VALIDATION_ERROR', `model "${ctx.reference}" is not a valid glTF 2.0 binary`);
    return undefined;
  }
  const chunkLength = data.readUInt32LE(12);
  if (data.readUInt32LE(16) !== CHUNK_JSON || 20 + chunkLength > data.length) {
    fail(ctx, 'SPEC_VALIDATION_ERROR', `model "${ctx.reference}" has no JSON chunk`);
    return undefined;
  }
  const json = parseGltfJson(ctx, data.subarray(20, 20 + chunkLength));
  if (json === undefined) return undefined;
  // A GLB is inlined unchanged, so it must be self-contained: an external
  // relative file could not be rewritten into the binary container.
  forEachUri(json, (uri, gltfPath) => {
    if (uri.startsWith('data:')) checkDataUri(ctx, uri, gltfPath);
    else if (isRemote(uri)) gateRemote(ctx, uri, gltfPath);
    else
      fail(
        ctx,
        'SPEC_VALIDATION_ERROR',
        `GLB model "${ctx.reference}" references the external file "${uri}"; embed it or use a .gltf`,
        { gltfPath, uri },
      );
  });
  return ctx.bag.hasErrors ? undefined : data;
}

/** Validate a glTF JSON file and inline its relative buffers and images. */
function inlineGltf(ctx: Context, data: Buffer, dir: string): Buffer | undefined {
  const json = parseGltfJson(ctx, data);
  if (json === undefined) return undefined;
  forEachUri(json, (uri, gltfPath, holder) => {
    if (uri.startsWith('data:')) {
      checkDataUri(ctx, uri, gltfPath);
      return;
    }
    if (isRemote(uri)) {
      gateRemote(ctx, uri, gltfPath);
      return;
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(uri);
    } catch {
      fail(ctx, 'SPEC_VALIDATION_ERROR', `glTF URI "${uri}" is not valid URI encoding`, {
        gltfPath,
        uri,
      });
      return;
    }
    const mime = MODEL_ASSET_TYPES[extname(decoded).toLowerCase()];
    if (mime === undefined || MODEL_EXTENSIONS.some((ext) => decoded.toLowerCase().endsWith(ext))) {
      fail(ctx, 'SPEC_VALIDATION_ERROR', `glTF URI "${uri}" has an unsupported file type`, {
        gltfPath,
        uri,
        allowed: Object.keys(MODEL_ASSET_TYPES).filter(
          (ext) => !(MODEL_EXTENSIONS as readonly string[]).includes(ext),
        ),
      });
      return;
    }
    const file = confine(ctx, dir, decoded, gltfPath);
    if (file === undefined) return;
    const bytes = readBounded(ctx, file, uri, gltfPath);
    if (bytes === undefined) return;
    holder.uri = `data:${mime};base64,${bytes.toString('base64')}`;
  });
  return ctx.bag.hasErrors ? undefined : Buffer.from(JSON.stringify(json), 'utf8');
}

type GltfJson = Record<string, unknown>;

function parseGltfJson(ctx: Context, bytes: Buffer): GltfJson | undefined {
  let json: unknown;
  try {
    json = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail(ctx, 'SPEC_VALIDATION_ERROR', `model "${ctx.reference}" is not valid glTF JSON`);
    return undefined;
  }
  if (!isRecord(json) || !isRecord(json.asset) || json.asset.version !== '2.0') {
    fail(ctx, 'SPEC_VALIDATION_ERROR', `model "${ctx.reference}" must declare asset.version "2.0"`);
    return undefined;
  }
  for (const key of ['buffers', 'images'] as const) {
    if (json[key] !== undefined && !Array.isArray(json[key])) {
      fail(ctx, 'SPEC_VALIDATION_ERROR', `model "${ctx.reference}" has a malformed "${key}" list`);
      return undefined;
    }
  }
  const required = json.extensionsRequired;
  if (required !== undefined) {
    const names = Array.isArray(required) ? required.filter((x) => typeof x === 'string') : [];
    const unsupported = names.filter((name) => !SUPPORTED_GLTF_EXTENSIONS.includes(name));
    if (!Array.isArray(required) || unsupported.length > 0) {
      fail(
        ctx,
        'SPEC_VALIDATION_ERROR',
        `model "${ctx.reference}" requires glTF extensions with no bundled decoder: ${unsupported.join(', ') || 'malformed extensionsRequired'}`,
        { unsupported, supported: [...SUPPORTED_GLTF_EXTENSIONS] },
      );
      return undefined;
    }
  }
  return json;
}

/** Visit every `uri` on buffers and images, in document order. */
function forEachUri(
  json: GltfJson,
  visit: (uri: string, gltfPath: string, holder: Record<string, unknown>) => void,
): void {
  for (const key of ['buffers', 'images'] as const) {
    const list = json[key];
    if (!Array.isArray(list)) continue;
    list.forEach((item, index) => {
      if (!isRecord(item) || item.uri === undefined) return;
      const gltfPath = pathKey(pathIndex(key, index), 'uri');
      if (typeof item.uri !== 'string') visit('', gltfPath, item);
      else visit(item.uri, gltfPath, item);
    });
  }
}

function checkDataUri(ctx: Context, uri: string, gltfPath: string): void {
  const mime = /^data:([^;,]+)/u.exec(uri)?.[1]?.toLowerCase();
  if (mime === undefined || !ALLOWED_DATA_MIMES.has(mime)) {
    fail(
      ctx,
      'SPEC_VALIDATION_ERROR',
      `glTF data URI at ${gltfPath} has an unsupported MIME type`,
      {
        gltfPath,
        mime: mime ?? null,
      },
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
