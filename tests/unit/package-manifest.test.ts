import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME, VERSION } from '../../src/index.js';

const packageJsonPath = fileURLToPath(new URL('../../package.json', import.meta.url));
const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
  name: string;
  version: string;
  type: string;
  engines: Record<string, string>;
  license: string;
  bin: Record<string, string>;
  exports: Record<string, Record<string, string>>;
  files: string[];
  publishConfig: Record<string, unknown>;
  repository: { type: string; url: string };
};

describe('package manifest contract', () => {
  it('keeps the runtime VERSION in sync with package.json', () => {
    expect(VERSION).toBe(manifest.version);
  });

  it('ships the AgentKit-scoped name as an ESM package on Node >= 20.11', () => {
    expect(PACKAGE_NAME).toBe('@agentkit/render');
    expect(manifest.name).toBe(PACKAGE_NAME);
    expect(manifest.type).toBe('module');
    expect(manifest.engines.node).toBe('>=20.11');
  });

  it('exposes both a library export and a CLI bin pointing at built output', () => {
    expect(manifest.exports['.']).toEqual({
      types: './dist/index.d.ts',
      import: './dist/index.js',
    });
    expect(manifest.bin['ak-render']).toBe('./dist/cli.js');
  });

  it('names the source repository so npm can tie the published provenance to it', () => {
    // Trusted publishing attests the workflow that produced the tarball, and npm
    // resolves that attestation against this field.
    expect(manifest.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/bestagentkits/ak-render.git',
    });
  });

  it('publishes under MIT with the license and docs included in the tarball', () => {
    expect(manifest.license).toBe('MIT');
    expect(manifest.publishConfig.access).toBe('public');
    for (const required of ['dist', 'LICENSE', 'README.md', 'CHANGELOG.md']) {
      expect(manifest.files).toContain(required);
    }
  });
});
