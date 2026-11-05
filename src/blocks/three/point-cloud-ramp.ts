/**
 * The point cloud's colour ramp, written once for the runtime (which bundles
 * this module) and mirrored by the CSS legend and static drawing.
 *
 * Hues run through the theme's info, success, warning and danger tones. Each
 * hue is set to one lightness with a chroma floor, then mixed toward the text
 * colour by up to `RAMP_INK`: the ramp's lightness moves in one direction in
 * every theme, darker on a light page and lighter on a dark one, so a high
 * value always stands out more than a low one and no step goes grey.
 */

/** Linear sRGB channels, 0 to 1. */
export type Rgb = readonly [number, number, number];
type Lab = [number, number, number];

export const RAMP_TONES = ['info', 'success', 'warning', 'danger'] as const;
/** Lightness every hue is set to before the ink mix. */
export const RAMP_LIGHTNESS = 0.7;
/** Chroma floor of a hue before the ink mix. */
export const RAMP_HUE_CHROMA = 0.13;
/** Share of the text colour mixed into the top of the ramp. */
export const RAMP_INK = 0.4;
/** Chroma floor after the ink mix. */
export const RAMP_CHROMA = 0.1;

export function toOklab([r, g, b]: Rgb): Lab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, A, B]: Lab): Rgb {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return [
    clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** Lightness, chroma and hue (radians) of a colour. */
export function toOklch(rgb: Rgb): Lab {
  const [L, A, B] = toOklab(rgb);
  return [L, Math.hypot(A, B), Math.atan2(B, A)];
}

/** `color-mix(in oklch, b t, a)`: the shorter hue arc; an achromatic end takes the other's hue. */
function mixOklch(a: Rgb, b: Rgb, t: number): Lab {
  const [la, ca, ha0] = toOklch(a);
  const [lb, cb, hb0] = toOklch(b);
  const ha = ca < 1e-4 ? hb0 : ha0;
  const hb = cb < 1e-4 ? ha : hb0;
  let dh = hb - ha;
  if (dh > Math.PI) dh -= 2 * Math.PI;
  if (dh < -Math.PI) dh += 2 * Math.PI;
  return [la + (lb - la) * t, ca + (cb - ca) * t, ha + dh * t];
}

const lab = ([L, C, H]: Lab): Lab => [L, C * Math.cos(H), C * Math.sin(H)];

/**
 * An oklch colour in sRGB, its chroma lowered until it fits: clipping the
 * channels instead would shift lightness and break the ramp's order.
 */
function inGamut([L, C, H]: Lab): Rgb {
  const fits = (c: number) => {
    const [L2, A, B] = lab([L, c, H]);
    const l = (L2 + 0.3963377774 * A + 0.2158037573 * B) ** 3;
    const m = (L2 - 0.1055613458 * A - 0.0638541728 * B) ** 3;
    const s = (L2 - 0.0894841775 * A - 1.291485548 * B) ** 3;
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ].every((v) => v >= -1e-4 && v <= 1 + 1e-4);
  };
  let chroma = C;
  if (!fits(chroma)) {
    let lo = 0;
    let hi = chroma;
    for (let k = 0; k < 20; k += 1) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    chroma = lo;
  }
  return fromOklab(lab([L, chroma, H]));
}

/** Segment and local position of `t` along the tone stops. */
export function rampSegment(t: number): { from: number; k: number } {
  const span = RAMP_TONES.length - 1;
  const at = Math.min(1, Math.max(0, t)) * span;
  const from = Math.min(span - 1, Math.floor(at));
  return { from, k: at - from };
}

/** The ramp colour at `t` in [0, 1], from the four tone stops and the text colour. */
export function cloudRamp(stops: readonly Rgb[], ink: Rgb, t: number): Rgb {
  const { from, k } = rampSegment(t);
  const [, C, H] = mixOklch(stops[from] as Rgb, stops[from + 1] as Rgb, k);
  const hue = inGamut([RAMP_LIGHTNESS, Math.max(C, RAMP_HUE_CHROMA), H]);
  // Toward the ink in oklab, so a near-grey text colour never turns the hue.
  const p = RAMP_INK * Math.min(1, Math.max(0, t));
  const a = toOklab(hue);
  const b = toOklab(ink);
  const L = a[0] + (b[0] - a[0]) * p;
  const A = a[1] + (b[1] - a[1]) * p;
  const B = a[2] + (b[2] - a[2]) * p;
  return inGamut([L, Math.max(Math.hypot(A, B), RAMP_CHROMA), Math.atan2(B, A)]);
}
