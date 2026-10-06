import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compile } from '../../src/render/render.js';
import { validate } from '../../src/spec/validate.js';

const pagesDir = fileURLToPath(new URL('../../fixtures/pages', import.meta.url));
// The corpus as it stood before these features existed. Newer fixtures exist
// to exercise the new fields, so they are not part of this contract.
const files = [
  'all-components.yaml',
  'brainstorm.yaml',
  'dashboard.yaml',
  'diff.yaml',
  'explain.yaml',
  'interactive.yaml',
  'media.yaml',
  'plan.yaml',
  'recap.yaml',
  'showcase.yaml',
  'theme-showcase.yaml',
];

/**
 * Specs written before nested slots, datasets, conditions and recipes existed
 * must keep validating exactly as they did: no errors, no warnings, and an IR
 * that carries none of the new optional fields.
 */
describe('existing specs stay valid', () => {
  for (const file of files) {
    it(`${file} validates and compiles with no diagnostics`, () => {
      const source = readFileSync(`${pagesDir}/${file}`, 'utf8');
      expect(validate(source, { source: file }).diagnostics).toEqual([]);
      const result = compile(source, { source: file });
      expect(result.warnings).toEqual([]);
      expect(result.ir.datasets).toEqual({});
      expect(result.ir.theme.recipes).toBeUndefined();
      for (const node of result.ir.nodes) {
        expect(node.when, node.path).toBeUndefined();
        expect(node.data, node.path).toBeUndefined();
      }
      expect(result.features).not.toContain('state');
    });
  }
});
