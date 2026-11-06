import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.js';
import { validate } from '../../src/index.js';
import { handleMcpMessage } from '../../src/mcp-server.js';
import { compile } from '../../src/render/render.js';
import { isPrivateHost, networkAllows } from '../../src/spec/network-policy.js';

const THREE_D_TYPES = [
  'scene-3d',
  'model-3d',
  'product-3d',
  'particles-3d',
  'text-3d',
  'shader-3d',
  'morph-3d',
  'network-3d',
  'scatter-3d',
  'bars-3d',
  'globe-3d',
  'point-cloud-3d',
  'terrain-3d',
  'timeline-3d',
] as const;

interface CatalogJson {
  blockCount: number;
  blocks: { type: string }[];
  families: { name: string; types: string[] }[];
}

/** Every block type a JSON catalog names, whether listed singly or under a family. */
function listedTypes(listing: CatalogJson): string[] {
  return [
    ...listing.blocks.map((block) => block.type),
    ...listing.families.flatMap((family) => family.types),
  ];
}

function cliJson(args: string[]): unknown {
  let stdout = '';
  const code = run(args, {
    stdout: (text) => {
      stdout += text;
    },
    stderr: () => {},
  });
  expect(code).toBe(0);
  return JSON.parse(stdout);
}

describe('3D blocks in the JSON catalog', () => {
  it('lists all 14 3D types under the 3d family and counts them in blockCount', () => {
    const listing = cliJson(['catalog', '--json']) as CatalogJson;
    const family = listing.families.find((entry) => entry.name === '3d');
    expect(family?.types).toEqual(expect.arrayContaining([...THREE_D_TYPES]));
    const types = listedTypes(listing);
    for (const type of THREE_D_TYPES) expect(types).toContain(type);
    expect(types).toHaveLength(listing.blockCount);
    expect(new Set(types).size).toBe(types.length);
  });

  it('gives the MCP catalog the same listing as the CLI', async () => {
    const response = await handleMcpMessage(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'catalog', arguments: {} } },
      { cwd: process.cwd(), home: process.cwd() },
    );
    const text =
      (response?.result as { content: { text: string }[] } | undefined)?.content[0]?.text ?? '';
    expect(JSON.parse(text)).toEqual(cliJson(['catalog', '--json']));
  });

  it('finds every 3D type through search-catalog by its name', () => {
    for (const type of THREE_D_TYPES) {
      const hits = cliJson(['search-catalog', type, '--json']) as { type: string }[];
      expect(hits.map((hit) => hit.type)).toContain(type);
    }
  });
});

const fixtures = fileURLToPath(new URL('../../fixtures/3d', import.meta.url));
const modelSpec = readFileSync(join(fixtures, 'model-3d-crate.yaml'), 'utf8');
const withSrc = (src: string, allowModels: boolean) =>
  `${modelSpec.replace('models/crate.glb', src)}${allowModels ? 'policy:\n  network:\n    allow: [models]\n' : ''}`;

describe('validate on a broken 3D spec', () => {
  it('reports the missing model src at its JSON path', () => {
    const result = validate(modelSpec.replace('    src: models/crate.glb\n', ''));
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.path)).toContainEqual(
      expect.stringMatching(/^\$\.blocks\[\d+\]\.src$/u),
    );
  });
});

describe('model-3d remote src', () => {
  const PRIVATE = [
    'http://169.254.169.254/latest/meta-data/model.glb',
    'http://localhost/model.glb',
    'http://app.localhost/model.glb',
    'http://127.0.0.1:8080/model.glb',
    'http://2130706433/model.glb',
    'https://10.0.0.5/model.glb',
    'https://172.16.4.2/model.glb',
    'https://192.168.1.10/model.glb',
    'https://100.64.0.1/model.glb',
    'http://[::1]/model.glb',
    'http://[::ffff:169.254.169.254]/model.glb',
    'http://[fd00::1]/model.glb',
    'http://[fe80::1]/model.glb',
    'http://metadata.google.internal/model.glb',
  ];

  it.each(PRIVATE)('rejects %s with or without the models capability', (src) => {
    for (const allow of [false, true]) {
      const result = validate(withSrc(src, allow));
      expect(result.ok).toBe(false);
      const diagnostic = result.diagnostics.find((entry) => entry.code === 'POLICY_VIOLATION');
      expect(diagnostic?.path).toMatch(/^\$\.blocks\[\d+\]\.src$/u);
      if (allow) expect(diagnostic?.message).toContain('loopback, private or metadata');
      expect(() => compile(withSrc(src, allow))).toThrow();
    }
  });

  it('rejects a public origin unless policy.network allows models', () => {
    const src = 'https://cdn.example.test/m/crate.glb';
    const blocked = validate(withSrc(src, false));
    expect(blocked.ok).toBe(false);
    expect(blocked.diagnostics[0]?.message).toMatch(
      /^remote src is not allowed because the page denies network access/u,
    );
    expect(blocked.diagnostics[0]?.path).toMatch(/^\$\.blocks\[\d+\]\.src$/u);
    expect(validate(withSrc(src, true)).ok).toBe(true);
  });
});

describe('isPrivateHost', () => {
  it('leaves public hosts and relative references alone', () => {
    for (const reference of [
      'https://cdn.example.test/a.glb',
      'https://8.8.8.8/a.glb',
      'https://172.32.0.1/a.glb',
      'https://[2606:4700::1111]/a.glb',
      'models/crate.glb',
    ]) {
      expect(isPrivateHost(reference)).toBe(false);
    }
  });

  it('holds back private hosts for every capability, even on a provider allowlist', () => {
    const policy = { allow: ['images', 'media', 'models'] };
    for (const capability of ['images', 'media', 'models'] as const) {
      expect(networkAllows(policy, capability, 'http://127.0.0.1/x', '')).toBe(false);
      expect(networkAllows(policy, capability, 'https://cdn.example.test/x', '')).toBe(true);
    }
  });
});
