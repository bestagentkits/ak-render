/**
 * The opt-in cloud renderer.
 *
 * Local mode never contacts this worker: nothing in the compiler or the CLI
 * references it, and an artifact is produced entirely offline. Uploading is an
 * explicit call to one of the routes below, and each route is separately
 * scoped, budgeted, and rate limited.
 *
 *   POST   /v1/render          compile and return HTML. Nothing is stored.
 *   POST   /v1/share           compile and publish one artifact as an expiring share.
 *   POST   /v1/screenshot      compile and export a PNG through Browser Run.
 *   POST   /v1/pdf             compile and export a PDF through Browser Run.
 *   GET    /v1/share/:id       serve one valid, unexpired share.
 *   DELETE /v1/share/:id       revoke a share the caller owns.
 *
 * No content telemetry. No analytics. The bearer is validated against the
 * canonical AgentKit entitlements endpoint and is never persisted.
 */

import { authenticate, authorize, type AuthOutcome, type Principal, type Scope } from './auth.js';
import type { Env } from './bindings.js';
import { checkRequestBytes, RATE_LIMITS, RATE_WINDOW_SECONDS } from './config.js';
import { renderArtifact, type RenderPayload } from './render.js';
import { exportArtifact } from './screenshot.js';
import { createShare, purgeExpiredShares, readShare, revokeShare } from './share.js';

const JSON_TYPE = 'application/json; charset=utf-8';

function json(status: number, body: unknown): Response {
  return new Response(`${JSON.stringify(body)}\n`, {
    status,
    headers: { 'content-type': JSON_TYPE, 'cache-control': 'no-store' },
  });
}

function htmlResponse(html: string, cacheControl: string): Response {
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': cacheControl,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  });
}

/**
 * Fixed-window rate limit per subject and route.
 *
 * KV is eventually consistent, so two simultaneous requests can both read the
 * same count. That is a deliberate trade: the limit is a cost guard, not a
 * security boundary, and the budgets are the hard limit.
 */
async function withinRateLimit(env: Env, subject: string, route: string, now: Date): Promise<boolean> {
  const limit = RATE_LIMITS[route];
  if (limit === undefined) return true;
  const window = Math.floor(now.getTime() / 1000 / RATE_WINDOW_SECONDS);
  const key = `rl:${route}:${subject}:${window}`;
  const current = Number((await env.RATE_LIMIT.get(key)) ?? '0');
  if (current >= limit) return false;
  await env.RATE_LIMIT.put(key, String(current + 1), { expirationTtl: RATE_WINDOW_SECONDS * 2 });
  return true;
}

function denied(outcome: Extract<AuthOutcome, { ok: false }>): Response {
  return json(outcome.status, { code: outcome.code, message: outcome.message });
}

async function readPayload(
  request: Request,
): Promise<{ ok: true; payload: RenderPayload } | { ok: false; response: Response }> {
  const text = await request.text();
  const bytes = new TextEncoder().encode(text).length;
  const violation = checkRequestBytes(bytes);
  if (violation !== undefined) {
    return {
      ok: false,
      response: json(413, {
        code: 'BUDGET_EXCEEDED',
        message: `the request body exceeds the ${violation.budget} budget`,
        details: [violation],
      }),
    };
  }
  const contentType = request.headers.get('content-type') ?? '';
  // A YAML body is passed through as text: the compiler owns the boundary, so
  // the worker does not need a second parser.
  if (contentType.includes('yaml') || contentType.includes('text/plain')) {
    return { ok: true, payload: { spec: text } };
  }
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const payload: RenderPayload = { spec: parsed['spec'] };
    if (parsed['theme'] !== undefined) payload.theme = parsed['theme'];
    if (typeof parsed['themeToggle'] === 'boolean') payload.themeToggle = parsed['themeToggle'];
    return { ok: true, payload };
  } catch {
    return {
      ok: false,
      response: json(400, { code: 'INVALID_BODY', message: 'the body must be JSON or YAML' }),
    };
  }
}

async function requireScope(
  request: Request,
  env: Env,
  scope: Scope,
): Promise<{ ok: true; principal: Principal } | { ok: false; response: Response }> {
  const auth = await authenticate(request, env);
  if (!auth.ok) return { ok: false, response: denied(auth) };
  const permitted = authorize(auth.principal, scope);
  if (!permitted.ok) return { ok: false, response: denied(permitted) };
  return { ok: true, principal: auth.principal };
}

export async function handleRequest(
  request: Request,
  env: Env,
  now: Date = new Date(),
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  // --- preview: no bearer, but only a valid unexpired share resolves --------
  if (method === 'GET' && path.startsWith('/v1/share/')) {
    const id = path.slice('/v1/share/'.length);
    const found = await readShare(env, id, now);
    if (!found.ok) return json(found.status, { code: found.code, message: found.message });
    return htmlResponse(found.html, 'public, max-age=60');
  }

  // --- revoke: share scope, owner only -------------------------------------
  if (method === 'DELETE' && path.startsWith('/v1/share/')) {
    const scoped = await requireScope(request, env, 'share');
    if (!scoped.ok) return scoped.response;
    const id = path.slice('/v1/share/'.length);
    const revoked = await revokeShare(env, scoped.principal, id);
    if (!revoked.ok) {
      return json(revoked.status, {
        code: revoked.status === 403 ? 'FORBIDDEN' : 'NOT_FOUND',
        message: revoked.status === 403 ? 'only the owner can revoke this share' : 'no such share',
      });
    }
    return json(200, { id, revoked: true });
  }

  // --- render and export ---------------------------------------------------
  const scopeFor: Record<string, Scope> = {
    '/v1/render': 'render',
    '/v1/share': 'share',
    '/v1/screenshot': 'render',
    '/v1/pdf': 'render',
  };
  const scope = scopeFor[path];
  if (scope === undefined || method !== 'POST') {
    return json(404, { code: 'NOT_FOUND', message: 'no such route' });
  }

  const scoped = await requireScope(request, env, scope);
  if (!scoped.ok) return scoped.response;

  const rateKey = path === '/v1/share' ? 'share' : path === '/v1/render' ? 'render' : 'export';
  if (!(await withinRateLimit(env, scoped.principal.subject, rateKey, now))) {
    return json(429, { code: 'RATE_LIMITED', message: `too many ${rateKey} requests` });
  }

  const body = await readPayload(request);
  if (!body.ok) return body.response;

  const rendered = renderArtifact(body.payload, env);
  if (!rendered.ok) {
    return json(rendered.status, {
      code: rendered.code,
      message: rendered.message,
      ...(rendered.details === undefined ? {} : { details: rendered.details }),
    });
  }

  if (path === '/v1/render') {
    // A render response is not stored. Only an explicit share or export persists.
    return htmlResponse(rendered.artifact.html, 'no-store');
  }

  if (path === '/v1/share') {
    const record = await createShare(env, scoped.principal, rendered.artifact, now);
    return json(201, { id: record.id, url: record.url, expiresAt: record.expiresAt });
  }

  const exported = await exportArtifact(
    env,
    rendered.artifact.html,
    path === '/v1/pdf' ? 'pdf' : 'screenshot',
  );
  if (exported.code !== undefined) {
    return new Response(exported.body, {
      status: exported.status,
      headers: { 'content-type': exported.contentType, 'cache-control': 'no-store' },
    });
  }
  return new Response(exported.body, {
    status: exported.status,
    headers: { 'content-type': exported.contentType, 'cache-control': 'no-store' },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
  async scheduled(_event: unknown, env: Env): Promise<void> {
    await purgeExpiredShares(env);
  },
};
