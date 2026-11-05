/**
 * Local 3D model assets, resolved on the compiler side (Node only).
 *
 * A model reference is either a remote URL, which the compiler never fetches
 * (only the browser does, and only through the `models` network capability),
 * or a path relative to the spec's directory. A local `.glb`, or a `.gltf`
 * whose buffers and textures are relative files, is inlined as data URIs so the
 * page stays offline and its bytes stay deterministic.
 *
 * Every local read is confined to `baseDir`: absolute paths, `..` escapes
 * (raw, backslashed or percent-encoded) and symlinks that leave it are rejected
 * before any byte is read. Reads go through a file descriptor and never pull
 * more than the per-asset cap plus one byte. Buffers and images are checked by
 * role: a buffer is never an image, and an image must be PNG, JPEG or WebP by
 * its magic bytes, whatever its name or declared MIME type says. Every
 * diagnostic carries the prop's JSON path, the reference the author wrote and
 * a `fix`.
 *
 * This module touches the file system, so it must never be imported by the
 * Worker or the browser runtime.
 */

import { closeSync, fstatSync, openSync, readSync, realpathSync } from 'node:fs';
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

const MIB = 1024 * 1024;

export const MODEL_ASSET_LIMITS: ModelAssetLimits = {
  perAssetBytes: 16 * MIB,
  perPageBytes: 32 * MIB,
};

/** Model files a reference may name, with the MIME type each is inlined as. */
const MODEL_TYPES: Readonly<Record<string, string>> = {
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
};

/** Buffer files a glTF may reference. */
const BUFFER_TYPES: Readonly<Record<string, string>> = {
  '.bin': 'application/octet-stream',
};

/** Image files a glTF may reference. KTX2 is absent: no decoder is bundled. */
const IMAGE_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

/** Every extension the resolver accepts, with its MIME type. */
export const MODEL_ASSET_TYPES: Readonly<Record<string, string>> = {
  ...MODEL_TYPES,
  ...BUFFER_TYPES,
  ...IMAGE_TYPES,
};

const BUFFER_DATA_MIMES: ReadonlySet<string> = new Set([
  'application/octet-stream',
  'application/gltf-buffer',
]);
const IMAGE_MIMES: ReadonlySet<string> = new Set(Object.values(IMAGE_TYPES));

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
  /** Real path of `baseDir`, symlinks and case resolved. */
  readonly root: string;
  readonly budget: ModelAssetBudget;
  readonly limits: ModelAssetLimits;
  readonly bag: DiagnosticBag;
  readonly origins: Set<string>;
  /** Bytes read for this model; committed to the budget only on success. */
  bytes: number;
}

/** Where inside a glTF a problem sits; absent for the model reference itself. */
interface Site {
  gltfPath: string;
  uri: string;
}

type Role = 'buffer' | 'image';

/** Resolve one model reference. Never touches the network. */
export function resolveModelAsset(
  reference: string,
  options: ResolveModelAssetOptions,
): ModelAssetResult {
  const bag = new DiagnosticBag();
  const base: Omit<Context, 'root'> = {
    options,
    reference,
    budget: options.budget ?? createModelAssetBudget(),
    limits: options.limits ?? MODEL_ASSET_LIMITS,
    bag,
    origins: new Set(),
    bytes: 0,
  };

  if (isRemote(reference)) {
    const ctx: Context = { ...base, root: '' };
    if (!gateRemote(ctx, reference, undefined)) return { diagnostics: bag.list() };
    return {
      asset: { kind: 'remote', uri: reference, connectOrigins: [...ctx.origins].sort() },
      diagnostics: bag.list(),
    };
  }

  let root: string;
  try {
    root = realpathSync(resolve(options.baseDir));
  } catch {
    const ctx: Context = { ...base, root: '' };
    fail(
      ctx,
      'SPEC_VALIDATION_ERROR',
      `the spec directory "${options.baseDir}" does not exist, so model "${reference}" cannot be resolved`,
      'compile the spec from a file on disk, or pass the directory that holds its assets',
    );
    return { diagnostics: bag.list() };
  }
  const ctx: Context = { ...base, root };

  const ext = extname(reference).toLowerCase();
  const mime = MODEL_TYPES[ext];
  if (mime === undefined) {
    fail(
      ctx,
      'SPEC_VALIDATION_ERROR',
      `model "${reference}" must be a .glb or .gltf file`,
      'export the model as glTF 2.0 (.glb or .gltf)',
      { allowed: Object.keys(MODEL_TYPES) },
    );
    return { diagnostics: bag.list() };
  }
  const file = confine(ctx, root, reference, undefined);
  if (file === undefined) return { diagnostics: bag.list() };
  const data = readBounded(ctx, file, undefined);
  if (data === undefined) return { diagnostics: bag.list() };

  const inlined = ext === '.glb' ? checkGlb(ctx, data) : inlineGltf(ctx, data, dirname(file));
  if (inlined === undefined || bag.hasErrors) return { diagnostics: bag.list() };

  ctx.budget.usedBytes += ctx.bytes;
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
  fix: string,
  details: Record<string, unknown> = {},
): void {
  ctx.bag.add({
    code,
    path: ctx.options.path,
    message,
    details: { reference: ctx.reference, ...details, fix },
  });
}

