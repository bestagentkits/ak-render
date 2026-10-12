import { describe, expect, it } from 'vitest';
import { ICON_GLYPHS } from '../../src/icons/icon-data.generated.js';
import { ICON_PACK_IDS, ICON_PACKS, ICON_PROFILES } from '../../src/icons/icon-packs.js';
import { checkGlyphBody } from '../../src/icons/icon-sanitize.js';
import { compile } from '../../src/render/render.js';

function page(blocks: unknown[], theme?: string): Record<string, unknown> {
  return {
    version: 1,
    meta: { title: 'Icons' },
    ...(theme === undefined ? {} : { theme: { preset: theme } }),
    blocks,
  };
}

const symbolIds = (html: string): string[] =>
  [...html.matchAll(/<symbol id="([^"]+)"/gu)].map((match) => match[1] ?? '');

describe('bundled glyph data', () => {
  it('passes the SVG allowlist for every glyph of every pack', () => {
    for (const [pack, glyphs] of Object.entries(ICON_GLYPHS)) {
      for (const [name, glyph] of Object.entries(glyphs)) {
        const result = checkGlyphBody(typeof glyph === 'string' ? glyph : glyph[0]);
        expect(result, `${pack}:${name}`).toEqual({ ok: true });
      }
    }
  });

  it('records license and provenance for every pack', () => {
    for (const id of ICON_PACK_IDS) {
      const pack = ICON_PACKS[id];
      expect(pack.license).not.toBe('');
      expect(pack.version).toMatch(/^\d+\.\d+\.\d+/u);
      expect(pack.source).toContain('@iconify-json/');
    }
    expect(ICON_PACKS.codicons.license).toContain('CC-BY');
    expect(ICON_PACKS.codicons.attribution).toContain('Microsoft');
  });

  it('rejects markup outside the allowlist', () => {
    expect(checkGlyphBody('<script>alert(1)</script>').ok).toBe(false);
    expect(checkGlyphBody('<path d="M0 0" onload="x"/>').ok).toBe(false);
    expect(checkGlyphBody('<path d="M0 0" fill="url(#a)"/>').ok).toBe(false);
    expect(checkGlyphBody('<path d="M0 0" fill="red"/>').ok).toBe(false);
    expect(checkGlyphBody('<path d="M0 0" fill="none"/>').ok).toBe(true);
  });
});

describe('icon rendering', () => {
  it('draws a semantic name with the theme pack and embeds only used glyphs', () => {
    const { html } = compile(page([{ type: 'icon', icon: 'gauge', label: 'Speed' }], 'blueprint'));
    expect(html).toContain('data-pack="tabler"');
    expect(symbolIds(html)).toEqual(['aki-tabler-gauge']);
    expect(html).not.toMatch(/<script[^>]*src=/u);
    expect(html).not.toMatch(/(?:src|href)="https?:/u);
  });

  it('is deterministic and deduplicates repeated icons into one symbol', () => {
    const spec = page([
      { type: 'icon', icon: 'gauge', label: 'A' },
      { type: 'icon', icon: 'gauge', label: 'B' },
      { type: 'icon', icon: 'settings', label: 'C' },
    ]);
    const first = compile(spec).html;
    expect(compile(spec).html).toBe(first);
    const ids = symbolIds(first);
    expect(ids).toHaveLength(2);
    expect(ids).toEqual([...ids].sort());
  });

  it('emits nothing when no icon is used', () => {
    const { html } = compile(page([{ type: 'card', title: 'Plain' }]));
    expect(html).not.toContain('ak-icon');
  });

  it('prefers an explicit pack over the theme profile and never swaps it', () => {
    const { html } = compile(
      page([{ type: 'icon', icon: 'phosphor:rocket', label: 'Launch' }], 'blueprint'),
    );
    expect(symbolIds(html)).toEqual(['aki-phosphor-rocket']);
  });

  it('applies each theme profile', () => {
    const cases: Array<[string, string]> = [
      ['blueprint', 'tabler'],
      ['editorial', 'lucide'],
      ['data-console', 'codicons'],
    ];
    for (const [theme, pack] of cases) {
      const { html } = compile(page([{ type: 'icon', icon: 'settings', label: 'S' }], theme));
      expect(html, theme).toContain(`data-pack="${pack}"`);
    }
    expect(ICON_PROFILES.codicons.pack).toBe('codicons');
  });

  it('hides decorative icons and names labelled ones', () => {
    const { html } = compile(
      page([
        { type: 'card', title: 'A', icon: 'settings' },
        { type: 'card', title: 'B', icon: { name: 'settings', label: 'Settings' } },
      ]),
    );
    expect(html).toContain('aria-hidden="true" focusable="false"');
    expect(html).toContain('role="img" aria-label="Settings"');
  });

  it('puts icons on card, callout, alert, button, stats, steps and timeline', () => {
    const { html } = compile(
      page([
        { type: 'card', title: 'C', icon: 'user' },
        { type: 'callout', title: 'T', text: 'x', icon: 'info' },
        { type: 'alert', title: 'T', text: 'x', icon: 'warning' },
        { type: 'stats', items: [{ label: 'L', value: '1', icon: 'chart-line' }] },
        { type: 'steps', items: [{ title: 'S', icon: 'check' }] },
        { type: 'timeline', items: [{ when: 'Now', title: 'T', icon: 'clock' }] },
        {
          type: 'button',
          label: 'Go',
          icon: 'arrow-right',
          on: { click: { action: 'open-url', url: 'https://example.com' } },
        },
      ]),
    );
    expect((html.match(/<svg class="ak-icon"/gu) ?? []).length).toBeGreaterThanOrEqual(7);
  });

  it('rejects an unknown icon with suggestions', () => {
    expect(() => compile(page([{ type: 'icon', icon: 'zzzz-nope', label: 'X' }]))).toThrow(
      /icon/iu,
    );
  });

  it('falls back to another pack with a warning when the profile lacks the glyph', () => {
    const spec = {
      ...page([{ type: 'icon', icon: 'gauge', label: 'R' }]),
      theme: { icons: 'pixelarticons' },
    };
    const result = compile(spec);
    expect(result.html).toContain('ak-icon');
    expect(result.html).toContain('<svg class="ak-icon" data-size="lg" data-pack="lucide"');
    expect(JSON.stringify(result.warnings)).toContain('gauge');
  });

  it('draws with the pack a theme icons field names', () => {
    const spec = {
      ...page([{ type: 'icon', icon: 'settings', label: 'S' }]),
      theme: { icons: 'pixelarticons' },
    };
    expect(compile(spec).html).toContain('data-pack="pixelarticons"');
  });
});
