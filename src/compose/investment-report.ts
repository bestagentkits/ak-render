/**
 * The `investment-report` compose intent.
 *
 * Typed slots (thesis, metrics, scenarios, risks, milestones, sources) expand
 * into an ordinary Page Spec built only from existing blocks. Scenario values
 * become one shared dataset that both the chart and the summary table read, so
 * the two can never disagree. The expansion is pure data reshaping: no model
 * call, no markup, and the only arithmetic is reading the last value of each
 * scenario for the summary table.
 */

import { DATA_LIMITS } from '../data/dataset-types.js';
import { CURRENCIES } from '../data/format-value.js';
import { type DiagnosticBag, pathIndex, pathKey } from '../diagnostics.js';
import type { JsonValue } from '../json.js';
import type { SlotField } from './slot-schema.js';

const RECOMMENDATIONS = ['invest', 'pass', 'hold', 'watch', 'buy', 'sell'] as const;
type Recommendation = (typeof RECOMMENDATIONS)[number];

const SCENARIO_FORMATS = ['number', 'integer', 'compact', 'currency', 'percent'] as const;
const LEVELS = ['low', 'medium', 'high'] as const;
const TRENDS = ['up', 'down', 'flat'] as const;
const DIRECTIONS = ['up', 'down'] as const;

/** Item caps keep a composed page readable; a longer list belongs in a dataset. */
export const INVESTMENT_REPORT_LIMITS = {
  facts: 12,
  points: 8,
  metrics: 8,
  periods: 24,
  scenarios: 6,
  risks: 12,
  milestones: 12,
  sources: 20,
} as const;

const L = INVESTMENT_REPORT_LIMITS;

/** Scenario names, periods and notes become dataset cells, which are shorter. */
const CELL = { kind: 'string', max: DATA_LIMITS.maxStringLength } as const;

export const INVESTMENT_REPORT_SLOTS: SlotField = {
  kind: 'object',
  fields: {
    title: { kind: 'string', required: true, description: 'The report headline.' },
    subtitle: { kind: 'string', description: 'One line under the headline.' },
    eyebrow: {
      kind: 'string',
      description: 'Label above the headline. Default "Investment report".',
    },
    currency: {
      kind: 'string',
      enum: CURRENCIES,
      description: 'Currency of scenario values when their format is currency. Default USD.',
    },
    facts: {
      kind: 'list',
      max: L.facts,
      description: 'Key facts beside the thesis: company, stage, ticket, date.',
      of: {
        kind: 'object',
        fields: {
          label: { kind: 'string', required: true },
          value: { kind: 'string', required: true },
        },
      },
    },
    thesis: {
      kind: 'object',
      required: true,
      fields: {
        summary: { kind: 'text', required: true, description: 'The thesis in a few sentences.' },
        recommendation: { kind: 'string', enum: RECOMMENDATIONS },
        points: {
          kind: 'list',
          max: L.points,
          of: { kind: 'text' },
          description: 'Supporting arguments, one per item.',
        },
      },
    },
    metrics: {
      kind: 'list',
      max: L.metrics,
      description: 'Headline numbers as already formatted strings.',
      of: {
        kind: 'object',
        fields: {
          label: { kind: 'string', required: true },
          value: { kind: 'string', required: true },
          delta: { kind: 'string' },
          trend: { kind: 'string', enum: TRENDS },
          good: { kind: 'string', enum: DIRECTIONS },
          caption: { kind: 'string' },
        },
      },
    },
    scenarios: {
      kind: 'object',
      description: 'Projected values per period for each scenario; one shared dataset.',
      fields: {
        title: { kind: 'string', description: 'Default "Scenarios".' },
        metric: { kind: 'string', description: 'What the values measure. Default "Value".' },
        format: { kind: 'string', enum: SCENARIO_FORMATS, description: 'Default currency.' },
        periods: {
          kind: 'list',
          required: true,
          min: 2,
          max: L.periods,
          of: CELL,
        },
        items: {
          kind: 'list',
          required: true,
          min: 1,
          max: L.scenarios,
          of: {
            kind: 'object',
            fields: {
              name: { ...CELL, required: true },
              probability: { kind: 'number', min: 0, max: 1 },
              values: {
                kind: 'list',
                required: true,
                min: 2,
                max: L.periods,
                of: { kind: 'number' },
                description: 'One value per period, in period order.',
              },
              note: CELL,
            },
          },
        },
      },
    },
    risks: {
      kind: 'list',
      max: L.risks,
      of: {
        kind: 'object',
        fields: {
          area: { kind: 'string', required: true },
          impact: { kind: 'string', required: true, enum: LEVELS },
          likelihood: { kind: 'string', required: true, enum: LEVELS },
          mitigation: { kind: 'text' },
        },
      },
    },
    milestones: {
      kind: 'list',
      max: L.milestones,
      of: {
        kind: 'object',
        fields: {
          when: { kind: 'string', required: true },
          title: { kind: 'string', required: true },
          text: { kind: 'text' },
        },
      },
    },
    sources: {
      kind: 'list',
      max: L.sources,
      description: 'Cited sources; numbered in order.',
      of: {
        kind: 'object',
        fields: {
          title: { kind: 'string', required: true },
          href: { kind: 'string' },
          authors: { kind: 'string' },
          publisher: { kind: 'string' },
          year: { kind: 'number', min: 1000, max: 9999 },
          note: { kind: 'text' },
        },
      },
    },
  },
};

