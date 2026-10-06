/**
 * Shared pieces for the product blocks: the person avatar with its initials
 * fallback, and the cross-field diagnostic shape their checks report.
 */

import type { IrNode, NetworkPolicy } from '../../ir.js';
import type { CheckContext } from '../../registry/block-module.js';
import { resolveMedia } from '../../render/block-helpers.js';
import { escapeAttribute, escapeText, escapeUrl } from '../../render/escape.js';

/** Up to two letters: the first of the first word and of the last word. */
export function initials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/u)
    .filter((word) => word !== '');
  const first = Array.from(words[0] ?? '')[0] ?? '';
  const last = words.length > 1 ? (Array.from(words[words.length - 1] ?? '')[0] ?? '') : '';
  return `${first}${last}`.toUpperCase();
}

/**
 * A round avatar. The name is always written next to it, so the image is
 * decorative (`alt=""`). With no source, or a remote one the network policy
 * blocks, it falls back to the person's initials: no request, nothing lost.
 */
export function avatar(source: string, name: string, policy: NetworkPolicy): string {
  if (source !== '') {
    const resolved = resolveMedia(source, policy, 'images');
    if (resolved.allowed) {
      return `<img class="ak-avatar" src="${escapeAttribute(resolved.src)}" alt="" loading="lazy" decoding="async" />`;
    }
  }
  return `<span class="ak-avatar" data-initials="true" aria-hidden="true">${escapeText(
    initials(name),
  )}</span>`;
}

/** Report a cross-field error at a path below the node. */
export function reportAt(
  context: CheckContext,
  node: IrNode,
  suffix: string,
  message: string,
  details?: Record<string, unknown>,
): void {
  context.bag.add({
    code: 'SPEC_VALIDATION_ERROR',
    path: `${node.path}${suffix}`,
    nodeId: node.id,
    message,
    ...(details === undefined ? {} : { details }),
  });
}

/**
 * An authored link. The URL policy validated the scheme; this only encodes it.
 * Remote targets never receive the page as a referrer or an opener.
 */
export function authoredLink(href: string, inner: string, attributes = ''): string {
  return `<a${attributes} href="${escapeAttribute(escapeUrl(href))}" rel="noreferrer noopener">${inner}</a>`;
}
