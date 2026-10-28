# GH-110: ChatGPT plugin package for the remote MCP server

Status: implemented; awaiting review and merge

## Outcome
A ChatGPT Plugins Directory package (ZIP) that connects to the hosted
`https://render.agentkit.best/mcp` over Streamable HTTP with OAuth, so a ChatGPT
user needs no Node or npm. The local stdio distribution (root `mcp.json`,
`plugin.json`, `.claude-plugin/plugin.json`) stays unchanged.

## Constraints
- Local compile stays canonical, offline and byte-identical.
- OpenAI package format: Agent Plugins `plugin.json` + `mcp.json` at the ZIP
  root, OpenAI settings under `extensions.com.openai`, no hooks, no `.app.json`,
  no secrets or non-empty server headers.
- Every tool advertises explicit `readOnlyHint`, `destructiveHint` and
  `openWorldHint` booleans (OpenAI plugin guidelines, "Correct annotation").

## Non-goals
- Release parity / capability manifest (#93), one-call publish (#94),
  artifact export (#66, shipped in #68).
- Submitting to the portal: needs an OpenAI org owner, a verified publisher,
  reviewer credentials and a demo video.

## Steps
1. Tool annotations in the shared tool contract; `tools/list` returns them.
2. `packaging/chatgpt/{plugin.json,mcp.json}` with listing, review cases.
3. `scripts/build-chatgpt-plugin.mjs`: deterministic ZIP with assets.
4. Unit test: schema, OpenAI limits, version, assets, review tool names exist.
5. Worker serves `/.well-known/openai-apps-challenge` from a secret.
6. `scripts/cloud-smoke.mjs`: annotations, client registration discovery,
   artifact content type, truthful invalid-spec error, challenge route.
7. Docs: README, apps/cloud/README, release policy, CHANGELOG.

## Acceptance
- `pnpm verify` green; package test green; ZIP builds deterministically.
- Live smoke against production passes (annotations after redeploy).
