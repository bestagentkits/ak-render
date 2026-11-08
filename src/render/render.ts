/**
 * The compile pipeline.
 *
 * `parse -> validate -> normalize -> resolve registry -> resolve theme ->
 * render -> collect used assets and runtime features -> assemble -> verify`
 *
 * Every stage is observable: `compile()` returns the IR, the resolved theme, the
 * collected features, the diagnostics, and a content hash of the emitted bytes.
 * `render()` is the same pipeline reduced to the HTML string.
 */

import type { ModelAssetResult, ResolvedModelAsset } from '../assets/model-assets.js';
import type { PointCloudColumns, PointCloudResolver } from '../assets/point-cloud-assets.js';
import { type Diagnostic, DiagnosticBag, pathKey } from '../diagnostics.js';
import type { DiagramAdapter } from '../diagram/adapter.js';
import { RenderError } from '../errors.js';
import { stableHash } from '../hash.js';
import { ICON_CSS, type IconCollector, renderIconSprite } from '../icons/icon-render.js';
import type { IrDocument, IrNode, NetworkPolicy } from '../ir.js';
import { DIAGRAM_CANVAS_V2, DIAGRAM_MOTION_RECIPES } from '../motion/diagram-motion.js';
import { getMotionRecipe, motionRecipeCss } from '../motion/recipes.js';
import type { BlockRegistry, FeatureModule } from '../registry/block-module.js';
import { DEFAULT_REGISTRY } from '../registry/registry.js';
import type { RuntimeFeature } from '../registry/roster.js';
import { assetOrigins, assetReferences } from '../spec/asset-references.js';
import { evaluateCondition } from '../spec/conditions.js';
import { CONNECT_CAPABILITIES, isRemote, type MediaCapability } from '../spec/network-policy.js';
import { type NormalizeResult, normalizeSpec } from '../spec/normalize.js';
import { loadTheme, type ResolvedTheme, resolveTheme } from '../theme/load-theme.js';
import { builtinThemeCatalog, type ThemeCatalog } from '../theme/theme-catalog.js';
import { type RenderContext, renderNode } from './blocks.js';
import { DIAGRAM_VIEWER_MARKUP } from './diagram-viewer.js';
import { assembleDocument } from './document.js';
import { renderAttributes } from './escape.js';
import { embeddedFontCss } from './font-faces.js';
import { applyMotionPolicy, motionPolicyOf, PRINT_STILL_CSS } from './motion.js';
import { hasOutline, renderOutline } from './outline.js';
import { recipeCss } from './recipe-styles.js';
import { buildRuntime, needsLiveRegion } from './runtime.js';
import { BASE_CSS, FEATURE_CSS } from './styles.js';
import { inverseSurfaceCss, usesInverseSurface } from './surface-styles.js';
import { SYNTAX_TOKEN_MARKUP } from './syntax-highlight.js';
import { verifyDocument, verifyIr } from './verify.js';

/** Capabilities the page displays from a remote origin: `img-src` and `media-src`. */
const DISPLAY_CAPABILITIES: readonly MediaCapability[] = ['images', 'media'];

export interface RenderOptions {
  /** Theme preset name or typed theme input; defaults to the spec's theme. */
  theme?: unknown;
  /** Source label used in parse diagnostics. */
  source?: string;
  /** Emit the light/dark toggle. On by default: AgentKit HTML pages require it. */
  themeToggle?: boolean;
  /** Preset catalog. Defaults to built-ins only; pass a discovered catalog to
   * resolve project or user presets. */
  themeCatalog?: ThemeCatalog;
  /**
   * Diagram adapter. AgentKit's Engineer install supplies one backed by the
   * `ak:diagram` typed compiler; without it every diagram-panel emits the
   * structured semantic fallback.
   */
  diagramAdapter?: DiagramAdapter;
  /**
   * Blocks and features available to the spec. Defaults to the built-in
   * registry. Internal: tests pass one from `buildRegistry()`; it is not a
   * supported extension point.
   */
  registry?: BlockRegistry;
  /**
   * Resolves a model block's `src`. The CLI and the local MCP server pass one
   * built on `createModelResolver(baseDir)`, which inlines local GLB/glTF files.
   * Without it a remote model still loads under the `models` capability, but a
   * local one fails with a diagnostic: this module never touches the disk.
   */
  modelResolver?: ModelResolver;
  /**
   * Reads a `point-cloud-3d` block's `src` file. The CLI and the local MCP
   * server pass `createPointCloudResolver(baseDir)`; without it a `src` cloud
   * fails with a diagnostic, since this module never touches the disk.
   */
  pointCloudResolver?: PointCloudResolver;
}