function mib(bytes: number): string {
  return `${(bytes / MIB).toFixed(2)} MiB`;
}

/** Remote URLs pass only the `models` gate; the compiler records the origin, never fetches. */
function gateRemote(ctx: Context, uri: string, site: Site | undefined): boolean {
  let url: URL | undefined;
  try {
    url = new URL(uri);
  } catch {
    url = undefined;
  }
  if (url === undefined || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
    fail(
      ctx,
      'POLICY_VIOLATION',
      `model URI "${uri}" must be a relative path or an http(s) URL`,
      'use a path relative to the spec, or an https URL allowed by policy.network',
      { ...site },
    );
    return false;
  }
  if (!networkAllows(ctx.options.policy, 'models', uri, '')) {
    fail(
      ctx,
      'POLICY_VIOLATION',
      `remote model URI "${uri}" is blocked: ${blockedReason(ctx.options.policy, 'models')}`,
      'add "models" to policy.network.allow (and its host to providers, if any), or use a local file',
      { ...site, capability: 'models' },
    );
    return false;
  }
  ctx.origins.add(url.origin);
  return true;
}

/** Any `..` segment, with either separator, raw or percent-encoded. */
function hasParentSegment(path: string): boolean {
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // Malformed encoding is judged on the raw text.
  }
  return [path, decoded].some((text) => text.split(/[\\/]/u).includes('..'));
}

/**
 * Resolve `relativePath` against `from` and prove it stays inside the root,
 * both lexically and after symlinks and junctions are followed.
 */
