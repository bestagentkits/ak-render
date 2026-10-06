# Cloud renderer (opt-in)

A Cloudflare Worker that compiles Page Specs with **the same
`@bestagentkits/render` code** the local CLI uses. It is opt-in: local mode never
contacts it, and the compiler has no knowledge of it. Nothing here is required
to produce an artifact.

The reason to deploy it is what a local compile cannot do: serve agents that
cannot install Node (remote MCP), host a page behind a URL, hand someone an
expiring link, produce a PNG, and produce a PDF.

Production endpoint: **`https://render.agentkit.best`** (`/mcp` and `/v1/*`).
The `workers.dev` URL stays enabled as a fallback and is not documented for
callers.

## Remote MCP

`POST /mcp` speaks MCP over Streamable HTTP (protocol revisions 2024-11-05
through 2025-11-25). It is the package's own MCP server: the tool names,
descriptions and input schemas come from `src/mcp/mcp-tool-definitions.ts`, the
protocol routing from `src/mcp/mcp-json-rpc-dispatch.ts`, and the HTTP framing
from `src/mcp/mcp-http-transport.ts`, which uses only the Fetch API. This Worker
adds authorization, rate limits and storage in
[`src/remote-mcp-endpoint.ts`](./src/remote-mcp-endpoint.ts).

| Tool | Bearer | Scope | Rate limit | Notes |
| --- | --- | --- | --- | --- |
| `catalog` | no | — | — | Static compiler data. |
| `describe` | no | — | — | Static compiler data. |
| `themes` | no | — | — | Built-in presets only. |
| `validate` | yes | `render` | `validate` | Parses an arbitrary spec. |
| `render` | yes | `render` | `render` | Stores a one-hour artifact. |
| `render` with `share: true` | yes | `render` + `share` | `render` + `share` | Stores a share for the retention period. |

`catalog`, `describe` and `themes` take no spec and read only static data with
bounded output, so they answer without a bearer: a client can discover the
server before it is configured with a token, and they cost about what a static
file costs. `validate` parses untrusted input, so it is authenticated and
limited like a render.

`render` compiles through `renderArtifact`, the exact path `POST /v1/render`
uses, so the stored bytes are identical to what the REST route returns for the
same spec, theme and compiler version (asserted in
`tests/unit/cloud-remote-mcp.test.ts`). It returns a compact summary, never the
HTML:

```json
{
  "bytes": 106964, "hash": "…", "title": "…", "theme": "editorial",
  "features": ["theme"], "nodes": 2, "warnings": [],
  "artifactUrl": "https://render.agentkit.best/v1/artifact/<uuid>",
  "expiresAt": "…", "shared": false, "version": "0.2.0"
}
```

Transport behaviour:

- One JSON response per POST (no SSE stream); a notification or response
  answers `202` with no body; a batch is answered member by member.
- Stateless: no `Mcp-Session-Id` is issued. `GET` and `DELETE` answer `405`.
- An unsupported `MCP-Protocol-Version` header answers `400`.
- A browser `Origin` other than the endpoint's own answers `403`; requests
  without `Origin` (non-browser clients) are unaffected.
- The body ceiling is the REST request budget (1 MiB), answered with `413`.
- A refused tool call (no bearer, inactive account, missing scope, rate limit,
  spec error, budget) is a tool result with `isError: true` and a JSON body
  carrying the same `code` the REST route would return.

Client configuration:

```json
{
  "mcpServers": {
    "ak-render": {
      "type": "http",
      "url": "https://render.agentkit.best/mcp",
      "headers": { "Authorization": "Bearer ${AGENTKIT_TOKEN}" }
    }
  }
}
```

## REST routes

| Route | Scope | Stores anything? |
| --- | --- | --- |
| `POST /v1/render` | `render` | No. The HTML is returned and discarded. |
| `POST /v1/share` | `share` | Yes: one artifact, in private R2, until it expires. |
| `POST /v1/screenshot` | `render` | No. Returns a PNG through Browser Run. |
| `POST /v1/pdf` | `render` | No. Returns a PDF through Browser Run. |
| `GET /v1/share/:id` | none | Serves one valid, unexpired share. |
| `DELETE /v1/share/:id` | `share` | Deletes a share the caller owns. |
| `GET /v1/artifact/:id` | none | Serves one unexpired artifact a remote MCP `render` stored. |

