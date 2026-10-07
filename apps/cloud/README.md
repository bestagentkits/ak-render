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
| `catalog` | no | — | `anon-ip` | Static compiler data. |
| `describe` | no | — | `anon-ip` | Static compiler data. |
| `themes` | no | — | `anon-ip` | Built-in presets only. |
| `search-catalog` | no | — | `anon-ip` | Ranks blocks by intent; static data. |
| `recipes` | no | — | `anon-ip` | Lists the page recipes; static data. |
| `recipe` | no | — | `anon-ip` | One starter spec as YAML; static data. |
| `validate` | yes | `render` | `validate` | Parses an arbitrary spec. |
| `render` | yes | `render` | `render` | Stores a one-hour artifact. |
| `render` with `share: true` | yes | `render` + `share` | `share` | Stores a share for the retention period. |

`catalog`, `describe`, `themes`, `search-catalog`, `recipes` and `recipe` take
no spec and read only static data, so they answer without a bearer: a client
can discover the server before it is configured with a token. Each call still builds a response of several
kilobytes, so they count per client IP (`anon-ip`), and a batch counts every
member. `validate` parses untrusted input, so it is authenticated and limited
like a render.

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
  "expiresAt": "…", "shared": false, "version": "0.3.0"
}
```

Transport behaviour:

- One JSON response per POST (no SSE stream); a notification or response
  answers `202` with no body.
- A JSON-RPC batch is answered member by member, and only under a revision
  that has batches: `MCP-Protocol-Version` `2025-03-26` (the default when the
  header is absent) or `2024-11-05`. Under `2025-06-18` and later, which
  removed batching, a batch answers `400`. A batch carries at most 16 members
  and never `initialize`; otherwise it answers `400` before any member runs.
- Stateless: no `Mcp-Session-Id` is issued. `GET` and `DELETE` answer `405`.
- An unsupported `MCP-Protocol-Version` header answers `400`.
- A browser `Origin` other than the endpoint's own answers `403`; requests
  without `Origin` (non-browser clients) are unaffected.
- The body ceiling is the REST request budget (1 MiB), answered with `413`.
- A request that **presents** a bearer is authenticated before any message
  runs. If the entitlements endpoint rejects it (or the `Authorization` header
  is not a bearer), the request answers HTTP `401` with
  `WWW-Authenticate: Bearer realm="ak-render", error="invalid_token"` and a
  JSON-RPC error body, whatever the method, so a client knows its credential is
  wrong instead of reading a tool error.
- A request **without** a bearer is answered HTTP `401` where OAuth is enabled
  (`OAUTH_RESOURCE` is set, as on `render.agentkit.best`). The challenge names
  the protected-resource metadata, which is how an MCP client discovers where
  to sign in. A deployment without OAuth serves it instead, because the client
  has no other way to get a token: discovery is anonymous, and a call it cannot
  make (`validate`, `render`) is a tool result with `isError: true` and code
  `UNAUTHENTICATED`.
- Every other refusal (inactive account, missing scope, rate limit, spec error,
  budget) is a tool error whose JSON body carries the code the REST route
  returns.
- A fault that is not the caller's (storage, a binding, the runtime) is a tool
  error with code `INTERNAL_ERROR` and a generic message; no internal message
  leaves the worker.

Client configuration. Pick one:

- **OAuth.** Add only the URL. The client reads the `401` challenge, finds the
  AgentKit authorization server through the metadata, opens a browser to sign
  in, and refreshes on its own. Access tokens last an hour, and the grant
  slides: each refresh extends it to 365 days, so a client in regular use never
  signs in again. Revoke it under **Account → Connected apps** on agentkit.best.

  ```json
  { "mcpServers": { "ak-render": { "type": "http", "url": "https://render.agentkit.best/mcp" } } }
  ```

- **API key.** Send a personal AgentKit API key (`ck_live_…`, from the
  agentkit.best account page) as a static bearer. It works until you revoke it
  or until the expiry you set when you created it. Use this for CI and for
  clients without OAuth.

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

The worker accepts three kinds of bearer:

| Bearer | Checked by | Lifetime |
| --- | --- | --- |
| Personal API key, `ck_live_…` | entitlements endpoint (below) | until revoked or its own expiry |
| CLI session token, `ak_cli_…` | entitlements endpoint | 15 minutes |
| OAuth access token, an `at+jwt` for `OAUTH_RESOURCE` | locally, against the issuer's JWKS | 1 hour; refresh grant slides to 365 days |

**OAuth.** OAuth is on when `OAUTH_RESOURCE` is set. The worker then serves
RFC 9728 metadata at `/.well-known/oauth-protected-resource` and
`/.well-known/oauth-protected-resource/mcp`, naming `OAUTH_ISSUER` (default:
the `ENTITLEMENTS_URL` origin) as the authorization server, and adds
`resource_metadata` and `scope` to every `401` challenge. An access token is
verified in [`src/oauth-access-token.ts`](./src/oauth-access-token.ts):

- the signature is ES256, with a key from `{OAUTH_ISSUER}/.well-known/jwks.json`;
- `typ` is `at+jwt`, `iss` is the issuer, `aud` is the resource, and the
  lifetime is at most an hour;
- a delegated token (`act`) is refused.

Keys are cached for 10 minutes. An unknown `kid` refetches them at most once a
minute, and an unreachable JWKS fails closed (`502 JWKS_UNREACHABLE`). Scope
`ak-render:render` grants `render` and `ak-render:share` grants `share`. The
subject is `sub`, the AgentKit user id the entitlements endpoint also reports,
so a share keeps the same owner whichever credential made it. The issuer
re-checks the account on every refresh, and a revoked grant stops working when
its last access token expires, within an hour.

Every other bearer is checked against the canonical AgentKit entitlements endpoint,
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
| `anon-ip` | 120/min per client IP | MCP `catalog`, `search-catalog`, `describe`, `recipes`, `recipe`, `themes`. |
| `auth-ip` | 30/min per client IP | Bearer checks the principal cache cannot answer. |
| MCP batch | 16 members | Only under revisions with batching. |
| MCP render artifact | 1 hour | Long enough to open the page; a durable link is a share. |
| Share retention | 30 days default, 365 max | A share is a link, not an archive. |

**One class per call.** Every call counts against exactly one class, the one
matching what it stores or costs, and only after authorization passed, so a
refused call consumes nothing. A share counts against `share` only, on REST
(`POST /v1/share`) and MCP (`render` with `share: true`) alike; it does not also
consume `render`.

Rate limiting uses the Workers Rate Limiting binding, one binding per class
(`ratelimits` in `wrangler.jsonc`; `RATE_LIMITS` in
[`src/config.ts`](./src/config.ts) mirrors it and a unit test keeps the two
equal). Counters are per Cloudflare location and eventually consistent. That is
deliberate: the rate limit is a cost guard, and the budgets above are the hard
limit. If the limiter itself fails, the call is refused with `RATE_LIMITED`.

The client IP is `CF-Connecting-IP`. Per-IP classes guard only the paths that
run before a bearer is known; everything a bearer unlocks counts per subject.

## Storage and privacy

- **Private R2.** The bucket is not public; a share or artifact resolves only
  through its preview route, which enforces expiry and revocation on every read.
- **Opaque ids.** Ids are random UUIDs. A caller cannot address an object it was
  not given, and a non-UUID path is rejected before any lookup.
- **REST render responses are not stored.** Only an explicit share, export, or
  remote MCP render persists anything, and only the artifact — never the spec
  source.
- **The bearer is never persisted.** It is not written to R2, to logs, or into
  a response, and the entitlements request does not follow redirects. To avoid
  one upstream round trip per call, each isolate keeps the entitlements answer
  in memory under the SHA-256 digest of the bearer (never the bearer): an
  accepted bearer for 60 s, a rejected or inactive one for 10 s, at most 1,000
  entries. An upstream fault is not cached. A cache miss counts against
  `auth-ip` before anything is forwarded, so spraying bearers cannot turn the
  worker into an amplifier against the entitlements endpoint.
- **Hosted pages run sandboxed.** A share or artifact is served with
  `content-security-policy: sandbox allow-scripts allow-popups
  allow-popups-to-escape-sandbox allow-downloads; frame-ancestors 'none'`.
  The page runs in an opaque origin, so untrusted-spec output cannot read or
  act as `render.agentkit.best`, and it cannot be framed. Its own meta CSP
  still governs fetches; the runtime treats storage as optional, so the theme
  toggle works and the choice is simply not remembered.
- **No content telemetry.** Observability is disabled in `wrangler.jsonc` and no
  analytics is wired. The only outbound call this worker makes is the
  entitlements check, and it carries no page content.
- **Browser Run is used for nothing else.** It receives an already-compiled
  artifact inline (`html`, never a URL) with caching disabled, and is never used
  as a fetch proxy or a second compile path.

## Expiry and revocation

Shares and artifacts carry `expiresAt` in their object metadata. Expiry is
enforced at read time (an expired object answers `410`, not `404`, so a caller
can tell the difference). Bytes are removed two ways:

- An hourly cron sweeps both prefixes. It walks each listing with its cursor
  (at most 100 pages of 1,000 per prefix per run), reads `expiresAt` from the
  listing metadata without downloading bodies, and deletes each page's expired
  keys in one call.
- R2 lifecycle rules ([`r2-lifecycle.json`](./r2-lifecycle.json)) are the
  backstop: `artifact/` objects are deleted after 1 day and `share/` objects
  after `SHARE_RETENTION_DAYS` + 1 days (31). Lifecycle ages are whole days and
  R2 applies them within about a day, so they never cut a share short. If
  `SHARE_RETENTION_DAYS` changes, change the share rule with it (a unit test
  fails until they agree) and re-apply the rules.
`DELETE /v1/share/:id` revokes immediately, and only the owner may revoke.

`SHARE_RETENTION_DAYS` is configurable and capped at 365 days, so a deployment
cannot accidentally make shares permanent.

## Deployment

The committed [`wrangler.jsonc`](./wrangler.jsonc) is the configuration of
record. It binds the private R2 bucket, six Workers Rate Limiting bindings
(`RATE_LIMIT_*`), the Browser Run binding (`BROWSER`, Quick Actions,
compatibility date 2026-03-24 or later), and two routes on the zone
`agentkit.best`:

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

Wrangler is pinned (`4.147.0`, `WRANGLER_VERSION` in the deploy workflow);
bump it deliberately.

One-time resources (already created for the current account):

```bash
npx wrangler@4.147.0 r2 bucket create ak-render-shares
```

The rate-limit bindings need no resource to be created: each `namespace_id` in
`wrangler.jsonc` (4101–4106) is an integer this configuration chooses, unique
within the account. Keep them stable; changing one resets that class's
counters.

Deploy and verify:

```bash
pnpm install --frozen-lockfile
pnpm verify
npx wrangler@4.147.0 deploy --dry-run --config apps/cloud/wrangler.jsonc --outdir /tmp/worker-dry-run
npx wrangler@4.147.0 deploy --config apps/cloud/wrangler.jsonc
# Idempotent: replaces the bucket's lifecycle rules with the committed file.
npx wrangler@4.147.0 r2 bucket lifecycle set ak-render-shares \
  --file apps/cloud/r2-lifecycle.json --force
