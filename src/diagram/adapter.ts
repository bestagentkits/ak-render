/**
 * The diagram adapter boundary.
 *
 * AK Render does not implement diagram layout. A host that owns a typed diagram
 * compiler — AgentKit's Engineer installs provide `ak:diagram` — registers an
 * adapter, and the compiler embeds that adapter's output inside the
 * `diagram-panel` block. Everything else keeps the structured semantic fallback.
 *
 * The boundary is deliberately narrow:
 *
 * - The adapter receives the bounded, structurally-opaque diagram spec from the
 *   Page Spec plus its title. It never receives the page, the theme, or the
 *   surrounding markup, so it cannot influence anything outside its own figure.
 * - Whatever the adapter returns is re-checked here. Output that could execute,
 *   navigate, or frame is rejected and the semantic fallback is emitted instead,
 *   with a diagnostic. An adapter is trusted code, but "trusted" still means
 *   "verified before it reaches the artifact".
 * - The fallback text is always emitted, so the diagram's content is available
 *   to assistive technology and to a reader whose adapter is not installed.
 * - Accepted markup is fitted to the page's Content Security Policy: its
 *   `<style>` elements are marked to receive the page style nonce, and inline
 *   `style` attributes, which that policy refuses, are removed and reported.
 * - Adapter stylesheets are filtered so they cannot load anything, and scoped
 *   to the diagram's own canvas so they cannot restyle the page.
 */

import { stableHash } from '../hash.js';
import type { JsonValue } from '../json.js';
import { ADAPTER_STYLE_MARKER, fitAdapterMarkup } from './adapter-markup-fit.js';
import { ADAPTER_SCOPE_ATTRIBUTE } from './adapter-stylesheet-filter.js';

export interface DiagramRenderRequest {
  /** The diagram spec exactly as authored, bounded by the Page Spec limits. */
  readonly spec: JsonValue;
  /** Title from the diagram spec meta or the block, when either declares one. */
  readonly title: string;
  /** Stable node id of the owning block, usable for adapter-side cache keys. */
  readonly nodeId: string;
  /** Version of the adapter contract this request was built against. */
  readonly contractVersion: 1;
}

export interface DiagramAdapter {
  /** Stable adapter name, reported in diagnostics. */
  readonly name: string;
  /** Adapter version, reported in diagnostics. */
  readonly version: string;
  /**
   * Return trusted markup (an SVG fragment) for the request, or `undefined` to
   * fall back. Throwing is treated exactly like returning `undefined`: a broken
   * adapter degrades the page instead of failing the compile.
   */
  render(request: DiagramRenderRequest): string | undefined;
}

export interface DiagramAdapterResult {
  readonly markup: string;
  readonly adapter: string;
  /** Set when the adapter produced output that the trust boundary rejected. */
  readonly rejected?: string;
  /**
   * Number of inline `style` attributes removed from accepted markup. The page
   * policy would refuse them anyway; the count lets the compiler say so.
   */
  readonly removedInlineStyles?: number;
  /**
   * Token the accepted markup's stylesheets are scoped to. The embedding page
   * wraps the markup in an element with the class `ak-diagram-canvas` and a
   * `data-ak-diagram-scope` attribute set to this token.
   */
  readonly scope?: string;
}

export const DIAGRAM_ADAPTER_CONTRACT_VERSION = 1 as const;

/** Bound on adapter output, so a runaway adapter cannot inflate the artifact. */
export const MAX_DIAGRAM_MARKUP_BYTES = 256 * 1024;

export { ADAPTER_STYLE_MARKER } from './adapter-markup-fit.js';

/**
 * Vectors that must never appear in adapter output.
 *
 * This is the same posture the page itself takes: no script, no frame, no
 * plugin, no inline handler, no navigable scheme, and no SVG escape hatch back
 * into HTML.
 */