/** Resolve one model reference at a JSON path; see `createModelResolver`. */
export type ModelResolver = (
  reference: string,
  path: string,
  policy: NetworkPolicy,
) => ModelAssetResult;

export interface CompileResult {
  html: string;
  /** Content hash of the emitted bytes; identical input yields an identical hash. */
  hash: string;
  /** UTF-8 size of `html`, which is what a file written from it occupies on disk. */
  bytes: number;
  ir: IrDocument;
  theme: ResolvedTheme;
  features: RuntimeFeature[];
  warnings: Diagnostic[];
}

/** Fixed feature order: emitted bytes must not depend on discovery order. */
const FEATURE_ORDER: readonly RuntimeFeature[] = [
  'tabs',
  'accordion',
  'carousel',
  'slider',
  'dialog',
  'filter',
  'copy',
  'syntax',
  'theme',
  'chart',
  'diagram',
  'diagram-viewer',
  'media',
  'outline',
  'frame',
  'bento',
  'marquee',
  'terminal',
  'tree',
  'before-after',
  'kpi',
  'checklist',
  'showcase',
  'cta',
  'state',
  'motion',
];

function collectFeatures(ir: IrDocument, includeTheme: boolean): Set<RuntimeFeature> {
  const features = new Set<RuntimeFeature>();
  for (const node of ir.nodes) {
    for (const feature of node.runtimeFeatures) features.add(feature);
  }
  if (includeTheme) features.add('theme');
  if (hasOutline(ir)) features.add('outline');
  // The browser frame is a style feature with no block of its own: the
  // showcase always draws one, and a hero draws one around its optional shot.
  const heroShot = ir.nodes.some(
    (node) => node.type === 'hero' && typeof node.props.src === 'string',
  );
  if (heroShot || features.has('showcase')) features.add('frame');
  return features;
}

/** Origins of the allowed remote assets, found through each block's `asset` props. */
function collectOrigins(
  ir: IrDocument,
  registry: BlockRegistry,
  capabilities: readonly MediaCapability[],
): string[] {
  return ir.nodes.flatMap((node) => {
    const definition = registry.byType.get(node.type);
    if (definition === undefined) return [];
    return assetOrigins(
      ir.policy.network,
      assetReferences(definition.props, node.props, node.path),
      capabilities,
    );
  });
}

function buildCss(
  features: ReadonlySet<RuntimeFeature>,
  moduleFeatures: readonly FeatureModule[],
  theme: ResolvedTheme,
  ir: IrDocument,
  usesIcons: boolean,
  motionUsed: ReadonlySet<string>,
): string {
  const sheets = [BASE_CSS];
  for (const feature of FEATURE_ORDER) {
    if (!features.has(feature)) continue;
    const sheet = FEATURE_CSS[feature];
    if (sheet !== undefined) sheets.push(sheet);
  }
  for (const feature of moduleFeatures) sheets.push(feature.css);
  if (usesIcons) sheets.push(ICON_CSS);
  // Recipes restyle feature surfaces, so they follow every feature sheet.
  const recipes = recipeCss(theme.recipes, features);
  if (recipes !== '') sheets.push(recipes);
  // Motion recipes are keyed on their own attribute and follow the feature
  // sheets they animate; the theme still overrides their duration.
  const motion = motionRecipeCss(motionUsed);
  if (motion !== '') sheets.push(motion);
  sheets.push(theme.css);
  // The night band redeclares colour tokens, so it must follow the theme sheet.
  if (usesInverseSurface(ir.nodes)) sheets.push(inverseSurfaceCss(theme));
  sheets.push(PRINT_STILL_CSS);
  // See `motion.ts` for what each effective motion state keeps.
  return applyMotionPolicy(sheets.join('\n'), motionPolicyOf(theme.motionPolicy));
}

/**
 * Recipe ids the page's blocks opt into. Diagram recipes animate a contract 2
 * drawing; without one on the page they have nothing to move and ship nothing.
 */
function usedMotionRecipes(ir: IrDocument, body: string): Set<string> {
  const used = new Set<string>();
  for (const node of ir.nodes) if (node.motion !== undefined) used.add(node.motion.preset);
  if (!body.includes(DIAGRAM_CANVAS_V2)) for (const id of DIAGRAM_MOTION_RECIPES) used.delete(id);
  return used;
}

/** True when a binding anywhere in a node, nested props included, runs `action`. */
function usesAction(value: unknown, action: string, inBindings = false): boolean {
  if (Array.isArray(value)) return value.some((item) => usesAction(item, action, inBindings));
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (inBindings && record.action === action) return true;
  return Object.entries(record).some(([key, child]) =>
    usesAction(child, action, inBindings || key === 'on'),
  );
}

