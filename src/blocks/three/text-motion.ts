/**
 * Text 3D motion: each unit's pose as a closed-form function of the clock, so
 * any frame is computed directly, a paused clock holds still and the rest
 * pose (all zeros, scale 1) is exactly what the poster draws.
 */

/** Seconds a `rise` entrance takes per unit, and the delay between units. */
export const RISE_DURATION = 0.9;
export const RISE_STAGGER = 0.055;
/** A unit's pose: lift in ems, turn about x and y in radians, uniform scale. */
export type UnitPose = [lift: number, turnX: number, turnY: number, scale: number];

const easeOutBack = (k: number) => {
  const c = 1.4;
  const x = k - 1;
  return 1 + (c + 1) * x * x * x + c * x * x;
};
const smooth = (k: number) => k * k * (3 - 2 * k);
const clamp01 = (k: number) => Math.min(1, Math.max(0, k));

/** The entrance is over once the last unit has risen; then the idle float takes over. */
export const riseEnd = (count: number) => RISE_DURATION + Math.max(0, count - 1) * RISE_STAGGER;

/** A small float, out of phase per unit, shared by `rise` once it has landed and by `float`. */
function bob(t: number, i: number, amount: number, out: UnitPose): UnitPose {
  const phase = i * 0.7;
  out[0] = amount * 0.05 * Math.sin(t * 1.3 + phase);
  out[1] = amount * 0.05 * Math.sin(t * 0.9 + phase * 1.3);
  out[2] = amount * 0.09 * Math.sin(t * 0.7 + phase * 0.6);
  out[3] = 1;
  return out;
}

/** Writes unit `i` of `count`'s pose at `t` seconds into `out`. */
export function unitPose(
  motion: string,
  t: number,
  i: number,
  count: number,
  out: UnitPose = [0, 0, 0, 1],
): UnitPose {
  out[0] = 0;
  out[1] = 0;
  out[2] = 0;
  out[3] = 1;
  if (motion === 'rise') {
    const k = clamp01((t - i * RISE_STAGGER) / RISE_DURATION);
    if (t < riseEnd(count)) {
      const e = easeOutBack(k);
      out[0] = (1 - e) * -0.7;
      out[1] = (1 - smooth(k)) * 1.2;
      out[3] = 0.001 + 0.999 * smooth(Math.min(1, k * 1.6));
      return out;
    }
    // The float fades in from the landing, so the hand-off has no jump.
    const settle = clamp01((t - riseEnd(count)) / 1.5);
    return bob(t - riseEnd(count), i, smooth(settle), out);
  }
  if (motion === 'wave') {
    const phase = t * 2.4 - i * 0.42;
    out[0] = 0.09 * Math.sin(phase);
    out[1] = -0.16 * Math.cos(phase);
    return out;
  }
  if (motion === 'float') return bob(t, i, 1.6, out);
  if (motion === 'spin') {
    // Every 5 s a flip runs along the text, one unit after another.
    const cycle = 5;
    const local = (((t - i * 0.08) % cycle) + cycle) % cycle;
    out[2] = local < 1.1 ? smooth(local / 1.1) * Math.PI * 2 : 0;
    return out;
  }
  return out;
}

/** Whether a motion keeps running after any entrance; looping motion gets a pause control. */
export const motionLoops = (motion: string) => motion !== 'none';
