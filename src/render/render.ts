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

import { type Diagnostic, DiagnosticBag } from '../diagnostics.js';
import type { DiagramAdapter } from '../diagram/adapter.js';
import { RenderError } from '../errors.js';
import { stableHash } from '../hash.js';
import type { IrDocument, IrNode } from '../ir.js';
import type { BlockRegistry, FeatureModule } from '../registry/block-module.js';
import { DEFAULT_REGISTRY } from '../registry/registry.js';
import type { RuntimeFeature } from '../registry/roster.js';
import { assetOrigins, assetReferences } from '../spec/asset-references.js';
import { evaluateCondition } from '../spec/conditions.js';
import { type NormalizeResult, normalizeSpec } from '../spec/normalize.js';
import { loadTheme, type ResolvedTheme, resolveTheme } from '../theme/load-theme.js';
import { builtinThemeCatalog, type ThemeCatalog } from '../theme/theme-catalog.js';
import { type RenderContext, renderNode } from './blocks.js';
import { assembleDocument } from './document.js';
import { renderAttributes } from './escape.js';
import { embeddedFontCss } from './font-faces.js';
import { hasOutline, renderOutline } from './outline.js';
import { recipeCss } from './recipe-styles.js';
import { buildRuntime, needsLiveRegion } from './runtime.js';
import { BASE_CSS, FEATURE_CSS } from './styles.js';
import { inverseSurfaceCss, usesInverseSurface } from './surface-styles.js';
import { verifyDocument, verifyIr } from './verify.js';

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
}

export interface CompileResult {
  html: string;
  /** Content hash of the emitted bytes; identical input yields an identical hash. */
  hash: string;
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
  'theme',
  'chart',
  'diagram',
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
function collectOrigins(ir: IrDocument, registry: BlockRegistry): string[] {
  return ir.nodes.flatMap((node) => {
    const definition = registry.byType.get(node.type);
    if (definition === undefined) return [];
    return assetOrigins(
      ir.policy.network,
      assetReferences(definition.props, node.props, node.path),
    );
  });
}

function buildCss(
  features: ReadonlySet<RuntimeFeature>,
  moduleFeatures: readonly FeatureModule[],
  theme: ResolvedTheme,
  ir: IrDocument,
): string {
  const sheets = [BASE_CSS];
  for (const feature of FEATURE_ORDER) {
    if (!features.has(feature)) continue;
    const sheet = FEATURE_CSS[feature];
    if (sheet !== undefined) sheets.push(sheet);
  }
  for (const feature of moduleFeatures) sheets.push(feature.css);
  // Recipes restyle feature surfaces, so they follow every feature sheet.
  const recipes = recipeCss(theme.recipes, features);
  if (recipes !== '') sheets.push(recipes);
  sheets.push(theme.css);
  // The night band redeclares colour tokens, so it must follow the theme sheet.
  if (usesInverseSurface(ir.nodes)) sheets.push(inverseSurfaceCss(theme));
  const css = sheets.join('\n');
  return theme.motionPolicy === 'none' ? withoutMotion(css) : css;
}

/**
 * Every animation in the emitted CSS sits behind
 * `(prefers-reduced-motion:no-preference)`. A theme that disables motion turns
 * that condition into one that never matches, so the page renders exactly as it
 * does for a reader who asked the system to reduce motion.
 */
const MOTION_ALLOWED = '(prefers-reduced-motion:no-preference)';
function withoutMotion(css: string): string {
  return css.replaceAll(MOTION_ALLOWED, `${MOTION_ALLOWED} and (prefers-reduced-motion:reduce)`);
}

function bodyNeedsRuntime(body: string): boolean {
  return body.includes('data-ak-on-') || body.includes('data-ak-dialog-open');
}

function nodeIndex(ir: IrDocument): Map<string, IrNode> {
  return new Map(ir.nodes.map((node) => [node.id, node]));
}

/**
 * Render a node, wrapped when it carries `visibleWhen`. The wrapper starts
 * hidden exactly when the condition is false for the initial state, so the page
 * reads correctly without scripts; the runtime toggles it afterwards.
 */
function renderVisible(node: IrNode, context: RenderContext): string {
  const html = renderNode(node, context);
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
  },
): string {
  const byId = nodeIndex(ir);
  const renderList = (ids: readonly string[]): string =>
    ids
      .map((childId) => byId.get(childId))
      .filter((child): child is IrNode => child !== undefined)
      .map((child) => `<!-- ak:${child.id} -->${renderVisible(child, context)}`)
      .join('\n');
  const context: RenderContext = {
    ir,
    theme,
    features,
    registry: renderOptions.registry,
    warnings: renderOptions.warnings,
    ...(renderOptions.diagramAdapter === undefined
      ? {}
      : { diagramAdapter: renderOptions.diagramAdapter }),
    renderChildren: (node) => renderList(node.children),
    renderSlot: (node, key) => renderList(node.slots?.[key] ?? []),
    byId: (id) => byId.get(id),
  };
  const root = byId.get(ir.rootId);
  if (root === undefined) {
    throw new RenderError('INTERNAL_ERROR', 'normalized IR has no root node', { path: '$' });
  }
  // The root is rendered as a node, not as its children: the page renderer owns
  // the `<main>` landmark and the h1 fallback.
  return renderNode(root, context);
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

  const renderWarnings: Diagnostic[] = [];
  const body = renderBody(ir, resolved, features, {
    registry,
    warnings: renderWarnings,
    ...(options.diagramAdapter === undefined ? {} : { diagramAdapter: options.diagramAdapter }),
  });
  // Faces come first and need the rendered text, which decides their subsets.
  const fonts = embeddedFontCss(resolved, `${ir.meta.title}\n${body}`);
  const css = [fonts, buildCss(features, moduleFeatures, resolved, ir)]
    .filter((sheet) => sheet !== '')
    .join('\n');
  const runtimeNeeded = features.size > 0 || bodyNeedsRuntime(body);
  const js = runtimeNeeded
    ? buildRuntime({
        features,
        state: ir.state,
        hasBindings: bodyNeedsRuntime(body),
        moduleFeatures,
      })
    : '';

  const assembled = assembleDocument({
    ir,
    compilerVersion: ir.compilerVersion,
    css,
    js,
    body,
    allowedOrigins: collectOrigins(ir, registry),
    themeToggle: includeThemeToggle,
    density: resolved.density,
    motionDisabled: resolved.motionPolicy === 'none',
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
    bytes: assembled.html.length,
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
