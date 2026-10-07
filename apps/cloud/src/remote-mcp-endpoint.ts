/**
 * The remote MCP endpoint: `POST /mcp` over Streamable HTTP.
 *
 * This is the package's transport-independent MCP server wired to the worker.
 * Tool names, descriptions and schemas come from the shared tool contract; the
 * HTTP framing comes from the package's Fetch-API transport. What this module
 * adds is what only a hosted server needs:
 *
 *   - authorization per tool, with the same scopes as the REST routes;
 *   - the same per-subject rate limits, so MCP is not a way around REST limits;
 *   - the same request, output and node budgets (the body ceiling here, the
 *     output and node ceilings inside `renderArtifact`);
 *   - a stored artifact URL in place of a filesystem path for `render`;
 *   - error results that never carry an internal message.
 *
 * `catalog`, `search-catalog`, `describe`, `recipes`, `recipe` and `themes`
 * answer without a bearer so a client can discover the server before it is
 * configured with a token. They take no spec and read only static compiler
 * data (a search query is at most 200 characters), but each call still builds a response of
 * several kilobytes, so they count per client IP, and the transport caps a
 * batch at 16 members. `validate` parses an arbitrary spec, so it needs a
 * bearer with the render grant and counts against its own limit.
 *
 * A request that presents a bearer is authenticated before any message runs.
 * A rejected bearer answers HTTP 401 with `WWW-Authenticate: Bearer`, which is
 * what an MCP client expects from a protected resource. Where OAuth is enabled
 * (`OAUTH_RESOURCE`), a request without a bearer gets the same 401, carrying
 * the protected-resource metadata URL so the client can sign in. Otherwise it
 * is still served: discovery works, and `validate`/`render` answer a tool
 * error with code `UNAUTHENTICATED`.
 */

import { handleMcpHttpRequest } from '../../../src/mcp/mcp-http-transport.js';
import {
  failure,
  JSON_RPC_ERRORS,
  publicToolErrorResult,
  rpcError,
  text,
  type ToolResult,
} from '../../../src/mcp/mcp-protocol.js';
import {
  BUILTIN_THEMES_TOOL,
  CATALOG_TOOL,
  DESCRIBE_TOOL,
  type McpTool,
  optionalTheme,
  RECIPE_TOOL,
  RECIPES_TOOL,
  REMOTE_RENDER_DEFINITION,
  SEARCH_CATALOG_TOOL,
  VALIDATE_TOOL,
} from '../../../src/mcp/mcp-tool-definitions.js';
import {
  type AuthOutcome,
  authenticate,
  authorizeAll,
  bearerChallenge,
  type Principal,
  type Scope,
} from './auth.js';
import type { Env } from './bindings.js';
import { MAX_REQUEST_BYTES, type RateLimitKey } from './config.js';
import { oauthConfig } from './oauth-access-token.js';
import { clientIp, withinRateLimit } from './rate-limit.js';
import { renderArtifact } from './render.js';
import { createArtifact, createShare } from './share.js';

export const REMOTE_INSTRUCTIONS = `AK Render compiles a Page Spec (YAML or JSON) into one self-contained, offline HTML file.
Loop: call catalog once (or search-catalog with a few words), describe only the block types you plan to use (several at once with types, compact: true for the short form), optionally start from a recipe (list them with recipes), validate the spec and fix every diagnostic by its JSON path, then render.
On this remote server render stores the page and returns its artifactUrl and a short summary, never the HTML. Pass share: true for a longer-lived share link.
validate and render need an AgentKit API key or OAuth access token as the bearer in the Authorization header.
Describe meaning, not presentation: the compiler owns layout, colour, typography and motion.`;

/** Per-request context every remote tool call receives. */
export interface RemoteMcpContext {
  env: Env;
  now: Date;
  /** Origin artifact URLs are built against: the endpoint the caller reached. */
  origin: string;
  /** The caller's IP, the key for the limits that apply before a bearer. */
  clientIp: string;
  /** The request's principal, resolved at most once per HTTP request. */
  principal: () => Promise<AuthOutcome>;
}

type RemoteTool = McpTool<RemoteMcpContext, ToolResult | Promise<ToolResult>>;

const rateLimited = (limit: RateLimitKey): ToolResult =>
  failure({ code: 'RATE_LIMITED', message: `too many ${limit} requests` });

/**
 * Authenticate, check every scope, then count the one rate-limit class the
 * call belongs to. Scopes are checked before anything is counted, so a refused
 * call consumes nothing. Any failure becomes a tool error carrying the same
 * code the REST route returns.
 */
async function guard(
  context: RemoteMcpContext,
  scopes: readonly Scope[],
  limit: RateLimitKey,
): Promise<{ ok: true; principal: Principal } | { ok: false; result: ToolResult }> {
  const outcome = authorizeAll(await context.principal(), scopes);
  if (!outcome.ok) {
    return { ok: false, result: failure({ code: outcome.code, message: outcome.message }) };
  }
  if (!(await withinRateLimit(context.env, limit, outcome.principal.subject))) {
    return { ok: false, result: rateLimited(limit) };
  }
  return { ok: true, principal: outcome.principal };
}