/** The `theme` action needs the theme runtime even when the page has no toggle. */
function usesThemeAction(ir: IrDocument): boolean {
  return ir.nodes.some(
    (node) => usesAction(node.bindings, 'theme', true) || usesAction(node.props, 'theme'),
  );
}

function bodyNeedsRuntime(body: string): boolean {
  return body.includes('data-ak-on-') || body.includes('data-ak-dialog-open');
}

function nodeIndex(ir: IrDocument): Map<string, IrNode> {
  return new Map(ir.nodes.map((node) => [node.id, node]));
}

const OPENING_TAG = /^(\s*(?:<!--[\s\S]*?-->\s*)*<[a-zA-Z][\w-]*)([^>]*)>/u;

/**
 * Mark a block's outer element with the motion recipe it opts into. An
 * arrival recipe also joins the runtime's arrival observer through
 * `data-ak-animate`, which some blocks already carry.
 */
function withMotion(html: string, node: IrNode): string {
  if (node.motion === undefined) return html;
  const recipe = getMotionRecipe(node.motion.preset);
  if (recipe === undefined) return html;
  // A diagram recipe without a contract 2 drawing has nothing to move: the
  // block renders still and the compiler has already warned.
  if (
    (DIAGRAM_MOTION_RECIPES as readonly string[]).includes(recipe.id) &&
    !html.includes(DIAGRAM_CANVAS_V2)
  ) {
    return html;
  }
  return html.replace(OPENING_TAG, (_match, open: string, rest: string) => {
    const arrival =
      recipe.runtime === 'in-view' && !/\sdata-ak-animate[\s=>]|\sdata-ak-animate$/u.test(rest)
        ? ' data-ak-animate'
        : '';
    return `${open}${rest} data-ak-motion="${recipe.id}"${arrival}>`;
  });
}

/**
 * Render a node, wrapped when it carries `visibleWhen`. The wrapper starts
 * hidden exactly when the condition is false for the initial state, so the page
 * reads correctly without scripts; the runtime toggles it afterwards.
 */
function renderVisible(node: IrNode, context: RenderContext): string {
  const html = withMotion(renderNode(node, context), node);
  if (node.when === undefined) return html;
  const attributes = renderAttributes({
    class: 'ak-when',
    'data-ak-when': JSON.stringify(node.when),
    hidden: !evaluateCondition(node.when, context.ir.state),
  });
  return `<div${attributes}>${html}</div>`;
}

function renderBody(
  ir: IrDocument,
  theme: ResolvedTheme,
  features: Set<RuntimeFeature>,
  renderOptions: {
    registry: BlockRegistry;
    diagramAdapter?: DiagramAdapter;
    warnings: Diagnostic[];
    models: ReadonlyMap<string, ResolvedModelAsset>;
    pointClouds: ReadonlyMap<string, PointCloudColumns>;
  },
): { body: string; usesIcons: boolean } {
  const byId = nodeIndex(ir);
  const renderList = (ids: readonly string[]): string =>
    ids
      .map((childId) => byId.get(childId))
      .filter((child): child is IrNode => child !== undefined)
      .map((child) => `<!-- ak:${child.id} -->${renderVisible(child, context)}`)
      .join('\n');
  const icons: IconCollector = new Map();
  const context: RenderContext = {
    ir,
    theme,
    features,
    registry: renderOptions.registry,
    warnings: renderOptions.warnings,
    icons,
    ...(renderOptions.diagramAdapter === undefined
      ? {}
      : { diagramAdapter: renderOptions.diagramAdapter }),
    renderChildren: (node) => renderList(node.children),
    renderSlot: (node, key) => renderList(node.slots?.[key] ?? []),
    byId: (id) => byId.get(id),
    models: renderOptions.models,
    pointClouds: renderOptions.pointClouds,
  };
  const root = byId.get(ir.rootId);
  if (root === undefined) {
    throw new RenderError('INTERNAL_ERROR', 'normalized IR has no root node', { path: '$' });
  }
  // The root is rendered as a node, not as its children: the page renderer owns
  // the `<main>` landmark and the h1 fallback.
  const page = renderNode(root, context);
  return { body: `${page}${renderIconSprite(icons)}`, usesIcons: icons.size > 0 };
}

/** The prop every model block names its source with. */
const MODEL_SOURCE = 'src';

/**
 * Resolve every model block's source before rendering. A remote model without
 * a resolver passes through: validation already gated it on the `models`
 * capability. A local one needs the resolver, which only Node callers have.
 */