BASE_URL=https://render.agentkit.best node scripts/cloud-smoke.mjs
BASE_URL=https://render.agentkit.best TOKEN="$AGENTKIT_TOKEN" EXPECT_EXPORT=1 \
  node scripts/cloud-smoke.mjs
```

Or run the **Cloud renderer deploy** workflow with `dry-run` off. It deploys,
applies the lifecycle rules, then runs the same smoke script against
`base-url`, which is a choice between `render.agentkit.best` and the
`workers.dev` fallback because the smoke token is sent there. Runs share one
concurrency group, so two deploys never race. Set the repository secret
`AK_RENDER_SMOKE_TOKEN` to an AgentKit token with an active entitlement for the
authenticated checks; without it they are skipped with a notice.

Migrating from the KV limiter: the first deploy with this configuration drops
the `RATE_LIMIT` KV binding. The old namespace (`ak-render-rate-limit`) is then
unused; delete it once the deploy is verified
(`npx wrangler@4.147.0 kv namespace delete --namespace-id 1e8e95424a9c4ac7bc774cb689842438`).

Account prerequisites:

- The API token (`CLOUDFLARE_API_TOKEN`) needs Workers Scripts edit, Workers
  Routes edit on the `agentkit.best` zone, R2 (including bucket lifecycle
  configuration) and Browser Rendering. KV is no longer needed.
- Browser Rendering must be enabled on the account (Workers Paid).
- No DNS record is added by hand: the site's Custom Domain already owns
  `render.agentkit.best`, and routes ride on it.

`scripts/cloud-smoke.mjs` checks MCP initialize, `tools/list` and `catalog`;
that render is refused without a bearer; that a rejected bearer answers `401`
with a Bearer challenge; and, with `TOKEN`, MCP `validate` and
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
- Rate limits are counted per Cloudflare location, not globally, so a client
  spread across locations can exceed a limit by that factor. The budgets are
  the hard limit.
- A revoked OAuth grant keeps working until its last access token expires
  (at most an hour), because tokens are verified locally.
- The remote server answers with JSON only; it opens no SSE stream and sends no
  server-initiated messages, which the tools do not need.
