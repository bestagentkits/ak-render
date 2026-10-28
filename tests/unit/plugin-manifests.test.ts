import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validate } from '../../src/spec/validate.js';
import { VERSION } from '../../src/version.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const json = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(`${root}${path}`, 'utf8')) as Record<string, unknown>;

// The folder submitted to the Claude plugin directory. People who install the
// plugin get only this folder, so everything it loads has to live inside it.
const CLAUDE_PLUGIN = 'plugins/ak-render';
const claudeSkill = `${CLAUDE_PLUGIN}/skills/ak-render`;

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return lstatSync(path).isDirectory() ? walk(path) : [path];
  });
// Forward slashes on every OS, so the patterns below match on Windows too.
const pluginFiles = walk(`${root}${CLAUDE_PLUGIN}`).map((path) =>
  relative(root, path).split(sep).join('/'),
);

describe('agent plugin manifests', () => {
  // Claude keeps users on the listed plugin version until it changes, so a
  // release that forgets these files ships the new package to nobody.
  it('carry the package version', () => {
    expect(json(`${CLAUDE_PLUGIN}/.claude-plugin/plugin.json`).version).toBe(VERSION);
    expect(json('plugin.json').version).toBe(VERSION);
  });

  // Pinned so a plugin version always runs the package its skill text describes,
  // and an unpublished version fails loudly instead of running an older one.
  it('start the MCP server from the matching published package', () => {
    const args = ['-y', `@bestagentkits/render@${VERSION}`, 'mcp'];
    const claude = json(`${CLAUDE_PLUGIN}/.claude-plugin/plugin.json`).mcpServers as Record<
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

  it('ship skills whose name matches their folder', () => {
    for (const dir of ['skills/ak-render', claudeSkill]) {
      const skill = readFileSync(`${root}${dir}/SKILL.md`, 'utf8');
      expect(skill, dir).toMatch(/^---\nname: ak-render\ndescription: .+\n---\n/u);
    }
  });
});

describe('Claude plugin folder', () => {
  it('is the folder the marketplace lists', () => {
    const marketplace = json('.claude-plugin/marketplace.json') as {
      plugins: { name: string; source: string }[];
    };
    expect(marketplace.plugins).toEqual([
      expect.objectContaining({ name: 'ak-render', source: `./${CLAUDE_PLUGIN}` }),
    ]);
    // A second manifest at the root would make the directory treat the whole
    // repository as the plugin.
    expect(existsSync(`${root}.claude-plugin/plugin.json`)).toBe(false);
  });

  // The directory blocks symlinks and OS junk files, and holds non-image files
  // over 256 KiB, more than 512 files, and other binaries for a reviewer.
  it('holds only small regular text files, images and the icon', () => {
    expect(pluginFiles.length).toBeLessThanOrEqual(512);
    for (const file of pluginFiles) {
      expect(lstatSync(`${root}${file}`).isSymbolicLink(), file).toBe(false);
      expect(file, file).not.toMatch(/(?:\.DS_Store|Thumbs\.db|desktop\.ini|__MACOSX)/u);
      expect(file, file).toMatch(/\.(?:md|json|yaml|png|webp)$|\/LICENSE$/u);
      if (!/\.(?:png|webp)$/u.test(file)) {
        expect(statSync(`${root}${file}`).size, file).toBeLessThan(256 * 1024);
      }
    }
  });

  // A registry config beside an npx launcher is a blocking finding.
  it('carries no package-manager config or lockfile', () => {
    const names = pluginFiles.map((file) => basename(file));
    for (const name of ['.npmrc', 'package.json', 'package-lock.json', 'bunfig.toml']) {
      expect(names).not.toContain(name);
    }
  });

  it('ships the repository license unchanged', () => {
    expect(readFileSync(`${root}${CLAUDE_PLUGIN}/LICENSE`, 'utf8')).toBe(
      readFileSync(`${root}LICENSE`, 'utf8'),
    );
  });

  // Every launcher the skill or README tells Claude to run must be the exact
  // version the MCP server pins, or the text and the compiler drift apart.
  it('pins every package reference to the plugin version', () => {
    for (const file of [`${claudeSkill}/SKILL.md`, `${CLAUDE_PLUGIN}/README.md`]) {
      const text = readFileSync(`${root}${file}`, 'utf8');
      // The link to the npm package page is the only unversioned mention allowed.
      const unlinked = text.replaceAll(
        '[`@bestagentkits/render`](https://www.npmjs.com/package/@bestagentkits/render)',
        '',
      );
      const refs = unlinked.match(/@bestagentkits\/render(?:@[\w.-]+)?/gu) ?? [];
      expect(refs.length, file).toBeGreaterThan(0);
      for (const ref of refs) expect(ref, file).toBe(`@bestagentkits/render@${VERSION}`);
    }
  });

  // The pinned release ships only these CLI commands. Later commands live in
  // the source tree first, and naming one here would send Claude to a command
  // the installed package rejects.
  it('names only commands the pinned release ships', () => {
    const shipped = new Set([
      'catalog',
      'describe',
      'mcp',
      'recipe',
      'recipes',
      'search-catalog',
      'themes',
      'validate',
    ]);
    for (const file of [`${claudeSkill}/SKILL.md`, `${CLAUDE_PLUGIN}/README.md`]) {
      const text = readFileSync(`${root}${file}`, 'utf8');
      const launches = [...text.matchAll(/@bestagentkits\/render@[\w.-]+ ([\w./-]+)/gu)];
      expect(launches.length, file).toBeGreaterThan(0);
      for (const [, word = ''] of launches) {
        // `--version` and a spec path such as page.yaml compile; anything else
        // must be a shipped command.
        if (word.startsWith('-') || /\.(?:ya?ml|json)$/u.test(word)) continue;
        expect(shipped, `${file}: ${word}`).toContain(word);
      }
      for (const later of ['compose', 'repair', 'patch', 'audit-ui', 'motions', 'search-icons']) {
        expect(text, file).not.toMatch(new RegExp(`\\b${later}\\b`, 'u'));
      }
    }
  });

  it('links README images that exist in the folder', () => {
    const readme = readFileSync(`${root}${CLAUDE_PLUGIN}/README.md`, 'utf8');
    const images = [...readme.matchAll(/!\[[^\]]+\]\(([^)]+)\)/gu)].map((m) => m[1] ?? '');
    expect(images.length).toBeGreaterThanOrEqual(3);
    for (const image of images) {
      expect(existsSync(`${root}${CLAUDE_PLUGIN}/${image}`), image).toBe(true);
    }
  });

  it('bundles example specs that validate cleanly', () => {
    const skill = readFileSync(`${root}${claudeSkill}/SKILL.md`, 'utf8');
    for (const name of ['report', 'dashboard', 'architecture']) {
      const file = `${claudeSkill}/examples/${name}.yaml`;
      expect(skill, file).toContain(`examples/${name}.yaml`);
      const result = validate(readFileSync(`${root}${file}`, 'utf8'), { source: file });
      expect(result.diagnostics, file).toEqual([]);
      expect(result.ok, file).toBe(true);
    }
  });

  // The plugins pin VERSION, so the skill's main text must work on it. Commands
  // and fields from later commits wait under a "Newer than VERSION" heading, and
  // the terms below, keyed by the version that lacks them, must stay out of the
  // main text. A release bump fails here until the section and link are renamed;
  // add a key for the new version as unreleased features land.
  it('keep known unreleased commands out of the main skill text', () => {
    const skill = readFileSync(`${root}skills/ak-render/SKILL.md`, 'utf8');
    const heading = `\n## Newer than ${VERSION}\n`;
    expect(skill).toContain(heading);
    expect(skill).toContain(`[Newer than ${VERSION}](#newer-than-${VERSION.replace(/\W/gu, '')})`);
    const unreleasedAfter: Record<string, RegExp[]> = {
      '0.3.0': [
        /\bcompose\b/u,
        /\brepair\b/u,
        /\bpatch\b/u,
        /suggest/u,
        /audit-ui|audit-motion|motion audit|motion studio/u,
        /`motions?\b|motion:/u,
        /search-icons|describe-icon|icon-packs|`icons\b/u,
        /`decision`|`feedback`/u,
        /\bderive\b|\brollup\b|`cite`/u,
        /crimson-press|newspaper/u,
        /`\*\*/u,
      ],
    };
    const pinned = skill.slice(0, skill.indexOf(heading));
    for (const term of unreleasedAfter[VERSION] ?? [])
      expect(pinned, String(term)).not.toMatch(term);
  });
});