function resolveModels(
  ir: IrDocument,
  registry: BlockRegistry,
  resolver: ModelResolver | undefined,
): Map<string, ResolvedModelAsset> {
  const models = new Map<string, ResolvedModelAsset>();
  const errors: Diagnostic[] = [];
  for (const node of ir.nodes) {
    const definition = registry.byType.get(node.type);
    if (definition?.props[MODEL_SOURCE]?.kind !== 'url') continue;
    if ((definition.props[MODEL_SOURCE] as { asset?: string }).asset !== 'models') continue;
    const reference = node.props[MODEL_SOURCE];
    if (typeof reference !== 'string') continue;
    const path = pathKey(node.path, MODEL_SOURCE);
    if (resolver === undefined) {
      if (isRemote(reference))
        models.set(node.id, { kind: 'remote', uri: reference, connectOrigins: [] });
      else
        errors.push({
          code: 'SPEC_VALIDATION_ERROR',
          severity: 'error',
          path,
          nodeId: node.id,
          message: `local model "${reference}" needs a compile from a spec file, which can read it`,
          details: {
            fix: 'compile the spec file with the CLI or the local MCP server, or use a remote URL under the models capability',
          },
        });
      continue;
    }
    const result = resolver(reference, path, ir.policy.network);
    for (const diagnostic of result.diagnostics)
      if (diagnostic.severity === 'error') errors.push({ ...diagnostic, nodeId: node.id });
    if (result.asset !== undefined) models.set(node.id, result.asset);
  }
  const first = errors[0];
  if (first !== undefined) {
    throw new RenderError(first.code, first.message, {
      path: first.path,
      ...(first.nodeId === undefined ? {} : { nodeId: first.nodeId }),
      details: { ...(first.details ?? {}), diagnostics: errors },
    });
  }
  return models;
}

/** Read every `point-cloud-3d` block's `src` file; warnings go to the compile result. */
function resolvePointClouds(
  ir: IrDocument,
  resolver: PointCloudResolver | undefined,
  warnings: Diagnostic[],
): Map<string, PointCloudColumns> {
  const clouds = new Map<string, PointCloudColumns>();
  const errors: Diagnostic[] = [];
  for (const node of ir.nodes) {
    if (node.type !== 'point-cloud-3d' || typeof node.props.src !== 'string') continue;
    const path = pathKey(node.path, 'src');
    if (resolver === undefined) {
      errors.push({
        code: 'SPEC_VALIDATION_ERROR',
        severity: 'error',
        path,
        nodeId: node.id,
        message: `point cloud "${node.props.src}" needs a compile from a spec file, which can read it`,
        details: {
          fix: 'compile the spec file with the CLI or the local MCP server, or put the points in data columns',
        },
      });
      continue;
    }
    const result = resolver(node.props.src, path);
    for (const diagnostic of result.diagnostics)
      (diagnostic.severity === 'error' ? errors : warnings).push({
        ...diagnostic,
        nodeId: node.id,
      });
    if (result.cloud !== undefined) clouds.set(node.id, result.cloud);
  }
  const first = errors[0];
  if (first !== undefined) {
    throw new RenderError(first.code, first.message, {
      path: first.path,
      ...(first.nodeId === undefined ? {} : { nodeId: first.nodeId }),
      details: { ...(first.details ?? {}), diagnostics: errors },
    });
  }
  return clouds;
}

