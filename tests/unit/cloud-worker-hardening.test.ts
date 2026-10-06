import { afterEach, describe, expect, it, vi } from 'vitest';
import { authenticate } from '../../apps/cloud/src/auth.js';
import { DEFAULT_SHARE_RETENTION_DAYS } from '../../apps/cloud/src/config.js';
import worker, { handleRequest, STORED_PAGE_CSP } from '../../apps/cloud/src/index.js';
import {
  ACCEPTED_TTL_MS,
  cachedDigests,
  cachedOutcome,
  MAX_CACHED_PRINCIPALS,
  REJECTED_TTL_MS,
  rememberOutcome,
} from '../../apps/cloud/src/principal-cache.js';
import { MAX_SWEEP_PAGES, purgeExpiredShares } from '../../apps/cloud/src/share.js';
import {
  activeEntitlements,
  harness,
  ORIGIN,
  post,
  SPEC,
  stubEntitlements,
  TOKEN,
} from './support/cloud-worker-harness.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** HTTP status of an auth outcome, 200 for a principal. */
const statusOf = (outcome: Awaited<ReturnType<typeof authenticate>>) =>
  outcome.ok ? 200 : outcome.status;

const bearer = (token: string, ip = '203.0.113.9') =>
  new Request(`${ORIGIN}/v1/render`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'cf-connecting-ip': ip },
  });

