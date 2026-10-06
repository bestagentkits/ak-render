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
 *   - a stored artifact URL in place of a filesystem path for `render`.
 *
 * `catalog`, `describe` and `themes` answer without a bearer: they take no spec,
 * read only static compiler data, and their output is bounded, so they cost
 * about as much as serving a static file and let a client discover the server
 * before it is configured with a token. `validate` parses an arbitrary spec,
 * so it needs a bearer with the render grant and counts against its own limit.
 */

import { handleMcpHttpRequest } from '../../../src/mcp/mcp-http-transport.js';
import { failure, text, type ToolResult } from '../../../src/mcp/mcp-protocol.js';
import {
  BUILTIN_THEMES_TOOL,
  CATALOG_TOOL,
  DESCRIBE_TOOL,
  type McpTool,
  optionalTheme,
  REMOTE_RENDER_DEFINITION,
  VALIDATE_TOOL,
} from '../../../src/mcp/mcp-tool-definitions.js';
import {
  type AuthOutcome,
  authenticate,
  authorizeAll,
  type Principal,
  type Scope,
} from './auth.js';
import type { Env } from './bindings.js';
import { MAX_REQUEST_BYTES, type RateLimitKey } from './config.js';
import { withinRateLimit } from './rate-limit.js';
import { renderArtifact } from './render.js';
import { createArtifact, createShare } from './share.js';

export const REMOTE_INSTRUCTIONS = `AK Render compiles a Page Spec (YAML or JSON) into one self-contained, offline HTML file.
Loop: call catalog once, describe only the block types you plan to use, validate the spec and fix every diagnostic by its JSON path, then render.
On this remote server render stores the page and returns its artifactUrl and a short summary, never the HTML. Pass share: true for a longer-lived share link.
validate and render need an AgentKit bearer token in the Authorization header.
Describe meaning, not presentation: the compiler owns layout, colour, typography and motion.`;

/** Per-request context every remote tool call receives. */
export interface RemoteMcpContext {
  env: Env;
  now: Date;
  /** Origin artifact URLs are built against: the endpoint the caller reached. */
  origin: string;
  /** The request's principal, resolved at most once per HTTP request. */
  principal: () => Promise<AuthOutcome>;
}

type RemoteTool = McpTool<RemoteMcpContext, ToolResult | Promise<ToolResult>>;

/**
 * Authenticate, check every scope, then count every rate-limit key. Any
 * failure becomes a tool error carrying the same code the REST route returns.
 */
async function guard(
  context: RemoteMcpContext,
  scopes: readonly Scope[],
  limits: readonly RateLimitKey[],
): Promise<{ ok: true; principal: Principal } | { ok: false; result: ToolResult }> {
  const outcome = authorizeAll(await context.principal(), scopes);
  if (!outcome.ok) {
    return { ok: false, result: failure({ code: outcome.code, message: outcome.message }) };
  }
  for (const limit of limits) {
    if (!(await withinRateLimit(context.env, outcome.principal.subject, limit, context.now))) {
      return {
        ok: false,
        result: failure({ code: 'RATE_LIMITED', message: `too many ${limit} requests` }),
      };
    }
  }
  return { ok: true, principal: outcome.principal };
}

const REMOTE_VALIDATE_TOOL: RemoteTool = {
  ...VALIDATE_TOOL,
  run: async (args, context) => {
    const guarded = await guard(context, ['render'], ['validate']);
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
    const guarded = await guard(
      context,
      share ? ['render', 'share'] : ['render'],
      share ? ['render', 'share'] : ['render'],
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
  CATALOG_TOOL,
  DESCRIBE_TOOL,
  REMOTE_VALIDATE_TOOL,
  REMOTE_RENDER_TOOL,
  BUILTIN_THEMES_TOOL,
];

export function handleMcp(request: Request, env: Env, now: Date): Promise<Response> {
  let principal: Promise<AuthOutcome> | undefined;
  const context: RemoteMcpContext = {
    env,
    now,
    origin: new URL(request.url).origin,
    // Lazy: an unauthenticated discovery call never reaches the entitlements
    // endpoint, and a batch authenticates once.
    principal: () => {
      principal ??= authenticate(request, env);
      return principal;
    },
  };
  return handleMcpHttpRequest(request, {
    tools: REMOTE_TOOLS,
    context,
    instructions: REMOTE_INSTRUCTIONS,
    maxRequestBytes: MAX_REQUEST_BYTES,
  });
}