/** Run the full pipeline and return everything it produced. */
export function compile(spec: unknown, options: RenderOptions = {}): CompileResult {
  const registry = options.registry ?? DEFAULT_REGISTRY;
  const normalized: NormalizeResult = normalizeSpec(spec, {
    registry,
    ...(options.source === undefined ? {} : { source: options.source }),
  });
  const errors = normalized.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  const firstError = errors[0];
  if (firstError !== undefined) {
    throw new RenderError(firstError.code, firstError.message, {
      path: firstError.path,
      ...(firstError.nodeId === undefined ? {} : { nodeId: firstError.nodeId }),
      details: { ...(firstError.details ?? {}), diagnostics: errors },
    });
  }

  const ir = normalized.ir;
  const themeBag = new DiagnosticBag();
  const resolved = resolveTheme(
    options.theme ?? ir.theme,
    themeBag,
    options.themeCatalog ?? builtinThemeCatalog(),
  );
  const themeErrors = themeBag.errors();
  const firstThemeError = themeErrors[0];
  if (resolved === undefined || firstThemeError !== undefined) {
    if (firstThemeError === undefined) {
      throw new RenderError('INTERNAL_ERROR', 'theme resolution failed without a diagnostic');
    }
    throw new RenderError(firstThemeError.code, firstThemeError.message, {
      path: firstThemeError.path,
      details: { ...(firstThemeError.details ?? {}), diagnostics: themeErrors },
    });
  }

  const includeThemeToggle = options.themeToggle !== false;
  const features = collectFeatures(ir, includeThemeToggle);
  const moduleFeatures = registry.features.filter((feature) => features.has(feature.name));

  const irDiagnostics = verifyIr(ir, features);
  if (irDiagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    throw new RenderError('INTERNAL_ERROR', 'IR verification failed', {
      path: '$',
      details: { diagnostics: irDiagnostics },
    });
  }

  const models = resolveModels(ir, registry, options.modelResolver);
  const renderWarnings: Diagnostic[] = [];
  const pointClouds = resolvePointClouds(ir, options.pointCloudResolver, renderWarnings);
  const { body, usesIcons } = renderBody(ir, resolved, features, {
    registry,
    warnings: renderWarnings,
    models,
    pointClouds,
    ...(options.diagramAdapter === undefined ? {} : { diagramAdapter: options.diagramAdapter }),
  });
  // Code panels live in several blocks and nested props, and only some
  // languages are highlighted, so the emitted tokens decide this sheet.
  if (body.includes(SYNTAX_TOKEN_MARKUP)) features.add('syntax');
  // Only a contract 2 drawing with declared capabilities gets viewer controls.
  if (body.includes(DIAGRAM_VIEWER_MARKUP)) features.add('diagram-viewer');
  // Faces come first and need the rendered text, which decides their subsets.
  const motionUsed = usedMotionRecipes(ir, body);
  // Only diagram recipes with no drawing to move: nothing of motion ships.
  if (motionUsed.size === 0) features.delete('motion');
  const fonts = embeddedFontCss(resolved, `${ir.meta.title}\n${body}`);
  const css = [fonts, buildCss(features, moduleFeatures, resolved, ir, usesIcons, motionUsed)]
    .filter((sheet) => sheet !== '')
    .join('\n');
  const runtimeNeeded = features.size > 0 || bodyNeedsRuntime(body);
  const js = runtimeNeeded
    ? buildRuntime({
        features,
        state: ir.state,
        hasBindings: bodyNeedsRuntime(body),
        moduleFeatures,
        motion: motionUsed,
        themeAction: usesThemeAction(ir),
      })
    : '';

  const assembled = assembleDocument({
    ir,
    compilerVersion: ir.compilerVersion,
    css,
    js,
    body,
    allowedOrigins: collectOrigins(ir, registry, DISPLAY_CAPABILITIES),
    connectOrigins: [
      ...collectOrigins(ir, registry, CONNECT_CAPABILITIES),
      ...[...models.values()].flatMap((model) => model.connectOrigins),
    ],
    modelLoader: models.size > 0,
    themeToggle: includeThemeToggle,
    density: resolved.density,
    motion: motionPolicyOf(resolved.motionPolicy),
    recipes: resolved.recipes,
    outline: renderOutline(ir),
    // Declared by the blocks themselves: the theme toggle alone announces nothing.
    liveRegion: needsLiveRegion(
      new Set(ir.nodes.flatMap((node) => node.runtimeFeatures)),
      moduleFeatures,
    ),
  });

  const verification = verifyDocument({
    html: assembled.html,
    ir,
    csp: assembled.csp,
    styleNonce: assembled.styleNonce,
    scriptNonce: assembled.scriptNonce,
    features,
    css,
    js,
    moduleFeatures,
  });
  const verificationErrors = verification.filter((diagnostic) => diagnostic.severity === 'error');
  if (verificationErrors.length > 0) {
    throw new RenderError('INTERNAL_ERROR', 'emitted document failed verification', {
      path: '$',
      details: { diagnostics: verificationErrors },
    });
  }

  return {
    html: assembled.html,
    hash: stableHash(assembled.html),
    bytes: new TextEncoder().encode(assembled.html).byteLength,
    ir,
    theme: resolved,
    features: [
      ...FEATURE_ORDER.filter((feature) => features.has(feature)),
      ...moduleFeatures.map((feature) => feature.name),
    ],
    warnings: [
      ...normalized.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning'),
      ...themeBag.warnings(),
      ...renderWarnings,
    ],
  };
}

/** Compile a spec to a standalone HTML artifact. */
export function render(spec: unknown, options: RenderOptions = {}): string {
  return compile(spec, options).html;
}

/** True when the emitted document needs the interaction runtime. */
export function documentNeedsRuntime(result: CompileResult): boolean {
  return result.html.includes('<script nonce=');
}

export { loadTheme, needsLiveRegion };
