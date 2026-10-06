import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  authenticate,
  authorize,
  authorizeAll,
  principalFromEntitlements,
  scopesFor,
} from '../../apps/cloud/src/auth.js';
import { activeEntitlements, harness, TOKEN } from './support/cloud-worker-harness.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const request = (token: string | null = TOKEN) =>
  new Request('https://render.example.test/v1/render', {
    method: 'POST',
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
  });

describe('entitlements: authenticate against the canonical endpoint', () => {
  it('maps an active subscription to a principal keyed by userId with render and share', async () => {
    const { env } = harness();
    const outcome = await authenticate(request(), env);
    expect(outcome).toEqual({
      ok: true,
      principal: { subject: 'user-1', scopes: ['render', 'share'] },
    });
  });

  it('grants scopes for the app entitlement alone', () => {
    const outcome = principalFromEntitlements({
      ...activeEntitlements(),
      entitlements: { agentkitApp: true, kits: {} },
    });
    expect(outcome).toMatchObject({ ok: true, principal: { scopes: ['render', 'share'] } });
  });

  it('refuses a 200 answer whose status is inactive', async () => {
    const { env } = harness({ entitlements: { ...activeEntitlements(), status: 'inactive' } });
    expect(await authenticate(request(), env)).toMatchObject({
      ok: false,
      status: 403,
      code: 'ENTITLEMENT_INACTIVE',
    });
  });

  it('treats the live 401 answer as a rejected bearer', async () => {
    const { env } = harness({
      entitlements: { status: 'inactive', code: 'not_authenticated' },
      status: 401,
    });
    expect(await authenticate(request('bogus'), env)).toMatchObject({
      ok: false,
      status: 401,
      code: 'UNAUTHENTICATED',
    });
  });

  it('fails closed on an upstream 530', async () => {
    const { env } = harness({ entitlements: 'origin unreachable', status: 530 });
    expect(await authenticate(request(), env)).toMatchObject({
      ok: false,
      status: 502,
      code: 'ENTITLEMENTS_ERROR',
    });
  });

  it('fails closed on a redirect instead of following it with the bearer', async () => {
    const { env } = harness({ entitlements: '', status: 302 });
    expect(await authenticate(request(), env)).toMatchObject({ ok: false, status: 502 });
  });

  it.each([
    ['a non-JSON body', 'not json'],
    ['a body without status', { userId: 'user-1', entitlements: {} }],
    ['a body without entitlements', { status: 'active', userId: 'user-1' }],
    ['a body without a subject', { status: 'active', entitlements: { kits: {} } }],
    [
      'kits that are not an object',
      { status: 'active', userId: 'user-1', entitlements: { kits: ['engineer'] } },
    ],
    [
      'an agentkitApp that is not a boolean',
      { status: 'active', userId: 'user-1', entitlements: { agentkitApp: 'yes' } },
    ],
  ])('fails closed on %s', async (_label, body) => {
    const { env } = harness({ entitlements: body });
    expect(await authenticate(request(), env)).toMatchObject({
      ok: false,
      status: 502,
      code: 'ENTITLEMENTS_MALFORMED',
    });
  });

  it('fails closed when the endpoint cannot be reached', async () => {
    const { env } = harness();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    expect(await authenticate(request(), env)).toMatchObject({
      code: 'ENTITLEMENTS_UNREACHABLE',
    });
  });

  it('never calls the endpoint without a bearer', async () => {
    const { env, fetchMock } = harness();
    expect(await authenticate(request(null), env)).toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps a license-only principal in its own subject namespace', () => {
    const { userId: _userId, ...licenseOnly } = activeEntitlements();
    expect(principalFromEntitlements(licenseOnly)).toMatchObject({
      ok: true,
      principal: { subject: 'license:lic-1' },
    });
  });

  it('grants nothing without an active kit or app entitlement', () => {
    expect(scopesFor({ agentkitApp: false, activeKits: [] })).toEqual([]);
    expect(scopesFor({ agentkitApp: false, activeKits: ['engineer'] })).toEqual([
      'render',
      'share',
    ]);
  });
});

describe('entitlements: scopes stay separate grants', () => {
  const renderOnly = { subject: 'user-1', scopes: ['render'] as const };
  const shareOnly = { subject: 'user-1', scopes: ['share'] as const };

  it('does not let a render grant publish, or a share grant render', () => {
    expect(authorize(renderOnly, 'share')).toMatchObject({ ok: false, status: 403 });
    expect(authorize(shareOnly, 'render')).toMatchObject({ ok: false, status: 403 });
    expect(authorize(renderOnly, 'render').ok).toBe(true);
  });

  it('requires every scope for a combined action', () => {
    expect(authorizeAll({ ok: true, principal: renderOnly }, ['render', 'share'])).toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
    });
    expect(
      authorizeAll({ ok: true, principal: { subject: 'u', scopes: ['render', 'share'] } }, [
        'render',
        'share',
      ]).ok,
    ).toBe(true);
  });
});
