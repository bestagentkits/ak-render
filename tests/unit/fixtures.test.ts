import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
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
  it('covers the page classes the epic requires', () => {
    expect(fixtureFiles.sort()).toEqual([
      'dashboard.yaml',
      'diff.yaml',
      'explain.yaml',
      'interactive.yaml',
      'media.yaml',
      'plan.yaml',
      'recap.yaml',
      'theme-showcase.yaml',
    ]);
  });

  for (const file of fixtureFiles) {
    describe(file, () => {
      const source = readFileSync(`${pagesDir}/${file}`, 'utf8');

      it('validates with no errors', () => {
        const result = validate(source, { source: file });
        const errors = result.diagnostics.filter((item) => item.severity === 'error');
        expect(errors).toEqual([]);
        expect(result.ok).toBe(true);
      });

      it('normalizes deterministically, including node IDs', () => {
        const first = normalize(source);
        const second = normalize(source);
        expect(first.nodes.map((node) => node.id)).toEqual(second.nodes.map((node) => node.id));
        expect(JSON.stringify(first)).toBe(JSON.stringify(second));
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
