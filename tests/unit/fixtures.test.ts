import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compile } from '../../src/render/render.js';
import { normalize } from '../../src/spec/normalize.js';
import { parseSpec } from '../../src/spec/parse.js';
import { validate } from '../../src/spec/validate.js';

const pagesDir = fileURLToPath(new URL('../../fixtures/pages', import.meta.url));
const fixtureFiles = readdirSync(pagesDir).filter((name) => name.endsWith('.yaml'));

/**
 * The fixture corpus is the compiler's specification. Every fixture must
 * validate, normalize deterministically, and keep stable node IDs across runs.
 */
describe('fixture corpus', () => {
  it('covers exactly the expected page classes', () => {
    // Exact: adding or removing a fixture is a deliberate change to this list.
    expect([...fixtureFiles].sort()).toEqual([
      'all-components.yaml',
      'benchmark-report.yaml',
      'brainstorm.yaml',
      'charts-v2.yaml',
      'complex-dashboard.yaml',
      'controls.yaml',
      'dashboard.yaml',
      'data-tables.yaml',
      'diff.yaml',
      'engineering-widgets.yaml',
      'evidence-widgets.yaml',
      'explain.yaml',
      'incident-report.yaml',
      'interactive-data-explorer.yaml',
      'interactive.yaml',
      'media.yaml',
      'plan-review.yaml',
      'plan.yaml',
      'product-case-study.yaml',
      'product-widgets.yaml',
      'recap.yaml',
      'research-report.yaml',
      'responsive-layouts.yaml',
      'rich-composition.yaml',
      'showcase.yaml',
      'theme-dialects.yaml',
      'theme-showcase.yaml',
    ]);
  });

  for (const file of fixtureFiles) {
    describe(file, () => {
      const source = readFileSync(`${pagesDir}/${file}`, 'utf8');

      it('validates with no errors and no warnings', () => {
        const result = validate(source, { source: file });
        expect(result.diagnostics).toEqual([]);
        expect(result.ok).toBe(true);
      });

      it('normalizes deterministically, including node IDs', () => {
        const first = normalize(source);
        const second = normalize(source);
        expect(first.nodes.map((node) => node.id)).toEqual(second.nodes.map((node) => node.id));
        expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      });

      it('compiles to identical bytes three times', () => {
        const [first, ...rest] = [1, 2, 3].map(() => compile(source, { source: file }));
        for (const run of rest) {
          expect(run.hash).toBe(first?.hash);
          expect(run.html).toBe(first?.html);
        }
      });

      it('produces unique node IDs', () => {
        const ir = normalize(source);
        const ids = ir.nodes.map((node) => node.id);
        expect(new Set(ids).size).toBe(ids.length);
      });

      it('keeps the offline default (network denied)', () => {
        const ir = normalize(source);
        expect(ir.theme.preset).toMatch(/^[a-z-]+$/);
        expect(ir.policy.network).toBe('deny');
      });

      it('names every node with a known block type and an a11y contract', () => {
        for (const node of normalize(source).nodes) {
          expect(node.type).toMatch(/^[a-z][a-z0-9-]*$/);
          expect(node.a11y.length).toBeGreaterThan(10);
        }
      });
    });
  }

  it('normalizes the same content from JSON and YAML to the same IR', () => {
    const yamlSource = readFileSync(`${pagesDir}/plan.yaml`, 'utf8');
    const fromYaml = normalize(yamlSource);

    // Round-trip the YAML fixture through JSON to prove the input boundary is
    // format-independent: same content, same IR, same node IDs.
    const asJson = JSON.stringify(parseSpec(yamlSource));
    const fromJson = normalize(asJson);
    expect(JSON.stringify(fromJson)).toBe(JSON.stringify(fromYaml));
  });
});
