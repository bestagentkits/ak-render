import { existsSync, readFileSync } from 'node:fs';
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

  // Pinned so a plugin version always runs the package its skill text describes,
  // and an unpublished version fails loudly instead of running an older one.
  it('start the MCP server from the matching published package', () => {
    const args = ['-y', `@bestagentkits/render@${VERSION}`, 'mcp'];
    const claude = json('.claude-plugin/plugin.json').mcpServers as Record<
      string,
      { args: string[] }
    >;
    const codex = json('mcp.json').mcpServers as Record<string, { args: string[] }>;
    expect(claude['ak-render']?.args).toEqual(args);
    expect(codex['ak-render']?.args).toEqual(args);
  });

  // Codex resolves interface assets relative to the plugin root; a renamed or
  // missing file shows a blank tile in the plugin directory.
  it('point the Codex interface at icon files that exist', () => {
    const extensions = json('plugin.json').extensions as {
      'com.openai': { interface: Record<string, string> };
    };
    const ui = extensions['com.openai'].interface;
    for (const key of ['composerIcon', 'logo']) {
      expect(ui[key], key).toMatch(/^\.\/assets\/.+\.png$/u);
      expect(existsSync(`${root}${ui[key]?.slice(2)}`), key).toBe(true);
    }
    expect(ui.brandColor).toMatch(/^#[0-9A-F]{6}$/u);
  });

  it('ship a skill whose name matches its folder', () => {
    const skill = readFileSync(`${root}skills/ak-render/SKILL.md`, 'utf8');
    expect(skill).toMatch(/^---\nname: ak-render\ndescription: .+\n---\n/u);
  });

  // The plugins pin VERSION, so the skill's main text must work on it. Commands
  // and fields from later commits wait under a "Newer than VERSION" heading;
  // a release bump fails here until that section is folded in.
  it('teach only what the pinned package ships above the newer-release section', () => {
    const skill = readFileSync(`${root}skills/ak-render/SKILL.md`, 'utf8');
    const heading = `\n## Newer than ${VERSION}\n`;
    expect(skill).toContain(heading);
    const pinned = skill.slice(0, skill.indexOf(heading));
    const unreleased = [
      /\bcompose\b/u,
      /\brepair\b/u,
      /\bpatch\b/u,
      /suggest/u,
      /audit-ui|audit-motion|motion audit|motion studio/u,
      /`motions?\b|motion:/u,
      /search-icons|describe-icon|icon-packs/u,
      /`decision`|`feedback`/u,
      /\bderive\b|\brollup\b|`cite`/u,
      /crimson-press|newspaper/u,
      /`\*\*/u,
    ];
    for (const term of unreleased) expect(pinned, String(term)).not.toMatch(term);
  });
});
