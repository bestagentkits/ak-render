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
import { RenderError } from '../errors.js';
import { stableHash } from '../hash.js';
import type { IrDocument, IrNode } from '../ir.js';
import { isPlainObject } from '../json.js';
import type { RuntimeFeature } from '../registry/roster.js';
import { type NormalizeResult, normalizeSpec } from '../spec/normalize.js';
import { loadTheme, type ResolvedTheme, resolveTheme } from '../theme/load-theme.js';
import { type RenderContext, renderNode } from './blocks.js';
import { assembleDocument } from './document.js';
import { buildRuntime, needsLiveRegion } from './runtime.js';
import { BASE_CSS, FEATURE_CSS } from './styles.js';
import { verifyDocument, verifyIr } from './verify.js';

export interface RenderOptions {
  /** Theme preset name or typed theme input; defaults to the spec's theme. */
  theme?: unknown;
  /** Source label used in parse diagnostics. */
  source?: string;
  /** Emit the light/dark toggle. On by default: AgentKit HTML pages require it. */
  themeToggle?: boolean;
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
];

function collectFeatures(ir: IrDocument, includeTheme: boolean): Set<RuntimeFeature> {
  const features = new Set<RuntimeFeature>();
  for (const node of ir.nodes) {
    for (const feature of node.runtimeFeatures) features.add(feature);
  }
  if (includeTheme) features.add('theme');
  return features;
}

function collectOrigins(ir: IrDocument): string[] {
  const policy = ir.policy.network;
  if (policy === 'deny') return [];
  const origins: string[] = [];
  const add = (reference: string, capability: string): void => {
    if (policy.allow.includes(capability) && /^https?:/iu.test(reference)) {
      try {
        origins.push(new URL(reference).origin);
      } catch {
        // A reference that is not a URL is handled by the block renderer, not here.
      }
    }
  };

  for (const node of ir.nodes) {
    const capability = node.type === 'image' || node.type === 'gallery' ? 'images' : 'media';
    const src = node.props.src;
    if (typeof src === 'string') add(src, capability);
    const items = node.props.items;
    if (Array.isArray(items)) {
      for (const item of items) {
        if (isPlainObject(item) && typeof item.src === 'string') add(item.src, capability);
      }
    }
  }
  return origins;
}

function buildCss(features: ReadonlySet<RuntimeFeature>, theme: ResolvedTheme): string {
  const sheets = [BASE_CSS];
  for (const feature of FEATURE_ORDER) {
    if (!features.has(feature)) continue;
    const sheet = FEATURE_CSS[feature];
    if (sheet !== undefined) sheets.push(sheet);
  }
  sheets.push(theme.css);
  return sheets.join('\n');
}

function bodyNeedsRuntime(body: string): boolean {
  return body.includes('data-ak-on-') || body.includes('data-ak-dialog-open');
}

function nodeIndex(ir: IrDocument): Map<string, IrNode> {
  return new Map(ir.nodes.map((node) => [node.id, node]));
}

function renderBody(ir: IrDocument, theme: ResolvedTheme, features: Set<RuntimeFeature>): string {
  const byId = nodeIndex(ir);
  const context: RenderContext = {
    ir,
    theme,
    features,
    renderChildren: (node) =>
      node.children
        .map((childId) => byId.get(childId))
        .filter((child): child is IrNode => child !== undefined)
        .map((child) => `<!-- ak:${child.id} -->${renderNode(child, context)}`)
        .join('\n'),
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
  const normalized: NormalizeResult = normalizeSpec(spec, {
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
  const resolved = resolveTheme(options.theme ?? ir.theme, themeBag);
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
  const css = buildCss(features, resolved);

  const irDiagnostics = verifyIr(ir, features);
  if (irDiagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    throw new RenderError('INTERNAL_ERROR', 'IR verification failed', {
      path: '$',
      details: { diagnostics: irDiagnostics },
    });
  }

  const body = renderBody(ir, resolved, features);
  const runtimeNeeded = features.size > 0 || bodyNeedsRuntime(body);
  const js = runtimeNeeded
    ? buildRuntime({ features, state: ir.state, hasBindings: bodyNeedsRuntime(body) })
    : '';

  const assembled = assembleDocument({
    ir,
    compilerVersion: ir.compilerVersion,
    css,
    js,
    body,
    allowedOrigins: collectOrigins(ir),
    themeToggle: includeThemeToggle,
    density: resolved.density,
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
    features: FEATURE_ORDER.filter((feature) => features.has(feature)),
    warnings: normalized.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning'),
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
