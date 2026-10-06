/**
 * Byte budgets for the discovery surfaces an agent loads into its context.
 *
 * Every assertion runs over the full registry at test time, so each block
 * package that merges is measured against the same ceilings. The projection
 * checks catch a roster whose per-block cost would not fit once it grows to
 * the planned size, before the absolute ceiling is hit.
 */

import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.js';
import { BLOCK_CATEGORIES } from '../../src/registry/block-module.js';
import { describeMany } from '../../src/registry/describe-many.js';
import { BLOCK_DEFINITIONS, blockTypes } from '../../src/registry/registry.js';

const BUDGET = {
  catalogText: 9_000,
  catalogJson: 20_000,
  categoryText: 3_000,
  compactDescribe: 1_500,
  summaryLength: 110,
  tags: 6,
  useCases: 4,
} as const;

/** The roster size the budgets are planned for. */
const PLANNED_BLOCKS = 83;

/**
 * Summaries written before the length cap existed. Each entry must still be
 * over the cap, so trimming one forces its removal here; the list only shrinks.
 */
const SUMMARIES_AWAITING_TRIM: readonly string[] = [];

function cliBytes(args: string[]): number {
  let stdout = '';
  let stderr = '';
  const code = run(args, {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
  });
  expect(code, stderr).toBe(0);
  return Buffer.byteLength(stdout, 'utf8');
}

/** Bytes at the planned roster size, if each extra block costs the current average. */
function projected(bytes: number): number {
  const count = BLOCK_DEFINITIONS.length;
  return Math.ceil((bytes / count) * Math.max(count, PLANNED_BLOCKS));
}

describe('catalog byte budgets', () => {
  it(`keeps the catalog text under ${BUDGET.catalogText} bytes`, () => {
    const bytes = cliBytes(['catalog']);
    expect(bytes).toBeLessThanOrEqual(BUDGET.catalogText);
    expect(projected(bytes)).toBeLessThanOrEqual(BUDGET.catalogText);
  });

  it(`keeps the catalog JSON under ${BUDGET.catalogJson} bytes`, () => {
    const bytes = cliBytes(['catalog', '--json']);
    expect(bytes).toBeLessThanOrEqual(BUDGET.catalogJson);
    expect(projected(bytes)).toBeLessThanOrEqual(BUDGET.catalogJson);
  });

  it(`keeps every category listing under ${BUDGET.categoryText} bytes`, () => {
    for (const category of BLOCK_CATEGORIES) {
      const bytes = cliBytes(['catalog', '--category', category]);
      expect(bytes, category).toBeLessThanOrEqual(BUDGET.categoryText);
    }
  });

  it(`keeps every compact contract under ${BUDGET.compactDescribe} bytes`, () => {
    for (const type of blockTypes()) {
      const [compact] = describeMany([type], { compact: true });
      // Measured as the MCP and CLI JSON replies print it.
      const bytes = Buffer.byteLength(JSON.stringify(compact, null, 2), 'utf8');
      expect(bytes, type).toBeLessThanOrEqual(BUDGET.compactDescribe);
    }
  });

  it('keeps the per-block catalog metadata short', () => {
    for (const definition of BLOCK_DEFINITIONS) {
      const { type, summary, tags, useCases } = definition;
      if (SUMMARIES_AWAITING_TRIM.includes(type)) {
        expect(summary.length, `${type} is trimmed; drop it from the list`).toBeGreaterThan(
          BUDGET.summaryLength,
        );
      } else {
        expect(summary.length, type).toBeLessThanOrEqual(BUDGET.summaryLength);
      }
      expect(tags.length, type).toBeLessThanOrEqual(BUDGET.tags);
      expect(useCases.length, type).toBeLessThanOrEqual(BUDGET.useCases);
    }
  });
});
