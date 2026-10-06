/**
 * In-isolate cache of entitlements answers, keyed by a SHA-256 digest of the
 * bearer.
 *
 * Without it every authenticated call costs an upstream round trip to the
 * AgentKit entitlements endpoint. An accepted bearer is remembered for a
 * minute, a rejected or inactive one for ten seconds (so a fixed token starts
 * working quickly), and an upstream fault is never remembered. The map is
 * bounded: the oldest entry is evicted first.
 *
 * Only the digest is held, never the bearer itself. The cache lives in one
 * isolate's memory and is not shared, persisted or logged.
 */

import type { AuthOutcome } from './auth.js';

/** How long an accepted bearer's principal is reused. */
export const ACCEPTED_TTL_MS = 60_000;

/** How long a rejected (401) or not-entitled (403) answer is reused. */
export const REJECTED_TTL_MS = 10_000;

/** Most entries one isolate keeps. */
export const MAX_CACHED_PRINCIPALS = 1_000;

const entries = new Map<string, { outcome: AuthOutcome; expiresAt: number }>();

/** Hex SHA-256 of the bearer: the only form of it the cache ever sees. */
export async function bearerDigest(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The remembered answer for a digest, or `undefined` when absent or stale. */
export function cachedOutcome(digest: string, now: number): AuthOutcome | undefined {
  const entry = entries.get(digest);
  if (entry === undefined) return undefined;
  if (entry.expiresAt <= now) {
    entries.delete(digest);
    return undefined;
  }
  return entry.outcome;
}

/**
 * Remember an upstream answer. Only a definite answer is cached: a principal,
 * a rejected bearer or an inactive account. An upstream fault or a rate-limit
 * refusal says nothing about the bearer, so it is not.
 */
export function rememberOutcome(digest: string, outcome: AuthOutcome, now: number): void {
  const ttl = outcome.ok
    ? ACCEPTED_TTL_MS
    : outcome.status === 401 || outcome.status === 403
      ? REJECTED_TTL_MS
      : undefined;
  if (ttl === undefined) return;
  entries.delete(digest);
  while (entries.size >= MAX_CACHED_PRINCIPALS) {
    const oldest = entries.keys().next();
    if (oldest.done === true) break;
    entries.delete(oldest.value);
  }
  entries.set(digest, { outcome, expiresAt: now + ttl });
}

/** Drop every entry. Tests call this so each starts with a cold isolate. */
export function clearPrincipalCache(): void {
  entries.clear();
}

/** The digests currently held, for assertions that no raw bearer is kept. */
export function cachedDigests(): string[] {
  return [...entries.keys()];
}