describe('cloud hardening: principal cache', () => {
  it('reuses an accepted bearer for a minute, then asks upstream again', async () => {
    const { env, fetchMock } = harness();
    const start = Date.parse('2026-10-06T00:00:00.000Z');
    expect((await authenticate(bearer(TOKEN), env, start)).ok).toBe(true);
    expect((await authenticate(bearer(TOKEN), env, start + ACCEPTED_TTL_MS - 1)).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await authenticate(bearer(TOKEN), env, start + ACCEPTED_TTL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('remembers a rejected bearer briefly and an upstream fault not at all', async () => {
    const { env, fetchMock } = harness({ entitlements: { status: 'inactive' }, status: 401 });
    const start = Date.parse('2026-10-06T00:00:00.000Z');
    await authenticate(bearer('bad'), env, start);
    await authenticate(bearer('bad'), env, start + REJECTED_TTL_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await authenticate(bearer('bad'), env, start + REJECTED_TTL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const down = stubEntitlements('bad gateway', 530);
    await authenticate(bearer('flaky'), env, start);
    await authenticate(bearer('flaky'), env, start);
    expect(down).toHaveBeenCalledTimes(2);
  });

  it('keys the cache on a digest of the bearer, never the bearer', async () => {
    const { env } = harness();
    await authenticate(bearer(TOKEN), env);
    const digests = cachedDigests();
    expect(digests).toHaveLength(1);
    expect(digests[0]).toMatch(/^[0-9a-f]{64}$/u);
    expect(digests[0]).not.toContain(TOKEN);
  });

  it('stays bounded, evicting the oldest entry first', () => {
    harness();
    const accepted = { ok: true as const, principal: { subject: 's', scopes: [] } };
    for (let index = 0; index <= MAX_CACHED_PRINCIPALS; index += 1) {
      rememberOutcome(`digest-${index}`, accepted, 0);
    }
    expect(cachedDigests()).toHaveLength(MAX_CACHED_PRINCIPALS);
    expect(cachedOutcome('digest-0', 1)).toBeUndefined();
    expect(cachedOutcome(`digest-${MAX_CACHED_PRINCIPALS}`, 1)).toEqual(accepted);
  });
});

describe('cloud hardening: per-IP bearer checks', () => {
  it('stops forwarding new bearers upstream once an address spends its allowance', async () => {
    const { env, fetchMock, limits } = harness({
      entitlements: { status: 'inactive' },
      status: 401,
      limits: { 'auth-ip': 2 },
    });
    expect(statusOf(await authenticate(bearer('guess-1'), env))).toBe(401);
    expect(statusOf(await authenticate(bearer('guess-2'), env))).toBe(401);
    const third = await authenticate(bearer('guess-3'), env);
    expect(third).toMatchObject({ ok: false, status: 429, code: 'RATE_LIMITED' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // A cached answer costs no lookup, and another address is unaffected.
    expect(statusOf(await authenticate(bearer('guess-1'), env))).toBe(401);
    expect(statusOf(await authenticate(bearer('guess-3', '198.51.100.4'), env))).toBe(401);
    expect([...limits['auth-ip'].counts.keys()].sort()).toEqual(['198.51.100.4', '203.0.113.9']);
  });

  it('answers the REST route 429 when the address is over its bearer-check allowance', async () => {
    const { env } = harness({ limits: { 'auth-ip': 0 } });
    const response = await handleRequest(post('/v1/render', { spec: SPEC }), env);
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ code: 'RATE_LIMITED' });
  });
});

describe('cloud hardening: REST challenges', () => {
  it('sends a Bearer challenge with a 401, naming invalid_token only for a presented one', async () => {
    const missing = await handleRequest(post('/v1/render', { spec: SPEC }, null), harness().env);
    expect(missing.status).toBe(401);
    expect(missing.headers.get('www-authenticate')).toBe('Bearer realm="ak-render"');

    const { env } = harness({ entitlements: { status: 'inactive' }, status: 401 });
    const rejected = await handleRequest(post('/v1/render', { spec: SPEC }, 'expired'), env);
    expect(rejected.status).toBe(401);
    expect(rejected.headers.get('www-authenticate')).toBe(
      'Bearer realm="ak-render", error="invalid_token"',
    );
  });

  it('answers a fault outside the routes with a generic 500', async () => {
    const { env, r2 } = harness();
    r2.put = async () => {
      throw new Error('R2 internal detail');
    };
    const response = await worker.fetch(post('/v1/share', { spec: SPEC }), env);
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'the request failed; try again later',
    });
    expect(body).not.toContain('internal detail');
  });
});

describe('cloud hardening: stored pages run sandboxed', () => {
  it('serves shares and artifacts with a sandbox CSP and no framing', async () => {
    const { env } = harness();
    expect(STORED_PAGE_CSP).toContain('sandbox allow-scripts');
    expect(STORED_PAGE_CSP).not.toContain('allow-same-origin');
    expect(STORED_PAGE_CSP).toContain("frame-ancestors 'none'");

    const created = await handleRequest(post('/v1/share', { spec: SPEC }), env);
    const { url } = (await created.json()) as { url: string };
    const share = await handleRequest(new Request(`${ORIGIN}${url}`), env);
    expect(share.headers.get('content-security-policy')).toBe(STORED_PAGE_CSP);

    const rendered = await handleRequest(
      new Request(`${ORIGIN}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'render', arguments: { spec: SPEC } },
        }),
      }),
      env,
    );
    const reply = (await rendered.json()) as { result: { content: { text: string }[] } };
    const { artifactUrl } = JSON.parse(reply.result.content[0]?.text ?? '{}') as {
      artifactUrl: string;
    };
    const artifact = await handleRequest(new Request(artifactUrl), env);
    expect(artifact.status).toBe(200);
    expect(artifact.headers.get('content-security-policy')).toBe(STORED_PAGE_CSP);

    // A REST render is the caller's own response, not a hosted page.
    const direct = await handleRequest(post('/v1/render', { spec: SPEC }), env);
    expect(direct.headers.get('content-security-policy')).toBeNull();
  });
});

describe('cloud hardening: expiry sweep', () => {
  const day = 24 * 60 * 60 * 1000;

  function seed(
    r2: ReturnType<typeof harness>['r2'],
    prefix: string,
    count: number,
    expiresAt: string,
  ) {
    for (let index = 0; index < count; index += 1) {
      const id = `${index.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
      r2.objects.set(`${prefix}${id}`, { value: '<html></html>', customMetadata: { expiresAt } });
    }
  }

  it('walks every page with the cursor, reads metadata from the listing and deletes in batches', async () => {
    const { r2, env } = harness();
    const now = new Date('2026-10-06T12:00:00.000Z');
    const past = new Date(now.getTime() - day).toISOString();
    const future = new Date(now.getTime() + day).toISOString();
    // Live objects sort first, so the expired ones sit beyond the first page.
    seed(r2, 'artifact/', 1500, future);
    for (let index = 0; index < 1200; index += 1) {
      r2.objects.set(`artifact/ffff${index.toString(16).padStart(4, '0')}-0000-4000-8000-0`, {
        value: '<html></html>',
        customMetadata: { expiresAt: past },
      });
    }
    seed(r2, 'share/', 3, past);

    const removed = await purgeExpiredShares(env, now);
    expect(removed).toBe(1203);
    expect(r2.objects.size).toBe(1500);
    expect(r2.calls.filter((call) => call.method === 'get')).toEqual([]);
    const deletes = r2.calls.filter((call) => call.method === 'delete');
    expect(deletes.every((call) => (call.detail as string[]).length <= 1000)).toBe(true);
    const lists = r2.calls.filter((call) => call.method === 'list');
    expect(lists.length).toBe(4);
    for (const call of lists) {
      expect(call.detail).toMatchObject({ include: ['customMetadata'] });
    }
  });

  it('keeps unexpired objects and objects without an expiry', async () => {
    const { r2, env } = harness();
    await handleRequest(post('/v1/share', { spec: SPEC }), env);
    r2.objects.set('share/no-expiry', { value: 'x' });
    expect(await purgeExpiredShares(env)).toBe(0);
    const later = new Date(Date.now() + (DEFAULT_SHARE_RETENTION_DAYS + 1) * day);
    expect(await purgeExpiredShares(env, later)).toBe(1);
    expect([...r2.objects.keys()]).toEqual(['share/no-expiry']);
  });

  it('bounds one run to a fixed number of listing pages per prefix', async () => {
    const { env } = harness();
    let pages = 0;
    env.RENDER_SHARES.list = async () => {
      pages += 1;
      return { objects: [], truncated: true, cursor: `page-${pages}` };
    };
    await purgeExpiredShares(env);
    expect(pages).toBe(MAX_SWEEP_PAGES * 2);
  });
});

describe('cloud hardening: separate subjects stay separate in the cache', () => {
  it('never answers one bearer with another bearer’s principal', async () => {
    const { env } = harness();
    await authenticate(bearer(TOKEN), env);
    stubEntitlements(activeEntitlements('user-2'));
    const other = await authenticate(bearer('other-token'), env);
    expect(other).toMatchObject({ ok: true, principal: { subject: 'user-2' } });
    const first = await authenticate(bearer(TOKEN), env);
    expect(first).toMatchObject({ ok: true, principal: { subject: 'user-1' } });
  });
});
