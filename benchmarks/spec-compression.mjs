#!/usr/bin/env node
/**
 * Spec compression: what a shared dataset saves an agent, and what the agent
 * reads to write the spec, for the required composition fixtures.
 *
 * Measured per fixture, in UTF-8 bytes:
 *   - specBytes: the fixture as committed;
 *   - expandedSpecBytes: the same spec with every `dataRef` replaced by the
 *     rows it names, inline (`data:`), and the top-level `datasets` removed;
 *     the difference is what the shared dataset saves;
 *   - htmlBytes: the compiled page;
 *   - catalogBytes: `ak-render catalog` text, the one listing an agent reads;
 *   - compactDescribeBytes: `ak-render describe <types...> --compact` text for
 *     the block types the fixture uses (in batches the CLI accepts).
 *
 * The output is deterministic: no timestamps, fixtures sorted by name, and the
 * same compiler always yields the same bytes.
 *
 * Usage:
 *   pnpm build
 *   node benchmarks/spec-compression.mjs [--out-dir docs/artifacts]
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';
import { compile } from '../dist/index.js';
import { specBlockTypes } from './spec-block-types.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CLI = join(REPO_ROOT, 'dist/cli.js');
const PAGES = join(REPO_ROOT, 'fixtures/pages');

/** The composition fixtures the release requires, in name order. */
export const REQUIRED_FIXTURES = [
  'benchmark-report',
  'complex-dashboard',
  'incident-report',
  'interactive-data-explorer',
  'product-case-study',
  'research-report',
];

/** The CLI's describe-many limit. */
const DESCRIBE_BATCH = 12;

const bytes = (text) => Buffer.byteLength(text, 'utf8');
const cli = (args) => execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

function parseArgs(argv) {
  const options = { outDir: join(REPO_ROOT, 'docs/artifacts') };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--out-dir' && argv[index + 1] !== undefined) {
      options.outDir = resolve(argv[index + 1]);
      index += 1;
    } else {
      throw new Error(`unexpected argument: ${argv[index]}`);
    }
  }
  return options;
}

/**
 * The spec with each `dataRef` inlined as `data`, at any depth, and the
 * `datasets` map dropped. Throws on a reference to a missing dataset, which a
 * valid fixture never has.
 */
export function expandDataRefs(spec) {
  const datasets = spec.datasets ?? {};
  const visit = (value) => {
    if (Array.isArray(value)) return value.map(visit);
    if (value === null || typeof value !== 'object') return value;
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === 'dataRef') {
        if (!Object.hasOwn(datasets, child)) throw new Error(`unknown dataset "${child}"`);
        out.data = datasets[child];
      } else {
        out[key] = visit(child);
      }
    }
    return out;
  };
  const { datasets: _datasets, ...rest } = spec;
  return visit(rest);
}

function compactDescribeBytes(types) {
  let total = 0;
  for (let start = 0; start < types.length; start += DESCRIBE_BATCH) {
    total += bytes(cli(['describe', ...types.slice(start, start + DESCRIBE_BATCH), '--compact']));
  }
  return total;
}

function measure() {
  const catalogBytes = bytes(cli(['catalog']));
  const rows = REQUIRED_FIXTURES.map((name) => {
    const source = readFileSync(join(PAGES, `${name}.yaml`), 'utf8');
    const spec = parse(source);
    const expanded = stringify(expandDataRefs(spec));
    const types = specBlockTypes(source);
    const specBytes = bytes(source);
    const expandedSpecBytes = bytes(expanded);
    const describeBytes = compactDescribeBytes(types);
    const htmlBytes = bytes(compile(source, { source: `${name}.yaml` }).html);
    return {
      fixture: `${name}.yaml`,
      datasets: Object.keys(spec.datasets ?? {}).length,
      blockTypes: types,
      specBytes,
      expandedSpecBytes,
      datasetSavingBytes: expandedSpecBytes - specBytes,
      htmlBytes,
      catalogBytes,
      compactDescribeBytes: describeBytes,
      readBytes: catalogBytes + describeBytes,
      htmlPerSpecByte: Number((htmlBytes / specBytes).toFixed(1)),
    };
  });
  const sum = (field) => rows.reduce((total, row) => total + row[field], 0);
  return {
    artifact: 'spec-compression',
    producer: 'benchmarks/spec-compression.mjs',
    compiler: cli(['--version']).trim(),
    method: {
      bytes: 'UTF-8 bytes',
      expandedSpec: 'every dataRef replaced by its rows inline (data:), datasets removed, YAML',
      catalog: 'ak-render catalog (text)',
      compactDescribe: `ak-render describe <types...> --compact, in batches of ${DESCRIBE_BATCH}`,
      readBytes: 'catalog plus compact describe: what an agent reads to write the spec',
    },
    rows,
    totals: {
      specBytes: sum('specBytes'),
      expandedSpecBytes: sum('expandedSpecBytes'),
      datasetSavingBytes: sum('datasetSavingBytes'),
      htmlBytes: sum('htmlBytes'),
      compactDescribeBytes: sum('compactDescribeBytes'),
    },
  };
}

const kb = (value) => `${(value / 1000).toFixed(1)} kB`;
const pct = (part, whole) => (whole === 0 ? '0%' : `${Math.round((part / whole) * 100)}%`);

function markdown(result) {
  const lines = [
    '# Spec compression',
    '',
    `Produced by \`${result.producer}\` with compiler ${result.compiler}. Machine-readable`,
    'companion: [`spec-compression.json`](./spec-compression.json). Sizes are UTF-8 bytes.',
    '',
    '- **Spec**: the fixture as written, with shared `datasets` and `dataRef`.',
    '- **Inline data**: the same spec with every `dataRef` replaced by its rows.',
    '- **Saved**: what the shared datasets save over inline data.',
    '- **Read**: `catalog` text plus `describe --compact` for the block types used.',
    '',
    '| Fixture | Block types | Spec | Inline data | Saved | HTML | HTML / spec | Read |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...result.rows.map(
      (row) =>
        `| ${row.fixture} | ${row.blockTypes.length} | ${kb(row.specBytes)} | ${kb(row.expandedSpecBytes)} | ${kb(row.datasetSavingBytes)} (${pct(row.datasetSavingBytes, row.expandedSpecBytes)}) | ${kb(row.htmlBytes)} | ${row.htmlPerSpecByte}× | ${kb(row.readBytes)} |`,
    ),
    `| **Total** | | **${kb(result.totals.specBytes)}** | **${kb(result.totals.expandedSpecBytes)}** | **${kb(result.totals.datasetSavingBytes)} (${pct(result.totals.datasetSavingBytes, result.totals.expandedSpecBytes)})** | **${kb(result.totals.htmlBytes)}** | | |`,
    '',
    `The catalog text is ${kb(result.rows[0]?.catalogBytes ?? 0)} on every row; the rest of`,
    '"Read" is the compact contract of each block type the fixture uses.',
    '',
    '## Block types per fixture',
    '',
    ...result.rows.map((row) => `- \`${row.fixture}\`: ${row.blockTypes.join(', ')}`),
    '',
  ];
  return `${lines.join('\n')}`;
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const options = parseArgs(process.argv.slice(2));
  const result = measure();
  writeFileSync(
    join(options.outDir, 'spec-compression.json'),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  writeFileSync(join(options.outDir, 'spec-compression.md'), markdown(result));
  console.log(
    `spec-compression: ${result.rows.length} fixtures, datasets save ${kb(result.totals.datasetSavingBytes)} of ${kb(result.totals.expandedSpecBytes)} inline`,
  );
}
