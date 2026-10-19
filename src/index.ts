/**
 * `@bestagentkits/render` public library surface.
 *
 * Additions here are additive and versioned; see `docs/release-policy.md` for
 * what a minor and a major release promise. Functions that are not implemented
 * yet are not exported — the package never advertises a scaffold.
 */

export type { UiAuditOptions, UiQuickOptions } from './audit/ui-audit.js';
export { auditUi, auditUiQuick, isHtmlInput } from './audit/ui-audit.js';
export type { BrowserLauncher, BrowserLike } from './audit/ui-audit-browser.js';
export type {
  UiAuditCheck,
  UiAuditMode,
  UiAuditReport,
  UiColorScheme,
  UiFinding,
} from './audit/ui-audit-report.js';
export { UI_FINDINGS_PER_RULE, uiAuditFails } from './audit/ui-audit-report.js';
export type { UiAuditPreset, UiRule, UiSeverity } from './audit/ui-audit-rules.js';
export { UI_AUDIT_PRESETS, UI_RULE_IDS, UI_RULES } from './audit/ui-audit-rules.js';
export type {
  ComposeInput,
  ComposeIntent,
  ComposeIntentDescription,
  ComposeOptions,
  ComposeResult,
  ComposeSpecResult,
} from './compose/compose.js';
export {
  COMPOSE_INTENTS,
  compose,
  composeInputJsonSchema,
  composeIntents,
  composeSpec,
} from './compose/compose.js';
export type { InvestmentReportContent } from './compose/investment-report.js';
export { INVESTMENT_REPORT_LIMITS } from './compose/investment-report.js';
export type { DataRow, DataScalar, MaterializedData } from './data/dataset-types.js';
export type { ValueFormat } from './data/format-value.js';
export { VALUE_FORMATS } from './data/format-value.js';
export type {
  Diagnostic,
  DiagnosticFix,
  DiagnosticSeverity,
  FixClassification,
  PatchOperation,
} from './diagnostics.js';
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
export type { IconDescription, IconHit, IconPackSummary } from './icons/icon-catalog.js';
export { describeIcon, iconPackSummaries, searchIcons } from './icons/icon-catalog.js';
export type { IconPackId, IconProfileName, IconSize } from './icons/icon-packs.js';
export { ICON_PACK_IDS, ICON_PROFILE_NAMES, ICON_SIZES } from './icons/icon-packs.js';
export type { IrDocument, IrNode, IrTheme, NetworkPolicy } from './ir.js';
export type { JsonValue } from './json.js';
export type {
  MotionAuditReport,
  MotionFinding,
  MotionScore,
  MotionSeverity,
  MotionSpecAuditOptions,
} from './motion/motion-audit.js';
export {
  auditMotionHtml,
  auditMotionSpec,
  compareMotionAudits,
  MOTION_SCORE_WEIGHTS,
  MOTION_SEVERITIES,
  motionAuditFails,
} from './motion/motion-audit.js';
export type {
  CompactMotionDescription,
  MotionCatalog,
  MotionCatalogEntry,
  MotionDescription,
  MotionSearchHit,
} from './motion/motion-catalog.js';
export {
  describeMotion,
  MOTION_SEARCH_LIMITS,
  motionCatalog,
  searchMotions,
} from './motion/motion-catalog.js';
export type {
  MotionDuration,
  MotionEasing,
  MotionPhase,
  MotionRecipe,
  MotionRole,
  MotionRuntime,
  MotionState,
  MotionTrigger,
} from './motion/recipes.js';
export {
  getMotionRecipe,
  MOTION_DURATION_SCALE,
  MOTION_EASINGS,
  MOTION_RECIPES,
  motionPresetsFor,
} from './motion/recipes.js';
export type { PageRecipe, PageRecipeSummary } from './recipes/index.js';
export { recipe, recipes } from './recipes/index.js';
export type { ActionDefinition, ActionType } from './registry/actions.js';
export { ACTION_DEFINITIONS, ALLOWED_EVENTS, listActionTypes } from './registry/actions.js';
export type { BlockCategory } from './registry/block-module.js';
export { BLOCK_CATEGORIES } from './registry/block-module.js';
export type { CatalogSearchHit } from './registry/catalog-search.js';
export { searchCatalog } from './registry/catalog-search.js';
export type {
  BlockDescription,
  CompactBlockDescription,
  DescribeManyOptions,
} from './registry/describe-many.js';
export { describeMany } from './registry/describe-many.js';
export type { Catalog, CatalogEntry, CatalogOptions } from './registry/registry.js';
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
export type {
  JsonPatchOperation,
  PatchChange,
  PatchOptions,
  PatchResult,
} from './spec/patch.js';
export { MAX_PATCH_OPERATIONS, patch, specHash } from './spec/patch.js';
export type { PatchTextResult } from './spec/patch-text.js';
export { patchSpecText } from './spec/patch-text.js';
export type { EmbedProvider } from './spec/providers.js';
export {
  EMBED_PROVIDER_NAMES,
  EMBED_PROVIDERS,
  hostMatchesAnyProvider,
  hostMatchesProvider,
  isEmbedProvider,
} from './spec/providers.js';
export type { RepairChange, RepairMode, RepairOptions, RepairResult } from './spec/repair.js';
export { REPAIR_MAX_ATTEMPTS, repair } from './spec/repair.js';
export type { ValidateOptions, ValidateResult, ValidateSummary } from './spec/validate.js';
export { validate, validateOrThrow } from './spec/validate.js';
export type { LoadThemeOptions, ResolvedTheme, ThemeInput } from './theme/load-theme.js';
export { loadTheme, resolveTheme, themeDiagnostics, themePresetNames } from './theme/load-theme.js';
export type { PresetEntry } from './theme/presets.js';
export type { ThemeRecipeSurface } from './theme/recipes.js';
export { THEME_RECIPE_SPECS } from './theme/recipes.js';
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
