/**
 * Stored artifacts: shares and short-lived render artifacts.
 *
 * A share is an explicit, scoped, expiring publication of one already-compiled
 * artifact into private object storage. A render artifact is the same object
 * with a one-hour lifetime: it is what a remote MCP `render` hands back instead
 * of writing into the caller's filesystem. Three properties hold for both:
 *
 *   - the id is opaque and random, so an artifact cannot be guessed or enumerated;
 *   - the object lives in a private bucket and is only ever served through its
 *     preview route after the expiry and revocation checks pass;
 *   - expiry is enforced at read time and swept by the scheduled handler, so an
 *     artifact stops resolving even if the sweep is late.
 */

import type { Principal } from './auth.js';
import type { Env } from './bindings.js';
import { ARTIFACT_TTL_SECONDS, retentionDays } from './config.js';
import type { RenderedArtifact } from './render.js';

export type StoredKind = 'share' | 'artifact';

export interface ShareRecord {
  id: string;
  /** Path of the preview route, relative to the worker origin. */
  url: string;
  expiresAt: string;
}

export type ShareReadOutcome =
  | { ok: true; html: string; expiresAt: string; owner: string }
  | { ok: false; status: 404 | 410; code: string; message: string };

/** Object-key prefix and preview-route path per kind. */
const KINDS: Readonly<Record<StoredKind, { prefix: string; route: string }>> = {
  share: { prefix: 'share/', route: '/v1/share/' },
  artifact: { prefix: 'artifact/', route: '/v1/artifact/' },
};

function keyOf(kind: StoredKind, id: string): string {
  return `${KINDS[kind].prefix}${id}`;
}

export function shareIdPattern(): RegExp {
  // Opaque ids only: a caller cannot address an object it was not given.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
}

async function store(
  env: Env,
  kind: StoredKind,
  principal: Principal,
  artifact: RenderedArtifact,
  now: Date,
  lifetimeMs: number,
): Promise<ShareRecord> {
  const id = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + lifetimeMs);
  await env.RENDER_SHARES.put(keyOf(kind, id), artifact.html, {
    customMetadata: {
      owner: principal.subject,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      hash: artifact.hash,
      version: artifact.version,
    },
    httpMetadata: { contentType: 'text/html; charset=utf-8' },
  });
  return { id, url: `${KINDS[kind].route}${id}`, expiresAt: expiresAt.toISOString() };
}

/** Publish an artifact as a share that lives for the configured retention. */
export function createShare(
  env: Env,
  principal: Principal,
  artifact: RenderedArtifact,
  now: Date = new Date(),
): Promise<ShareRecord> {
  return store(env, 'share', principal, artifact, now, retentionDays(env) * 24 * 60 * 60 * 1000);
}

/** Store a short-lived render artifact for a remote MCP `render`. */
export function createArtifact(
  env: Env,
  principal: Principal,
  artifact: RenderedArtifact,
  now: Date = new Date(),
): Promise<ShareRecord> {
  return store(env, 'artifact', principal, artifact, now, ARTIFACT_TTL_SECONDS * 1000);
}

/** Read one stored object of a kind, enforcing id shape and expiry. */
export async function readStored(
  env: Env,
  kind: StoredKind,
  id: string,
  now: Date = new Date(),
): Promise<ShareReadOutcome> {
  if (!shareIdPattern().test(id)) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: `no such ${kind}` };
  }
  const object = await env.RENDER_SHARES.get(keyOf(kind, id));
  if (object === null) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: `no such ${kind}` };
  }
  const expiresAt = object.customMetadata?.['expiresAt'] ?? '';
  const owner = object.customMetadata?.['owner'] ?? '';
  if (expiresAt !== '' && Date.parse(expiresAt) <= now.getTime()) {
    return { ok: false, status: 410, code: 'EXPIRED', message: `this ${kind} has expired` };
  }
  return { ok: true, html: await object.text(), expiresAt, owner };
}

export function readShare(env: Env, id: string, now: Date = new Date()): Promise<ShareReadOutcome> {
  return readStored(env, 'share', id, now);
}

export async function revokeShare(
  env: Env,
  principal: Principal,
  id: string,
): Promise<{ ok: boolean; status: 200 | 403 | 404 }> {
  if (!shareIdPattern().test(id)) return { ok: false, status: 404 };
  const object = await env.RENDER_SHARES.get(keyOf('share', id));
  if (object === null) return { ok: false, status: 404 };
  // Only the owner revokes. A different valid principal must not be able to
  // delete someone else's share.
  if ((object.customMetadata?.['owner'] ?? '') !== principal.subject) {
    return { ok: false, status: 403 };
  }
  await env.RENDER_SHARES.delete(keyOf('share', id));
  return { ok: true, status: 200 };
}

/** Delete expired shares and render artifacts. Wired to the scheduled handler. */
export async function purgeExpiredShares(env: Env, now: Date = new Date()): Promise<number> {
  let removed = 0;
  for (const { prefix } of Object.values(KINDS)) {
    const listed = await env.RENDER_SHARES.list({ prefix, limit: 1000 });
    for (const entry of listed.objects) {
      const object = await env.RENDER_SHARES.get(entry.key);
      if (object === null) continue;
      const expiresAt = object.customMetadata?.['expiresAt'] ?? '';
      if (expiresAt === '' || Date.parse(expiresAt) > now.getTime()) continue;
      await env.RENDER_SHARES.delete(entry.key);
      removed += 1;
    }
  }
  return removed;
}
