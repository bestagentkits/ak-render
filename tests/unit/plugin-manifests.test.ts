import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../../src/version.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const json = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(`${root}${path}`, 'utf8')) as Record<string, unknown>;

describe('agent plugin manifests', () => {
  // Claude keeps users on the listed plugin version until it changes, so a
  // release that forgets these files ships the new package to nobody.
  it('carry the package version', () => {
    expect(json('.claude-plugin/plugin.json').version).toBe(VERSION);
    expect(json('plugin.json').version).toBe(VERSION);
  });

  it('start the MCP server from the published package', () => {
    const args = ['-y', '@bestagentkits/render', 'mcp'];
    const claude = json('.claude-plugin/plugin.json').mcpServers as Record<
      string,
      { args: string[] }
    >;
    const codex = json('mcp.json').mcpServers as Record<string, { args: string[] }>;
    expect(claude['ak-render']?.args).toEqual(args);
    expect(codex['ak-render']?.args).toEqual(args);
  });

  it('ship a skill whose name matches its folder', () => {
    const skill = readFileSync(`${root}skills/ak-render/SKILL.md`, 'utf8');
    expect(skill).toMatch(/^---\nname: ak-render\ndescription: .+\n---\n/u);
  });
});
