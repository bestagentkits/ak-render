/**
 * Test-results block: a computed run summary over suites of cases.
 *
 * The summary (counts, total duration and a proportional bar) is derived from
 * the cases, so it cannot disagree with them. Suites with failures come first,
 * and suites with failing or flaky cases start open. Inside a suite, failing
 * cases come first. Native `<details>` carry the folding, so there is no script.
 */

import { formatValue } from '../../data/format-value.js';
import { pathKey } from '../../diagnostics.js';
import type { IrNode } from '../../ir.js';
import { isPlainObject } from '../../json.js';
import type { BlockModule } from '../../registry/block-module.js';
import {
  anchorProps,
  define,
  enumStr,
  itemsOf,
  LABEL,
  num,
  OPTIONAL_TITLE,
  str as strProp,
  txt,
} from '../../registry/define-helpers.js';
import {
  element,
  nodeAttributes,
  objectListProp,
  str,
  titleHeader,
} from '../../render/block-helpers.js';
import { escapeText, renderAttributes } from '../../render/escape.js';

export const TEST_RESULTS_MAX_CASES = 200;

/** Status order for the summary and for sorting failures first. */
const STATUS_ORDER = ['fail', 'flaky', 'skip', 'pass'] as const;
type CaseStatus = (typeof STATUS_ORDER)[number];

const STATUS_TEXT: Readonly<Record<CaseStatus, { label: string; tone: string; plural: string }>> = {
  fail: { label: 'Failed', tone: 'danger', plural: 'failed' },
  flaky: { label: 'Flaky', tone: 'warning', plural: 'flaky' },
  skip: { label: 'Skipped', tone: 'neutral', plural: 'skipped' },
  pass: { label: 'Passed', tone: 'success', plural: 'passed' },
};

interface TestCase {
  name: string;
  status: CaseStatus;
  duration: number | undefined;
  message: string;
  file: string;
}

interface Suite {
  name: string;
  cases: TestCase[];
  counts: Record<CaseStatus, number>;
  duration: number;
}

function isStatus(value: string): value is CaseStatus {
  return (STATUS_ORDER as readonly string[]).includes(value);
}

function emptyCounts(): Record<CaseStatus, number> {
  return { fail: 0, flaky: 0, skip: 0, pass: 0 };
}

function suites(node: IrNode): Suite[] {
  return objectListProp(node, 'suites').map((suite) => {
    const cases = (Array.isArray(suite.cases) ? suite.cases : []).flatMap((entry) => {
      if (!isPlainObject(entry)) return [];
      const status = str(entry.status);
      return [
        {
          name: str(entry.name),
          status: isStatus(status) ? status : 'pass',
          duration: typeof entry.duration === 'number' ? entry.duration : undefined,
          message: str(entry.message),
          file: str(entry.file),
        } satisfies TestCase,
      ];
    });
    const counts = emptyCounts();
    for (const item of cases) counts[item.status] += 1;
    const duration = cases.reduce((total, item) => total + (item.duration ?? 0), 0);
    // Failures first, then flaky, then the rest in authored order (sort is stable).
    const rank = (status: CaseStatus): number =>
      status === 'fail' ? 0 : status === 'flaky' ? 1 : 2;
    const ordered = [...cases].sort((left, right) => rank(left.status) - rank(right.status));
    return { name: str(suite.name), cases: ordered, counts, duration };
  });
}

function duration(ms: number): string {
  return formatValue(ms, { format: 'duration' });
}

function countPhrase(counts: Record<CaseStatus, number>): string {
  return STATUS_ORDER.filter((status) => counts[status] > 0)
    .map((status) => `${counts[status]} ${STATUS_TEXT[status].plural}`)
    .join(', ');
}

function statusBadge(status: CaseStatus): string {
  const text = STATUS_TEXT[status];
  return `<span class="ak-badge" data-tone="${text.tone}">${text.label}</span>`;
}

/**
 * The proportional bar is an SVG of rect widths (attributes, not inline
 * styles), stretched to the row. It is decorative: the counts are text.
 */
function summaryBar(counts: Record<CaseStatus, number>, total: number): string {
  if (total === 0) return '';
  let offset = 0;
  const rects = STATUS_ORDER.filter((status) => counts[status] > 0)
    .map((status) => {
      const width = (counts[status] / total) * 100;
      const rect = `<rect class="ak-tests-seg" data-status="${status}" x="${offset.toFixed(2)}" y="0" width="${width.toFixed(2)}" height="1"></rect>`;
      offset += width;
      return rect;
    })
    .join('');
  return `<svg class="ak-tests-bar" viewBox="0 0 100 1" preserveAspectRatio="none" aria-hidden="true" focusable="false">${rects}</svg>`;
}

function renderCase(item: TestCase): string {
  const time =
    item.duration === undefined
      ? ''
      : `<span class="ak-tests-time">${escapeText(duration(item.duration))}</span>`;
  const file =
    item.file === '' ? '' : `<code class="ak-tests-file">${escapeText(item.file)}</code>`;
  const message =
    item.message === '' ? '' : `<pre class="ak-tests-message">${escapeText(item.message)}</pre>`;
  return `<li${renderAttributes({ class: 'ak-tests-case', 'data-status': item.status })}><div class="ak-tests-case-head">${statusBadge(
    item.status,
  )}<span class="ak-tests-name">${escapeText(item.name)}</span>${time}</div>${file}${message}</li>`;
}

