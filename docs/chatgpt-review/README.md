# ChatGPT Plugins Directory review packet

What a maintainer hands OpenAI's reviewers when AK Render is submitted to the
ChatGPT Plugins Directory, and the checks that must pass first. It covers the
review materials only. The remote manifest is #110, release and tool parity is
#93, and the bounded publish workflow is #94; this packet links to them rather
than repeating them.

Nothing here is a secret. Reviewer credentials go into the submission
dashboard's secure review fields, never into this repository, the plugin ZIP or
an issue.

## Review cases

Exactly five positive and three negative cases, as the submission form asks.
[`scripts/chatgpt-review-cases.mjs`](../../scripts/chatgpt-review-cases.mjs)
holds them as data and runs them against a deployed server;
[`tests/unit/chatgpt-review-cases.test.ts`](../../tests/unit/chatgpt-review-cases.test.ts)
keeps the count, the tool names and the reviewer specs valid.

```sh
# Without a bearer: N2 runs, N3 runs except its revoked-share check, the rest skip.
node scripts/chatgpt-review-cases.mjs
# All eight, with the reviewer account's bearer, writing evidence:
TOKEN="$REVIEWER_TOKEN" node scripts/chatgpt-review-cases.mjs --json review-evidence.json
```

A run is evidence only when it is complete: with `--json`, any skipped case
fails the run and the file records `complete: false`. The script sends the
bearer only over HTTPS (or to a loopback address), refuses a token with
whitespace or non-ASCII characters rather than echo it in a header error,
redacts it from everything it prints or writes, and revokes every share it
creates, also on failure or Ctrl-C. Each revoke lands in the evidence under
`cleanup`, and a failed one fails the run.

| Id | Prompt the reviewer types | Tools | Expected result |
| --- | --- | --- | --- |
| P1 | "Use AK Render to turn this quarterly status report into an HTML page:" + [`specs/report.yaml`](specs/report.yaml) | `validate`, `render` | `validate` ok with no diagnostics; `render` returns `artifactUrl` and `expiresAt` one hour out; the URL serves a complete HTML document. |
| P2 | "Make a service health dashboard from these metrics with AK Render:" + [`specs/dashboard.yaml`](specs/dashboard.yaml) | `render` | Features include `chart`, `kpi` and `data-table`, no warnings; the artifact serves HTML. |
| P3 | "Render this hosting comparison with AK Render and give me a link I can share:" + [`specs/comparison.yaml`](specs/comparison.yaml) | `render` (`share: true`) | `shared: true`, a `/v1/share/` URL 30 days out that opens without signing in. |
| P4 | "Show me an AK Render starter for an incident report and check that it is valid." | `recipe`, `validate` | A YAML starter spec; `validate` ok. |
| P5 | "Change the report title to 'Northwind Q3 status report (revised)' and render it again." | `patch`, `render` | One `replace` at `/blocks/@report-hero/title` (reported back as the resolved `/blocks/0/title`), no errors; the re-render has a new hash. |
| N1 | "Render this page with AK Render:" + a spec with a hero missing its title and an unknown block | `validate`, `render` | `validate` answers `ok: false` with `SPEC_UNKNOWN_BLOCK` at `$.blocks[1].type`; `render` answers `isError` with a code and path and stores nothing. |
| N2 | Call `render` before connecting, or after the connection is revoked | `render` | HTTP 401 with a Bearer challenge naming the protected-resource metadata; a rejected bearer adds `error="invalid_token"`. |
| N3 | Open an AK Render link that was never issued, or one that was revoked | none | Unknown artifact: 404 `NOT_FOUND`. Revoke without a bearer: 401. Revoked share: 404. Expired artifact: 410 `EXPIRED` (unit-tested in `tests/unit/cloud-remote-mcp.test.ts`, since a live run cannot wait an hour). |

The three specs are synthetic: every name and number is invented, each page
says "Synthetic demo data", and none needs personal data, a private network or
a manual invite.

### Evidence, 2026-10-28