function confine(
  ctx: Context,
  from: string,
  relativePath: string,
  site: Site | undefined,
): string | undefined {
  const notRelative =
    relativePath === '' ||
    isAbsolute(relativePath) ||
    /^[\\/]/u.test(relativePath) ||
    /^[a-zA-Z]:/u.test(relativePath) ||
    relativePath.includes('\0');
  if (notRelative) {
    fail(
      ctx,
      'POLICY_VIOLATION',
      `model path "${relativePath}" must be relative to the spec`,
      'use a path relative to the spec file, with forward slashes, e.g. models/part.glb',
      { ...site },
    );
    return undefined;
  }
  const leaves = () =>
    fail(
      ctx,
      'POLICY_VIOLATION',
      `model path "${relativePath}" leaves the spec directory`,
      'move the file inside the spec directory and reference it without ".."',
      { ...site },
    );
  if (hasParentSegment(relativePath)) {
    leaves();
    return undefined;
  }
  const candidate = resolve(from, relativePath.replaceAll('\\', '/'));
  if (!inside(ctx.root, candidate)) {
    leaves();
    return undefined;
  }
  let real: string;
  try {
    real = realpathSync(candidate);
  } catch {
    fail(
      ctx,
      'SPEC_VALIDATION_ERROR',
      `model file "${relativePath}" was not found`,
      'check the path is relative to the spec file and the file exists',
      { ...site },
    );
    return undefined;
  }
  if (!inside(ctx.root, real)) {
    fail(
      ctx,
      'POLICY_VIOLATION',
      `model path "${relativePath}" resolves through a link outside the spec directory`,
      'copy the file into the spec directory instead of linking to it',
      { ...site },
    );
    return undefined;
  }
  return real;
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * Read a file through one descriptor, never allocating more than the per-asset
 * cap plus one byte, so an oversized or growing file is caught without being
 * loaded.
 */
function readBounded(ctx: Context, file: string, site: Site | undefined): Buffer | undefined {
  const shown = site?.uri ?? ctx.reference;
  const cap = ctx.limits.perAssetBytes;
  let fd: number | undefined;
  let data: Buffer;
  try {
    fd = openSync(file, 'r');
    const stat = fstatSync(fd);
    if (!stat.isFile()) {
      fail(
        ctx,
        'SPEC_VALIDATION_ERROR',
        `model path "${shown}" is not a file`,
        'point at a file, not a directory',
        { ...site },
      );
      return undefined;
    }
    const buffer = Buffer.alloc(Math.min(stat.size, cap) + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = readSync(fd, buffer, length, buffer.length - length, length);
      if (read === 0) break;
      length += read;
    }
    data = buffer.subarray(0, length);
  } catch {
    fail(
      ctx,
      'SPEC_VALIDATION_ERROR',
      `model file "${shown}" could not be read`,
      'check the file exists and is readable',
      { ...site },
    );
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  if (data.length > cap) {
    fail(
      ctx,
      'SPEC_BOUNDS_ERROR',
      `model file "${shown}" is over the ${mib(cap)} limit per asset`,
      'simplify the mesh or shrink its textures',
      { ...site, limit: cap },
    );
    return undefined;
  }
  const total = ctx.budget.usedBytes + ctx.bytes + data.length;
  if (total > ctx.limits.perPageBytes) {
    fail(
      ctx,
      'SPEC_BOUNDS_ERROR',
      `model assets on this page reach ${mib(total)}, over the ${mib(ctx.limits.perPageBytes)} limit per page`,
      'use fewer or smaller models on this page',
      { ...site, bytes: total, limit: ctx.limits.perPageBytes },
    );
    return undefined;
  }
  ctx.bytes += data.length;
  return data;
}

/** The image MIME type the bytes really are, or undefined when not PNG, JPEG or WebP. */
function sniffImage(bytes: Buffer): string | undefined {
  if (
    bytes.length >= 8 &&
    bytes.readUInt32BE(0) === 0x89504e47 &&
    bytes.readUInt32BE(4) === 0x0d0a1a0a
  )
    return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'image/jpeg';
  if (
    bytes.length >= 12 &&
    bytes.toString('latin1', 0, 4) === 'RIFF' &&
    bytes.toString('latin1', 8, 12) === 'WEBP'
  )
    return 'image/webp';
  return undefined;
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
    fail(
      ctx,
      'SPEC_VALIDATION_ERROR',
      `model "${ctx.reference}" is not a valid glTF 2.0 binary`,
      're-export the model as glTF 2.0 binary (.glb)',
    );
    return undefined;
  }
  const chunkLength = data.readUInt32LE(12);
  if (data.readUInt32LE(16) !== CHUNK_JSON || 20 + chunkLength > data.length) {
    fail(
      ctx,
      'SPEC_VALIDATION_ERROR',
      `model "${ctx.reference}" has no JSON chunk`,
      're-export the model as glTF 2.0 binary (.glb)',
    );
    return undefined;
  }
  const json = parseGltfJson(ctx, data.subarray(20, 20 + chunkLength));
  if (json === undefined) return undefined;
  // A GLB is inlined unchanged, so it must be self-contained: an external
  // relative file could not be rewritten into the binary container.
  forEachUri(json, (uri, site, role) => {
    if (uri.startsWith('data:')) checkDataUri(ctx, uri, site, role);
    else if (isRemote(uri)) gateRemote(ctx, uri, site);
    else
      fail(
        ctx,
        'SPEC_VALIDATION_ERROR',
        `GLB model "${ctx.reference}" references the external file "${uri}"`,
        'embed the file in the GLB when exporting, or use a .gltf with relative files',
        { ...site },
      );
  });
  return ctx.bag.hasErrors ? undefined : data;
}

/** Validate a glTF JSON file and inline its relative buffers and images. */
function inlineGltf(ctx: Context, data: Buffer, dir: string): Buffer | undefined {
  const json = parseGltfJson(ctx, data);
  if (json === undefined) return undefined;
  forEachUri(json, (uri, site, role, holder) => {
    if (uri.startsWith('data:')) {
      checkDataUri(ctx, uri, site, role);
      return;
    }
    if (isRemote(uri)) {
      gateRemote(ctx, uri, site);
      return;
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(uri);
    } catch {
      fail(
        ctx,
        'SPEC_VALIDATION_ERROR',
        `glTF URI "${uri}" is not valid URI encoding`,
        'percent-encode the file name correctly or rename the file',
        { ...site },
      );
      return;
    }
    const types = role === 'buffer' ? BUFFER_TYPES : IMAGE_TYPES;
    const mime = types[extname(decoded).toLowerCase()];
    if (mime === undefined) {
      fail(
        ctx,
        'SPEC_VALIDATION_ERROR',
        `glTF ${role} URI "${uri}" has an unsupported file type`,
        role === 'buffer'
          ? 'reference buffers as .bin files'
          : 'convert the texture to PNG, JPEG or WebP',
        { ...site, allowed: Object.keys(types) },
      );
      return;
    }
    const file = confine(ctx, dir, decoded, site);
    if (file === undefined) return;
    const bytes = readBounded(ctx, file, site);
    if (bytes === undefined) return;
    if (role === 'image' && !imageBytesMatch(ctx, bytes, mime, site)) return;
    holder.uri = `data:${mime};base64,${bytes.toString('base64')}`;
  });
  return ctx.bag.hasErrors ? undefined : Buffer.from(JSON.stringify(json), 'utf8');
}

/** An image's bytes must be the format its name or MIME type claims. */
function imageBytesMatch(ctx: Context, bytes: Buffer, claimed: string, site: Site): boolean {
  const actual = sniffImage(bytes);
  if (actual === claimed) return true;
  fail(
    ctx,
    'SPEC_VALIDATION_ERROR',
    `glTF image "${site.uri.slice(0, 64)}" is not a ${claimed} image`,
    'use a real PNG, JPEG or WebP file whose name and MIME type match its content',
    { ...site, claimed, actual: actual ?? null },
  );
  return false;
}

type GltfJson = Record<string, unknown>;

function parseGltfJson(ctx: Context, bytes: Buffer): GltfJson | undefined {
  let json: unknown;
  try {
    json = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail(
      ctx,
      'SPEC_VALIDATION_ERROR',
      `model "${ctx.reference}" is not valid glTF JSON`,
      're-export the model as glTF 2.0',
    );
    return undefined;
  }
  if (!isRecord(json) || !isRecord(json.asset) || json.asset.version !== '2.0') {
    fail(
      ctx,
      'SPEC_VALIDATION_ERROR',
      `model "${ctx.reference}" must declare asset.version "2.0"`,
      're-export the model as glTF 2.0',
    );
    return undefined;
  }
  for (const key of ['buffers', 'images'] as const) {
    if (json[key] !== undefined && !Array.isArray(json[key])) {
      fail(
        ctx,
        'SPEC_VALIDATION_ERROR',
        `model "${ctx.reference}" has a malformed "${key}" list`,
        're-export the model as glTF 2.0',
      );
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
        're-export without Draco, Meshopt or KTX2 compression',
        { unsupported, supported: [...SUPPORTED_GLTF_EXTENSIONS] },
      );
      return undefined;
    }
  }
  const images = Array.isArray(json.images) ? json.images : [];
  images.forEach((image, index) => {
    if (!isRecord(image) || image.mimeType === undefined) return;
    if (typeof image.mimeType !== 'string' || !IMAGE_MIMES.has(image.mimeType)) {
      fail(
        ctx,
        'SPEC_VALIDATION_ERROR',
        `glTF image ${index} declares the unsupported mimeType "${String(image.mimeType)}"`,
        'convert the texture to PNG, JPEG or WebP',
        { gltfPath: pathKey(pathIndex('images', index), 'mimeType'), allowed: [...IMAGE_MIMES] },
      );
    }
  });
  return ctx.bag.hasErrors ? undefined : json;
}

