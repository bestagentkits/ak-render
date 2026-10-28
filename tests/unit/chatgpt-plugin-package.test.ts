import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { REMOTE_TOOLS } from '../../apps/cloud/src/remote-mcp-endpoint.js';
// @ts-expect-error -- plain ESM build script without type declarations
import * as chatgptPackage from '../../scripts/build-chatgpt-plugin.mjs';
import { VERSION } from '../../src/version.js';

const { checkPackage, PACKAGE_DIR, packageEntries, reviewedToolNames, zip } = chatgptPackage;
const temps: string[] = [];

// biome-ignore lint/suspicious/noExplicitAny: tests edit arbitrary manifest JSON.
type Json = any;

/** A writable copy of the package whose manifests a test may break. */
function packageCopy(edit: (plugin: Json, mcp: Json) => void): string {
  const dir = mkdtempSync(join(tmpdir(), 'ak-render-chatgpt-'));
  temps.push(dir);
  cpSync(PACKAGE_DIR, dir, { recursive: true });
  const plugin = JSON.parse(readFileSync(join(dir, 'plugin.json'), 'utf8'));
  const mcp = JSON.parse(readFileSync(join(dir, 'mcp.json'), 'utf8'));
  edit(plugin, mcp);
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify(plugin));
  writeFileSync(join(dir, 'mcp.json'), JSON.stringify(mcp));
  return dir;
}

/** Entry names and contents read back from a stored or deflated ZIP. */
function unzip(archive: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let at = 0;
  while (archive.readUInt32LE(at) === 0x04034b50) {
    const method = archive.readUInt16LE(at + 8);
    const size = archive.readUInt32LE(at + 18);
    const nameLength = archive.readUInt16LE(at + 26);
    const extraLength = archive.readUInt16LE(at + 28);
    const name = archive.subarray(at + 30, at + 30 + nameLength).toString('utf8');
    const start = at + 30 + nameLength + extraLength;
    const body = archive.subarray(start, start + size);
    files.set(name, method === 8 ? inflateRawSync(body) : body);
    at = start + size;
  }
  return files;
}

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('ChatGPT plugin package', () => {
  it('passes the portable schemas and the submission limits at the package version', () => {
    expect(checkPackage({ version: VERSION })).toEqual([]);
  });

  it('points at the hosted Streamable HTTP endpoint with OAuth and no headers', () => {
    const mcp = JSON.parse(readFileSync(join(PACKAGE_DIR, 'mcp.json'), 'utf8'));
    expect(mcp.mcpServers['ak-render']).toMatchObject({
      type: 'streamable-http',
      url: 'https://render.agentkit.best/mcp',
      extensions: { 'com.openai': { auth: { type: 'oauth' } } },
    });
    expect(mcp.mcpServers['ak-render'].headers).toBeUndefined();
  });

  it('only names tools the hosted server lists in its review cases', () => {
    const remote = new Set(REMOTE_TOOLS.map((tool) => tool.name));
    const reviewed: string[] = reviewedToolNames();
    expect(reviewed.length).toBeGreaterThan(0);
    expect(reviewed.filter((name: string) => !remote.has(name))).toEqual([]);
  });

  it('leaves the local stdio manifest for desktop and Codex installs untouched', () => {
    const local = JSON.parse(readFileSync('mcp.json', 'utf8'));
    for (const server of Object.values<{ command?: string; type?: string }>(local.mcpServers)) {
      expect(server.command).toBe('npx');
      expect(server.type).not.toBe('streamable-http');
    }
  });

  it('builds a byte-identical archive holding the manifests and their assets', () => {
    const first = zip(packageEntries());
    expect(zip(packageEntries()).equals(first)).toBe(true);
    const files = unzip(first);
    expect([...files.keys()]).toEqual([
      'plugin.json',
      'mcp.json',
      'assets/composer-icon.png',
      'assets/logo.png',
    ]);
    expect(files.get('mcp.json')?.equals(readFileSync(join(PACKAGE_DIR, 'mcp.json')))).toBe(true);
    expect(files.get('assets/logo.png')?.equals(readFileSync('assets/logo.png'))).toBe(true);
  });

  it('reports a version mismatch, headers, a secret and a missing review case', () => {
    const dir = packageCopy((plugin, mcp) => {
      plugin.extensions['com.openai'].review.test_cases.positive.pop();
      const server = mcp.mcpServers['ak-render'];
      server.headers = { Authorization: 'Bearer x' };
      server.extensions['com.openai'].auth.client = { mode: 'provided', clientSecret: 's' };
    });
    const problems = checkPackage({ dir, version: '9.9.9' });
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining('is not the package version 9.9.9'),
        expect.stringContaining('must not send headers'),
        expect.stringContaining('clientSecret must never be in the package'),
        expect.stringContaining('exactly 5 positive and 3 negative'),
      ]),
    );
  });

  it('reports listing text over the directory limits and a non-HTTPS policy URL', () => {
    const dir = packageCopy((plugin) => {
      const ui = plugin.extensions['com.openai'].interface;
      ui.displayName = 'An AK Render name that is far too long';
      ui.privacyPolicyURL = 'http://agentkit.best/privacy';
    });
    expect(checkPackage({ dir })).toEqual(
      expect.arrayContaining([
        expect.stringContaining('interface.displayName is'),
        expect.stringContaining('interface.privacyPolicyURL must be an HTTPS URL'),
      ]),
    );
  });

  it('rejects a local stdio server in place of the hosted endpoint', () => {
    const dir = packageCopy((_plugin, mcp) => {
      mcp.mcpServers['ak-render'] = {
        command: 'npx',
        args: ['-y', '@bestagentkits/render', 'mcp'],
      };
    });
    expect(checkPackage({ dir })).toEqual(
      expect.arrayContaining([expect.stringContaining('must be streamable-http over HTTPS')]),
    );
  });
});