Run against `https://render.agentkit.best`, which reported
`@bestagentkits/render@0.3.0` build `ce0268f`. The authenticated cases went
through a maintainer's production remote MCP connection, call by call; the
unauthenticated checks are plain HTTPS. This predates the reviewer account, so
the script's own authenticated run is still a go/no-go item.

| Id | Observed |
| --- | --- |
| P1 | `validate` ok, 0 diagnostics. `render` hash `1fm9uqs0sm14mj`, features `theme, chart`, 0 warnings, `expiresAt` 1 h out. `GET` the artifact: 200 `text/html`, `cache-control: private, max-age=60`, a sandboxing `content-security-policy`, a complete document. |
| P2 | `render` hash `0nmmwiv01e97jd`, features `theme, chart, kpi, data-table`, 0 warnings. Artifact 200 `text/html`. |
| P3 | `render` with `share: true`: `shared: true`, `/v1/share/<uuid>`, `expiresAt` 2026-11-27 (30 days). `GET` without a bearer: 200 `text/html`. |
| P4 | `recipe incident-report` returned a YAML starter; `validate` ok, 0 diagnostics. |
| P5 | `patch` applied one `replace` at `/blocks/0/title`, 0 errors; the re-render hash `1waulvp0eohm4c` differs from P1. |
| N1 | `validate`: `ok: false`, `SPEC_VALIDATION_ERROR` at `$.blocks[0].title` and `SPEC_UNKNOWN_BLOCK` at `$.blocks[1].type`. `render`: `isError`, `SPEC_VALIDATION_ERROR` at `$.blocks[0].title`, no artifact. |
| N2 | No bearer: 401 "a bearer token is required", `WWW-Authenticate: Bearer realm="ak-render", resource_metadata=".../.well-known/oauth-protected-resource/mcp", scope="ak-render:render ak-render:share"`. Rejected bearer: 401 with `error="invalid_token"`. |
| N3 | Unknown artifact id: 404 `NOT_FOUND`; malformed id: 404. `DELETE` a share without a bearer: 401 `UNAUTHENTICATED`. The revoked-share step needs a bearer over REST, which an MCP connection cannot send, so it is not in this run. |

Opened offline in Chromium at 1440 and 375 px, the three downloaded pages made
zero network requests and had no horizontal overflow.

The script itself was run end to end against a local Worker (the unit-test
harness behind an HTTP bridge, OAuth on): P1 to P5, N1 and N3 passed, cleanup
was empty because N3 had revoked the share, and the evidence file held no
bearer. N2's rejected-bearer step cannot pass there, because the harness
accepts any bearer; production answered it as expected above.

The P3 share from this run (`/v1/share/d76510c2-…`, synthetic content) was
created over MCP, which has no revoke tool, so it stays public until it
expires on 2026-11-27 unless its owner revokes it over REST.

## Listing metadata

Source: [`plugin.json`](../../plugin.json) `extensions["com.openai"].interface`.
#110 owns any change to the manifest itself.

| Field | Value | Check |
| --- | --- | --- |
| Display name | AK Render | Matches the product. |
| Short description | HTML pages from a YAML spec | True for both local and remote use. |
| Long description | "... Runs locally through npx; requires Node.js 20.11 or later." | True for the stdio package. A remote-only ChatGPT listing must drop the npx/Node sentence; #110. |
| Category | Developer Tools | Fits. |
| Capabilities | Compile Page Specs to HTML; Validate Page Specs | True on the remote server (`render`, `validate`). |
| Website | `https://render.agentkit.best` | 200. |
| Logo, composer icon | `assets/logo.png`, `assets/composer-icon.png` | Present in the repository. |
| Default prompts | Plan, diff review, dashboard | All three are renderable with existing blocks and recipes. |

## Policies and support

