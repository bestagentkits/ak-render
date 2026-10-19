/**
 * WCAG 2.2 contrast arithmetic for theme tokens.
 *
 * Theme colours are validated as `#rgb`, `#rrggbb` or `#rrggbbaa`; an alpha
 * channel is ignored, because the compiler never paints text with a
 * translucent token on its own.
 */

/** The red, green and blue channels of a hex colour, 0–255. */
export function hexChannels(hex: string): [number, number, number] {
  const digits = hex.slice(1);
  const full =
    digits.length === 3
      ? [...digits].map((digit) => `${digit}${digit}`).join('')
      : digits.slice(0, 6);
  return [0, 2, 4].map((offset) => Number.parseInt(full.slice(offset, offset + 2), 16)) as [
    number,
    number,
    number,
  ];
}

/** WCAG relative luminance of an sRGB colour given as 0–255 channels. */
export function relativeLuminance([red, green, blue]: readonly [number, number, number]): number {
  const linear = (channel: number): number => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

/** WCAG contrast ratio between two hex colours, from 1 to 21. */
export function contrastRatio(first: string, second: string): number {
  const [light, dark] = [
    relativeLuminance(hexChannels(first)),
    relativeLuminance(hexChannels(second)),
  ].sort((a, b) => b - a) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}
