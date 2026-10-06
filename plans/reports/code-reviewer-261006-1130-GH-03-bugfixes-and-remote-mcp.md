# Code Review: GH #3/#4/#7/#8/#9/#11 bugfixes + remote MCP

Range: `50a47d7..1b869c9` (excl. plans, docs/gallery, fixtures/snapshots, schema). Branch `mrgoonie/handle-issues-03-11`. Read-only review.

## Scope
- 58 files, +4017/-858. Focus: `src/mcp/*`, `apps/cloud/src/*`, `src/diagram/adapter.ts`, `src/render/{escape,blocks,document,styles}.ts`, `src/spec/{network-policy,normalize}.ts`, `.github/workflows/cloud-deploy.yml`, `scripts/cloud-smoke.mjs`, wrangler configs.
- Gates run: focused vitest (7 files, 147 tests) pass; `pnpm typecheck` clean; `pnpm lint` 0 errors (20 infos).
- Verified by probes against `dist/` (node one-liners), results quoted below.

## Overall
Compiler-side fixes (#3 inline code, #4 poster gate, #8 wrap, #9 layout) are sound: `escapeInlineText` escapes every segment, spec text cannot forge the adapter style marker (all `<` escaped in text + attribute contexts; verified across text/code/terminal/list/title), poster gate shared between validate and render. stdio MCP keeps the old exports and behaviour.
The risk is in the new hosted surface and the #7 adapter change: unbounded unauthenticated batches, a KV limiter that will throw under the new batch path, adapter CSS that now goes live page-wide, a quadratic regex, and a sweep that cannot keep up with artifacts.

## High

### H1. Unauthenticated batch amplification on `POST /mcp`
- `src/mcp/mcp-http-transport.ts:147-160` accepts any batch length; `apps/cloud/src/remote-mcp-endpoint.ts:139-145` serves `catalog`/`describe`/`themes` with no bearer and no rate limit.
- Comment at `remote-mcp-endpoint.ts:15-19` ("cost about as much as serving a static file") is false under batching.
- Probe: 450 KB batch of 5000 `tools/call catalog` → **58.7 MB response, ~4.0 s CPU** in Node (describe: 525 KB → 8.1 MB). The 1 MiB cap allows ~2x that. Workers 128 MB isolate memory will OOM; CPU billed per request; anonymous.
- Fix: cap batch members (e.g. ≤16) and reject batches when `MCP-Protocol-Version` ≥ `2025-06-18` (batching was removed in that revision); add a per-IP limit (`CF-Connecting-IP`) for unauthenticated tool calls; optionally cap total response bytes.

### H2. KV fixed-window limiter throws on same-key writes, now trivially reachable via MCP batch
- `apps/cloud/src/rate-limit.ts:25-27` does get+put on the same key per call. Cloudflare KV documents a limit of 1 write/second per key; above that `put` rejects (429). Not caught anywhere.
- MCP batch of 2+ `validate`/`render` calls runs sequentially (`mcp-http-transport.ts:151-156`) → back-to-back puts to `rl:validate:<subject>:<window>` in the same ms. `validate` limit is 120/min (`config.ts:41`) → exceeds 1/s by design.
- Effect: MCP → `answer()` catch → `toolErrorResult` returns the raw KV error message to the client (internal leak, `mcp-http-transport.ts:73-77`); REST → unhandled → 500. Also the read-modify-write is not atomic, so concurrent requests under-count (documented as accepted, but the throw is not).
- Pattern pre-existed for REST; the MCP batch path and the 120/min validate key make it a hot path. Not runtime-verified against real KV (unit harness KV mock has no write limit).
- Fix: use the Workers Rate Limiting binding (`ratelimits` in wrangler) or a Durable Object counter. Minimum: wrap get/put in try/catch, fail closed with a generic `RATE_LIMITED`.

### H3. Adapter `<style>` now gets the page nonce: page-wide, unscoped CSS from spec-derived adapter output; regex filters bypassable
- `src/diagram/adapter.ts:146-164` marks every adapter `<style>`; `src/render/document.ts:99-105` grants the nonce. Before this change those styles were inert under `style-src 'nonce-…'`.
- Adapter input is the block spec verbatim (`docs/diagram-adapter.md` contract), i.e. untrusted. Any adapter that forwards spec styling into CSS (Mermaid-style `classDef` / `themeCSS`) becomes a raw-CSS escape hatch, against the "No escape hatch… No raw CSS" boundary in AGENTS.md.
- Verified: adapter returning `<style>.ak-shell{display:none}</style>` compiles with `nonce="ak1g0l7uo1j380q5"` and no warning → hides the whole page.
- Verified `checkAdapterMarkup` returns `ok:true` for `@\69mport "x.css"`, `url(https:\2f\2f evil.com/x)`, `url(\2f\2f evil.com)`, `image-set("https://evil.com/x.png" 1x)` (`adapter.ts:87-90` regexes). Network exfil is still blocked by CSP (`img-src data: file: 'self'`, nonce-only style-src blocks @import targets) when policy is deny, so the realistic impact is page restyling/spoofing, not data exfil. Note `'self'` makes same-origin `url()` loads possible on the hosted share origin.
- Fix (pick one): (a) reject adapter CSS containing `\`, `image-set(`, any `url(` other than `url(#id)`, and any at-rule other than `@media/@keyframes/@supports`; (b) require every selector to be prefixed by the adapter root (e.g. `[data-ak-diagram-adapter] …`) with a small CSS tokenizer, rejecting otherwise; (c) keep adapter styles inert and require SVG presentation attributes. Document whichever in `docs/diagram-adapter.md`.

## Medium

### M1. Style-marker replacement is a string replace, not tag-aware → attribute breakout
- `src/render/document.ts:100-105` `replaceAll('<style data-ak-adapter-style', …)` over the whole body; `fitAdapterMarkupToPolicy` keeps quoted attribute values verbatim (`adapter.ts:155-160`).
- Verified: adapter markup `<g aria-label="<style data-ak-adapter-style">` emits `<g aria-label="<style nonce="ak1g0l7uo1j380q5" data-ak-adapter-style">` — inserted `"` closes the attribute. Payload is fixed (nonce), so not XSS today, but output is malformed and the "marker cannot be forged" invariant (comment at `document.ts:96-98`) only holds for spec text, not adapter text.
- Fix: in `checkAdapterMarkup` reject any markup containing `data-ak-adapter-style` or `nonce`, and/or escape `<` inside attribute values during fitting; add a regression test.

### M2. Quadratic regex in `fitAdapterMarkupToPolicy` (compile hang)
- `src/diagram/adapter.ts:128-131` `START_TAG`: attribute-name class `[^\s"'>/=]` includes `<`, so on unterminated tags every `<` start rescans the rest.
- Verified: `'<svg>' + '<a '.repeat(n)` → n=2000: 1.1 s, 8000: 17.8 s, 16000: 75.8 s. At the 256 KB cap (~85k reps) this is tens of minutes; `checkAdapterMarkup` accepts the input.
- Fix: exclude `<` from attribute names: `[^\s"'<>/=]+` in both `START_TAG` and `ATTRIBUTE`. Verified the patched regex runs 255 KB in 4 ms. Add a perf regression test.

### M3. Expiry sweep cannot keep up; retention claim not met
- `apps/cloud/src/share.ts:136-150`: one `list({prefix, limit:1000})` page per prefix, no cursor; then one `get` (full body) per object; `bindings.ts:27` type has no `cursor/truncated`.
- Random UUID keys list lexicographically, so once >1000 live objects exist under a prefix, expired objects beyond the first page are never reached. Remote render allows 60 artifacts/min/subject at 1 h TTL → `artifact/` exceeds 1000 quickly. Read path still returns 410, so no exposure, but bytes stay in R2 indefinitely despite the "not a hosting service" 1 h claim (`config.ts:25-30`) and subrequest count (up to 2000 per kind) risks hitting per-invocation limits.
- Fix: R2 lifecycle rules per prefix (`artifact/` 1 day, `share/` ≤ 366 days) as the primary mechanism; sweep with cursor pagination, `include: ['customMetadata']` instead of `get`, batched `delete([...keys])`.

### M4. Every authenticated call does an uncached upstream entitlements fetch, before rate limiting
- `apps/cloud/src/auth.ts:146-193`, `apps/cloud/src/index.ts:163-170`; MCP memoizes only within one HTTP request (`remote-mcp-endpoint.ts:155-158`).
- Arbitrary bearers are forwarded 1:1 to `agentkit.best` with no per-IP limit; each MCP `validate`/`render` adds an upstream RTT (5 s timeout ceiling).
- Fix: cache `sha256(token) → principal` in Cache API/KV for ~60 s (short negative cache for 401); per-IP limit on auth failures. Never key on the raw token.

### M5. Remote MCP auth is not discoverable by MCP clients
- Auth failures return HTTP 200 + `isError` tool results (`remote-mcp-endpoint.ts:73-76`); no `401` + `WWW-Authenticate` / Protected Resource Metadata as the 2025-06-18 authorization spec expects. OAuth-capable clients (Claude connectors etc.) will never prompt for credentials. Product decision (anonymous discovery) — confirm it is intended and document that clients must be pre-configured with a static bearer.

## Low

- **L1** `src/mcp/mcp-http-transport.ts:147`: batch accepted regardless of negotiated version; `initialize` allowed inside a batch (forbidden in 2025-03-26). `DEFAULT_HTTP_PROTOCOL` (`mcp-protocol.ts:329`) is exported but never used — either use it to gate batch support or drop it.
- **L2** `apps/cloud/src/index.ts:46-56`: shares/artifacts (untrusted-spec output) are served on `render.agentkit.best`, same origin as the landing site and `/mcp` (whose Origin check allows same-origin). Only the in-document meta CSP protects it. Add response headers `content-security-policy: sandbox allow-scripts allow-popups; frame-ancestors 'none'` for defense in depth.
- **L3** `.github/workflows/cloud-deploy.yml:70,75`: `wrangler@latest` unpinned (non-reproducible deploy, supply chain) — pin or add as devDependency. `base-url` input is free-form and receives `AK_RENDER_SMOKE_TOKEN` (`:93-94`) — restrict to an allowlist of hosts. No `concurrency:` group for deploys.
- **L4** `remote-mcp-endpoint.ts:77-84,104-108`: guard consumes the `render` counter before checking `share`, so a denied share still burns a render; MCP share counts render+share while REST `/v1/share` counts only share (`index.ts:166-167`). Pick one rule.
- **L5** `mcp-http-transport.ts:73-77`: any non-RenderError (KV/R2/runtime) message goes to the client verbatim. In the remote wrapper map unknown errors to a generic `INTERNAL_ERROR`.
- **L6** `src/render/blocks.ts:870-873`: with an adapter, the text description is inside a closed `<details>`; it does not print. SVG still prints, and the chart data table already follows this pattern, so consistent — note only against the "reads completely in print" principle.

## Checked, no issue
- `escapeInlineText` (`src/render/escape.ts:45-66`): linear regex, all segments escaped; `` `</code><script>` `` stays inert. Prose-described `txt()` props all route through it (checked roster ↔ renderers); verbatim props (code, terminal, chart description) stay literal as documented.
- Poster (#4): `imageReferenceAllowed` shared by `normalize.ts:563-576` and `blocks.ts:938-944`; `render.ts:122-124` adds poster origin to CSP under `images`. URL scheme policy still applied by the `url` prop kind.
- Spec text cannot forge `<style data-ak-adapter-style` (text and attribute escaping both encode `<`; verified across title/text/code/terminal/list/inline code).
- Determinism: nonce still `stableHash(css)`; no time/random in compile path. Cloud `crypto.randomUUID` only for storage ids (122-bit, not guessable).
- Auth fail-closed: missing bearer 401, upstream non-200/3xx (`redirect:'manual'`)/timeout/malformed → 401/502; inactive → 403; token not logged (`observability.enabled:false`) or echoed.
- Origin check (`mcp-http-transport.ts:58-62`) before method handling; cross-origin preflight gets 403 (no CORS = fail closed). GET/DELETE 405, notifications/responses 202, unsupported protocol header 400, parse error 400.
- stdio: `src/mcp-server.ts` re-exports `handleMcpLine`, `handleMcpMessage`, `serveMcp`, `McpContext`, `JsonRpcResponse` — same surface as `50a47d7`.
- Wrangler: route patterns `render.agentkit.best/mcp` and `/v1/*` on zone `agentkit.best` in front of the site's Custom Domain (`site/wrangler.jsonc`) — Cloudflare runs route Workers before a Custom Domain Worker, so the claim in `apps/cloud/wrangler.jsonc:13-17` holds. Browser binding `quickAction` exists (Cloudflare changelog 2026-05-28, compat date ≥ 2026-03-24; config uses 2026-09-01).
- Workflow conditions: dry-run default true skips deploy and smoke; smoke-only skips build/deploy; secrets only on deploy/smoke steps; `permissions: contents: read`.

## Recommended actions (order)
1. H1 batch cap + anonymous per-IP limit.
2. H2 replace KV limiter (Rate Limiting binding / DO) or at least catch + fail closed.
3. H3 decide adapter CSS policy (scope or reject escapes/url/at-rules); M1 reject marker/nonce text in adapter output.
4. M2 one-character regex fix + perf test.
5. M3 R2 lifecycle rules + paginated sweep.
6. M4 principal cache; M5 confirm auth-discovery intent.
7. Lows as convenient.

## Metrics
- Typecheck: clean. Lint: 0 errors, 20 infos. Focused tests: 147/147 pass. Coverage: not measured.

## Unresolved questions
- Which adapters are expected in practice (ak:diagram only?) and can they emit spec-controlled CSS? Decides H3 severity.
- Is anonymous discovery (M5) a firm product decision, or should `/mcp` answer 401 + resource metadata for OAuth clients?
- Account plan for the Worker (subrequest/CPU limits) — affects H1/M3 blast radius.