interface Fact {
  label: string;
  value: string;
}
interface Metric {
  label: string;
  value: string;
  delta?: string;
  trend?: string;
  good?: string;
  caption?: string;
}
interface Scenario {
  name: string;
  probability?: number;
  values: number[];
  note?: string;
}
interface Scenarios {
  title?: string;
  metric?: string;
  format?: (typeof SCENARIO_FORMATS)[number];
  periods: string[];
  items: Scenario[];
}
interface Risk {
  area: string;
  impact: string;
  likelihood: string;
  mitigation?: string;
}
interface Milestone {
  when: string;
  title: string;
  text?: string;
}
interface Source {
  title: string;
  href?: string;
  authors?: string;
  publisher?: string;
  year?: number;
  note?: string;
}

/** The content of an `investment-report`, once `checkSlot` accepted it. */
export interface InvestmentReportContent {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  currency?: (typeof CURRENCIES)[number];
  facts?: Fact[];
  thesis: { summary: string; recommendation?: Recommendation; points?: string[] };
  metrics?: Metric[];
  scenarios?: Scenarios;
  risks?: Risk[];
  milestones?: Milestone[];
  sources?: Source[];
}

/**
 * Checks the slot schema cannot express: every scenario has one value per
 * period, scenario names are distinct, and stated probabilities add up to 1.
 */
export function checkInvestmentReport(
  content: InvestmentReportContent,
  path: string,
  bag: DiagnosticBag,
): void {
  const scenarios = content.scenarios;
  if (scenarios === undefined) return;
  const scenariosPath = pathKey(path, 'scenarios');
  const names = new Set<string>();
  scenarios.items.forEach((item, index) => {
    const itemPath = pathIndex(pathKey(scenariosPath, 'items'), index);
    if (item.values.length !== scenarios.periods.length) {
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: pathKey(itemPath, 'values'),
        message: `has ${item.values.length} values for ${scenarios.periods.length} periods; give one value per period`,
      });
    }
    if (names.has(item.name)) {
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: pathKey(itemPath, 'name'),
        message: `duplicate scenario name "${item.name}"`,
      });
    }
    names.add(item.name);
  });
  const probabilities = scenarios.items.map((item) => item.probability);
  if (probabilities.every((value) => value !== undefined)) {
    const sum = probabilities.reduce((total, value) => total + value, 0);
    if (Math.abs(sum - 1) > 0.001) {
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        severity: 'warning',
        path: pathKey(scenariosPath, 'items'),
        message: `scenario probabilities add up to ${Number(sum.toFixed(4))}, not 1`,
      });
    }
  }
}

// A success callout is labelled "Done", which misreads as a finished deal, so
// a positive recommendation stays a note and only a negative one warns.
const RECOMMENDATION_TONE: Readonly<Record<Recommendation, string>> = {
  invest: 'info',
  buy: 'info',
  hold: 'info',
  watch: 'info',
  pass: 'warning',
  sell: 'warning',
};

function titleCase(word: string): string {
  return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}

/** Copy only the keys that are present, in the order given. */
function pick<T extends object>(source: T, keys: readonly (keyof T)[]): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {};
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined) out[key as string] = value as JsonValue;
  }
  return out;
}

function thesisBlocks(content: InvestmentReportContent): JsonValue[] {
  const { summary, recommendation, points } = content.thesis;
  const blocks: JsonValue[] = [
    {
      type: 'callout',
      id: 'thesis',
      tone: recommendation === undefined ? 'info' : RECOMMENDATION_TONE[recommendation],
      title:
        recommendation === undefined
          ? 'Investment thesis'
          : `Recommendation: ${titleCase(recommendation)}`,
      text: summary,
    },
  ];
  if (points !== undefined && points.length > 0) {
    blocks.push({
      type: 'list',
      id: 'thesis-points',
      title: 'Why',
      items: points.map((text) => ({ text })),
    });
  }
  return blocks;
}