/** A tool that answers without a bearer, counted per client IP. */
function anonymous(tool: McpTool<unknown>): RemoteTool {
  return {
    ...tool,
    run: async (args, context) => {
      if (!(await withinRateLimit(context.env, 'anon-ip', context.clientIp))) {
        return rateLimited('anon-ip');
      }
      return tool.run(args, context);
    },
  };
}

const REMOTE_VALIDATE_TOOL: RemoteTool = {
  ...VALIDATE_TOOL,
  run: async (args, context) => {
    const guarded = await guard(context, ['render'], 'validate');
    if (!guarded.ok) return guarded.result;
    return VALIDATE_TOOL.run(args, context);
  },
};

const REMOTE_RENDER_TOOL: RemoteTool = {
  ...REMOTE_RENDER_DEFINITION,
  run: async (args, context) => {
    const share = args.share === true;
    if (args.share !== undefined && typeof args.share !== 'boolean') {
      return failure('"share" must be a boolean');
    }
    // A shared render counts against `share` only, exactly like POST /v1/share:
    // each call consumes the one class that matches what it stores.
    const guarded = await guard(
      context,
      share ? ['render', 'share'] : ['render'],
      share ? 'share' : 'render',
    );
    if (!guarded.ok) return guarded.result;

    const theme = optionalTheme(args);
    // The same compile path as POST /v1/render, budgets included, so the stored
    // bytes are exactly what the REST route would have returned.
    const rendered = renderArtifact(
      { spec: args.spec, ...(theme === undefined ? {} : { theme }) },
      context.env,
    );
    if (!rendered.ok) {
      return failure({
        code: rendered.code,
        message: rendered.message,
        ...(rendered.details === undefined ? {} : { details: rendered.details }),
      });
    }
    const stored = share
      ? await createShare(context.env, guarded.principal, rendered.artifact, context.now)
      : await createArtifact(context.env, guarded.principal, rendered.artifact, context.now);
    return text({
      ...rendered.artifact.summary,
      artifactUrl: `${context.origin}${stored.url}`,
      expiresAt: stored.expiresAt,
      shared: share,
      version: rendered.artifact.version,
    });
  },
};

/** Remote tools, in the same order and with the same names as the stdio server. */
export const REMOTE_TOOLS: readonly RemoteTool[] = [
  anonymous(CATALOG_TOOL),
  anonymous(SEARCH_CATALOG_TOOL),
  anonymous(DESCRIBE_TOOL),
  anonymous(RECIPES_TOOL),
  anonymous(RECIPE_TOOL),
  REMOTE_VALIDATE_TOOL,
  REMOTE_RENDER_TOOL,
  anonymous(BUILTIN_THEMES_TOOL),
];

/** HTTP 401 for a rejected bearer, or a missing one where OAuth can supply it. */
function rejectedBearer(request: Request, env: Env, message: string): Response {
  return new Response(JSON.stringify(rpcError(null, JSON_RPC_ERRORS.invalidRequest, message)), {
    status: 401,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'www-authenticate': bearerChallenge(request, env),
    },
  });
}

export function handleMcp(request: Request, env: Env, now: Date): Promise<Response> {
  let principal: Promise<AuthOutcome> | undefined;
  const context: RemoteMcpContext = {
    env,
    now,
    origin: new URL(request.url).origin,
    clientIp: clientIp(request),
    // Resolved at most once per HTTP request: a batch authenticates once, and a
    // request without a bearer never reaches the entitlements endpoint.
    principal: () => {
      principal ??= authenticate(request, env, now.getTime());
      return principal;
    },
  };
  return handleMcpHttpRequest(request, {
    tools: REMOTE_TOOLS,
    context,
    instructions: REMOTE_INSTRUCTIONS,
    maxRequestBytes: MAX_REQUEST_BYTES,
    toolError: publicToolErrorResult,
    // A presented bearer is checked before any message runs, so a rejected one
    // is an HTTP 401 an MCP client can act on, not a tool result.
    //
    // Where OAuth is enabled, a request without a bearer is refused the same
    // way: that 401 and its `resource_metadata` are what make an MCP client
    // start the sign-in flow. Without OAuth there is no way for a client to
    // obtain a token interactively, so discovery stays anonymous.
    preflight: async () => {
      if (!request.headers.has('authorization')) {
        return oauthConfig(env) === undefined
          ? undefined
          : rejectedBearer(request, env, 'a bearer token is required');
      }
      const outcome = await context.principal();
      return !outcome.ok && outcome.status === 401
        ? rejectedBearer(request, env, outcome.message)
        : undefined;
    },
  });
}