```bash
curl -sS https://render.agentkit.best/v1/render \
  -H "authorization: Bearer $AGENTKIT_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"spec":{"version":1,"meta":{"title":"Hello"},"blocks":[{"type":"hero","title":"Hello"}]}}'
```

`content-type: application/yaml` (or `text/plain`) sends a YAML Page Spec
instead. The compiler owns the parse boundary, so the worker does not carry a
second parser.

## Authentication and scopes

The bearer is checked against the canonical AgentKit entitlements endpoint,
`GET https://agentkit.best/api/agentkit/entitlements` (`ENTITLEMENTS_URL` is
the origin; the path is fixed in [`src/auth.ts`](./src/auth.ts)). **No signing
secret, no database credential, and no auth logic is copied into this worker.**

| Upstream answer | Worker answer |
| --- | --- |
| `200`, `status: "active"`, subject and entitlements present | principal with scopes (below) |
| `200`, any other `status` | `403 ENTITLEMENT_INACTIVE` |
| `401` or `403` (e.g. `{"status":"inactive","code":"not_authenticated"}`) | `401 UNAUTHENTICATED` |
| any other status, a redirect, or a timeout (5 s) | `502 ENTITLEMENTS_ERROR` / `ENTITLEMENTS_UNREACHABLE` |
| a body without status, subject or a well-formed `entitlements` object | `502 ENTITLEMENTS_MALFORMED` |

The subject is `userId` (or `license:<licenseId>` when no user id is present);
shares are owned by it.

**Scope mapping.** One active AgentKit entitlement, the app
(`entitlements.agentkitApp`) or any kit (`entitlements.kits.<id>: true`), grants
both `render` and `share`, because the endpoint has no narrower grant to read
today. The two scopes are still derived by separate functions and every route
and tool checks the scope it needs, so a future render-only grant changes one
function in `auth.ts` and a render-only token then cannot publish. An active
account with no active kit and no app grant gets no scope (`403 FORBIDDEN`).

## Budgets and limits

| Budget | Value | Why |
| --- | --- | --- |
| Request body | 1 MiB | Well below the platform request ceiling. REST and MCP. |
| Output artifact | 2 MiB | A page larger than this is not a page. |
| Nodes | 2,000 | Under the compiler's own bound. |
| `render` | 60/min per subject | REST render and MCP render share the counter. |
| `share` | 20/min per subject | REST share and MCP `share: true` share the counter. |
| `export` | 10/min per subject | Screenshot and PDF are the expensive path. |
| `validate` | 120/min per subject | MCP only. |
| MCP render artifact | 1 hour | Long enough to open the page; a durable link is a share. |
| Share retention | 30 days default, 365 max | A share is a link, not an archive. |

Rate limiting uses a fixed window in KV. KV is eventually consistent, so two
simultaneous requests can both read the same count. That is deliberate: the rate
limit is a cost guard, and the budgets above are the hard limit.

## Storage and privacy

- **Private R2.** The bucket is not public; a share or artifact resolves only
  through its preview route, which enforces expiry and revocation on every read.
- **Opaque ids.** Ids are random UUIDs. A caller cannot address an object it was
  not given, and a non-UUID path is rejected before any lookup.
- **REST render responses are not stored.** Only an explicit share, export, or
  remote MCP render persists anything, and only the artifact — never the spec
  source.
- **The bearer is never persisted.** It is not written to R2, to KV, to logs, or
  into a response, and the entitlements request does not follow redirects.
- **No content telemetry.** Observability is disabled in `wrangler.jsonc` and no
  analytics is wired. The only outbound call this worker makes is the
  entitlements check, and it carries no page content.
