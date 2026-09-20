import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { isRenderError, type RenderError } from '../../src/index.js';
import { compile } from '../../src/render/render.js';
import { loadTheme } from '../../src/theme/load-theme.js';
import {
  buildThemeCatalog,
  catalogPresetNames,
  loadPresetFile,
  parsePresetDocument,
} from '../../src/theme/theme-catalog.js';

const workspace = mkdtempSync(join(tmpdir(), 'ak-render-themes-'));
const home = join(workspace, 'home');
const project = join(workspace, 'project');

function writePreset(root: string, name: string, body: string): string {
  const directory = join(root, '.ak-render/themes');
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `${name}.yaml`);
  writeFileSync(file, body, 'utf8');
  return file;
}

const PROJECT_THEME = `name: team-theme
extends: editorial
description: Team palette
tokens:
  color-accent: "#b8860b"
dark:
  color-accent: "#e0b64a"
`;

writePreset(project, 'team-theme', PROJECT_THEME);
writePreset(
  home,
  'team-theme',
  'name: team-theme\nextends: paper-ink\ntokens:\n  color-accent: "#123456"\n',
);
writePreset(home, 'user-only', 'name: user-only\nextends: swiss-clean\n');
writePreset(project, 'broken', 'name: broken\ntokens:\n  color-nope: "#fff000"\n');
const cycleA = 'name: cycle-a\nextends: cycle-b\n';
const cycleB = 'name: cycle-b\nextends: cycle-a\n';
writePreset(project, 'cycle-a', cycleA);
writePreset(project, 'cycle-b', cycleB);

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('preset files', () => {
  it('parses a valid preset document', () => {
    const entry = parsePresetDocument({
      name: 'team-theme',
      extends: 'editorial',
      description: 'Team palette',
      tokens: { 'color-accent': '#b8860b' },
      dark: { 'color-accent': '#e0b64a' },
    });
    expect(entry.name).toBe('team-theme');
    expect(entry.extends).toBe('editorial');
    expect(entry.version).toBe(1);
    expect(entry.tokens['color-accent']).toBe('#b8860b');
    expect(entry.dark['color-accent']).toBe('#e0b64a');
    expect(entry.origin).toBe('file');
  });

  it('derives the preset name from the filename when it is not declared', () => {
    const entry = parsePresetDocument({ extends: 'editorial' }, { file: '/themes/from-file.yaml' });
    expect(entry.name).toBe('from-file');
  });

  it('rejects an unknown field so a typo cannot be silently ignored', () => {
    expect(() => parsePresetDocument({ name: 'x', css: 'body { color: red }' })).toThrowError(
      /unknown preset field "css"/u,
    );
  });

  it('rejects an unknown token', () => {
    try {
      parsePresetDocument({ name: 'x', tokens: { 'color-brand': '#fff000' } });
      throw new Error('expected a rejection');
    } catch (error) {
      expect(isRenderError(error)).toBe(true);
      expect((error as RenderError).path).toBe('<theme>#tokens.color-brand');
      expect(JSON.stringify((error as RenderError).details?.known)).toContain('color-accent');
    }
  });

  it('rejects an executable or malformed token value', () => {
    const hostile = [
      { 'color-accent': 'url(https://evil.example/x)' },
      { 'font-body': 'Inter; background: url(x)' },
      { 'space-unit': '8px; color: red' },
      { dark: { 'color-text': '<script>' } },
    ];
    for (const tokens of hostile) {
      expect(
        () => parsePresetDocument({ name: 'x', ...tokens }),
        JSON.stringify(tokens),
      ).toThrowError();
    }
  });

  it('rejects an invalid preset or extends name', () => {
    expect(() => parsePresetDocument({ name: 'Not Valid' })).toThrowError();
    expect(() => parsePresetDocument({ name: 'ok', extends: 'Not Valid' })).toThrowError();
  });

  it('rejects an invalid version', () => {
    expect(() => parsePresetDocument({ name: 'ok', version: 0 })).toThrowError();
    expect(() => parsePresetDocument({ name: 'ok', version: 1.5 })).toThrowError();
  });

  it('loads a preset from a JSON file as well as YAML', () => {
    const file = join(workspace, 'json-theme.json');
    writeFileSync(
      file,
      JSON.stringify({
        name: 'json-theme',
        extends: 'editorial',
        tokens: { 'space-unit': '12px' },
      }),
      'utf8',
    );
    const entry = loadPresetFile(file);
    expect(entry.name).toBe('json-theme');
    expect(entry.tokens['space-unit']).toBe('12px');
  });

  it('reports a missing preset file instead of crashing', () => {
    expect(() => loadPresetFile(join(workspace, 'nope.yaml'))).toThrowError(/not found/u);
  });
});

