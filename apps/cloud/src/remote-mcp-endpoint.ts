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
 * batch at 16 members. `validate` and `repair` parse an arbitrary spec, so they need a
 * bearer with the render grant and counts against its own limit.
 *
 * A request that presents a bearer is authenticated before any message runs.
 * A rejected bearer answers HTTP 401 with `WWW-Authenticate: Bearer`, which is
 * what an MCP client expects from a protected resource. Where OAuth is enabled
 * (`OAUTH_RESOURCE`), a request without a bearer gets the same 401, carrying
 * the protected-resource metadata URL so the client can sign in. Otherwise it
 * is still served: discovery works, and `validate`/`compose`/`render` answer a tool
 * error with code `UNAUTHENTICATED`.
 */

import { handleMcpHttpRequest } from '../../../src/mcp/mcp-http-transport.js';
import {
  failure,
  JSON_RPC_ERRORS,
  publicToolErrorResult,
  rpcError,
  SUPPORTED_VERSIONS,
  text,
  type ToolResult,
} from '../../../src/mcp/mcp-protocol.js';
import {
  AUDIT_MOTION_TOOL,
  BUILTIN_THEMES_TOOL,
  CATALOG_TOOL,
  composeReplyExtras,
  checkComposeFlags,
  composeToolStep,
  DESCRIBE_ICON_TOOL,
  DESCRIBE_TOOL,
  ICON_PACKS_TOOL,
  isComposeToolStep,
  type McpTool,
  MOTIONS_TOOL,
  PATCH_TOOL,
  optionalTheme,
  RECIPE_TOOL,
  RECIPES_TOOL,
  REMOTE_COMPOSE_DEFINITION,
  REMOTE_RENDER_DEFINITION,
  SEARCH_CATALOG_TOOL,
  SEARCH_ICONS_TOOL,
  REPAIR_TOOL,
  VALIDATE_TOOL,
} from '../../../src/mcp/mcp-tool-definitions.js';
import { PACKAGE_NAME, VERSION } from '../../../src/version.js';
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
Fastest path: compose builds a whole page from a typed intent and content (e.g. investment-report) in one call; pass dryRun or returnSpec to get the Page Spec back for edits.
Full control: call catalog once (or search-catalog with a few words), describe only the block types you plan to use (several at once with types, compact: true for the short form), find icons by meaning with search-icons (describe-icon, icon-packs for detail), find motion recipes with motions, optionally start from a recipe (list them with recipes), validate the spec and fix every diagnostic by its JSON path (repair applies the safe fixes; validate with suggest: true lists the rest as JSON Patches; audit-motion checks the motion it names), then render (themes lists the presets). For a later edit, send patch ops (paths like /blocks/@<id>/title) instead of rewriting the spec.
On this remote server render stores the page and returns its artifactUrl and a short summary, never the HTML. Pass share: true for a longer-lived share link.
validate, repair, patch, audit-motion, compose and render need an AgentKit API key or OAuth access token as the bearer in the Authorization header.
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

const REMOTE_REPAIR_TOOL: RemoteTool = {
  ...REPAIR_TOOL,
  run: async (args, context) => {
    // Up to REPAIR_MAX_ATTEMPTS revalidations per call: charged like a render.
    const guarded = await guard(context, ['render'], 'render');
    if (!guarded.ok) return guarded.result;
    return REPAIR_TOOL.run(args, context);
  },
};

const REMOTE_VALIDATE_TOOL: RemoteTool = {
  ...VALIDATE_TOOL,
  run: async (args, context) => {
    const guarded = await guard(context, ['render'], 'validate');
    if (!guarded.ok) return guarded.result;
    return VALIDATE_TOOL.run(args, context);
  },
};

/** `patch` is metered like `validate`: it parses and validates, and stores nothing. */
const REMOTE_PATCH_TOOL: RemoteTool = {
  ...PATCH_TOOL,
  run: async (args, context) => {
    const guarded = await guard(context, ['render'], 'validate');
    if (!guarded.ok) return guarded.result;
    return PATCH_TOOL.run(args, context);
  },
};

/**
 * The Worker refuses request bodies over MAX_REQUEST_BYTES. The schema states
 * that as an upper bound on the page: the envelope, escaping and multi-byte
 * characters all count against the same cap, so a page near it can still be
 * refused.
 */
const AUDIT_MOTION_PROPERTIES = AUDIT_MOTION_TOOL.inputSchema.properties as Record<string, object>;
const REMOTE_AUDIT_MOTION_SCHEMA = {
  ...AUDIT_MOTION_TOOL.inputSchema,
  properties: {
    ...AUDIT_MOTION_PROPERTIES,
    html: { ...AUDIT_MOTION_PROPERTIES.html, maxLength: MAX_REQUEST_BYTES },
  },
};

const REMOTE_AUDIT_MOTION_TOOL: RemoteTool = {
  ...AUDIT_MOTION_TOOL,
  inputSchema: REMOTE_AUDIT_MOTION_SCHEMA,
  run: async (args, context) => {
    const guarded = await guard(context, ['render'], 'validate');
    if (!guarded.ok) return guarded.result;
    return AUDIT_MOTION_TOOL.run(args, context);
  },
};

