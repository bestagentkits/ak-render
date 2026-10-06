/**
 * Benchmark verdicts: how one metric changed between a baseline and a
 * candidate, and the one-line tally of those verdicts. Pure functions, so the
 * rules are tested without compiling a page.
 */

/** A change smaller than this many percent of the baseline reads as unchanged. */
export const UNCHANGED_PERCENT = 1;

export type Better = 'lower' | 'higher';
export type Verdict = 'improved' | 'regressed' | 'unchanged';

export interface MetricComparison {
  /** Candidate minus baseline. */
  delta: number;
  /** Change relative to the baseline, in percent; null when the baseline is zero. */
  percent: number | null;
  verdict: Verdict;
}

export const BETTER_VALUES: readonly Better[] = ['lower', 'higher'];

/**
 * Compare one metric. With a zero baseline there is no percentage, and any
 * change is judged on its direction alone; otherwise a change under
 * `UNCHANGED_PERCENT` of the baseline is unchanged.
 */
export function compareMetric(
  baseline: number,
  candidate: number,
  better: Better,
): MetricComparison {
  const delta = candidate - baseline;
  const percent = baseline === 0 ? null : (delta / Math.abs(baseline)) * 100;
  const negligible = percent === null ? delta === 0 : Math.abs(percent) < UNCHANGED_PERCENT;
  if (negligible) return { delta, percent, verdict: 'unchanged' };
  const wentUp = delta > 0;
  return { delta, percent, verdict: wentUp === (better === 'higher') ? 'improved' : 'regressed' };
}

/** "3 improved, 1 regressed": the non-zero counts in a fixed order. */
export function verdictSummary(verdicts: readonly Verdict[]): string {
  return (['improved', 'regressed', 'unchanged'] as const)
    .map((verdict) => ({ verdict, count: verdicts.filter((item) => item === verdict).length }))
    .filter(({ count }) => count > 0)
    .map(({ verdict, count }) => `${count} ${verdict}`)
    .join(', ');
}
