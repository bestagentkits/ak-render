import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createModelAssetBudget,
  MODEL_ASSET_LIMITS,
  type ResolveModelAssetOptions,
  resolveModelAsset,
} from '../../src/assets/model-assets.js';
import type { NetworkPolicy } from '../../src/ir.js';
import { buildContentSecurityPolicy } from '../../src/render/document.js';
import { type AssetReference, assetOrigins } from '../../src/spec/asset-references.js';
import { normalize, normalizeSpec } from '../../src/spec/normalize.js';

const FIXTURES = resolve('fixtures/3d/assets');
const PATH = '$.blocks[0].src';
const scratch = mkdtempSync(join(tmpdir(), 'ak-model-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A minimal valid GLB: header, one JSON chunk, one 12-byte BIN chunk. */
function makeGlb(json: Record<string, unknown> = { asset: { version: '2.0' } }): Buffer {
  let text = JSON.stringify(json);
  while (text.length % 4 !== 0) text += ' ';
  const jsonChunk = Buffer.from(text, 'utf8');
  const bin = Buffer.alloc(12);
  const out = Buffer.alloc(12 + 8 + jsonChunk.length + 8 + bin.length);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(jsonChunk.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(out, 20);
  const binAt = 20 + jsonChunk.length;
  out.writeUInt32LE(bin.length, binAt);
  out.writeUInt32LE(0x004e4942, binAt + 4);
  return out;
}

function dir(name: string, files: Record<string, string | Buffer>): string {
  const root = join(scratch, name);
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  return root;
}

function opts(baseDir: string, extra: Partial<ResolveModelAssetOptions> = {}) {
  return { baseDir, path: PATH, policy: 'deny' as NetworkPolicy, ...extra };
}

const codes = (result: ReturnType<typeof resolveModelAsset>) =>
  result.diagnostics.map((d) => d.code);

describe('local model resolver', () => {
  it('inlines a .gltf and its relative buffer as data URIs, deterministically', () => {
    const first = resolveModelAsset('triangle.gltf', opts(FIXTURES));
    expect(first.diagnostics).toEqual([]);
    expect(first.asset?.kind).toBe('inline');
    const uri = first.asset?.uri ?? '';
    expect(uri.startsWith('data:model/gltf+json;base64,')).toBe(true);
    const json = JSON.parse(Buffer.from(uri.split(',')[1] ?? '', 'base64').toString('utf8'));
    expect(json.buffers[0].uri).toMatch(/^data:application\/octet-stream;base64,/u);
    expect(resolveModelAsset('triangle.gltf', opts(FIXTURES)).asset?.uri).toBe(uri);
  });

  it('inlines a self-contained GLB unchanged', () => {
    const root = dir('glb', { 'm.glb': makeGlb() });
    const result = resolveModelAsset('m.glb', opts(root));
    expect(result.diagnostics).toEqual([]);
    expect(result.asset?.uri).toBe(`data:model/gltf-binary;base64,${makeGlb().toString('base64')}`);
  });

  it('rejects absolute paths, .. escapes and nested escapes', () => {
    const root = dir('trav/inner', { 'm.glb': makeGlb() });
    for (const ref of [resolve(root, 'm.glb'), '/m.glb', 'C:/m.glb', '../m.glb', 'a/../../m.glb']) {
      const result = resolveModelAsset(ref.endsWith('.glb') ? ref : `${ref}`, opts(root));
      expect(result.asset).toBeUndefined();
      expect(codes(result)).toEqual(['POLICY_VIOLATION']);
      expect(result.diagnostics[0]?.path).toBe(PATH);
      expect(result.diagnostics[0]?.details?.reference).toBe(ref);
    }
    const escaping = dir('trav2/spec', {
      'm.gltf': JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: '../../x.bin' }] }),
    });
    const nested = resolveModelAsset('m.gltf', opts(escaping));
    expect(codes(nested)).toEqual(['POLICY_VIOLATION']);
    expect(nested.diagnostics[0]?.details?.gltfPath).toBe('buffers[0].uri');
  });

  it('rejects a symlink that leaves baseDir', () => {
    const outside = dir('outside', { 'm.glb': makeGlb() });
    const root = dir('linked', {});
    try {
      symlinkSync(join(outside, 'm.glb'), join(root, 'm.glb'), 'file');
    } catch {
      return; // Symlinks need privileges on some Windows hosts.
    }
    const result = resolveModelAsset('m.glb', opts(root));
    expect(codes(result)).toEqual(['POLICY_VIOLATION']);
    expect(result.diagnostics[0]?.message).toMatch(/link outside/u);
  });

  it('enforces the per-asset and per-page caps', () => {
    const glb = makeGlb();
    const root = dir('caps', { 'a.glb': glb, 'b.glb': glb });
    const small = { perAssetBytes: glb.length - 1, perPageBytes: 1_000_000 };
    expect(codes(resolveModelAsset('a.glb', opts(root, { limits: small })))).toEqual([
      'SPEC_BOUNDS_ERROR',
    ]);
    const page = { perAssetBytes: glb.length, perPageBytes: glb.length * 1.5 };
    const budget = createModelAssetBudget();
    expect(resolveModelAsset('a.glb', opts(root, { limits: page, budget })).diagnostics).toEqual(
      [],
    );
    expect(budget.usedBytes).toBe(glb.length);
    const second = resolveModelAsset('b.glb', opts(root, { limits: page, budget }));
    expect(codes(second)).toEqual(['SPEC_BOUNDS_ERROR']);
    expect(second.diagnostics[0]?.details?.limit).toBe(page.perPageBytes);
    expect(MODEL_ASSET_LIMITS.perPageBytes).toBeGreaterThanOrEqual(
      MODEL_ASSET_LIMITS.perAssetBytes,
    );
  });

  it('accepts only allowed extensions', () => {
    const root = dir('ext', {
      'm.obj': 'v 0 0 0',
      'm.gltf': JSON.stringify({ asset: { version: '2.0' }, images: [{ uri: 'tex.svg' }] }),
      'tex.svg': '<svg/>',
    });
    expect(codes(resolveModelAsset('m.obj', opts(root)))).toEqual(['SPEC_VALIDATION_ERROR']);
    const nested = resolveModelAsset('m.gltf', opts(root));
    expect(nested.diagnostics[0]?.message).toMatch(/unsupported file type/u);
    const data = dir('ext-data', {
      'm.gltf': JSON.stringify({
        asset: { version: '2.0' },
        images: [{ uri: 'data:text/html;base64,PGI+' }],
      }),
    });
    expect(resolveModelAsset('m.gltf', opts(data)).diagnostics[0]?.message).toMatch(/MIME/u);
  });

  it('validates the glTF shape', () => {
    const root = dir('shape', {
      'v1.gltf': JSON.stringify({ asset: { version: '1.0' } }),
      'bad.gltf': '{',
      'bad.glb': Buffer.from('not a glb at all, really'),
      'ext.glb': makeGlb({ asset: { version: '2.0' }, buffers: [{ uri: 'side.bin' }] }),
    });
    expect(resolveModelAsset('v1.gltf', opts(root)).diagnostics[0]?.message).toMatch(/"2\.0"/u);
    expect(resolveModelAsset('bad.gltf', opts(root)).diagnostics[0]?.message).toMatch(/JSON/u);
    expect(resolveModelAsset('bad.glb', opts(root)).diagnostics[0]?.message).toMatch(/binary/u);
    expect(resolveModelAsset('ext.glb', opts(root)).diagnostics[0]?.message).toMatch(/external/u);
    expect(codes(resolveModelAsset('missing.glb', opts(root)))).toEqual(['SPEC_VALIDATION_ERROR']);
  });

  it('reports required extensions that have no bundled decoder', () => {
    const root = dir('draco', {
      'm.glb': makeGlb({
        asset: { version: '2.0' },
        extensionsRequired: ['KHR_draco_mesh_compression', 'KHR_texture_basisu'],
      }),
    });
    const result = resolveModelAsset('m.glb', opts(root));
    expect(result.asset).toBeUndefined();
    expect(result.diagnostics[0]?.details).toMatchObject({
      unsupported: ['KHR_draco_mesh_compression', 'KHR_texture_basisu'],
      supported: [],
    });
    expect(result.diagnostics[0]?.message).toMatch(/no bundled decoder/u);
  });

  it('never fetches remote URLs and gates them through the models capability', () => {
    const url = 'https://models.example.com/a.glb';
    expect(codes(resolveModelAsset(url, opts(FIXTURES)))).toEqual(['POLICY_VIOLATION']);
    expect(
      codes(resolveModelAsset(url, opts(FIXTURES, { policy: { allow: ['images'] } }))),
    ).toEqual(['POLICY_VIOLATION']);
    const allowed = resolveModelAsset(url, opts(FIXTURES, { policy: { allow: ['models'] } }));
    expect(allowed.asset).toEqual({
      kind: 'remote',
      uri: url,
      connectOrigins: ['https://models.example.com'],
    });
    expect(codes(resolveModelAsset('file:///etc/a.glb', opts(FIXTURES)))).toEqual([
      'POLICY_VIOLATION',
    ]);
    const root = dir('remote-in-gltf', {
      'm.gltf': JSON.stringify({
        asset: { version: '2.0' },
        buffers: [{ uri: 'https://cdn.example.com/b.bin' }],
      }),
    });
    expect(codes(resolveModelAsset('m.gltf', opts(root)))).toEqual(['POLICY_VIOLATION']);
    const ok = resolveModelAsset('m.gltf', opts(root, { policy: { allow: ['models'] } }));
    expect(ok.asset?.connectOrigins).toEqual(['https://cdn.example.com']);
  });
});

