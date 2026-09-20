/**
 * Post-render verification.
 *
 * The compiler checks its own output before releasing it. These are invariants
 * that must hold for every emitted artifact regardless of the spec, so a
 * regression in a renderer fails the compile instead of shipping a page with a
 * missing main landmark or an inline handler.
 */

import { type Diagnostic, DiagnosticBag } from '../diagnostics.js';
import type { IrDocument } from '../ir.js';
import type { RuntimeFeature } from '../registry/roster.js';

export interface VerifyInput {
  html: string;
  ir: IrDocument;
  csp: string;
  styleNonce: string;
  scriptNonce: string;
  features: ReadonlySet<RuntimeFeature>;
  css: string;
  js: string;
}

/**
 * A stable substring that must appear in the emitted CSS exactly when the
 * feature is used. The bidirectional check below is what proves feature CSS is
 * tree-shaken rather than merely present.
 */
const FEATURE_MARKERS: Readonly<Partial<Record<RuntimeFeature, string>>> = {
  tabs: '.ak-tabs',
  accordion: '.ak-accordion',
  carousel: '.ak-carousel',
  slider: '.ak-slider',
  dialog: 'dialog.ak-dialog',
  filter: '.ak-search',
  theme: '.ak-theme-toggle',
  chart: '.ak-chart',
  diagram: '.ak-diagram',
  media: '.ak-media-fallback',
};

/** Features whose behavior requires emitted JavaScript. */
const SCRIPTED_FEATURES: readonly RuntimeFeature[] = [
  'tabs',
  'carousel',
  'slider',
  'filter',
  'theme',
  'dialog',
];

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

const INLINE_HANDLER = /<[^>]+\son[a-z]+\s*=/iu;
const REMOTE_SOURCE = /\ssrc\s*=\s*["']?https?:/iu;
const STYLESHEET_LINK = /<link[^>]+rel=["']?stylesheet/iu;
const CSS_IMPORT = /@import/iu;
const TH_WITHOUT_SCOPE = /<th(?=[\s>])(?![^>]*scope=)[^>]*>/iu;

/**
 * Remove element bodies whose contents are not markup.
 *
 * The runtime is emitted into a `script` element, and its JavaScript legitimately
 * contains text such as `if (open = ...)`; scanning it as markup produced a
 * false "inline handler" report. Attribute-level checks must only ever look at
 * the markup.
 */
function markupOnly(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, '<script></script>')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, '<style></style>');
}

export function verifyDocument(input: VerifyInput): Diagnostic[] {
  const bag = new DiagnosticBag();
  const { html } = input;
  const markup = markupOnly(html);
  const report = (
    message: string,
    code: 'SPEC_VALIDATION_ERROR' | 'INTERNAL_ERROR' | 'POLICY_VIOLATION' = 'INTERNAL_ERROR',
  ): void => {
    bag.add({ code, message, path: '$' });
  };

  if (countMatches(html, /<h1[\s>]/giu) !== 1) {
    report(`expected exactly one <h1>, found ${countMatches(html, /<h1[\s>]/giu)}`);
  }
  if (!/<main[\s>]/iu.test(html)) report('missing a <main> landmark');
  if (!/<html[^>]+lang="/iu.test(html)) report('missing a language attribute on <html>');
  if (!/<a class="ak-skip"/iu.test(html)) report('missing a skip link');

  if (!/default-src 'none'/u.test(input.csp)) report("CSP must start from default-src 'none'");
  if (/unsafe-inline|unsafe-eval/iu.test(input.csp)) {
    report('CSP must not permit unsafe-inline or unsafe-eval', 'POLICY_VIOLATION');
  }
  if (!input.csp.includes(`'nonce-${input.styleNonce}'`))
    report('CSP style nonce does not match the emitted style element');
  if (input.js === '') {
    if (!input.csp.includes("script-src 'none'")) {
      report("expected script-src 'none' when no script is emitted");
    }
  } else if (!input.csp.includes(`script-src 'nonce-${input.scriptNonce}'`)) {
    report('CSP script nonce does not match the emitted script element');
  }

  if (INLINE_HANDLER.test(markup)) {
    report('emitted inline event handler attribute', 'POLICY_VIOLATION');
  }
  if (STYLESHEET_LINK.test(markup)) report('emitted a remote stylesheet link', 'POLICY_VIOLATION');
  if (CSS_IMPORT.test(markup)) report('emitted an @import rule', 'POLICY_VIOLATION');
  if (/<script[^>]+src=/iu.test(markup)) report('emitted an external script', 'POLICY_VIOLATION');
  if (/<iframe/iu.test(markup)) report('emitted an iframe', 'POLICY_VIOLATION');

  if (input.ir.policy.network === 'deny' && REMOTE_SOURCE.test(markup)) {
    report(
      'emitted a remote resource reference while the network policy denies access',
      'POLICY_VIOLATION',
    );
  }

  const images = markup.match(/<img\b[^>]*>/giu) ?? [];
  for (const image of images) {
    if (!/\salt="/iu.test(image)) report('an <img> element is missing alt text');
  }

  const ids = [...markup.matchAll(/data-ak-id="([^"]+)"/gu)].map((match) => match[1] ?? '');
  if (new Set(ids).size !== ids.length) {
    report('duplicate data-ak-id values: a target would resolve ambiguously');
  }

  const tables = markup.match(/<table\b[^>]*>/giu) ?? [];
  if (tables.length !== countMatches(markup, /<thead>/giu)) {
    report('every table must have a header row');
  }
  if (TH_WITHOUT_SCOPE.test(markup)) report('a <th> element is missing a scope attribute');

  const buttons = markup.match(/<button\b[^>]*>/giu) ?? [];
  for (const button of buttons) {
    if (!/\stype="/iu.test(button)) report('a <button> element is missing an explicit type');
  }

  if (!/:focus-visible/u.test(html)) report('missing a :focus-visible rule');
  if (!/prefers-reduced-motion/u.test(html)) report('missing a prefers-reduced-motion rule');

  for (const [feature, marker] of Object.entries(FEATURE_MARKERS) as [RuntimeFeature, string][]) {
    const used = input.features.has(feature);
    const emitted = input.css.includes(marker);
    if (used && !emitted) report(`feature "${feature}" is used but its stylesheet was not emitted`);
    if (!used && emitted) {
      report(
        `feature "${feature}" is not used but its stylesheet was emitted (tree-shaking regression)`,
      );
    }
    const scripted = SCRIPTED_FEATURES.includes(feature);
    if (used && scripted && input.js === '') {
      report(`feature "${feature}" requires runtime behavior but no script was emitted`);
    }
  }

  return bag.list();
}

/** Verify the IR itself before rendering, catching compiler-side inconsistencies. */
export function verifyIr(ir: IrDocument, features: ReadonlySet<RuntimeFeature>): Diagnostic[] {
  const bag = new DiagnosticBag();
  const ids = new Set<string>();
  for (const node of ir.nodes) {
    if (ids.has(node.id)) {
      bag.add({
        code: 'INTERNAL_ERROR',
        path: node.path,
        nodeId: node.id,
        message: `duplicate node id "${node.id}"`,
      });
    }
    ids.add(node.id);
    for (const feature of node.runtimeFeatures) {
      if (!features.has(feature)) {
        bag.add({
          code: 'INTERNAL_ERROR',
          path: node.path,
          nodeId: node.id,
          message: `runtime feature "${feature}" was not collected`,
        });
      }
    }
  }
  return bag.list();
}
