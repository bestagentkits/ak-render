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
export type MediaCapability = 'images' | 'media';

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
  capability: MediaCapability,
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
export function blockedReason(policy: NetworkPolicy, capability: MediaCapability): string {
  if (policy === 'deny') return 'the page denies network access';
  if (!capabilityAllowed(policy, capability)) return `the page does not allow remote ${capability}`;
  return 'its host is not on the page’s provider allowlist';
}

/**
 * True when a still image reference (a poster, for example) may be emitted: a
 * local path always may, a remote one only through the `images` gate.
 */
export function imageReferenceAllowed(policy: NetworkPolicy, reference: string): boolean {
  return !isRemote(reference) || networkAllows(policy, 'images', reference, '');
}
