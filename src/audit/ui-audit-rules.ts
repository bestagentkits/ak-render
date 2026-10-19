/**
 * The audit-ui rule registry: every rule id the visual audit can report, with
 * its preset, default severity and the deterministic fix it suggests.
 *
 * Findings only ever name a rule from this table, so a report, the docs and a
 * baseline agree on what a rule means. A rule's fix may name the block type it
 * applies to; it never invents spec values.
 */

export type UiSeverity = 'error' | 'warning' | 'info';

/** Severities from most to least serious; `none` gates nothing. */
export const UI_SEVERITIES: readonly UiSeverity[] = ['error', 'warning', 'info'];

export type UiAuditPreset = 'quick' | 'publication';

export const UI_AUDIT_PRESETS: readonly UiAuditPreset[] = ['quick', 'publication'];

export interface UiRule {
  id: string;
  /** `quick` rules read the spec and the compiled markup; `publication` rules need a browser. */
  preset: UiAuditPreset | 'both';
  severity: UiSeverity;
  summary: string;
  fix: string;
}

const RULE_LIST: readonly UiRule[] = [
  {
    id: 'ui/theme-contrast',
    preset: 'quick',
    severity: 'error',
    summary: 'A theme text colour falls below WCAG 2.2 AA (4.5:1) on a surface it is drawn on.',
    fix: 'Darken (light scheme) or lighten (dark scheme) the named foreground token, or move the surface token further from it, until the pair reaches 4.5:1.',
  },
  {
    id: 'ui/wide-table',
    preset: 'both',
    severity: 'warning',
    summary: 'A table is much wider than a phone screen and is read by scrolling sideways.',
    fix: 'Drop columns a reader does not need on this page, split the table into two, or move per-row detail into a key-value or card list.',
  },
  {
    id: 'ui/long-chart-label',
    preset: 'quick',
    severity: 'info',
    summary: 'A chart category label is long enough to crowd or be cut at narrow widths.',
    fix: 'Shorten the category values the chart labels (12 characters or fewer reads at every width), and keep the full wording in the data table or the chart summary.',
  },
  {
    id: 'ui/horizontal-overflow',
    preset: 'publication',
    severity: 'error',
    summary:
      'The page scrolls sideways: an element is wider than the viewport, as rendered or with its disclosures open.',
    fix: 'Shorten the unbroken text (URL, identifier, number) in this block or move wide content into a block that scrolls on its own, such as a table or code block.',
  },
  {
    id: 'ui/clipped-chart-label',
    preset: 'publication',
    severity: 'warning',
    summary: 'A chart label is drawn outside the chart and is cut off.',
    fix: 'Shorten the category or series values this chart labels, or use fewer categories, so every label fits inside the chart at this width.',
  },
  {
    id: 'ui/text-contrast',
    preset: 'publication',
    severity: 'error',
    summary: 'Rendered text is below WCAG 2.2 AA contrast against the background it is drawn on.',
    fix: 'Adjust the theme tokens this block draws with (text, text-muted or a tone token against its surface) until the pair reaches 4.5:1, or 3:1 for large text.',
  },
  {
    id: 'ui/small-text',
    preset: 'publication',
    severity: 'warning',
    summary: 'Readable text is set below 10px at this viewport.',
    fix: 'Raise the theme font-size-base token, or a font-scale that shrinks this text, so every label stays at 10px or more on every viewport.',
  },
  {
    id: 'ui/touch-target',
    preset: 'publication',
    severity: 'warning',
    summary:
      'A control (or the label that activates it) is smaller than the WCAG 2.2 AA target size, 24px, in its shorter dimension on a phone.',
    fix: 'The compiler sizes controls; report this as a compiler issue with the block type and viewport, and avoid wrapping the control in a denser layout in the meantime.',
  },
  {
    id: 'ui/broken-image',
    preset: 'publication',
    severity: 'error',
    summary: 'An image failed to load.',
    fix: 'Point the image source at a file that exists beside the page or embed it, and keep its alt text.',
  },
  {
    id: 'ui/script-error',
    preset: 'publication',
    severity: 'error',
    summary: 'The compiled runtime threw or logged an error.',
    fix: 'Report this as a compiler issue with the block type and the evidence; a compiled page must never raise a script error.',
  },
  {
    id: 'ui/interaction-failed',
    preset: 'publication',
    severity: 'error',
    summary: 'A control did not change state when activated (tab, disclosure or theme toggle).',
    fix: 'Report this as a compiler issue with the block type and the evidence; check first that the block has the content its control switches to.',
  },
  {
    id: 'ui/no-js-hidden',
    preset: 'publication',
    severity: 'warning',
    summary: 'A block that is visible with JavaScript is hidden when JavaScript is off.',
    fix: 'Content must read without JavaScript; report this as a compiler issue with the block type, or move the content out of a control-only block.',
  },
  {
    id: 'ui/reduced-motion',
    preset: 'publication',
    severity: 'error',
    summary: 'An element still animates or transitions with reduced motion requested.',
    fix: 'Report this as a compiler issue with the block type; reduced motion must yield 0ms transitions. Removing the block motion field avoids it meanwhile.',
  },
  {
    id: 'audit/network-request',
    preset: 'publication',
    severity: 'error',
    summary: 'The page tried to make a network request; the audit blocked it.',
    fix: 'Embed the resource or reference a file beside the page; a page opts into network only through policy.network.',
  },
  {
    id: 'audit/scripts-disabled',
    preset: 'publication',
    severity: 'info',
    summary: 'Compiled HTML was audited with JavaScript off, so interaction checks did not run.',
    fix: 'Audit the Page Spec instead of its HTML: the audit compiles the spec itself, so it can run the compiled runtime it trusts.',
  },
  {
    id: 'audit/budget-exceeded',
    preset: 'publication',
    severity: 'error',
    summary:
      'The audit ran out of its time budget; the report covers only the checks that finished.',
    fix: 'Raise the timeout, or audit a smaller page; an incomplete report never counts as a pass.',
  },
  {
    id: 'audit/aborted',
    preset: 'publication',
    severity: 'error',
    summary:
      'The browser stopped the audit (a crash or a closed page); the report covers only the checks that finished.',
    fix: 'Re-run the audit; if it stops again, open the page in a browser and look for the crash it reports.',
  },
  {
    id: 'audit/browser-unavailable',
    preset: 'publication',
    severity: 'error',
    summary: 'The publication preset needs a browser, and none could be launched.',
    fix: 'Install Playwright with Chromium (npm i -D playwright && npx playwright install chromium), or use the quick preset.',
  },
];

export const UI_RULES: Readonly<Record<string, UiRule>> = Object.fromEntries(
  RULE_LIST.map((rule) => [rule.id, rule]),
);

/** Rule ids in registry order, for listings and docs. */
export const UI_RULE_IDS: readonly string[] = RULE_LIST.map((rule) => rule.id);

export function uiRule(id: string): UiRule {
  const rule = UI_RULES[id];
  if (rule === undefined) throw new Error(`unknown audit-ui rule ${id}`);
  return rule;
}
