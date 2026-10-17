import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOWNLOAD_URL_TTL_SECONDS } from '../../apps/cloud/src/config.js';
import { handleRequest } from '../../apps/cloud/src/index.js';
import { purgeExpiredShares } from '../../apps/cloud/src/share.js';
import {
  activeEntitlements,
  harness,
  ORIGIN,
  SPEC,
  TOKEN,
  YAML_SPEC,
} from './support/cloud-worker-harness.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Env = Parameters<typeof handleRequest>[1];

let nextId = 1;

async function tool(
  env: Env,
  name: string,
  args: Record<string, unknown>,
  token: string | null = TOKEN,
  now?: Date,
): Promise<{ isError: boolean; payload: Record<string, unknown> }> {
  const response = await handleRequest(
    new Request(`${ORIGIN}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'mcp-protocol-version': '2025-11-25',
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: nextId++,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    }),
    env,
    now,
  );
  const body = (await response.json()) as {
    result: { isError?: boolean; content: { text: string }[] };
  };
  const raw = body.result.content[0]?.text ?? '';
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    payload = { text: raw };
  }
  return { isError: body.result.isError === true, payload };
}

async function render(env: Env, args: Record<string, unknown> = {}): Promise<string> {
  const rendered = await tool(env, 'render', { spec: SPEC, ...args });
  expect(rendered.isError).toBe(false);
  return rendered.payload['artifactUrl'] as string;
}

async function exportUrls(
  env: Env,
  artifact: string,
  formats?: string[],
  now?: Date,
): Promise<Record<string, string>> {
  const exported = await tool(
    env,
    'artifact-export',
    { artifact, ...(formats === undefined ? {} : { formats }) },
    TOKEN,
    now,
  );
  expect(exported.isError, JSON.stringify(exported.payload)).toBe(false);
  return exported.payload['downloads'] as Record<string, string>;
}

const get = (env: Env, url: string, now?: Date) =>
  handleRequest(new Request(url, { method: 'GET' }), env, now);

describe('remote MCP render: retainSpec', () => {
  it('keeps nothing but the page by default', async () => {
    const { env, r2 } = harness();
    const rendered = await tool(env, 'render', { spec: SPEC });
    expect(rendered.payload['specRetained']).toBeUndefined();
    expect([...r2.objects.keys()]).toHaveLength(1);
  });

  it('keeps the YAML source byte for byte, with the page owner and expiry', async () => {
    const { env, r2 } = harness();
    const rendered = await tool(env, 'render', { spec: YAML_SPEC, retainSpec: true });
    expect(rendered.payload['specRetained']).toBe(true);
    const id = (rendered.payload['artifactUrl'] as string).split('/').at(-1) as string;
    const page = r2.objects.get(`artifact/${id}`);
    const spec = r2.objects.get(`artifact/${id}.spec`);
    expect(spec?.value).toBe(YAML_SPEC);
    expect(spec?.httpMetadata?.contentType).toMatch(/^application\/yaml/u);
    expect(spec?.customMetadata?.['owner']).toBe('user-1');
    expect(spec?.customMetadata?.['expiresAt']).toBe(page?.customMetadata?.['expiresAt']);
    expect(page?.customMetadata?.['spec']).toBe('yaml');
  });

  it('refuses a non-boolean retainSpec', async () => {
    const { env } = harness();
    const refused = await tool(env, 'render', { spec: SPEC, retainSpec: 'yes' });
    expect(refused.isError).toBe(true);
  });
});

describe('remote MCP artifact-export', () => {
  it('returns signed html and spec URLs that download the stored bytes, never the content', async () => {
    const { env } = harness();
    const artifactUrl = await render(env, { retainSpec: true });
    const exported = await tool(env, 'artifact-export', {
      artifact: artifactUrl,
      formats: ['html', 'spec'],
    });
    expect(exported.isError).toBe(false);
    expect(JSON.stringify(exported.payload)).not.toContain('<html');
    const downloads = exported.payload['downloads'] as Record<string, string>;
    expect(Object.keys(downloads)).toEqual(['html', 'spec']);

    const page = await get(env, artifactUrl);
    const html = await get(env, downloads['html'] as string);
    expect(html.status).toBe(200);
    expect(await html.text()).toBe(await page.text());
    expect(html.headers.get('content-disposition')).toMatch(/^attachment; filename=".+\.html"$/u);
    expect(html.headers.get('content-security-policy')).toContain('sandbox');
    expect(html.headers.get('cache-control')).toBe('private, no-store');
    expect(html.headers.get('x-content-type-options')).toBe('nosniff');
    expect(html.headers.get('referrer-policy')).toBe('no-referrer');

    const spec = await get(env, downloads['spec'] as string);
    expect(spec.status).toBe(200);
    expect(spec.headers.get('content-type')).toMatch(/^application\/json/u);
    expect(spec.headers.get('content-disposition')).toMatch(/\.json"$/u);
    // A parsed object comes back as JSON the compiler reads as the same spec.
    expect(JSON.parse(await spec.text())).toEqual(SPEC);
  });

  it('accepts a bare id and defaults to html', async () => {
    const { env } = harness();
    const id = (await render(env)).split('/').at(-1) as string;
    expect(Object.keys(await exportUrls(env, id))).toEqual(['html']);
  });

  it('names a theme argument the retained spec does not carry', async () => {
    const { env } = harness();
    const artifactUrl = await render(env, { retainSpec: true, theme: 'editorial' });
    const exported = await tool(env, 'artifact-export', { artifact: artifactUrl });
    expect(exported.payload['themeOverride']).toBe('editorial');
  });

  it('refuses spec for a page rendered without retainSpec', async () => {
    const { env } = harness();
    const exported = await tool(env, 'artifact-export', {
      artifact: await render(env),
      formats: ['spec'],
    });
    expect(exported.isError).toBe(true);
    expect(exported.payload['code']).toBe('SPEC_NOT_RETAINED');
  });

  it('makes png and pdf once, stores them beside the page, and reuses them', async () => {
    const { env, r2, browserCalls, limits } = harness({ browser: true });
    const artifactUrl = await render(env);
    const id = artifactUrl.split('/').at(-1) as string;
    const first = await exportUrls(env, artifactUrl, ['png', 'pdf']);
    expect(browserCalls.map((call) => call.action)).toEqual(['screenshot', 'pdf']);
    expect(r2.objects.has(`artifact/${id}.png`)).toBe(true);
    expect(r2.objects.get(`artifact/${id}.pdf`)?.customMetadata?.['expiresAt']).toBe(
      r2.objects.get(`artifact/${id}`)?.customMetadata?.['expiresAt'],
    );
    expect(limits.export.counts.get('user-1')).toBe(1);

    await exportUrls(env, artifactUrl, ['png', 'pdf']);
    // Reuse costs no browser call, but png or pdf always counts as an export.
    expect(browserCalls).toHaveLength(2);
    expect(limits.export.counts.get('user-1')).toBe(2);
    expect(limits.validate.counts.get('user-1')).toBeUndefined();

    const png = await get(env, first['png'] as string);
    expect(png.status).toBe(200);
    expect(png.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await png.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    const pdf = await get(env, first['pdf'] as string);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
  });

  it('answers EXPORT_UNAVAILABLE for png without a Browser Run binding', async () => {
    const { env } = harness();
    const exported = await tool(env, 'artifact-export', {
      artifact: await render(env),
      formats: ['png'],
    });
    expect(exported.payload['code']).toBe('EXPORT_UNAVAILABLE');
  });

  it('exports a share, and revoking the share removes its spec and exports', async () => {
    const { env, r2 } = harness({ browser: true });
    const shareUrl = await render(env, { share: true, retainSpec: true });
    expect(shareUrl).toContain('/v1/share/');
    const downloads = await exportUrls(env, shareUrl, ['html', 'spec', 'png']);
    const id = shareUrl.split('/').at(-1) as string;
    expect([...r2.objects.keys()].sort()).toEqual(
      [`share/${id}`, `share/${id}.png`, `share/${id}.spec`].sort(),
    );

    const revoked = await handleRequest(
      new Request(shareUrl, { method: 'DELETE', headers: { authorization: `Bearer ${TOKEN}` } }),
      env,
    );
    expect(revoked.status).toBe(200);
    expect(r2.objects.size).toBe(0);
    // The URLs are still signed and unexpired, but there is nothing to serve.
    for (const url of Object.values(downloads)) {
      expect((await get(env, url)).status).toBe(404);
    }
  });

  it("answers another user's page exactly like a missing one", async () => {
    const owner = harness();
    const artifactUrl = await render(owner.env);
    const other = harness({ entitlements: activeEntitlements('user-2') });
    other.env.RENDER_SHARES = owner.env.RENDER_SHARES;
    const exported = await tool(other.env, 'artifact-export', { artifact: artifactUrl });
    expect(exported.payload['code']).toBe('NOT_FOUND');
    const missing = await tool(other.env, 'artifact-export', {
      artifact: `${ORIGIN}/v1/artifact/00000000-0000-4000-8000-000000000000`,
    });
    expect(missing.payload).toEqual(exported.payload);
  });

  it("answers another user's expired page like a missing one too", async () => {
    const owner = harness();
    const start = new Date('2026-10-17T00:00:00Z');
    const rendered = await tool(owner.env, 'render', { spec: SPEC }, TOKEN, start);
    const artifactUrl = rendered.payload['artifactUrl'] as string;
    const later = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    expect(
      (await tool(owner.env, 'artifact-export', { artifact: artifactUrl }, TOKEN, later)).payload[
        'code'
      ],
    ).toBe('EXPIRED');
    const other = harness({ entitlements: activeEntitlements('user-2') });
    other.env.RENDER_SHARES = owner.env.RENDER_SHARES;
    const foreign = await tool(
      other.env,
      'artifact-export',
      { artifact: artifactUrl },
      TOKEN,
      later,
    );
    expect(foreign.payload['code']).toBe('NOT_FOUND');
  });

  it('counts a refused export before any storage read, so failures are not free', async () => {
    const { env, r2, limits } = harness({ limits: { validate: 2 } });
    const artifactUrl = await render(env);
    const before = r2.calls.length;
    for (let call = 0; call < 2; call += 1) {
      const refused = await tool(env, 'artifact-export', {
        artifact: artifactUrl,
        formats: ['spec'],
      });
      expect(refused.payload['code']).toBe('SPEC_NOT_RETAINED');
    }
    expect(limits.validate.counts.get('user-1')).toBe(2);
    const limited = await tool(env, 'artifact-export', {
      artifact: artifactUrl,
      formats: ['spec'],
    });
    expect(limited.payload['code']).toBe('RATE_LIMITED');
    // The limited call read nothing; the two refused ones read metadata only.
    const after = r2.calls.slice(before);
    expect(after.filter((call) => call.method === 'get')).toEqual([]);
    expect(after.filter((call) => call.method === 'head')).toHaveLength(2);
  });

  it('passes a failed browser export through and stores nothing', async () => {
    const { env, r2 } = harness({ browser: true });
    env.BROWSER = { quickAction: async () => new Response('busy', { status: 503 }) };
    const artifactUrl = await render(env);
    const exported = await tool(env, 'artifact-export', {
      artifact: artifactUrl,
      formats: ['pdf'],
    });
    expect(exported.payload['code']).toBe('EXPORT_FAILED');
    expect([...r2.objects.keys()].some((key) => key.endsWith('.pdf'))).toBe(false);
  });

  it('sweeps an expired page together with its spec and exports', async () => {
    const { env, r2 } = harness({ browser: true });
    const start = new Date('2026-10-17T00:00:00Z');
    const rendered = await tool(env, 'render', { spec: SPEC, retainSpec: true }, TOKEN, start);
    await exportUrls(env, rendered.payload['artifactUrl'] as string, ['png', 'pdf'], start);
    expect(r2.objects.size).toBe(4);
    const removed = await purgeExpiredShares(env, new Date(start.getTime() + 2 * 60 * 60 * 1000));
    expect(removed).toBe(4);
    expect(r2.objects.size).toBe(0);
  });

  it('requires a bearer and validates its arguments', async () => {
    const { env } = harness();
    const unauthenticated = await tool(env, 'artifact-export', { artifact: SPEC_ID }, null);
    expect(unauthenticated.payload['code']).toBe('UNAUTHENTICATED');
    for (const args of [
      { artifact: 'not-an-id' },
      { artifact: `${ORIGIN}/v1/other/${SPEC_ID}` },
      { artifact: SPEC_ID, formats: [] },
      { artifact: SPEC_ID, formats: ['docx'] },
    ]) {
      expect((await tool(env, 'artifact-export', args)).isError).toBe(true);
    }
  });

  it('answers DOWNLOAD_UNAVAILABLE without a usable signing key', async () => {
    const { env } = harness();
    const artifactUrl = await render(env);
    const downloads = await exportUrls(env, artifactUrl);
    const { DOWNLOAD_SIGNING_KEY: _key, ...withoutKey } = env;
    for (const unsigned of [withoutKey, { ...env, DOWNLOAD_SIGNING_KEY: 'too-short' }]) {
      const exported = await tool(unsigned, 'artifact-export', { artifact: artifactUrl });
      expect(exported.payload['code']).toBe('DOWNLOAD_UNAVAILABLE');
      expect((await get(unsigned, downloads['html'] as string)).status).toBe(501);
    }
  });
});

const SPEC_ID = '11111111-2222-4333-8444-555555555555';

describe('signed download route', () => {
  it('refuses a tampered, foreign-key or malformed URL before reading storage', async () => {
    const { env, r2 } = harness({ browser: true });
    const artifactUrl = await render(env, { retainSpec: true });
    const { html } = await exportUrls(env, artifactUrl);
    const url = new URL(html as string);
    const otherId = url.pathname.replace(/[0-9a-f-]{36}/u, SPEC_ID);
    const reads = () =>
      r2.calls.filter((call) => call.method === 'get' || call.method === 'head').length;
    const before = reads();

    const tampered = [
      `${ORIGIN}${url.pathname.replace('/html', '/spec')}${url.search}`,
      `${ORIGIN}${otherId}${url.search}`,
      `${ORIGIN}${url.pathname}?exp=${Number(url.searchParams.get('exp')) + 1}&sig=${url.searchParams.get('sig')}`,
      `${ORIGIN}${url.pathname}?exp=${url.searchParams.get('exp')}`,
    ];
    for (const target of tampered) {
      expect((await get(env, target)).status, target).toBe(403);
    }
    const foreign = { ...env, DOWNLOAD_SIGNING_KEY: 'another-signing-key-0123456789abcdefghij' };
    expect((await get(foreign, html as string)).status).toBe(403);
    expect((await get(env, `${ORIGIN}/v1/download/artifact/x/html?exp=1&sig=a`)).status).toBe(404);
    expect(reads()).toBe(before);
  });

  it('expires the link after its own TTL and never outlives the page', async () => {
    const { env } = harness();
    const start = new Date('2026-10-17T00:00:00Z');
    const rendered = await tool(env, 'render', { spec: SPEC }, TOKEN, start);
    const artifactUrl = rendered.payload['artifactUrl'] as string;
    // Exported 30 minutes in: the page lives 30 more minutes, so the link does too.
    const later = new Date(start.getTime() + 30 * 60 * 1000);
    const exported = await tool(env, 'artifact-export', { artifact: artifactUrl }, TOKEN, later);
    expect(exported.payload['urlsExpireAt']).toBe(exported.payload['expiresAt']);
    const { html } = exported.payload['downloads'] as Record<string, string>;
    expect((await get(env, html as string, later)).status).toBe(200);
    const after = new Date(start.getTime() + 61 * 60 * 1000);
    expect((await get(env, html as string, after)).status).toBe(410);
  });

  it('caps a share link at the download TTL', async () => {
    const { env } = harness();
    const now = new Date('2026-10-17T00:00:00Z');
    const rendered = await tool(env, 'render', { spec: SPEC, share: true }, TOKEN, now);
    const exported = await tool(
      env,
      'artifact-export',
      { artifact: rendered.payload['artifactUrl'] },
      TOKEN,
      now,
    );
    expect(Date.parse(exported.payload['urlsExpireAt'] as string)).toBe(
      now.getTime() + DOWNLOAD_URL_TTL_SECONDS * 1000,
    );
    const { html } = exported.payload['downloads'] as Record<string, string>;
    const past = new Date(now.getTime() + (DOWNLOAD_URL_TTL_SECONDS + 1) * 1000);
    const expired = await get(env, html as string, past);
    expect(expired.status).toBe(410);
    expect(((await expired.json()) as { code: string }).code).toBe('LINK_EXPIRED');
  });
});