function scenarioBlocks(
  scenarios: Scenarios,
  currency: string,
): { datasets: Record<string, JsonValue>; block: JsonValue } {
  const format = scenarios.format ?? 'currency';
  const metric = scenarios.metric ?? 'Value';
  const valueFormat: Record<string, JsonValue> = {
    format,
    ...(format === 'currency' ? { currency } : {}),
  };
  const rows = scenarios.items.flatMap((item) =>
    scenarios.periods.map((period, index) => ({
      period,
      scenario: item.name,
      value: item.values[index] ?? 0,
    })),
  );
  const lastPeriod = scenarios.periods[scenarios.periods.length - 1] ?? '';
  const hasProbability = scenarios.items.some((item) => item.probability !== undefined);
  const hasNote = scenarios.items.some((item) => item.note !== undefined);
  const summaryRows = scenarios.items.map((item) => ({
    scenario: item.name,
    // Probabilities arrive as 0..1; a percent column reads 25 as 25%.
    ...(hasProbability
      ? {
          probability:
            item.probability === undefined ? null : Number((item.probability * 100).toFixed(4)),
        }
      : {}),
    final: item.values[item.values.length - 1] ?? 0,
    ...(hasNote ? { note: item.note ?? '' } : {}),
  }));
  const columns: JsonValue[] = [
    { key: 'scenario', label: 'Scenario' },
    ...(hasProbability
      ? [{ key: 'probability', label: 'Probability', type: 'percent', decimals: 0 }]
      : []),
    { key: 'final', label: `${metric} (${lastPeriod})`, type: 'number', ...valueFormat },
    ...(hasNote ? [{ key: 'note', label: 'Note' }] : []),
  ];
  return {
    datasets: { scenarios: rows, 'scenario-summary': summaryRows },
    block: {
      type: 'section',
      id: 'scenarios',
      title: scenarios.title ?? 'Scenarios',
      blocks: [
        {
          type: 'chart',
          id: 'scenarios-chart',
          kind: 'line',
          title: `${metric} by scenario`,
          dataRef: 'scenarios',
          x: { field: 'period' },
          y: { field: 'value', label: metric, ...valueFormat },
          series: { field: 'scenario' },
        },
        {
          type: 'data-table',
          id: 'scenarios-table',
          title: 'Scenario summary',
          dataRef: 'scenario-summary',
          columns,
        },
      ],
    },
  };
}

/** Expand an accepted `investment-report` input into a Page Spec object. */
export function expandInvestmentReport(
  content: InvestmentReportContent,
  theme: string,
): Record<string, JsonValue> {
  const blocks: JsonValue[] = [
    {
      type: 'hero',
      eyebrow: content.eyebrow ?? 'Investment report',
      title: content.title,
      ...(content.subtitle === undefined ? {} : { description: content.subtitle }),
    },
  ];

  const thesis = thesisBlocks(content);
  if (content.facts !== undefined && content.facts.length > 0) {
    blocks.push({
      type: 'sidebar-layout',
      sidebar: [
        {
          type: 'key-value',
          id: 'facts',
          title: 'Key facts',
          items: content.facts.map(({ label, value }) => ({ key: label, value })),
        },
      ],
      blocks: thesis,
    });
  } else {
    blocks.push(...thesis);
  }

  if (content.metrics !== undefined && content.metrics.length > 0) {
    blocks.push({
      type: 'kpi',
      id: 'metrics',
      items: content.metrics.map((metric) =>
        pick(metric, ['label', 'value', 'delta', 'trend', 'good', 'caption']),
      ),
    });
  }

  let datasets: Record<string, JsonValue> | undefined;
  if (content.scenarios !== undefined) {
    const scenarios = scenarioBlocks(content.scenarios, content.currency ?? 'USD');
    datasets = scenarios.datasets;
    blocks.push(scenarios.block);
  }

  if (content.risks !== undefined && content.risks.length > 0) {
    blocks.push({
      type: 'risk-matrix',
      id: 'risks',
      title: 'Risks',
      items: content.risks.map(({ area, impact, likelihood, mitigation }) => ({
        area,
        impact,
        likelihood,
        ...(mitigation === undefined ? {} : { note: mitigation }),
      })),
    });
  }

  if (content.milestones !== undefined && content.milestones.length > 0) {
    blocks.push({
      type: 'timeline',
      id: 'milestones',
      title: 'Milestones',
      items: content.milestones.map((milestone) => pick(milestone, ['when', 'title', 'text'])),
    });
  }

  if (content.sources !== undefined && content.sources.length > 0) {
    blocks.push({
      type: 'references',
      id: 'sources',
      title: 'Sources',
      items: content.sources.map((source, index) => ({
        id: String(index + 1),
        title: source.title,
        ...pick(source, ['href', 'authors']),
        ...(source.publisher === undefined ? {} : { source: source.publisher }),
        ...pick(source, ['year', 'note']),
      })),
    });
  }

  return {
    version: 1,
    meta: {
      title: content.title,
      ...(content.subtitle === undefined ? {} : { description: content.subtitle }),
    },
    theme: { preset: theme },
    ...(datasets === undefined ? {} : { datasets }),
    blocks,
  };
}
