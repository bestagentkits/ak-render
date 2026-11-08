/**
 * The network gate for remote references.
 *
 * Validation and rendering both decide whether a remote reference may load, so
 * the decision lives here, below both, and the two can never disagree about
 * what a page's `policy.network` allows.
 */

import type { NetworkPolicy } from '../ir.js';
import { hostMatchesAnyProvider, hostMatchesProvider } from './providers.js';

/** The capabilities a remote reference can be gated by. */
export type MediaCapability = 'images' | 'media' | 'models';

/**
 * Capabilities whose remote references the browser fetches with `fetch`/XHR
 * (glTF/GLB loaders), so their origins belong in CSP `connect-src` rather than
 * `img-src`/`media-src`.
 */
export const CONNECT_CAPABILITIES: readonly MediaCapability[] = ['models'];

export function isRemote(reference: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(reference);
}

function ipv4Private(host: string): boolean {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  const [a = 0, b = 0] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

/**
 * True when a remote reference points at a loopback, private, link-local or
 * cloud-metadata host. Such a reference never loads, whatever the policy says:
 * the page may be rendered server-side (cloud export), where these hosts reach
 * the renderer's own network rather than the reader's.
 */
export function isPrivateHost(reference: string): boolean {
  let host: string;
  try {
    host = new URL(reference).hostname.toLowerCase().replace(/\.$/u, '');
  } catch {
    return false;
  }
  if (host === '') return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === 'metadata.google.internal') return true;
  if (host.startsWith('[') && host.endsWith(']')) {
    const ip = host.slice(1, -1);
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/u.exec(ip)?.[1];
    if (mapped !== undefined) return ipv4Private(mapped);
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u.exec(ip);
    if (hex !== null) {
      const high = Number.parseInt(hex[1] ?? '0', 16);
      const low = Number.parseInt(hex[2] ?? '0', 16);
      return ipv4Private(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    return ip === '::1' || ip === '::' || /^f[cd]/u.test(ip) || /^fe[89ab]/u.test(ip);
  }
  return ipv4Private(host);
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
  capability: MediaCapability,
  reference: string,
  provider: string,
): boolean {
  if (!capabilityAllowed(policy, capability)) return false;
  if (policy === 'deny') return false;
  if (isPrivateHost(reference)) return false;
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
export function blockedReason(
  policy: NetworkPolicy,
  capability: MediaCapability,
  reference?: string,
): string {
  if (policy === 'deny') return 'the page denies network access';
  if (!capabilityAllowed(policy, capability)) return `the page does not allow remote ${capability}`;
  if (reference !== undefined && isPrivateHost(reference)) {
    return 'its host is a loopback, private or metadata address';
  }
  return 'its host is not on the page’s provider allowlist';
}

/**
 * True when a still image reference (a poster, for example) may be emitted: a
 * local path always may, a remote one only through the `images` gate.
 */
export function imageReferenceAllowed(policy: NetworkPolicy, reference: string): boolean {
  return !isRemote(reference) || networkAllows(policy, 'images', reference, '');
}
