/**
 * Document assembly.
 *
 * The emitted artifact is a single file that must be self-defending: it is
 * opened from `file://`, so it cannot rely on response headers. The Content
 * Security Policy is therefore embedded, derived from the page's own network
 * policy, and the inline style and script elements carry deterministic nonces
 * so the policy can name exactly what is allowed instead of falling back to
 * `'unsafe-inline'`.
 *
 * Nonces are derived from a content hash, not from randomness: a random nonce
 * would break byte-determinism, and a nonce does not need to be unpredictable
 * to be useful here (it only has to distinguish the compiler's own elements).
 */

import { ADAPTER_STYLE_MARKER } from '../diagram/adapter.js';
import { stableHash } from '../hash.js';
import type { IrDocument, NetworkPolicy } from '../ir.js';
import { escapeAttribute, escapeText } from './escape.js';
import { needsLiveRegion } from './runtime.js';

export interface DocumentInput {
  ir: IrDocument;
  compilerVersion: string;
  css: string;
  js: string;
  body: string;
  /** Extra origins a permitted capability needs in the policy, deduplicated. */
  allowedOrigins: string[];
  themeToggle: boolean;
  /** Resolved theme density, emitted as a document-level attribute. */
  density: string;
  /** The theme turned motion off; the runtime reads this from the root element. */
  motionDisabled?: boolean;
  /** Rendered page outline; omitted or empty when the page has none. */
  outline?: string;
}

export interface AssembledDocument {
  html: string;
  csp: string;
  styleNonce: string;
  scriptNonce: string;
}

function directives(
  policy: NetworkPolicy,
  input: DocumentInput,
  styleNonce: string,
  scriptNonce: string,
): string {
  const origins = [...new Set(input.allowedOrigins)].sort();
  // `'self'` lets the page's own relative assets load when the file is served
  // over HTTP(S) instead of opened from disk. It adds no fetch path: remote URLs
  // in the spec are still gated by the network policy before they reach markup.
  const imageSources = ['data:', 'file:', "'self'", ...origins];
  const mediaSources = ['file:', "'self'", ...origins];
  const parts = [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "connect-src 'none'",
    // Only embedded `data:` faces are ever allowed; a page without one keeps fonts closed.
    input.css.includes('@font-face') ? 'font-src data:' : "font-src 'none'",
    `img-src ${imageSources.join(' ')}`,
    `media-src ${mediaSources.join(' ')}`,
    `style-src 'nonce-${styleNonce}'`,
  ];
  parts.push(input.js === '' ? "script-src 'none'" : `script-src 'nonce-${scriptNonce}'`);
  if (policy !== 'deny' && policy.allow.length > 0) {
    parts.push(`/* network capabilities: ${policy.allow.join(', ')} */`);
  }
  return parts.join('; ');
}

export function buildContentSecurityPolicy(input: DocumentInput): {
  csp: string;
  styleNonce: string;
  scriptNonce: string;
} {
  const styleNonce = `ak${stableHash(input.css).slice(0, 16)}`;
  const scriptNonce = `ak${stableHash(input.js).slice(0, 16)}`;
  return {
    csp: directives(input.ir.policy.network, input, styleNonce, scriptNonce),
    styleNonce,
    scriptNonce,
  };
}

/**
 * Give accepted diagram adapter `<style>` elements the page style nonce.
 *
 * Adapter markup passed the trust check before it reached the body, and the
 * renderer marked each of its style elements. Spec text cannot forge the
 * marker, because every `<` in spec text is escaped. The policy stays
 * nonce-only: no `'unsafe-inline'`, and inline `style` attributes stay refused.
 */
function nonceAdapterStyles(body: string, styleNonce: string): string {
  return body.replaceAll(
    `<style ${ADAPTER_STYLE_MARKER}`,
    `<style nonce="${escapeAttribute(styleNonce)}" ${ADAPTER_STYLE_MARKER}`,
  );
}

export function assembleDocument(input: DocumentInput): AssembledDocument {
  const { csp, styleNonce, scriptNonce } = buildContentSecurityPolicy(input);
  const { meta } = input.ir;
  const liveRegion = needsLiveRegion(
    new Set(input.ir.nodes.flatMap((node) => node.runtimeFeatures)),
  )
    ? `<div class="ak-sr" data-ak-live role="status" aria-live="polite"></div>`
    : '';
  const themeToggle = input.themeToggle
    ? `<div class="ak-page-bar"><button type="button" class="ak-btn ak-theme-toggle" data-ak-theme-toggle aria-pressed="false" aria-label="Toggle dark theme">Dark</button></div>`
    : '';
  // Share metadata comes only from the spec's own meta, so it stays
  // deterministic and never invents a URL the artifact does not have.
  const description =
    meta.description === undefined
      ? ''
      : [
          `<meta name="description" content="${escapeAttribute(meta.description)}" />`,
          `<meta property="og:description" content="${escapeAttribute(meta.description)}" />`,
        ].join('\n');
  const share = [
    `<meta property="og:title" content="${escapeAttribute(meta.title)}" />`,
    '<meta property="og:type" content="article" />',
    '<meta name="twitter:card" content="summary" />',
  ].join('\n');

  // The colophon names the generator and offers a way back to the top; it holds
  // no dates or paths, so the artifact stays byte-deterministic.
  const colophon = [
    '<footer class="ak-colophon">',
    `<p><span class="ak-colophon-title">${escapeText(meta.title)}</span>`,
    `<span>Generated by @bestagentkits/render ${escapeText(input.compilerVersion)}</span></p>`,
    '<a href="#ak-main-content">Back to top</a>',
    '</footer>',
  ].join('');

  const outline = input.outline ?? '';
  const html = [
    '<!DOCTYPE html>',
    `<html lang="${escapeAttribute(meta.locale)}" data-density="${escapeAttribute(input.density)}"${input.motionDisabled === true ? ' data-motion="none"' : ''}>`,
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<meta name="color-scheme" content="light dark" />',
    `<meta name="generator" content="@bestagentkits/render ${escapeAttribute(input.compilerVersion)}" />`,
    `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}" />`,
    `<title>${escapeText(meta.title)}</title>`,
    description,
    share,
    `<style nonce="${escapeAttribute(styleNonce)}">${input.css}</style>`,
    '</head>',
    '<body>',
    '<a class="ak-skip" href="#ak-main-content">Skip to main content</a>',
    '<div class="ak-progress-rail" aria-hidden="true"></div>',
    `<div class="ak-shell${outline === '' ? '' : ' ak-shell--outline'}">`,
    themeToggle,
    nonceAdapterStyles(input.body, styleNonce),
    outline,
    colophon,
    '</div>',
    liveRegion,
    input.js === '' ? '' : `<script nonce="${escapeAttribute(scriptNonce)}">${input.js}</script>`,
    '</body>',
    '</html>',
    '',
  ]
    .filter((line) => line !== '')
    .join('\n');

  return { html, csp, styleNonce, scriptNonce };
}