const FORBIDDEN_ADAPTER_PATTERNS: readonly { pattern: RegExp; reason: string }[] = [
  { pattern: /<script/iu, reason: 'script element' },
  { pattern: /<iframe/iu, reason: 'iframe element' },
  { pattern: /<object/iu, reason: 'object element' },
  { pattern: /<embed/iu, reason: 'embed element' },
  { pattern: /<foreignObject/iu, reason: 'foreignObject element' },
  { pattern: /<base/iu, reason: 'base element' },
  { pattern: /<form/iu, reason: 'form element' },
  { pattern: /\bsrcdoc\s*=/iu, reason: 'srcdoc attribute' },
  { pattern: /\son[a-z]+\s*=/iu, reason: 'inline event handler' },
  { pattern: /javascript\s*:/iu, reason: 'javascript: URL' },
  { pattern: /\bdata\s*:\s*text\/html/iu, reason: 'data: text/html URL' },
  // Adapter `<style>` elements are live on the page, so they must not pull in
  // another stylesheet or reach the network from CSS.
  { pattern: /@import/iu, reason: 'CSS @import' },
  { pattern: /url\(\s*['"]?\s*(?:[a-z][a-z0-9+.-]*:)?\/\//iu, reason: 'remote CSS url()' },
  // The page owns its style nonce and the attributes it uses to place and scope
  // adapter styles. Markup that writes any of them could forge or misplace one.
  { pattern: /nonce[\t\n\f\r ]*=/iu, reason: 'nonce attribute' },
  { pattern: new RegExp(ADAPTER_STYLE_MARKER, 'iu'), reason: 'reserved page attribute' },
  { pattern: new RegExp(ADAPTER_SCOPE_ATTRIBUTE, 'iu'), reason: 'reserved page attribute' },
];

export interface AdapterMarkupCheck {
  readonly ok: boolean;
  readonly reason?: string;
}

/**
 * Verify adapter output before it is embedded.
 *
 * Exported so a host can assert the same contract in its own adapter tests, and
 * so the check has one implementation rather than one per call site.
 */
export function checkAdapterMarkup(markup: string): AdapterMarkupCheck {
  if (typeof markup !== 'string' || markup.trim() === '') {
    return { ok: false, reason: 'empty output' };
  }
  if (markup.length > MAX_DIAGRAM_MARKUP_BYTES) {
    return { ok: false, reason: `output exceeds ${MAX_DIAGRAM_MARKUP_BYTES} bytes` };
  }
  for (const { pattern, reason } of FORBIDDEN_ADAPTER_PATTERNS) {
    if (pattern.test(markup)) return { ok: false, reason };
  }
  const fitted = fitAdapterMarkup(markup, CHECK_SCOPE);
  return fitted.ok ? { ok: true } : { ok: false, reason: fitted.reason };
}

/**
 * Token naming the canvas an adapter's styles are scoped to.
 *
 * Node ids are already a safe token; anything else (a host calling
 * `runDiagramAdapter` directly) is hashed into one, so it never needs escaping.
 */
function adapterScope(nodeId: string): string {
  return /^[A-Za-z0-9_-]{1,64}$/u.test(nodeId) ? nodeId : `s${stableHash(nodeId)}`;
}

/** Placeholder scope used when markup is only being checked. */
const CHECK_SCOPE = 'check';

/**
 * Run an adapter and return markup that has passed the trust boundary.
 *
 * A `rejected` reason means the adapter answered but its answer was refused; the
 * caller emits the semantic fallback and records a warning either way.
 */
export function runDiagramAdapter(
  adapter: DiagramAdapter | undefined,
  request: Omit<DiagramRenderRequest, 'contractVersion'>,
): DiagramAdapterResult | undefined {
  if (adapter === undefined) return undefined;
  let markup: string | undefined;
  try {
    markup = adapter.render({ ...request, contractVersion: DIAGRAM_ADAPTER_CONTRACT_VERSION });
  } catch {
    return { markup: '', adapter: adapter.name, rejected: 'adapter threw' };
  }
  if (markup === undefined) return undefined;
  const check = checkAdapterMarkup(markup);
  if (!check.ok) {
    return { markup: '', adapter: adapter.name, rejected: check.reason ?? 'rejected' };
  }
  const scope = adapterScope(request.nodeId);
  const fitted = fitAdapterMarkup(markup, scope);
  if (!fitted.ok) return { markup: '', adapter: adapter.name, rejected: fitted.reason };
  return {
    markup: fitted.markup,
    adapter: adapter.name,
    scope,
    ...(fitted.removedInlineStyles === 0
      ? {}
      : { removedInlineStyles: fitted.removedInlineStyles }),
  };
}
