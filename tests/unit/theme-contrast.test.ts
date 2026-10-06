import { describe, expect, it } from 'vitest';
import { loadTheme, themePresetNames } from '../../src/theme/load-theme.js';
import type { Tokens } from '../../src/theme/tokens.js';

/** WCAG 2.2 relative luminance of a `#rrggbb` or `#rgb` colour. */
function luminance(hex: string): number {
  const digits = hex.slice(1);
  const full =
    digits.length === 3
      ? [...digits].map((digit) => `${digit}${digit}`).join('')
      : digits.slice(0, 6);
  const [red, green, blue] = [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(full.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** WCAG contrast ratio between two colours, from 1 to 21. */
function contrast(first: string, second: string): number {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a) as [
    number,
    number,
  ];
  return (light + 0.05) / (dark + 0.05);
}

const SURFACES = ['background', 'surface', 'surface-raised'] as const;
const TONES = ['accent', 'info', 'success', 'warning', 'danger'] as const;

/** Every foreground/background pair a preset must keep legible, with its minimum ratio. */
const PAIRS: [foreground: string, background: string, minimum: number][] = [
  // Body text reaches AAA so long-form reading never strains.
  ...SURFACES.map((surface): [string, string, number] => ['text', surface, 7]),
  ...SURFACES.map((surface): [string, string, number] => ['text-muted', surface, 4.5]),
  ['accent-contrast', 'accent', 4.5],
  // Links, tone labels and badges are text drawn in these colours.
  ...TONES.flatMap((tone) =>
    SURFACES.map((surface): [string, string, number] => [tone, surface, 4.5]),
  ),
];

function color(tokens: Tokens, name: string): string {
  const value = tokens[`color-${name}`];
  if (value === undefined) throw new Error(`missing color-${name}`);
  return value;
}

describe('preset contrast (WCAG 2.2 AA)', () => {
  it('computes the reference ratios', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(contrast('#fff', '#ffffff')).toBe(1);
  });

  for (const preset of themePresetNames()) {
    for (const scheme of ['light', 'dark'] as const) {
      it(`${preset} keeps every text pair legible in ${scheme}`, () => {
        const tokens = loadTheme(preset)[scheme];
        const failures = PAIRS.flatMap(([foreground, background, minimum]) => {
          const ratio = contrast(color(tokens, foreground), color(tokens, background));
          return ratio < minimum
            ? [`${foreground} on ${background}: ${ratio.toFixed(2)} < ${minimum}`]
            : [];
        });
        expect(failures).toEqual([]);
      });
    }
  }
});