- **Browser Run is used for nothing else.** It receives an already-compiled
  artifact inline (`html`, never a URL) with caching disabled, and is never used
  as a fetch proxy or a second compile path.

## Expiry and revocation

Shares and artifacts carry `expiresAt` in their object metadata. Expiry is
enforced at read time (an expired object answers `410`, not `404`, so a caller
can tell the difference) and an hourly cron sweeps both prefixes so expired
objects stop resolving even before the read path is exercised.
`DELETE /v1/share/:id` revokes immediately, and only the owner may revoke.

`SHARE_RETENTION_DAYS` is configurable and capped at 365 days, so a deployment
cannot accidentally make shares permanent.

## Deployment

The committed [`wrangler.jsonc`](./wrangler.jsonc) is the configuration of
record. It binds the private R2 bucket, the rate-limit KV namespace, the Browser
Run binding (`BROWSER`, Quick Actions, compatibility date 2026-03-24 or later),
and two routes on the zone `agentkit.best`:

```text
render.agentkit.best/mcp
render.agentkit.best/v1/*
```

`render.agentkit.best` is the Custom Domain of the static site
(`site/wrangler.jsonc`). Cloudflare runs Worker routes before a Custom Domain on
the same hostname, so those two paths reach this Worker and every other path,
including `/` and `/gallery/`, still reaches the site. Neither deploy changes
the other.

### Steps

One-time resources (already created for the current account):

```bash
npx wrangler r2 bucket create ak-render-shares
npx wrangler kv namespace create RATE_LIMIT   # put the id in wrangler.jsonc
```

Deploy and verify:

```bash
pnpm install --frozen-lockfile
pnpm verify
npx wrangler deploy --dry-run --config apps/cloud/wrangler.jsonc --outdir /tmp/worker-dry-run
npx wrangler deploy --config apps/cloud/wrangler.jsonc
BASE_URL=https://render.agentkit.best node scripts/cloud-smoke.mjs
BASE_URL=https://render.agentkit.best TOKEN="$AGENTKIT_TOKEN" EXPECT_EXPORT=1 \
  node scripts/cloud-smoke.mjs
```

Or run the **Cloud renderer deploy** workflow with `dry-run` off. It deploys,
then runs the same smoke script against `base-url`. Set the repository secret
`AK_RENDER_SMOKE_TOKEN` to an AgentKit token with an active entitlement for the
authenticated checks; without it they are skipped with a notice.

Account prerequisites:

- The API token (`CLOUDFLARE_API_TOKEN`) needs Workers Scripts edit, Workers
  Routes edit on the `agentkit.best` zone, R2, KV and Browser Rendering.
- Browser Rendering must be enabled on the account (Workers Paid).
- No DNS record is added by hand: the site's Custom Domain already owns
  `render.agentkit.best`, and routes ride on it.

`scripts/cloud-smoke.mjs` checks MCP initialize, `tools/list` and `catalog`;
that render is refused without a bearer; and, with `TOKEN`, MCP `validate` and
`render`, that the artifact is an HTML document identical to `POST /v1/render`,
the share lifecycle (create, read, revoke, gone), an MCP share, and a PNG and a
PDF export. It revokes every share it creates.

## Parity

Cloud output is not a second implementation. The parity tests compile the same
spec locally, through `POST /v1/render`, and through the remote MCP `render`
tool, and assert the HTML is byte-identical for JSON and YAML input at the same
compiler version:

```bash
pnpm exec vitest run tests/unit/cloud-worker.test.ts tests/unit/cloud-remote-mcp.test.ts
```

## Limitations

- Screenshot and PDF use the Browser Run `quickAction` binding method. The
  local simulator (`wrangler dev --local`) does not implement it, so exports are
  verified with a mock binding in tests and by the live smoke test after a
  deploy (`EXPECT_EXPORT=1` makes a missing or failing export a failure).
- Rate limiting is a KV fixed window, not a global token bucket.
- The remote server answers with JSON only; it opens no SSE stream and sends no
  server-initiated messages, which the tools do not need.
