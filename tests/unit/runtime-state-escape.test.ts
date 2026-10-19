import { describe, expect, it } from 'vitest';
import { compile } from '../../src/render/render.js';
import { buildRuntime } from '../../src/render/runtime.js';

describe('runtime state', () => {
  it('escapes state so a value cannot close the script element', () => {
    const js = buildRuntime({
      features: new Set(['theme']),
      state: { note: '</script><b>x</b>', line: '\u2028' },
      hasBindings: false,
    });
    expect(js).not.toContain('</script>');
    expect(js).toContain('\\u003c/script\\u003e');
    expect(js).toContain('\\u2028');
  });

  it('keeps an author state value inert in the emitted page', () => {
    const html = compile({
      version: 1,
      meta: { title: 'Escape' },
      state: { view: '</script><b>x' },
      blocks: [{ type: 'text', text: 'a', visibleWhen: { path: 'state.view', truthy: true } }],
    }).html;
    expect(html.match(/<\/script>/gu)?.length).toBe(1);
  });

  it('stops event propagation at the nearest block', () => {
    const js = buildRuntime({ features: new Set(), state: {}, hasBindings: true });
    expect(js).toContain("if (target.hasAttribute('data-ak-id')) return;");
  });
});

describe('theme runtime', () => {
  const themeButton = (overrides: Record<string, unknown> = {}) => ({
    version: 1,
    meta: { title: 'Theme action' },
    blocks: [
      {
        type: 'button',
        label: 'Go dark',
        on: { click: { action: 'theme', value: 'dark' } },
        ...overrides,
      },
    ],
  });

  it('never mentions restoreTheme without the theme part', () => {
    const js = buildRuntime({ features: new Set(), state: {}, hasBindings: true });
    expect(js).not.toContain('restoreTheme');
    expect(js).not.toContain('function applyTheme');
  });

  it('ships the theme runtime for a theme action without the toggle', () => {
    const result = compile(themeButton(), { themeToggle: false });
    expect(result.html).toContain('function applyTheme');
    expect(result.html).toContain('restoreTheme();');
    // The toggle's feature, stylesheet and markup stay off the page.
    expect(result.features).not.toContain('theme');
    expect(result.html).not.toContain('.ak-theme-toggle{');
    expect(result.html).not.toContain('class="ak-btn ak-theme-toggle"');
  });

  const nested = {
    'a toolbar item': [
      {
        type: 'toolbar',
        items: [
          { type: 'button', label: 'Light', on: { click: { action: 'theme', value: 'light' } } },
        ],
      },
    ],
    'a dialog action': [
      { type: 'button', label: 'Open', on: { click: { action: 'toggle', target: 'prefs' } } },
      {
        type: 'dialog',
        id: 'prefs',
        title: 'Preferences',
        text: 'Pick a theme.',
        actions: [{ label: 'Dark', on: { click: { action: 'theme', value: 'dark' } } }],
      },
    ],
  };
  for (const [where, blocks] of Object.entries(nested)) {
    it(`finds a theme action nested in ${where}`, () => {
      const html = compile(
        { version: 1, meta: { title: 'Nested theme' }, blocks },
        { themeToggle: false },
      ).html;
      expect(html).toContain('function applyTheme');
    });
  }

  it('leaves the theme part out when no binding uses the theme action', () => {
    const html = compile(
      themeButton({ on: { click: { action: 'open-url', url: 'https://example.com' } } }),
      { themeToggle: false },
    ).html;
    expect(html).not.toContain('function applyTheme');
    expect(html).not.toContain('restoreTheme');
  });
});
