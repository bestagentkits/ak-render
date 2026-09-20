/**
 * `@agentkit/render` public library surface.
 *
 * Additions here are additive and versioned; see `docs/release-policy.md` for
 * what a minor and a major release promise. Functions that are not implemented
 * yet are not exported — the package never advertises a scaffold.
 */

export type { Diagnostic, DiagnosticSeverity } from './diagnostics.js';
export type { RenderErrorCode, RenderErrorOptions } from './errors.js';
export { isRenderError, RenderError } from './errors.js';
export type { IrDocument, IrNode, IrTheme, NetworkPolicy } from './ir.js';
export type { JsonValue } from './json.js';
export type { ActionDefinition, ActionType } from './registry/actions.js';
export { ACTION_DEFINITIONS, ALLOWED_EVENTS, listActionTypes } from './registry/actions.js';
export type { Catalog, CatalogEntry } from './registry/registry.js';
export {
  blockTypes,
  buildPageSpecJsonSchema,
  catalog,
  describe,
  getBlockDefinition,
  SPEC_SCHEMA_VERSION,
} from './registry/registry.js';
export type { BlockDefinition, SizingContract, SlotSpec } from './registry/roster.js';
export type { BoundsReport } from './spec/bounds.js';
export { LIMITS } from './spec/bounds.js';
export { CURRENT_SPEC_VERSION, supportedVersions } from './spec/migrate.js';
export type { NormalizeResult } from './spec/normalize.js';
export { normalize, normalizeSpec } from './spec/normalize.js';
export type { ParseOptions } from './spec/parse.js';
export { parseSpec } from './spec/parse.js';
export type { ValidateResult, ValidateSummary } from './spec/validate.js';
export { validate, validateOrThrow } from './spec/validate.js';
export { PACKAGE_NAME, VERSION } from './version.js';
