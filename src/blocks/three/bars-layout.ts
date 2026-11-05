/**
 * Bars 3D layout: pure arithmetic from the data matrix to bar extents.
 *
 * Every bar starts at zero. A grouped bar spans [min(0, v), max(0, v)]. A
 * stacked bar sits on the running total of its sign, so positives build up
 * from the baseline and negatives build down from it, and the stack ends at
 * the category's positive and negative sums. A filter hides series: hidden
 * bars collapse to the baseline and the visible ones restack.
 */

export type BarsMode = 'grouped' | 'stacked';

/** One bar's value extent in data units, bottom to top. */
export type Extent = readonly [number, number];

export function barExtents(
  values: readonly (readonly number[])[],
  mode: BarsMode,
  visible: (series: number) => boolean = () => true,
): Extent[][] {
  return values.map((row) => {
    let up = 0;
    let down = 0;
    return row.map((value, s): Extent => {
      if (!visible(s)) return [0, 0];
      if (mode === 'grouped') return value < 0 ? [value, 0] : [0, value];
      if (value < 0) {
        const extent: Extent = [down + value, down];
        down += value;
        return extent;
      }
      const extent: Extent = [up, up + value];
      up += value;
      return extent;
    });
  });
}

/** The data range every layout fits in, always including zero. */
export function valueDomain(extents: readonly Extent[][]): Extent {
  let lo = 0;
  let hi = 0;
  for (const row of extents) {
    for (const [bottom, top] of row) {
      lo = Math.min(lo, bottom);
      hi = Math.max(hi, top);
    }
  }
  return [lo, hi];
}

/** Round step ticks (1, 2, 2.5 or 5 times a power of ten) that cover the domain and include zero. */
export function niceTicks(domain: Extent, count = 5): number[] {
  const [lo, hi] = domain;
  const span = hi - lo;
  if (span <= 0) return [0];
  const raw = span / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  // A step a little under the raw one hugs the data better, as long as the ticks stay few.
  const steps = [1, 2, 2.5, 5, 10, 20].map((m) => m * power).filter((s) => s >= raw * 0.9);
  const fits = (s: number) => Math.ceil(hi / s - 1e-9) - Math.floor(lo / s + 1e-9) <= count + 2;
  const step = steps.find(fits) ?? steps[steps.length - 1] ?? raw;
  const ticks: number[] = [];
  const first = Math.floor(lo / step + 1e-9);
  const last = Math.ceil(hi / step - 1e-9);
  for (let k = first; k <= last; k += 1) ticks.push(Number((k * step).toPrecision(12)) || 0);
  return ticks;
}

/** Category and series totals a reader checks the stack against. */
export function stackTotals(
  values: readonly (readonly number[])[],
): { up: number; down: number }[] {
  return values.map((row) => ({
    up: row.reduce((sum, v) => (v > 0 ? sum + v : sum), 0),
    down: row.reduce((sum, v) => (v < 0 ? sum + v : sum), 0),
  }));
}
