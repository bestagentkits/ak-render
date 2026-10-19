/**
 * audit-ui findings and the report that carries them.
 *
 * A report is deterministic for the same input, compiler version, preset and
 * browser build: findings are sorted, capped per rule, and carry no timing.
 */

import { UI_SEVERITIES, type UiAuditPreset, type UiSeverity, uiRule } from './ui-audit-rules.js';

/** How the page was presented when a finding was measured. */
export type UiAuditMode = 'screen' | 'print' | 'no-js' | 'reduced-motion';

export type UiColorScheme = 'light' | 'dark';

export interface UiFinding {
  /** Stable id from `UI_RULES`. */
  rule: string;
  severity: UiSeverity;
  message: string;
  /** JSON path of the block in the spec, or `$` / `html` when no block applies. */
  path: string;
  /** The block's `data-ak-id`. */
  nodeId?: string;
  blockType?: string;
  /** `375x812`, `768x1024`, `1440x900`; absent for structural findings. */
  viewport?: string;
  scheme?: UiColorScheme;
  mode?: UiAuditMode;
  /** What was measured, so the finding can be reproduced (selector and numbers). */
  evidence: string;
  /** A screenshot written for this check, relative to the evidence directory. */
  evidenceRef?: string;
  fix: string;
}

export interface UiAuditCheck {
  viewport: string;
  scheme: UiColorScheme;
  mode: UiAuditMode;
  /** The screenshot of this check, when an evidence directory was given. */
  evidenceRef?: string;
}

export interface UiAuditReport {
  preset: UiAuditPreset;
  /** `spec` when the audit compiled the spec itself; `html` for a compiled page. */
  input: 'spec' | 'html';
  /** False when the budget ran out or the browser could not start. */
  complete: boolean;
  /**
   * `compiled-runtime`: only the runtime this audit compiled ran. `disabled`:
   * the page was HTML from elsewhere, so it ran with JavaScript off. `none`: no
   * browser ran (quick preset).
   */
  scripts: 'compiled-runtime' | 'disabled' | 'none';
  /** Every browser check that ran, in matrix order. */
  checks: UiAuditCheck[];
  budget: { timeoutMs: number; network: 'blocked' };
  /** Requests the page attempted; the audit blocks every one. */
  blockedRequests: number;
  counts: Record<UiSeverity, number>;
  findings: UiFinding[];
}

/**
 * A report lists at most this many findings per rule, plus one that counts the
 * rest, so a pathological page cannot make the report grow without bound.
 * Counts still cover every finding.
 */
export const UI_FINDINGS_PER_RULE = 20;

const RANK: Readonly<Record<UiSeverity, number>> = { error: 0, warning: 1, info: 2 };
const VIEWPORT_ORDER = ['375x812', '768x1024', '1440x900'];
const MODE_ORDER: readonly UiAuditMode[] = ['screen', 'no-js', 'reduced-motion', 'print'];

/** A finding for `rule`, with the registry's severity and fix unless given. */
export function uiFinding(
  rule: string,
  fields: Omit<UiFinding, 'rule' | 'severity' | 'fix'> & { severity?: UiSeverity; fix?: string },
): UiFinding {
  const definition = uiRule(rule);
  const { severity, fix, ...rest } = fields;
  return {
    rule,
    severity: severity ?? definition.severity,
    ...rest,
    fix: fix ?? definition.fix,
  };
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function order<T>(list: readonly T[], value: T | undefined): number {
  const index = value === undefined ? -1 : list.indexOf(value);
  return index === -1 ? list.length : index;
}

function sortFindings(findings: UiFinding[]): UiFinding[] {
  return findings.sort(
    (a, b) =>
      RANK[a.severity] - RANK[b.severity] ||
      compare(a.rule, b.rule) ||
      compare(a.path, b.path) ||
      order(VIEWPORT_ORDER, a.viewport) - order(VIEWPORT_ORDER, b.viewport) ||
      compare(a.scheme ?? '', b.scheme ?? '') ||
      order(MODE_ORDER, a.mode) - order(MODE_ORDER, b.mode) ||
      compare(a.evidence, b.evidence),
  );
}

/** Drop exact repeats: the same rule on the same block in the same check. */
function dedupe(findings: readonly UiFinding[]): UiFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = [
      finding.rule,
      finding.path,
      finding.nodeId ?? '',
      finding.viewport ?? '',
      finding.scheme ?? '',
      finding.mode ?? '',
      finding.evidence,
    ].join('\u0000');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function capPerRule(findings: readonly UiFinding[]): UiFinding[] {
  const kept: UiFinding[] = [];
  const dropped = new Map<string, UiFinding[]>();
  const listed = new Map<string, number>();
  for (const finding of findings) {
    const count = listed.get(finding.rule) ?? 0;
    if (count < UI_FINDINGS_PER_RULE) {
      kept.push(finding);
      listed.set(finding.rule, count + 1);
    } else {
      dropped.set(finding.rule, [...(dropped.get(finding.rule) ?? []), finding]);
    }
  }
  for (const [rule, rest] of dropped) {
    const first = rest[0];
    if (first === undefined) continue;
    kept.push({
      rule,
      severity: first.severity,
      message: `${rest.length} more ${rule} finding(s) not listed`,
      path: '$',
      evidence: `${rest.length} unlisted`,
      fix: first.fix,
    });
  }
  return kept;
}

export function buildUiReport(
  base: Omit<UiAuditReport, 'counts' | 'findings'>,
  findings: readonly UiFinding[],
): UiAuditReport {
  const unique = sortFindings(dedupe(findings));
  const counts: Record<UiSeverity, number> = { error: 0, warning: 0, info: 0 };
  for (const finding of unique) counts[finding.severity] += 1;
  return { ...base, counts, findings: sortFindings(capPerRule(unique)) };
}

/**
 * True when the report should fail a gate at `failOn` or above. An incomplete
 * report always fails unless the gate is `none`: a check that did not run is
 * not a pass.
 */
export function uiAuditFails(report: UiAuditReport, failOn: UiSeverity | 'none'): boolean {
  if (failOn === 'none') return false;
  if (!report.complete) return true;
  const threshold = UI_SEVERITIES.indexOf(failOn);
  return UI_SEVERITIES.some((severity, index) => index <= threshold && report.counts[severity] > 0);
}
