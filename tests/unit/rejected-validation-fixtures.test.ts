import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isRenderError, type RenderError } from '../../src/errors.js';
import { compile } from '../../src/index.js';
import { validate } from '../../src/spec/validate.js';

const validationDir = fileURLToPath(new URL('../../fixtures/rejected/validation', import.meta.url));
const fixtures = existsSync(validationDir)
  ? readdirSync(validationDir)
      .filter((name) => name.endsWith('.yaml'))
      .sort()
  : [];

/**
 * An optional first-line comment pins the expected diagnostic, for example
 * `# expect: SPEC_VALIDATION_ERROR $.blocks[0].columns`. Without it the fixture
 * only has to fail validation with a located error.
 */
function expectation(source: string): { code?: string; path?: string } {
  const match = /^#\s*expect:\s*([A-Z_]+)(?:\s+(\S+))?/u.exec(source);
  if (match === null) return {};
  return { code: match[1], ...(match[2] === undefined ? {} : { path: match[2] }) };
}

/**
 * Specs that are well-formed but wrong: a dangling dataRef, an unknown column,
 * a visibleWhen naming a missing control. Unlike the injection fixtures beside
 * them, these fail as validation errors, not policy violations, and must say
 * where the author has to look.
 */
describe('validation-error fixtures are rejected', () => {
  for (const fixture of fixtures) {
    const source = readFileSync(`${validationDir}/${fixture}`, 'utf8');
    const expected = expectation(source);

    it(`reports ${fixture} as a located validation error`, () => {
      const result = validate(source, { source: fixture });
      const errors = result.diagnostics.filter((item) => item.severity === 'error');
      expect(result.ok, fixture).toBe(false);
      expect(errors.length, fixture).toBeGreaterThan(0);
      for (const error of errors) expect(error.path, fixture).toMatch(/^\$/u);
      if (expected.path !== undefined) {
        expect(
          errors.map((error) => error.path),
          fixture,
        ).toContain(expected.path);
      }
    });

    it(`refuses to compile ${fixture}`, () => {
      try {
        const result = compile(source, { source: fixture });
        throw new Error(`expected a rejection, but compiled ${result.bytes} bytes`);
      } catch (error) {
        expect(isRenderError(error), fixture).toBe(true);
        const code = (error as RenderError).code;
        expect(code, fixture).not.toBe('INTERNAL_ERROR');
        expect(code, fixture).not.toBe('POLICY_VIOLATION');
        if (expected.code !== undefined) expect(code, fixture).toBe(expected.code);
      }
    });
  }
});
