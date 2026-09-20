import { describe, expect, it } from 'vitest';
import { isRenderError, type RenderError } from '../../src/index.js';
import { compile } from '../../src/render/render.js';
import { loadTheme, themePresetNames } from '../../src/theme/load-theme.js';
import { TOKEN_SPECS, tokenNames, validateTokenValue } from '../../src/theme/tokens.js';

const SPEC = `version: 1
meta:
  title: Theme fixture
blocks:
  - type: hero
    title: Theme fixture
    description: One content spec, many presets.
  - type: stats
    items:
      - label: Presets
        value: '6'
`;

describe('theme presets', () => {
  it('ships the six built-in presets the epic requires', () => {
    expect(themePresetNames()).toEqual([
      'blueprint',
      'editorial',
      'paper-ink',
      'swiss-clean',
      'terminal-mono',
      'warm-signal',
    ]);
  });

  it('renders the same content spec distinctly under every preset', () => {
    const hashes = new Set<string>();
    for (const name of themePresetNames()) {
      const result = compile(SPEC, { theme: name });
      expect(result.theme.base).toBe(name);
      expect(result.html).toContain('--ak-color-background');
      hashes.add(result.hash);
    }
    expect(hashes.size).toBe(themePresetNames().length);
  });

  it('emits token values as CSS custom properties', () => {
    const { html } = compile(SPEC, { theme: 'blueprint' });
    expect(html).toContain('--ak-color-background:#f0f4f8');
    expect(html).toContain('--ak-font-mono:ui-monospace');
    expect(html).toContain('--ak-density'.replace('--ak-density', '--ak-motion-duration'));
  });

  it('emits both schemes and a reduced-motion override', () => {
    const { html } = compile(SPEC, { theme: 'editorial' });
    expect(html).toContain(':root[data-theme="dark"]');
    expect(html).toContain('@media (prefers-color-scheme: dark)');
    expect(html).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('resolves a custom preset that extends a built-in', () => {
    const theme = loadTheme({
      preset: 'team-theme',
      extends: 'editorial',
      tokens: { 'color-accent': '#b8860b', 'space-unit': '10px' },
    });
    expect(theme.name).toBe('team-theme');
    expect(theme.base).toBe('editorial');
    expect(theme.light['color-accent']).toBe('#b8860b');
    expect(theme.light['space-unit']).toBe('10px');
    // Untouched tokens keep the base preset's voice.
    expect(theme.light['font-heading']).toContain('serif');
    expect(theme.css).toContain('--ak-color-accent:#b8860b');
  });

  it('accepts a preset through the spec theme block and honours extends', () => {
    const spec = `version: 1
meta:
  title: Custom theme
theme:
  preset: team-theme
  extends: terminal-mono
  tokens:
    color-accent: "#2f8f5b"
blocks:
  - type: text
    text: hello
`;
    const result = compile(spec);
    expect(result.theme.name).toBe('team-theme');
    expect(result.theme.base).toBe('terminal-mono');
    expect(result.html).toContain('--ak-color-accent:#2f8f5b');
  });

  it('rejects an unknown preset instead of silently falling back', () => {
    try {
      loadTheme({ preset: 'no-such-preset' });
      throw new Error('expected a theme error');
    } catch (error) {
      expect(isRenderError(error)).toBe(true);
      expect((error as RenderError).details?.known).toContain('blueprint');
    }
  });

  it('rejects an unknown token', () => {
    try {
      loadTheme({ preset: 'editorial', tokens: { 'color-brand-new': '#fff000' } });
      throw new Error('expected a theme error');
    } catch (error) {
      const renderError = error as RenderError;
      expect(renderError.code).toBe('POLICY_VIOLATION');
      expect(renderError.path).toBe('theme.tokens.color-brand-new');
    }
  });

  it('rejects executable or malformed token values', () => {
    const hostile: Record<string, unknown>[] = [
      { 'color-accent': 'javascript:alert(1)' },
      { 'color-accent': 'url(https://evil.example/x)' },
      { 'font-body': 'Inter; background: url(https://evil.example/x)' },
      { 'font-body': 'url(https://evil.example/f.woff2)' },
      { 'space-unit': '8px; background: red' },
      { 'font-size-base': '-1' },
      { density: 'gigantic' },
      { 'motion-policy': 'animate' },
      { 'elevation-card': '0 0 4px red' },
    ];
    for (const tokens of hostile) {
      expect(
        () => loadTheme({ preset: 'editorial', tokens }),
        JSON.stringify(tokens),
      ).toThrowError();
    }
  });

  it('accepts a safe font stack and rejects one with an escape', () => {
    expect(validateTokenValue('font-body', 'Georgia, "Times New Roman", serif')).toBeUndefined();
    expect(validateTokenValue('font-body', 'Inter} body{display:none')).toBeDefined();
    expect(validateTokenValue('font-body', 'url(x)')).toBeDefined();
  });

  it('maps elevation tokens to fixed shadows rather than arbitrary values', () => {
    const theme = loadTheme({ preset: 'swiss-clean' });
    expect(theme.css).toContain('--ak-elevation-card:none');
    const strong = loadTheme({ preset: 'warm-signal', tokens: { 'elevation-card': 'strong' } });
    expect(strong.css).toContain('--ak-elevation-card:0 8px 24px rgba(0, 0, 0, 0.16)');
  });

  it('zeroes motion when the preset disables it', () => {
    const theme = loadTheme({ preset: 'editorial', tokens: { 'motion-policy': 'none' } });
    expect(theme.motionPolicy).toBe('none');
    expect(theme.css).toContain('--ak-motion-duration:0ms');
  });

  it('reports every token problem at once', () => {
    try {
      loadTheme({ preset: 'editorial', tokens: { 'color-accent': 'nope', density: 'huge' } });
      throw new Error('expected a theme error');
    } catch (error) {
      const renderError = error as RenderError;
      const diagnostics = renderError.details?.diagnostics as { path: string }[];
      expect(diagnostics).toHaveLength(2);
      expect(diagnostics.map((item) => item.path)).toEqual([
        'theme.tokens.color-accent',
        'theme.tokens.density',
      ]);
    }
  });

  it('documents every token it accepts', () => {
    for (const name of tokenNames()) {
      const spec = TOKEN_SPECS[name];
      expect(spec, name).toBeDefined();
      expect(spec?.description.length ?? 0).toBeGreaterThan(5);
    }
  });
});