function renderTestResults(node: IrNode): string {
  const all = suites(node);
  const totals = emptyCounts();
  for (const suite of all)
    for (const status of STATUS_ORDER) totals[status] += suite.counts[status];
  const total = STATUS_ORDER.reduce((sum, status) => sum + totals[status], 0);
  const elapsed = all.reduce((sum, suite) => sum + suite.duration, 0);
  const coverage = node.props.coverage;
  const failed = totals.fail > 0;
  const verdict = failed
    ? `${totals.fail} of ${total} ${total === 1 ? 'test' : 'tests'} failed`
    : `No failures in ${total} ${total === 1 ? 'test' : 'tests'}`;

  const stats = [
    ...STATUS_ORDER.map((status) => [STATUS_TEXT[status].label, String(totals[status]), status]),
    ...(elapsed > 0 ? [['Duration', duration(elapsed), '']] : []),
    ...(typeof coverage === 'number'
      ? [['Coverage', formatValue(coverage, { format: 'percent' }), '']]
      : []),
  ]
    .map(
      ([label, value, status]) =>
        `<div${renderAttributes({ 'data-status': status === '' ? undefined : status })}><dt>${escapeText(
          label ?? '',
        )}</dt><dd>${escapeText(value ?? '')}</dd></div>`,
    )
    .join('');

  // Suites with failures first, in authored order otherwise.
  const ordered = [...all].sort(
    (left, right) => Number(right.counts.fail > 0) - Number(left.counts.fail > 0),
  );
  const suitesMarkup = ordered
    .map((suite) => {
      const elapsedText = suite.duration > 0 ? ` · ${duration(suite.duration)}` : '';
      return `<details${renderAttributes({
        class: 'ak-tests-suite',
        open: suite.counts.fail + suite.counts.flaky > 0,
        'data-status': suite.counts.fail > 0 ? 'fail' : suite.counts.flaky > 0 ? 'flaky' : 'pass',
      })}><summary><span class="ak-tests-suite-name">${escapeText(
        suite.name,
      )}</span><span class="ak-tests-suite-counts">${escapeText(
        `${countPhrase(suite.counts)}${elapsedText}`,
      )}</span></summary><ul class="ak-tests-cases">${suite.cases.map(renderCase).join('')}</ul></details>`;
    })
    .join('');

  return element(
    'section',
    nodeAttributes(node, { class: 'ak-block ak-tests-block' }),
    `${titleHeader(node)}<div class="ak-tests"><div class="ak-tests-summary"${renderAttributes({
      'data-status': failed ? 'fail' : 'pass',
    })}><p class="ak-tests-verdict">${escapeText(verdict)}</p>${summaryBar(
      totals,
      total,
    )}<dl class="ak-tests-counts">${stats}</dl></div><div class="ak-tests-suites">${suitesMarkup}</div></div>`,
  );
}

export const testResultsBlock: BlockModule = {
  definition: define({
    type: 'test-results',
    kind: 'semantic',
    category: 'engineering',
    tags: ['tests', 'ci', 'quality', 'suites'],
    useCases: ['test run report', 'ci summary', 'regression triage'],
    purpose:
      'Test run report: suites of cases with a computed pass, fail, skip and duration summary.',
    summary:
      'Test results: suites of pass/fail/skip/flaky cases; the summary is computed and failures come first.',
    props: {
      title: OPTIONAL_TITLE,
      coverage: num({ min: 0, max: 100, description: 'Line coverage in percent (87 for 87%).' }),
      suites: itemsOf(
        {
          name: LABEL,
          cases: itemsOf(
            {
              name: strProp({ required: true, maxLength: 300 }),
              status: enumStr(STATUS_ORDER, { required: true }),
              duration: num({ min: 0, description: 'Milliseconds.' }),
              message: txt({ maxLength: 400, description: 'Failure output; emitted verbatim.' }),
              file: strProp({
                maxLength: 200,
                description: 'Source reference, such as src/a.ts:12.',
              }),
            },
            { minItems: 1, maxItems: TEST_RESULTS_MAX_CASES },
          ),
        },
        { minItems: 1, maxItems: 20 },
      ),
      ...anchorProps,
    },
    runtimeFeatures: ['test-results'],
    sizing: {
      sizes: ['medium', 'large'],
      default: 'large',
      responsive:
        'One column at every width; case rows wrap their duration and file under the name.',
    },
    a11y: 'Counts and each case status are text; the summary bar is decorative. Suites are native disclosures.',
  }),
  render: renderTestResults,
  check(node, { bag }) {
    const total = objectListProp(node, 'suites').reduce(
      (sum, suite) => sum + (Array.isArray(suite.cases) ? suite.cases.length : 0),
      0,
    );
    if (total > TEST_RESULTS_MAX_CASES) {
      bag.add({
        code: 'SPEC_BOUNDS_ERROR',
        path: pathKey(node.path, 'suites'),
        message: `the suites hold ${total} cases, limit is ${TEST_RESULTS_MAX_CASES} in total`,
        nodeId: node.id,
      });
    }
  },
};
