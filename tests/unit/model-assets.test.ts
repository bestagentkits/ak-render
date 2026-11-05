import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
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

  it('rejects a directory link (junction on win32, symlink elsewhere) that leaves baseDir', () => {
    const outside = dir('outside', { 'm.glb': makeGlb() });
    const root = dir('linked', { 'keep.txt': '' });
    // A junction needs no privilege on Windows, so this runs on every host.
    symlinkSync(outside, join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    const result = resolveModelAsset('link/m.glb', opts(root));
    expect(codes(result)).toEqual(['POLICY_VIOLATION']);
    expect(result.diagnostics[0]?.message).toMatch(/link outside/u);
  });

  it('rejects backslash, UNC, percent-encoded and drive-relative escapes on every platform', () => {
    const root = dir('trav3/spec', { 'm.glb': makeGlb() });
    dir('trav3', { 'x.glb': makeGlb() });
    for (const ref of [
      '..\\x.glb',
      'a\\..\\..\\x.glb',
      '\\\\server\\share\\x.glb',
      '//server/share/x.glb',
      '%2e%2e%2fx.glb',
      '..%2fx.glb',
      'C:x.glb',
    ]) {
      const result = resolveModelAsset(ref, opts(root));
      expect(result.asset, ref).toBeUndefined();
      expect(codes(result), ref).toEqual(['POLICY_VIOLATION']);
      expect(result.diagnostics[0]?.details?.fix, ref).toEqual(expect.any(String));
    }
    const nested = dir('trav4/spec', {
      'm.gltf': JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: '%2e%2e%2fx.bin' }] }),
    });
    expect(codes(resolveModelAsset('m.gltf', opts(nested)))).toEqual(['POLICY_VIOLATION']);
  });

  it('treats a baseDir that differs only in case per the file system', () => {
    const root = dir('CaseRoot', { 'm.glb': makeGlb() });
    const flipped = join(scratch, 'caseroot');
    const result = resolveModelAsset('m.glb', opts(flipped));
    if (process.platform === 'win32' || process.platform === 'darwin') {
      // Case-insensitive volume: the real root is the same directory.
      expect(result.diagnostics).toEqual([]);
      expect(codes(resolveModelAsset('../CaseRoot/../x.glb', opts(flipped)))).toEqual([
        'POLICY_VIOLATION',
      ]);
    } else {
      expect(result.diagnostics[0]?.message).toMatch(/spec directory .* does not exist/u);
    }
    expect(resolveModelAsset('m.glb', opts(root)).diagnostics).toEqual([]);
  });

  it('names a missing baseDir in its own message', () => {
    const result = resolveModelAsset('m.glb', opts(join(scratch, 'nope')));
    expect(result.diagnostics[0]?.message).toMatch(/spec directory .* does not exist/u);
  });

  it('never allocates more than perAssetBytes + 1 for a read', () => {
    const big = Buffer.alloc(64 * 1024, 1);
    const root = dir('alloc', { 'm.glb': big });
    const spy = vi.spyOn(Buffer, 'alloc');
    try {
      const result = resolveModelAsset(
        'm.glb',
        opts(root, { limits: { perAssetBytes: 100, perPageBytes: 1000 } }),
      );
      expect(codes(result)).toEqual(['SPEC_BOUNDS_ERROR']);
      expect(result.diagnostics[0]?.message).toMatch(/MiB/u);
      expect(Math.max(...spy.mock.calls.map((call) => Number(call[0])))).toBeLessThanOrEqual(101);
    } finally {
      spy.mockRestore();
    }
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

  it('rejects KTX2 textures, since no decoder is bundled', () => {
    const root = dir('ktx2', {
      'm.gltf': JSON.stringify({ asset: { version: '2.0' }, images: [{ uri: 't.ktx2' }] }),
      't.ktx2': Buffer.from([0xab, 0x4b, 0x54, 0x58]),
    });
    expect(codes(resolveModelAsset('m.gltf', opts(root)))).toEqual(['SPEC_VALIDATION_ERROR']);
  });

  it('checks images and buffers by role, MIME type and magic bytes', () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    const gltf = (extra: Record<string, unknown>) =>
      JSON.stringify({ asset: { version: '2.0' }, ...extra });
    const root = dir('roles', {
      'svg.gltf': gltf({ images: [{ uri: 'fake.png' }] }),
      'fake.png': '<svg xmlns="http://www.w3.org/2000/svg"/>',
      'html.gltf': gltf({
        images: [{ uri: `data:image/png;base64,${Buffer.from('<html>').toString('base64')}` }],
      }),
      'buf.gltf': gltf({ buffers: [{ uri: `data:image/png;base64,${png.toString('base64')}` }] }),
      'bufpng.gltf': gltf({ buffers: [{ uri: 'real.png' }] }),
      'mime.gltf': gltf({ images: [{ bufferView: 0, mimeType: 'image/svg+xml' }] }),
      'ok.gltf': gltf({ images: [{ uri: 'real.png', mimeType: 'image/png' }] }),
      'real.png': png,
    });
    for (const [file, pattern] of [
      ['svg.gltf', /not a image\/png image/u],
      ['html.gltf', /not a image\/png image/u],
      ['buf.gltf', /buffer data URI .* unsupported MIME/u],
      ['bufpng.gltf', /buffer URI .* unsupported file type/u],
      ['mime.gltf', /mimeType "image\/svg\+xml"/u],
    ] as const) {
      const result = resolveModelAsset(file, opts(root));
      expect(result.asset, file).toBeUndefined();
      expect(codes(result), file).toEqual(['SPEC_VALIDATION_ERROR']);
      expect(result.diagnostics[0]?.message, file).toMatch(pattern);
    }
    expect(resolveModelAsset('ok.gltf', opts(root)).diagnostics).toEqual([]);
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
    // The capability filter is required, so no caller can mix directives by omission.
    // @ts-expect-error capabilities must be passed
    expect(() => assetOrigins(policy, refs)).toThrow();
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