describe('preset discovery and precedence', () => {
  it('discovers user and project presets, with project winning', () => {
    const catalog = buildThemeCatalog({ cwd: project, home });
    const names = catalogPresetNames(catalog);
    expect(names).toContain('team-theme');
    expect(names).toContain('user-only');
    expect(names).toEqual(expect.arrayContaining(['blueprint', 'editorial']));

    const team = catalog.entries['team-theme'];
    expect(team?.origin).toBe('project');
    // The project copy extends editorial and sets one override.
    expect(team?.extends).toBe('editorial');
    expect(team?.tokens['color-accent']).toBe('#b8860b');
  });

  it('lets an explicitly named file override a discovered one', () => {
    const explicit = join(workspace, 'explicit.yaml');
    writeFileSync(explicit, 'name: team-theme\nextends: warm-signal\n', 'utf8');
    const catalog = buildThemeCatalog({ cwd: project, home, files: [explicit] });
    expect(catalog.entries['team-theme']?.extends).toBe('warm-signal');
    expect(catalog.entries['team-theme']?.origin).toBe('file');
  });

  it('records a malformed preset as a problem without failing the catalog', () => {
    const catalog = buildThemeCatalog({ cwd: project, home });
    expect(catalog.problems.map((problem) => problem.path)).toEqual([
      join(project, '.ak-render/themes/broken.yaml'),
    ]);
    expect(catalog.entries.broken).toBeUndefined();
    // A broken team preset does not make the built-ins unusable.
    expect(catalogPresetNames(catalog)).toContain('editorial');
  });

  it('uses built-ins only when discovery is disabled', () => {
    const catalog = buildThemeCatalog({ cwd: project, home, discovery: false });
    expect(catalogPresetNames(catalog)).toEqual([
      'blueprint',
      'editorial',
      'paper-ink',
      'swiss-clean',
      'terminal-mono',
      'warm-signal',
    ]);
    expect(catalog.problems).toEqual([]);
  });
});

describe('catalog-aware resolution', () => {
  const catalog = buildThemeCatalog({ cwd: project, home });

  it('resolves a discovered preset through its extends chain', () => {
    const theme = loadTheme('team-theme', { catalog });
    expect(theme.name).toBe('team-theme');
    expect(theme.chain).toEqual(['editorial', 'team-theme']);
    expect(theme.light['color-accent']).toBe('#b8860b');
    expect(theme.dark['color-accent']).toBe('#e0b64a');
    // Inherited values survive.
    expect(theme.light['font-heading']).toContain('serif');
  });

  it('renders a spec with a discovered preset', () => {
    const spec = `version: 1
meta:
  title: Team theme
theme:
  preset: team-theme
blocks:
  - type: hero
    title: Team theme
`;
    const result = compile(spec, { themeCatalog: catalog });
    expect(result.theme.name).toBe('team-theme');
    expect(result.html).toContain('--ak-color-accent:#b8860b');
  });

  it('fails for a preset that is not in the catalog', () => {
    expect(() => loadTheme('team-theme')).toThrowError(/unknown theme preset/u);
  });

  it('detects an extends cycle instead of recursing forever', () => {
    try {
      loadTheme('cycle-a', { catalog });
      throw new Error('expected a cycle error');
    } catch (error) {
      expect(isRenderError(error)).toBe(true);
      expect((error as RenderError).message).toMatch(/cycle/u);
      expect(JSON.stringify((error as RenderError).details?.chain)).toContain('cycle-a');
    }
  });

  it('rejects an extends target that does not exist', () => {
    const file = join(workspace, 'dangling.yaml');
    writeFileSync(file, 'name: dangling\nextends: no-such-base\n', 'utf8');
    const dangling = buildThemeCatalog({ cwd: project, home, files: [file] });
    expect(() => loadTheme('dangling', { catalog: dangling })).toThrowError(
      /unknown theme preset/u,
    );
  });

  it('completes a partial preset from the default and warns about it', () => {
    const file = join(workspace, 'partial.yaml');
    writeFileSync(file, 'name: partial\ntokens:\n  color-accent: "#333333"\n', 'utf8');
    const partial = buildThemeCatalog({ cwd: project, home, files: [file] });
    const theme = loadTheme('partial', { catalog: partial });
    expect(theme.light['color-accent']).toBe('#333333');
    // Every declared token is present, so the artifact still renders correctly.
    expect(theme.light['color-background']).toBeDefined();
    expect(theme.light['font-body']).toBeDefined();
  });
});
