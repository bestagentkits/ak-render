# Writing a Page Spec as an agent

AK Render turns a short YAML or JSON **Page Spec** into one self-contained HTML
file. You describe what the page says; the compiler owns layout, colour,
typography, motion, accessibility and security. Do not write HTML or CSS, and
do not try to position or style blocks: there is no field for it.

## The loop

1. **Find the blocks.** `ak-render search-catalog <intent words>` ranks block
   types for what the page needs, for example `search-catalog sortable table`
   or `search-catalog pricing`. `ak-render catalog --category <c>` lists one
   category; `ak-render catalog` lists every block and action (about 7 kB).
2. **Describe only what you use.** `ak-render describe <type...> --compact`
   returns one line per prop for up to 12 types at once. Use
   `ak-render describe <type> --json` for a block whose full contract you need:
   defaults, bounds, descriptions and accessibility notes.
3. **Start from a recipe when one fits.** `ak-render recipes` lists starter
   specs for common pages (dashboard, benchmark report, incident report,
   decision memo and more), and `ak-render recipe <name>` prints one as YAML.
   Replace every placeholder with real content; keep only blocks you can fill.
4. **Validate.** `ak-render validate page.yaml --json` returns
   `{ ok, diagnostics[] }`. Each diagnostic has a stable `code` and the JSON
   `path` to fix (for example `$.blocks[0].titl`); an unknown prop lists the
   allowed ones in `details.allowed`. Exit code 1 means "fix and retry".
5. **Compile.** `ak-render page.yaml --out page.html --json` writes the file and
   prints a summary (bytes, hash, features, warnings).

Pass `-` instead of a path to read the spec from standard input, so no temporary
file is needed:

```bash
ak-render - --out page.html < spec.yaml
cat spec.yaml | ak-render validate - --json
```

Every command accepts `--json` and never prompts.

## Minimal spec

```yaml
version: 1
meta:
  title: Migration plan
  description: How we move the API to the new gateway.
theme:
  preset: editorial # optional; see `ak-render themes`
blocks:
  - type: hero
    eyebrow: Plan
    title: Migration plan
    description: Move the public API to the new gateway without downtime.
  - type: section
    title: Steps
    blocks:
      - type: steps
        items:
          - title: Mirror traffic
            text: Send a copy of production requests to the new gateway.
          - title: Switch reads
            text: Route read endpoints once error rates match.
  - type: callout
    tone: info
    title: Rollback
    text: Point DNS back to the old gateway; no data migrates.
```

Check every block's real props with `describe` before relying on this shape.

## MCP server

`ak-render mcp` serves the same loop as MCP tools over stdio: `catalog`
(optional `category`), `search-catalog` (`query`), `describe` (`type`, or
`types` with optional `compact`), `recipes`, `recipe` (`name`), `validate`,
`render` and `themes`. `render` writes the HTML to the
`out` path and returns only the summary, so the page never enters your context.
`out` must end in `.html` or `.htm`. A relative path resolves against the
directory the server was started in; an absolute or `..` path is written where
it points, so review it like any file write. `spec` may be YAML/JSON text or the parsed object.

```json
{
  "mcpServers": {
    "ak-render": { "command": "npx", "args": ["-y", "@bestagentkits/render", "mcp"] }
  }
}
```

### Remote MCP server

Without Node, use the hosted server at `https://render.agentkit.best/mcp` (MCP
Streamable HTTP). It serves `catalog`, `search-catalog`, `describe`,
`recipes`, `recipe`, `validate`, `render` and `themes` with the same names and
contracts, and the
loop is the same. Two things differ:

- `render` has no `out`, because a remote server cannot write into your
  filesystem. It stores the page and returns the same summary plus
  `artifactUrl` and `expiresAt`. The artifact lives for one hour; pass
  `share: true` for a share link that lives for 30 days. The HTML is never in
  the reply.
- `validate` and `render` need an AgentKit bearer token. `catalog`,
  `search-catalog`, `describe`, `recipes`, `recipe` and `themes` work without
  one. `themes` lists the built-in presets only, since
  the server has no project presets to discover.

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

A refused call comes back as a tool error whose text is JSON with a `code`:
`UNAUTHENTICATED` (no token), `ENTITLEMENT_INACTIVE` or `FORBIDDEN`
(the account is not entitled), `RATE_LIMITED` (wait for the next minute), or a
compiler code such as `SPEC_UNKNOWN_BLOCK` with the JSON path to fix. A token
the server rejects fails the whole request with HTTP 401 instead; replace the
token in the client configuration. Under protocol revision 2025-06-18 or later
send one message per request: batches are refused. Local
rendering never needs the token or the network.

## Rules that save retries

- The output is offline. A remote image or video stays a labelled fallback
  unless the spec opts in under `policy.network`; see
  [media-policy.md](./media-policy.md). A remote video `poster` is rejected at
  its path unless the page allows remote `images`.
- Write commands, paths and identifiers in prose between backticks:
  `` `ak-render catalog` `` renders as inline code. That is the only markup
  text props understand; titles, `code` and `terminal` text stay literal.
- URLs accept `https`, `http`, `mailto` and relative paths; `javascript:` and
  similar schemes are rejected.
- Use semantic blocks (`hero`, `steps`, `timeline`, `comparison`, `kpi`,
  `data-table`, `cta`) before primitives; they carry the design for you.
- Put shared numbers in `datasets` once and bind blocks with `dataRef`, instead
  of repeating rows in a chart and a table. A field a block names that the rows
  lack comes back with `details.allowed`. `percent` takes `87` for "87%". See
  [data-and-state.md](./data-and-state.md).
- State keys are lowercase kebab case (`state.show-details`), and every key a
  control binds must be declared under `state`.
- Themes are presets, not CSS. Custom presets extend a built-in; see
  [themes.md](./themes.md).
- The same spec, theme presets and compiler version always produce the same
  bytes, so a changed hash means one of those three changed. Project or user
  presets found on disk and `--theme` count as theme input.

## Install the skill

The repository ships one agent skill, `ak-render`
([skills/ak-render/SKILL.md](../skills/ak-render/SKILL.md)), that teaches this
loop. The Claude Code and Codex plugins also register the MCP server above.

**Claude Code** (plugin marketplace):

```bash
claude plugin marketplace add bestagentkits/ak-render
claude plugin install ak-render@ak-render
```

Inside a session, run `/plugin marketplace add bestagentkits/ak-render`, then
`/plugin install ak-render@ak-render`. The skill runs as `/ak-render:ak-render`.

**Codex** (repo marketplace at `.agents/plugins/marketplace.json`):

```bash
codex plugin marketplace add bestagentkits/ak-render
codex plugin add ak-render@ak-render
```

In the ChatGPT desktop app, open the Plugins Directory, choose the `AK Render`
marketplace, and install `ak-render`.

**Any agent** ([skills CLI](https://github.com/vercel-labs/skills)):

```bash
npx skills add bestagentkits/ak-render
```

Add `-g` to install for every project, or `-a <agent>` to target one agent.
The skills CLI installs the skill only; add the MCP server yourself with the
config above if you want the tools.
