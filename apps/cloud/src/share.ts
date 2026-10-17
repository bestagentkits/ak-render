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
 *
 * What `artifact-export` adds lives beside the page under the same prefix, at
 * `<key>.spec` (only when the caller asked for `retainSpec`), `<key>.png` and
 * `<key>.pdf`, with the page's owner and expiry. The sweep and the lifecycle
 * rules therefore cover them with no rule of their own, and revoking a share
 * deletes them with it.
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
  | {
      ok: true;
      html: string;
      expiresAt: string;
      owner: string;
      metadata: Readonly<Record<string, string>>;
    }
  | { ok: false; status: 404 | 410; code: string; message: string };

/** Object-key prefix and preview-route path per kind. */
const KINDS: Readonly<Record<StoredKind, { prefix: string; route: string }>> = {
  share: { prefix: 'share/', route: '/v1/share/' },
  artifact: { prefix: 'artifact/', route: '/v1/artifact/' },
};

/** What may sit beside a stored page, by key suffix. */
export type SiblingSuffix = 'spec' | 'png' | 'pdf';
const SIBLING_SUFFIXES: readonly SiblingSuffix[] = ['spec', 'png', 'pdf'];

export function keyOf(kind: StoredKind, id: string, suffix?: SiblingSuffix): string {
  return `${KINDS[kind].prefix}${id}${suffix === undefined ? '' : `.${suffix}`}`;
}

/** The spec source a caller asked to keep, as it was sent. */
export interface RetainedSpec {
  source: string;
  format: 'yaml' | 'json';
}

export interface StoreOptions {
  /** Keep the spec source beside the page (`retainSpec`). */
  spec?: RetainedSpec;
  /** The `theme` preset argument, when one overrode the spec; the retained spec does not carry it. */
  themeOverride?: string;
}

export const SPEC_CONTENT_TYPES: Readonly<Record<RetainedSpec['format'], string>> = {
  yaml: 'application/yaml; charset=utf-8',
  json: 'application/json; charset=utf-8',
};

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
  options: StoreOptions,
): Promise<ShareRecord> {
  const id = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + lifetimeMs);
  const shared = {
    owner: principal.subject,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  // The spec goes first: a page whose metadata says the spec is retained must
  // never resolve without it.
  if (options.spec !== undefined) {
    await env.RENDER_SHARES.put(keyOf(kind, id, 'spec'), options.spec.source, {
      customMetadata: shared,
      httpMetadata: { contentType: SPEC_CONTENT_TYPES[options.spec.format] },
    });
  }
  await env.RENDER_SHARES.put(keyOf(kind, id), artifact.html, {
    customMetadata: {
      ...shared,
      hash: artifact.hash,
      version: artifact.version,
      ...(options.spec === undefined ? {} : { spec: options.spec.format }),
      ...(options.themeOverride === undefined ? {} : { themeOverride: options.themeOverride }),
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
  options: StoreOptions = {},
): Promise<ShareRecord> {
  const lifetimeMs = retentionDays(env) * 24 * 60 * 60 * 1000;
  return store(env, 'share', principal, artifact, now, lifetimeMs, options);
}

/** Store a short-lived render artifact for a remote MCP `render`. */
export function createArtifact(
  env: Env,
  principal: Principal,
  artifact: RenderedArtifact,
  now: Date = new Date(),
  options: StoreOptions = {},
): Promise<ShareRecord> {
  return store(env, 'artifact', principal, artifact, now, ARTIFACT_TTL_SECONDS * 1000, options);
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
  return {
    ok: true,
    html: await object.text(),
    expiresAt,
    owner,
    metadata: object.customMetadata ?? {},
  };
}

/**
 * A stored page's metadata, read without its body. Absent and expired both
 * come back as values, so a caller can decide what a non-owner may learn.
 */
export async function statStored(
  env: Env,
  kind: StoredKind,
  id: string,
): Promise<{ owner: string; expiresAt: string; metadata: Readonly<Record<string, string>> } | null> {
  if (!shareIdPattern().test(id)) return null;
  const head = await env.RENDER_SHARES.head(keyOf(kind, id));
  if (head === null) return null;
  const metadata = head.customMetadata ?? {};
  return { owner: metadata['owner'] ?? '', expiresAt: metadata['expiresAt'] ?? '', metadata };
}

export function isExpired(expiresAt: string, now: Date): boolean {
  return expiresAt !== '' && Date.parse(expiresAt) <= now.getTime();
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
  // The retained spec and any exports go with the page; deleting an absent
  // key is a no-op.
  await env.RENDER_SHARES.delete([
    keyOf('share', id),
    ...SIBLING_SUFFIXES.map((suffix) => keyOf('share', id, suffix)),
  ]);
  return { ok: true, status: 200 };
}

/**
 * Most listing pages one sweep reads per prefix. A page holds up to 1,000
 * objects, so this bounds one run's subrequests while still covering far more
 * objects than the rate limits can create between two hourly runs. R2
 * lifecycle rules (r2-lifecycle.json) are the backstop that deletes the bytes
 * even if a sweep never reaches them.
 */
export const MAX_SWEEP_PAGES = 100;

/**
 * Delete expired shares and render artifacts. Wired to the scheduled handler.
 *
 * It walks each prefix with the listing cursor and reads expiry from the
 * metadata the listing returns, so it never downloads an object body, and it
 * deletes each page's expired keys in one call.
 */
export async function purgeExpiredShares(env: Env, now: Date = new Date()): Promise<number> {
  let removed = 0;
  for (const { prefix } of Object.values(KINDS)) {
    let cursor: string | undefined;
    for (let page = 0; page < MAX_SWEEP_PAGES; page += 1) {
      const listed = await env.RENDER_SHARES.list({
        prefix,
        limit: 1000,
        include: ['customMetadata'],
        ...(cursor === undefined ? {} : { cursor }),
      });
      const expired = listed.objects
        .filter((entry) => {
          const expiresAt = entry.customMetadata?.['expiresAt'] ?? '';
          return expiresAt !== '' && Date.parse(expiresAt) <= now.getTime();
        })
        .map((entry) => entry.key);
      if (expired.length > 0) {
        await env.RENDER_SHARES.delete(expired);
        removed += expired.length;
      }
      if (!listed.truncated || listed.cursor === undefined) break;
      cursor = listed.cursor;
    }
  }
  return removed;
}
