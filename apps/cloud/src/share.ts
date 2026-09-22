/**
 * Share objects.
 *
 * A share is an explicit, scoped, expiring publication of one already-compiled
 * artifact into private object storage. Three properties matter:
 *
 *   - the id is opaque and random, so a share cannot be guessed or enumerated;
 *   - the object lives in a private bucket and is only ever served through the
 *     preview route after the expiry and revocation checks pass;
 *   - expiry is enforced at read time and swept by the scheduled handler, so a
 *     share stops resolving even if the sweep is late.
 */

import type { Env } from './bindings.js';
import { retentionDays } from './config.js';
import type { Principal } from './auth.js';
import type { RenderedArtifact } from './render.js';

export interface ShareRecord {
  id: string;
  url: string;
  expiresAt: string;
}

export type ShareReadOutcome =
  | { ok: true; html: string; expiresAt: string; owner: string }
  | { ok: false; status: 404 | 410; code: string; message: string };

const SHARE_PREFIX = 'share/';

function keyOf(id: string): string {
  return `${SHARE_PREFIX}${id}`;
}

export function shareIdPattern(): RegExp {
  // Opaque ids only: a caller cannot address an object it was not given.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
}

export async function createShare(
  env: Env,
  principal: Principal,
  artifact: RenderedArtifact,
  now: Date = new Date(),
): Promise<ShareRecord> {
  const id = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + retentionDays(env) * 24 * 60 * 60 * 1000);
  await env.RENDER_SHARES.put(keyOf(id), artifact.html, {
    customMetadata: {
      owner: principal.subject,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      hash: artifact.hash,
      version: artifact.version,
    },
    httpMetadata: { contentType: 'text/html; charset=utf-8' },
  });
  return { id, url: `/v1/share/${id}`, expiresAt: expiresAt.toISOString() };
}

export async function readShare(
  env: Env,
  id: string,
  now: Date = new Date(),
): Promise<ShareReadOutcome> {
  if (!shareIdPattern().test(id)) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: 'no such share' };
  }
  const object = await env.RENDER_SHARES.get(keyOf(id));
  if (object === null) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: 'no such share' };
  }
  const expiresAt = object.customMetadata?.['expiresAt'] ?? '';
  const owner = object.customMetadata?.['owner'] ?? '';
  if (expiresAt !== '' && Date.parse(expiresAt) <= now.getTime()) {
    return { ok: false, status: 410, code: 'EXPIRED', message: 'this share has expired' };
  }
  return { ok: true, html: await object.text(), expiresAt, owner };
}

export async function revokeShare(
  env: Env,
  principal: Principal,
  id: string,
): Promise<{ ok: boolean; status: 200 | 403 | 404 }> {
  if (!shareIdPattern().test(id)) return { ok: false, status: 404 };
  const object = await env.RENDER_SHARES.get(keyOf(id));
  if (object === null) return { ok: false, status: 404 };
  // Only the owner revokes. A different valid principal must not be able to
  // delete someone else's share.
  if ((object.customMetadata?.['owner'] ?? '') !== principal.subject) {
    return { ok: false, status: 403 };
  }
  await env.RENDER_SHARES.delete(keyOf(id));
  return { ok: true, status: 200 };
}

/** Delete expired shares. Wired to the scheduled handler. */
export async function purgeExpiredShares(env: Env, now: Date = new Date()): Promise<number> {
  const listed = await env.RENDER_SHARES.list({ prefix: SHARE_PREFIX, limit: 1000 });
  let removed = 0;
  for (const entry of listed.objects) {
    const object = await env.RENDER_SHARES.get(entry.key);
    if (object === null) continue;
    const expiresAt = object.customMetadata?.['expiresAt'] ?? '';
    if (expiresAt === '' || Date.parse(expiresAt) > now.getTime()) continue;
    await env.RENDER_SHARES.delete(entry.key);
    removed += 1;
  }
  return removed;
}