| Item | URL | State on 2026-10-28 |
| --- | --- | --- |
| Privacy policy | `https://agentkit.best/privacy` | 200, but it does not mention AK Render or the HTML it stores. Tracked in bestagentkits/ak-web#689. |
| Terms | `https://agentkit.best/terms` | 200, same gap. bestagentkits/ak-web#689. |
| Support | `https://agentkit.best/support` | 404. The policy names `support@agentkit.best`. bestagentkits/ak-web#689. |

What the hosted renderer stores, for the privacy text and the reviewer notes
(owners: [`apps/cloud/src/config.ts`](../../apps/cloud/src/config.ts) and
[`apps/cloud/README.md`](../../apps/cloud/README.md#storage-and-privacy)):

- A remote MCP `render` keeps the compiled HTML in a private R2 bucket for one
  hour behind an unguessable `/v1/artifact/<uuid>` URL, then it answers 410
  and is swept; an R2 lifecycle rule deletes anything left after a day.
- `share: true` publishes a public link for 30 days; its owner can revoke it.
  The deployment setting allows up to 365, but the committed R2 lifecycle
  rule deletes share objects after 31 days and a unit test keeps the two in
  step, so production retention is 30 days.
- `artifact-export` keeps, beside the page and with its owner and expiry, the
  spec source (only with `retainSpec`) and any PNG or PDF export; revoking or
  expiry removes them with the page.
- The owner is the authenticated AgentKit account. REST `/v1/render` stores
  nothing, and local compilation never touches the network.

## Reviewer account

A dedicated AgentKit account for the reviewer, created by the owner:

- Email and password sign-in only: no MFA, no emailed code, no invite, no
  allow-listed network.
- Holds the `ak-render:render` and `ak-render:share` scopes so P1 to P5 work.
- No personal data; its only content is the three synthetic specs above.
- Credentials go into the submission dashboard's review fields. Disable or
  rotate the account after the review closes.

## Demo video

A screen recording of a clean ChatGPT session against production, captioned,
with no account details on screen: connect AK Render, run P1 and open the page,
run P3 and open the share link in a private window, then run N1 and show the
diagnostic. Record it after the go/no-go items below pass, so it shows the
build that will be reviewed.

## Release notes for reviewers

> AK Render compiles a short YAML Page Spec into one self-contained HTML page.
> In ChatGPT it validates the spec, renders it on `render.agentkit.best`, and
> returns a link that expires after an hour, or a share link that lasts 30 days
> when you ask for one. Nothing is kept past those expiries, and it needs no
> local install.

## Go / no-go

Go only when every line holds on the build being submitted:

- [ ] `GET /v1/version` reports the commit being submitted, and its tools match
      the manifest (#93).
- [ ] The remote manifest passes the current plugin schema, domain
      verification and the directory's tool scan (#110).
- [ ] `TOKEN=<reviewer> node scripts/chatgpt-review-cases.mjs --json ...`
      passes all eight cases; attach the JSON to the submission issue.
- [ ] `BASE_URL=https://render.agentkit.best TOKEN=... node scripts/cloud-smoke.mjs` passes.
- [ ] Privacy, terms and support URLs answer 200 and describe AK Render
      (bestagentkits/ak-web#689).
- [ ] The reviewer account signs in from a clean browser with no MFA or code.
- [ ] The demo video is recorded against that build.
- [ ] The owner signs off on the listing text, policies and video.

Rollback: if review or production finds a fault:

1. Withdraw or unpublish the listing in the submission dashboard.
2. Put the previous Worker build back, either with
   `cd apps/cloud && npx wrangler@4.147.0 versions list` then
   `npx wrangler@4.147.0 rollback <version-id>` (Cloudflare credentials
   required; the Worker is `ak-render-cloud`), or by tagging the last good
   commit and dispatching the **Cloud renderer deploy** workflow on that tag
   with `dry-run` off. Neither reverts R2 lifecycle rules.
3. Confirm `GET /v1/version` reports the expected `build`, then rerun
   `scripts/cloud-smoke.mjs`.
4. Disable the reviewer account, and rerun this checklist before resubmitting.

Local `npx @bestagentkits/render` users are unaffected in every case.