describe('models network capability', () => {
  it('is accepted by policy.network.allow', () => {
    const spec = {
      version: 1,
      meta: { title: 'M' },
      policy: { network: { allow: ['models'] } },
      blocks: [{ type: 'text', text: 'hi' }],
    };
    expect(normalizeSpec(spec).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('routes models origins to connect-src only, and keeps it closed by default', () => {
    const refs: AssetReference[] = [
      {
        path: '$.a',
        field: 'src',
        reference: 'https://m.example.com/a.glb',
        capability: 'models',
        rejectBlocked: false,
      },
      {
        path: '$.b',
        field: 'src',
        reference: 'https://i.example.com/a.png',
        capability: 'images',
        rejectBlocked: false,
      },
    ];
    const policy: NetworkPolicy = { allow: ['models', 'images'] };
    expect(assetOrigins(policy, refs, ['models'])).toEqual(['https://m.example.com']);
    expect(assetOrigins(policy, refs, ['images', 'media'])).toEqual(['https://i.example.com']);

    const ir = normalize({
      version: 1,
      meta: { title: 'M' },
      policy: { network: { allow: ['models', 'images'] } },
      blocks: [{ type: 'text', text: 'hi' }],
    });
    const base = {
      ir,
      compilerVersion: '0.0.0-test',
      css: '',
      js: '',
      body: '',
      allowedOrigins: assetOrigins(policy, refs, ['images', 'media']),
      themeToggle: false,
      density: 'comfortable',
    };
    const { csp } = buildContentSecurityPolicy({
      ...base,
      connectOrigins: assetOrigins(policy, refs, ['models']),
    });
    expect(csp).toContain('connect-src https://m.example.com;');
    expect(csp).toMatch(/img-src [^;]*https:\/\/i\.example\.com/u);
    expect(csp).not.toMatch(/img-src [^;]*m\.example\.com/u);
    expect(csp).not.toMatch(/-src [^;]*(?:^|\s)\*/u);
    expect(csp).not.toContain('unsafe-eval');
    expect(buildContentSecurityPolicy(base).csp).toContain("connect-src 'none'");
  });
});
