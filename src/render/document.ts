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
  const imageSources = ['data:', 'file:', ...origins];
  const mediaSources = ['file:', ...origins];
  const parts = [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "connect-src 'none'",
    "font-src 'none'",
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

export function assembleDocument(input: DocumentInput): AssembledDocument {
  const { csp, styleNonce, scriptNonce } = buildContentSecurityPolicy(input);
  const { meta } = input.ir;
  const liveRegion = needsLiveRegion(
    new Set(input.ir.nodes.flatMap((node) => node.runtimeFeatures)),
  )
    ? `<div class="ak-sr" data-ak-live role="status" aria-live="polite"></div>`
    : '';
  const themeToggle = input.themeToggle
    ? `<div class="ak-page-bar"><button type="button" class="ak-btn ak-theme-toggle" data-ak-theme-toggle aria-pressed="false">Dark</button></div>`
    : '';
  const description =
    meta.description === undefined
      ? ''
      : `<meta name="description" content="${escapeAttribute(meta.description)}" />`;

  const html = [
    '<!DOCTYPE html>',
    `<html lang="${escapeAttribute(meta.locale)}" data-density="${escapeAttribute(input.density)}">`,
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<meta name="color-scheme" content="light dark" />',
    `<meta name="generator" content="@agentkit/render ${escapeAttribute(input.compilerVersion)}" />`,
    `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}" />`,
    `<title>${escapeText(meta.title)}</title>`,
    description,
    `<style nonce="${escapeAttribute(styleNonce)}">${input.css}</style>`,
    '</head>',
    '<body>',
    '<a class="ak-skip" href="#ak-main-content">Skip to main content</a>',
    '<div class="ak-shell">',
    themeToggle,
    input.body,
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