/** Visit every `uri` on buffers and images, in document order, with its role. */
function forEachUri(
  json: GltfJson,
  visit: (uri: string, site: Site, role: Role, holder: Record<string, unknown>) => void,
): void {
  const lists: [key: 'buffers' | 'images', role: Role][] = [
    ['buffers', 'buffer'],
    ['images', 'image'],
  ];
  for (const [key, role] of lists) {
    const list = json[key];
    if (!Array.isArray(list)) continue;
    list.forEach((item, index) => {
      if (!isRecord(item) || item.uri === undefined) return;
      const uri = typeof item.uri === 'string' ? item.uri : '';
      visit(uri, { gltfPath: pathKey(pathIndex(key, index), 'uri'), uri }, role, item);
    });
  }
}

/** Decode a `data:` URI into its MIME type and bytes. */
function parseDataUri(uri: string): { mime: string; bytes: Buffer } | undefined {
  const match = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/su.exec(uri);
  if (match === null) return undefined;
  const mime = (match[1] ?? '').toLowerCase();
  const payload = match[3] ?? '';
  try {
    const bytes = /;base64$/iu.test(match[2] ?? '')
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'latin1');
    return { mime, bytes };
  } catch {
    return undefined;
  }
}

function checkDataUri(ctx: Context, uri: string, site: Site, role: Role): void {
  const shown: Site = { gltfPath: site.gltfPath, uri: `${uri.slice(0, 48)}…` };
  const parsed = parseDataUri(uri);
  const allowed = role === 'buffer' ? BUFFER_DATA_MIMES : IMAGE_MIMES;
  if (parsed === undefined || !allowed.has(parsed.mime)) {
    fail(
      ctx,
      'SPEC_VALIDATION_ERROR',
      `glTF ${role} data URI at ${site.gltfPath} has an unsupported MIME type`,
      role === 'buffer'
        ? 'declare buffers as application/octet-stream'
        : 'embed textures as PNG, JPEG or WebP',
      { ...shown, mime: parsed?.mime ?? null, allowed: [...allowed] },
    );
    return;
  }
  if (role === 'image') imageBytesMatch(ctx, parsed.bytes, parsed.mime, shown);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
