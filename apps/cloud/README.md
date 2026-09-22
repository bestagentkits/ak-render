# Cloud renderer (opt-in)

A Cloudflare Worker that compiles Page Specs with **the same
`@agentkit/render` code** the local CLI uses. It is opt-in: local mode never
contacts it, and the compiler has no knowledge of it. Nothing here is required
to produce an artifact.

The reason to deploy it is the four things a local compile cannot do: host a
page behind a URL, hand someone an expiring link, produce a PNG, and produce a
PDF.

## Routes

| Route | Scope | Stores anything? |
| --- | --- | --- |
| `POST /v1/render` | `render` | No. The HTML is returned and discarded. |
| `POST /v1/share` | `share` | Yes: one artifact, in private R2, until it expires. |
| `POST /v1/screenshot` | `render` | No. Returns a PNG through Browser Run. |
| `POST /v1/pdf` | `render` | No. Returns a PDF through Browser Run. |
| `GET /v1/share/:id` | none | Serves one valid, unexpired share. |
| `DELETE /v1/share/:id` | `share` | Deletes a share the caller owns. |

`render` and `share` are separate grants. A bearer that may render cannot
publish, and a bearer that may publish is not thereby allowed to render.

### Request

```bash
curl -sS https://render.example.test/v1/render \
  -H "authorization: Bearer $AK_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"spec":{"version":1,"meta":{"title":"Hello"},"blocks":[{"type":"hero","title":"Hello"}]}}'
```

`content-type: application/yaml` (or `text/plain`) sends a YAML Page Spec
instead. The compiler owns the parse boundary, so the worker does not carry a
second parser.

## Deployment

```bash
cd apps/cloud
npx wrangler r2 bucket create ak-render-shares
npx wrangler kv namespace create RATE_LIMIT
npx wrangler deploy
```

The Worker bundles the compiler from this repository's source, so a deploy
publishes exactly the version under review. Set `ENTITLEMENTS_URL` to the
canonical AgentKit entitlements endpoint for the environment; the worker posts
the caller's bearer there and trusts only that answer. **No signing secret, no
database credential, and no auth logic is copied into this worker.**

Browser Run is a separate binding. Add it for the deployment that needs
screenshot or PDF; without it those two routes answer `501` with
`EXPORT_UNAVAILABLE`, because a missing capability is a fact the caller should
see rather than a silent degradation.

## Budgets and limits

| Budget | Value | Why |
| --- | --- | --- |
| Request body | 1 MiB | Well below the platform request ceiling. |
| Output artifact | 2 MiB | A page larger than this is not a page. |
| Nodes | 2,000 | Under the compiler's own bound. |
| `render` | 60/min per subject | |
| `share` | 20/min per subject | |
| `export` | 10/min per subject | Screenshot and PDF are the expensive path. |
| Share retention | 30 days default, 365 max | A share is a link, not an archive. |

Rate limiting uses a fixed window in KV. KV is eventually consistent, so two
simultaneous requests can both read the same count. That is deliberate: the rate
limit is a cost guard, and the budgets above are the hard limit.

## Storage and privacy

- **Private R2.** The bucket is not public; a share resolves only through the
  preview route, which enforces expiry and revocation on every read.
- **Opaque ids.** A share id is a random UUID. A caller cannot address an object
  it was not given, and a non-UUID path is rejected before any lookup.
- **Render responses are not stored.** Only an explicit `share` or export
  persists anything, and only the artifact — never the spec source.
- **The bearer is never persisted.** It is not written to R2, to KV, to logs, or
  into a response. It exists for the duration of one request.
- **No content telemetry.** Observability is disabled in `wrangler.jsonc` and no
  analytics is wired. The only outbound call this worker makes is the
  entitlements check, and it carries no page content.
- **Browser Run is used for nothing else.** It receives an already-compiled
  artifact and a format, and is never used as a fetch proxy or a second compile
  path.

## Expiry and revocation

A share carries `expiresAt` in its object metadata. Expiry is enforced at read
time — an expired share answers `410`, not `404`, so a caller can tell the
difference — and an hourly cron sweeps expired objects so they stop resolving
even before the read path is exercised. `DELETE /v1/share/:id` revokes
immediately, and only the owner may revoke.

`SHARE_RETENTION_DAYS` is configurable and capped at 365 days, so a deployment
cannot accidentally make shares permanent.

## Parity

Cloud output is not a second implementation. The parity test compiles the same
spec locally and through the worker and asserts the HTML is byte-identical, for
JSON and YAML input, at the same compiler version:

```bash
pnpm exec vitest run tests/unit/cloud-worker.test.ts
```

## Limitations

- The Browser Run call shape in `src/screenshot.ts` is written against the
  documented binding contract and exercised with a mock binding in tests. It has
  not been run against a live Browser Run binding from this repository, so treat
  the first deploy of the export routes as unverified until observed.
- Rate limiting is per Worker isolate through KV, not a global token bucket.
