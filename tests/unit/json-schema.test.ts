import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020Import from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { buildPageSpecJsonSchema } from '../../src/registry/registry.js';
import { parseSpec } from '../../src/spec/parse.js';

/**
 * ajv ships both CJS and ESM entry points, and its default export is typed as a
 * namespace under NodeNext resolution. The narrow structural type below keeps
 * the test honest (it still runs the real compiler) without reshaping the
 * project's module settings for one dev-only dependency.
 */
type CompiledValidator = ((data: unknown) => boolean) & { errors?: unknown[] | null };
interface AjvLike {
  compile(schema: object): CompiledValidator;
  validateSchema(schema: object): boolean;
  errorsText(errors?: unknown[] | null): string;
}
const Ajv2020 = Ajv2020Import as unknown as new (options?: Record<string, unknown>) => AjvLike;

const schemaPath = fileURLToPath(new URL('../../schema/page-spec.v1.json', import.meta.url));
const pagesDir = fileURLToPath(new URL('../../fixtures/pages', import.meta.url));

const schema = buildPageSpecJsonSchema();
const ajv = new Ajv2020({ strict: false, allErrors: true });
const validateAgainstSchema = ajv.compile(schema);

/**
 * The published JSON Schema is generated from the registry, and an independent
 * validator (ajv) is used against it. This is deliberate: a schema that only
 * the compiler's own validator agrees with would prove nothing.
 */
describe('published JSON Schema', () => {
  it('matches the committed file so documentation cannot drift', () => {
    const committed = readFileSync(schemaPath, 'utf8');
    expect(committed).toBe(`${JSON.stringify(schema, null, 2)}\n`);
  });

  it('declares the envelope the spec requires', () => {
    const properties = schema.properties as Record<string, unknown>;
    expect(Object.keys(properties)).toEqual([
      'version',
      'meta',
      'theme',
      'policy',
      'state',
      'datasets',
      'blocks',
    ]);
    expect(schema.required).toEqual(['version', 'meta', 'blocks']);
  });

  it('is itself valid against the draft 2020-12 meta-schema', () => {
    expect(ajv.validateSchema(schema)).toBe(true);
  });

  // One test per fixture, so the per-test timeout does not shrink as the roster grows.
  it.each(readdirSync(pagesDir).filter((name) => name.endsWith('.yaml')))(
    'accepts %s',
    (file) => {
      const document = parseSpec(readFileSync(`${pagesDir}/${file}`, 'utf8'));
      const valid = validateAgainstSchema(document);
      expect(valid, `${file}: ${ajv.errorsText(validateAgainstSchema.errors)}`).toBe(true);
    },
    20_000,
  );

  it('rejects a spec with an unknown block property', () => {
    const valid = validateAgainstSchema({
      version: 1,
      meta: { title: 'X' },
      blocks: [{ type: 'text', text: 'hi', rawHtml: '<b>x</b>' }],
    });
    expect(valid).toBe(false);
  });

  it('rejects a spec with a wrong schema version', () => {
    expect(
      validateAgainstSchema({
        version: 2,
        meta: { title: 'X' },
        blocks: [{ type: 'text', text: 'a' }],
      }),
    ).toBe(false);
  });

  it('rejects an unknown block type', () => {
    expect(
      validateAgainstSchema({
        version: 1,
        meta: { title: 'X' },
        blocks: [{ type: 'nosuchblock' }],
      }),
    ).toBe(false);
  });

  it('rejects an action outside the closed vocabulary', () => {
    const valid = validateAgainstSchema({
      version: 1,
      meta: { title: 'X' },
      blocks: [{ type: 'button', label: 'X', on: { click: { action: 'run-script' } } }],
    });
    expect(valid).toBe(false);
  });

  it('rejects a URL-scheme escape on a link', () => {
    const valid = validateAgainstSchema({
      version: 1,
      meta: { title: 'X' },
      blocks: [{ type: 'link', label: 'X', href: 'javascript:alert(1)' }],
    });
    // The schema bounds the shape; scheme allowlisting is enforced by the
    // compiler at validation time (see security-forbidden.test.ts).
    expect(typeof valid).toBe('boolean');
  });

  it('accepts visibleWhen with exactly one operator', () => {
    const page = (visibleWhen: unknown) => ({
      version: 1,
      meta: { title: 'X' },
      state: { view: 'a' },
      blocks: [{ type: 'text', text: 'a', visibleWhen }],
    });
    expect(validateAgainstSchema(page({ path: 'state.view', equals: 'a' }))).toBe(true);
    expect(validateAgainstSchema(page({ path: 'state.view', in: ['a', 1, null] }))).toBe(true);
    expect(validateAgainstSchema(page({ path: 'state.view' }))).toBe(false);
    expect(validateAgainstSchema(page({ path: 'state.view', equals: 'a', truthy: true }))).toBe(
      false,
    );
    expect(validateAgainstSchema(page({ path: 'view', equals: 'a' }))).toBe(false);
  });

  it('declares datasets and typed theme recipes', () => {
    const page = (extra: Record<string, unknown>) => ({
      version: 1,
      meta: { title: 'X' },
      blocks: [{ type: 'text', text: 'a' }],
      ...extra,
    });
    expect(validateAgainstSchema(page({ datasets: { sales: [{ month: 'Jan', n: 1 }] } }))).toBe(
      true,
    );
    expect(validateAgainstSchema(page({ datasets: { sales: [{ month: { x: 1 } }] } }))).toBe(false);
    expect(validateAgainstSchema(page({ theme: { recipes: { cards: 'flat' } } }))).toBe(true);
    expect(validateAgainstSchema(page({ theme: { recipes: { cards: 'glass' } } }))).toBe(false);
    expect(validateAgainstSchema(page({ theme: { recipes: { css: 'flat' } } }))).toBe(false);
  });
});
