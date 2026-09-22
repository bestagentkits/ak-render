/**
 * `@agentkit/render` public library surface.
 *
 * Additions here are additive and versioned; see `docs/release-policy.md` for
 * what a minor and a major release promise. Functions that are not implemented
 * yet are not exported — the package never advertises a scaffold.
 */

export type { Diagnostic, DiagnosticSeverity } from './diagnostics.js';
export type {
  AdapterMarkupCheck,
  DiagramAdapter,
  DiagramAdapterResult,
  DiagramRenderRequest,
} from './diagram/adapter.js';
export {
  checkAdapterMarkup,
  DIAGRAM_ADAPTER_CONTRACT_VERSION,
  MAX_DIAGRAM_MARKUP_BYTES,
  runDiagramAdapter,
} from './diagram/adapter.js';
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
export { buildContentSecurityPolicy } from './render/document.js';
export { escapeAttribute, escapeText, escapeUrl, serializeJsonForScript } from './render/escape.js';
export type { CompileResult, RenderOptions } from './render/render.js';
export { compile, render } from './render/render.js';
export type { BoundsReport } from './spec/bounds.js';
export { LIMITS } from './spec/bounds.js';
export { CURRENT_SPEC_VERSION, supportedVersions } from './spec/migrate.js';
export type { NormalizeResult } from './spec/normalize.js';
export { normalize, normalizeSpec } from './spec/normalize.js';
export type { ParseOptions } from './spec/parse.js';
export { parseSpec } from './spec/parse.js';
export type { EmbedProvider } from './spec/providers.js';
export {
  EMBED_PROVIDER_NAMES,
  EMBED_PROVIDERS,
  hostMatchesAnyProvider,
  hostMatchesProvider,
  isEmbedProvider,
} from './spec/providers.js';
export type { ValidateResult, ValidateSummary } from './spec/validate.js';
export { validate, validateOrThrow } from './spec/validate.js';
export type { LoadThemeOptions, ResolvedTheme, ThemeInput } from './theme/load-theme.js';
export { loadTheme, resolveTheme, themeDiagnostics, themePresetNames } from './theme/load-theme.js';
export type { PresetEntry } from './theme/presets.js';
export type { PresetSource, ThemeCatalog, ThemeCatalogOptions } from './theme/theme-catalog.js';
export {
  buildThemeCatalog,
  builtinThemeCatalog,
  catalogPresetNames,
  loadPresetFile,
  parsePresetDocument,
  themeSearchDirectories,
} from './theme/theme-catalog.js';
export type { TokenSpec } from './theme/tokens.js';
export { TOKEN_SPECS, tokenNames } from './theme/tokens.js';
export { PACKAGE_NAME, VERSION } from './version.js';
