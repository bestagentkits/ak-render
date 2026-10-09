/**
 * Definition helpers shared by the core roster and the block modules.
 *
 * Small constructors for prop schemas and block definitions. They only build
 * data: validation, the JSON Schema and `describe()` all read the result.
 */

import type { PropSchema } from './prop-schema.js';
import type { BlockDefinition, SizingContract } from './roster.js';

export const DEFAULT_MIGRATION =
  'Props are additive; removed props are reported as diagnostics, never silently dropped.';
export const DEFAULT_SERIALIZER =
  'Serializes back to the same Page Spec shape; child blocks keep their order and slots.';
export const DEFAULT_SIZING: SizingContract = {
  sizes: ['medium', 'large'],
  default: 'medium',
  responsive: 'Fills its parent slot and reflows its content; never clips or scales by transform.',
};

export const str = (o: Omit<PropSchema & { kind: 'string' }, 'kind'> = {}): PropSchema => ({
  kind: 'string',
  ...o,
});
/**
 * How text renders. `describe` and the JSON Schema both carry it, once per
 * prop, so it stays short.
 */
export const PROSE_DESCRIPTION = 'Plain text; `code` and **bold** spans render inline.';
export const VERBATIM_DESCRIPTION = 'Emitted verbatim; backticks stay literal.';

export const LANGUAGE_DESCRIPTION =
  'Highlighted: php, javascript, typescript, python, go, rust, java, kotlin, csharp, c, cpp, swift, ruby, bash, sql, json, yaml, diff. Any other value renders plain.';

export const txt = (
  o: { required?: boolean; default?: string; maxLength?: number; description?: string } = {},
): PropSchema => ({
  kind: 'text',
  description: PROSE_DESCRIPTION,
  ...o,
});
export const num = (
  o: {
    required?: boolean;
    default?: number;
    min?: number;
    max?: number;
    integer?: boolean;
    description?: string;
  } = {},
): PropSchema => ({ kind: 'number', ...o });
export const bool = (
  o: { required?: boolean; default?: boolean; description?: string } = {},
): PropSchema => ({
  kind: 'boolean',
  ...o,
});
export const urlProp = (
  o: {
    required?: boolean;
    schemes?: readonly string[];
    description?: string;
    asset?: 'images' | 'media';
    rejectBlocked?: boolean;
  } = {},
): PropSchema => ({
  kind: 'url',
  ...o,
});
export const list = (
  of: PropSchema,
  o: { required?: boolean; minItems?: number; maxItems?: number; description?: string } = {},
): PropSchema => ({ kind: 'list', of, ...o });
export const obj = (
  fields: Record<string, PropSchema>,
  o: { required?: boolean; description?: string } = {},
): PropSchema => ({ kind: 'object', fields, ...o });
export const oneOf = (
  options: readonly PropSchema[],
  o: { required?: boolean; description?: string } = {},
): PropSchema => ({ kind: 'oneOf', options, ...o });
export const enumStr = (
  values: readonly string[],
  o: { required?: boolean; default?: string; description?: string } = {},
): PropSchema => ({
  kind: 'string',
  enum: values,
  ...o,
});
export const idProp = (description: string): PropSchema => ({
  kind: 'string',
  id: true,
  description,
});
export const actionMap = (description: string): PropSchema => ({
  kind: 'json',
  description,
  maxBytes: 8_000,
  schemaRef: '#/$defs/actionMap',
});

/** A nested list of child blocks, built into `IrNode.slots` rather than props. */
export const blocks = (
  o: {
    required?: boolean;
    minItems?: number;
    maxItems?: number;
    accepts?: readonly string[] | '*';
    description?: string;
  } = {},
): PropSchema => ({ kind: 'blocks', ...o });

/** Reusable prop fragments. */
export const onProp = (description = 'Declarative action bindings for this block.'): PropSchema =>
  actionMap(description);

export const anchorProps: Record<string, PropSchema> = {
  id: idProp('Stable node id. Author-provided ids are used verbatim and must be unique.'),
};

export const itemsOf = (
  fields: Record<string, PropSchema>,
  o: { minItems?: number; maxItems?: number } = {},
): PropSchema =>
  list(obj(fields), { required: true, minItems: o.minItems ?? 1, maxItems: o.maxItems ?? 200 });

export const TITLE = str({ required: true, maxLength: 200 });
export const OPTIONAL_TITLE = str({ maxLength: 200 });
export const LABEL = str({ required: true, maxLength: 200 });

/** A block definition with the shared defaults filled in. */
export function define(
  specification: Partial<BlockDefinition> &
    Pick<
      BlockDefinition,
      'type' | 'category' | 'tags' | 'useCases' | 'purpose' | 'summary' | 'props'
    >,
): BlockDefinition {
  return {
    version: 1,
    kind: 'primitive',
    sizing: DEFAULT_SIZING,
    a11y: 'Renders semantic markup; text alternatives come from the authored content.',
    actions: [],
    runtimeFeatures: [],
    assets: [],
    network: 'none',
    migration: DEFAULT_MIGRATION,
    serializer: DEFAULT_SERIALIZER,
    ...specification,
  };
}

export function semantic(
  specification: Partial<BlockDefinition> &
    Pick<
      BlockDefinition,
      'type' | 'category' | 'tags' | 'useCases' | 'purpose' | 'summary' | 'props'
    >,
): BlockDefinition {
  return define({ kind: 'semantic', ...specification });
}
