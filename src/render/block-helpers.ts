/**
 * Shared helpers for block renderers.
 *
 * Prop readers, attribute and element builders, and the media network gate
 * live here so every renderer module applies them identically.
 */

import type { IrNode, NetworkPolicy } from '../ir.js';
import { isPlainObject, type JsonValue } from '../json.js';
import { hostMatchesAnyProvider, hostMatchesProvider } from '../spec/providers.js';
import { type AttributeValue, escapeText, escapeUrl, renderAttributes } from './escape.js';

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

export function figureCaption(value: string): string {
  return value === '' ? '' : `<figcaption>${escapeText(value)}</figcaption>`;
}

export function isRemote(reference: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(reference);
}

export function capabilityAllowed(policy: NetworkPolicy, capability: string): boolean {
  if (policy === 'deny') return false;
  return policy.allow.includes(capability);
}

/**
 * Decide whether a remote reference may be loaded.
 *
 * Two gates apply. The capability must be opted into, and when the page declares
 * a provider allowlist the reference's host must belong to one of those
 * providers. A block that names a provider itself requires that provider to be
 * allowlisted, so a spec cannot promote an arbitrary host to trusted by
 * labelling it "youtube".
 */
export function networkAllows(
  policy: NetworkPolicy,
  capability: 'images' | 'media',
  reference: string,
  provider: string,
): boolean {
  if (!capabilityAllowed(policy, capability)) return false;
  if (policy === 'deny') return false;
  const declared = policy.providers ?? [];
  if (provider !== '') {
    return declared.includes(provider) && hostMatchesProvider(provider, reference);
  }
  if (declared.length === 0) return true;
  return hostMatchesAnyProvider(declared, reference);
}

/**
 * Why a remote reference was held back. The page may deny the network outright,
 * leave the capability out, or allow it only for other hosts.
 */
export function blockedReason(policy: NetworkPolicy, capability: 'images' | 'media'): string {
  if (policy === 'deny') return 'the page denies network access';
  if (!capabilityAllowed(policy, capability)) return `the page does not allow remote ${capability}`;
  return 'its host is not on the page’s provider allowlist';
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
  capability: 'images' | 'media',
  provider = '',
): { allowed: boolean; src: string } {
  if (!isRemote(reference)) return { allowed: true, src: escapeUrl(reference) };
  return {
    allowed: networkAllows(policy, capability, reference, provider),
    src: escapeUrl(reference),
  };
}