/** Check the `share` flag and run the guard for a storing call. */
async function guardStore(
  args: Record<string, unknown>,
  context: RemoteMcpContext,
): Promise<{ ok: true; principal: Principal; share: boolean } | { ok: false; result: ToolResult }> {
  if (args.share !== undefined && typeof args.share !== 'boolean') {
    return { ok: false, result: failure('"share" must be a boolean') };
  }
  const share = args.share === true;
  // A shared render counts against `share` only, exactly like POST /v1/share:
  // each call consumes the one class that matches what it stores.
  const guarded = await guard(
    context,
    share ? ['render', 'share'] : ['render'],
    share ? 'share' : 'render',
  );
  return guarded.ok ? { ...guarded, share } : guarded;
}

/**
 * Compile through the same path as POST /v1/render, budgets included, so the
 * stored bytes are exactly what the REST route would have returned, then store
 * the artifact and describe it.
 */
async function renderAndStore(
  spec: unknown,
  theme: string | undefined,
  principal: Principal,
  share: boolean,
  context: RemoteMcpContext,
): Promise<ToolResult | Record<string, unknown>> {
  const rendered = renderArtifact(
    { spec, ...(theme === undefined ? {} : { theme }) },
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
    ? await createShare(context.env, principal, rendered.artifact, context.now)
    : await createArtifact(context.env, principal, rendered.artifact, context.now);
  return {
    ...rendered.artifact.summary,
    artifactUrl: `${context.origin}${stored.url}`,
    expiresAt: stored.expiresAt,
    shared: share,
    version: rendered.artifact.version,
  };
}

function isToolResult(value: ToolResult | Record<string, unknown>): value is ToolResult {
  return Array.isArray(value.content);
}

const REMOTE_RENDER_TOOL: RemoteTool = {
  ...REMOTE_RENDER_DEFINITION,
  run: async (args, context) => {
    const guarded = await guardStore(args, context);
    if (!guarded.ok) return guarded.result;
    const stored = await renderAndStore(
      args.spec,
      optionalTheme(args),
      guarded.principal,
      guarded.share,
      context,
    );
    return isToolResult(stored) ? stored : text(stored);
  },
};

const REMOTE_COMPOSE_TOOL: RemoteTool = {
  ...REMOTE_COMPOSE_DEFINITION,
  run: async (args, context) => {
    checkComposeFlags(args);
    if (args.dryRun === true) {
      // A dry run stores nothing, so it is metered like validate.
      const guarded = await guard(context, ['render'], 'validate');
      if (!guarded.ok) return guarded.result;
      const step = composeToolStep(args);
      return isComposeToolStep(step) ? text({ ok: true, ...composeReplyExtras(step) }) : step;
    }
    const guarded = await guardStore(args, context);
    if (!guarded.ok) return guarded.result;
    const step = composeToolStep(args);
    if (!isComposeToolStep(step)) return step;
    // The theme is already in the composed spec.
    const stored = await renderAndStore(
      step.composed.spec,
      undefined,
      guarded.principal,
      guarded.share,
      context,
    );
    return isToolResult(stored) ? stored : text({ ok: true, ...stored, ...composeReplyExtras(step) });
  },
};

/** Remote tools, in the same order and with the same names as the stdio server. */
export const REMOTE_TOOLS: readonly RemoteTool[] = [
  anonymous(CATALOG_TOOL),
  anonymous(SEARCH_CATALOG_TOOL),
  anonymous(DESCRIBE_TOOL),
  anonymous(SEARCH_ICONS_TOOL),
  anonymous(DESCRIBE_ICON_TOOL),
  anonymous(ICON_PACKS_TOOL),
  anonymous(MOTIONS_TOOL),
  anonymous(RECIPES_TOOL),
  anonymous(RECIPE_TOOL),
  REMOTE_VALIDATE_TOOL,
  REMOTE_REPAIR_TOOL,
  REMOTE_PATCH_TOOL,
  REMOTE_AUDIT_MOTION_TOOL,
  REMOTE_COMPOSE_TOOL,
  REMOTE_RENDER_TOOL,
  anonymous(BUILTIN_THEMES_TOOL),
];

/** What `GET /v1/version` reports: enough to tell whether a deploy is current. */
export interface RemoteVersion {
  name: string;
  version: string;
  /** Commit the Worker was built from, or null when the deploy did not say. */
  build: string | null;
  protocolVersions: readonly string[];
  tools: string[];
}

export function remoteVersion(env: Pick<Env, 'BUILD_SHA'>): RemoteVersion {
  return {
    name: PACKAGE_NAME,
    version: VERSION,
    build: env.BUILD_SHA === undefined || env.BUILD_SHA === '' ? null : env.BUILD_SHA,
    protocolVersions: SUPPORTED_VERSIONS,
    tools: REMOTE_TOOLS.map((tool) => tool.name),
  };
}

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
