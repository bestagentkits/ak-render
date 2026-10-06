/**
 * Shared helpers for block renderers.
 *
 * Prop readers, attribute and element builders, and the media network gate
 * live here so every renderer module applies them identically.
 */

import type { IrNode, NetworkPolicy } from '../ir.js';
import { isPlainObject, type JsonValue } from '../json.js';
import { isRemote, type MediaCapability, networkAllows } from '../spec/network-policy.js';
import {
  type AttributeValue,
  escapeInlineText,
  escapeText,
  escapeUrl,
  renderAttributes,
} from './escape.js';

// The network gate is shared with validation; renderers keep importing it from here.
export {
  blockedReason,
  capabilityAllowed,
  imageReferenceAllowed,
  isRemote,
  networkAllows,
} from '../spec/network-policy.js';

export function stringProp(node: IrNode, key: string, fallback = ''): string {
  const value = node.props[key];
  return typeof value === 'string' ? value : fallback;
}

export function numberProp(node: IrNode, key: string, fallback = 0): number {
  const value = node.props[key];
  return typeof value === 'number' ? value : fallback;
}

export function listProp(node: IrNode, key: string): JsonValue[] {
  const value = node.props[key];
  return Array.isArray(value) ? value : [];
}

export function objectListProp(node: IrNode, key: string): Record<string, JsonValue>[] {
  return listProp(node, key).filter(isPlainObject) as Record<string, JsonValue>[];
}

export function str(value: JsonValue | undefined, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function numProp(value: JsonValue | undefined, fallback = 0): number {
  return typeof value === 'number' ? value : fallback;
}

/** `data-ak-id` plus every non-click binding on the node. */
export function nodeAttributes(node: IrNode, extra: AttributeValue = {}): AttributeValue {
  const attributes: AttributeValue = { 'data-ak-id': node.id, ...extra };
  for (const [event, actions] of Object.entries(node.bindings)) {
    if (event === 'click') continue;
    attributes[`data-ak-on-${event}`] = JSON.stringify(actions);
  }
  return attributes;
}

export function element(tag: string, attributes: AttributeValue, inner: string): string {
  const rendered = renderAttributes(attributes);
  return inner === '' ? `<${tag}${rendered}></${tag}>` : `<${tag}${rendered}>${inner}</${tag}>`;
}

export function heading(level: number, text: string, className = 'ak-section-head'): string {
  return `<header class="${className}"><h${level}>${escapeText(text)}</h${level}></header>`;
}

/** A section heading for blocks whose `title` is optional. */
export function titleHeader(node: IrNode, level = 2): string {
  const title = stringProp(node, 'title');
  return title === '' ? '' : heading(level, title);
}

/** A figure caption is prose, so backtick spans become inline code. */
export function figureCaption(value: string): string {
  return value === '' ? '' : `<figcaption>${escapeInlineText(value)}</figcaption>`;
}

/**
 * Resolve a media reference against the network policy.
 *
 * A relative path is local and always allowed; a remote reference needs the
 * matching capability and, when a provider allowlist exists, an allowlisted
 * host. Nothing here can produce an embed the spec did not ask for in a way the
 * policy did not allow.
 */
export function resolveMedia(
  reference: string,
  policy: NetworkPolicy,
  capability: MediaCapability,
  provider = '',
): { allowed: boolean; src: string } {
  if (!isRemote(reference)) return { allowed: true, src: escapeUrl(reference) };
  return {
    allowed: networkAllows(policy, capability, reference, provider),
    src: escapeUrl(reference),
  };
}
