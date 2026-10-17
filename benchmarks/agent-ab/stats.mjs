/**
 * Summary statistics for the live-model A/B harness.
 *
 * Medians and reductions get percentile-bootstrap intervals over the per-run
 * values; rates get Wilson score intervals. The resampler is seeded so the same runs always produce the same report;
 * the randomness lives in the model, never in the statistics.
 */

/** Small, seedable PRNG (mulberry32). Returns floats in [0, 1). */
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Linear-interpolated quantile, `q` in [0, 1]. `undefined` for no values. */
export function quantile(values, q) {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

export const median = (values) => quantile(values, 0.5);

export function mean(values) {
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Sample standard deviation; 0 for a single value, `undefined` for none. */
export function stddev(values) {
  if (values.length === 0) return undefined;
  if (values.length === 1) return 0;
  const average = mean(values);
  const squares = values.reduce((sum, value) => sum + (value - average) ** 2, 0);
  return Math.sqrt(squares / (values.length - 1));
}

const resample = (values, random) => values.map(() => values[Math.floor(random() * values.length)]);

/**
 * Percentile bootstrap interval for `statistic(values)`.
 * Returns `[low, high]`, or `undefined` with fewer than two values.
 */
export function bootstrapInterval(
  values,
  statistic,
  { iterations = 2000, level = 0.95, seed = 1 } = {},
) {
  if (values.length < 2) return undefined;
  const random = seededRandom(seed);
  const estimates = [];
  for (let index = 0; index < iterations; index += 1) {
    estimates.push(statistic(resample(values, random)));
  }
  const tail = (1 - level) / 2;
  return [quantile(estimates, tail), quantile(estimates, 1 - tail)];
}

/** Count, median, mean, standard deviation, p95, min, max and a 95% CI of the median. */
export function describe(values, options) {
  const finite = values.filter((value) => Number.isFinite(value));
  return {
    n: finite.length,
    median: median(finite),
    mean: mean(finite),
    stddev: stddev(finite),
    p95: quantile(finite, 0.95),
    min: finite.length === 0 ? undefined : Math.min(...finite),
    max: finite.length === 0 ? undefined : Math.max(...finite),
    medianCi95: bootstrapInterval(finite, median, options),
  };
}

const Z95 = 1.959963984540054;

/**
 * Share of `true` values with a Wilson score 95% interval, which stays honest
 * at 0% and 100% where a bootstrap would collapse to a zero-width interval.
 */
export function proportion(flags) {
  const n = flags.length;
  if (n === 0) return { n, rate: undefined, ci95: undefined };
  const rate = flags.filter(Boolean).length / n;
  const z2 = Z95 * Z95;
  const centre = (rate + z2 / (2 * n)) / (1 + z2 / n);
  const half = (Z95 * Math.sqrt((rate * (1 - rate)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return { n, rate, ci95: [Math.max(0, centre - half), Math.min(1, centre + half)] };
}

const finiteOnly = (strata) =>
  strata.map((values) => values.filter((value) => Number.isFinite(value)));

/**
 * Relative reduction of the median from `before` to `after`:
 * `1 - median(after) / median(before)`, positive when `after` is lower.
 *
 * Both arguments are strata (one array of values per task), paired by index.
 * Only strata measured in both arms count, and the bootstrap resamples within
 * each stratum so the mix of cheap and costly tasks stays the same in every
 * resample; otherwise task differences would swamp the arm difference.
 */
export function medianReduction(before, after, { iterations = 2000, seed = 1 } = {}) {
  const a = finiteOnly(before);
  const b = finiteOnly(after);
  const paired = a.map((_, index) => index).filter((i) => a[i].length > 0 && b[i]?.length > 0);
  if (paired.length === 0) return undefined;
  const pool = (strata) => paired.flatMap((index) => strata[index]);
  const base = median(pool(a));
  if (base === 0) return undefined;
  const point = 1 - median(pool(b)) / base;
  if (paired.every((index) => a[index].length < 2 && b[index].length < 2)) {
    return { point, ci95: undefined, strata: paired.length };
  }
  const random = seededRandom(seed);
  const estimates = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const resampledBase = median(paired.flatMap((index) => resample(a[index], random)));
    const resampledAfter = median(paired.flatMap((index) => resample(b[index], random)));
    if (resampledBase !== 0) estimates.push(1 - resampledAfter / resampledBase);
  }
  return {
    point,
    ci95:
      estimates.length === 0 ? undefined : [quantile(estimates, 0.025), quantile(estimates, 0.975)],
    strata: paired.length,
  };
}
