# Writing a Page Spec as an agent

AK Render turns a short YAML or JSON **Page Spec** into one self-contained HTML
file. You describe what the page says; the compiler owns layout, colour,
typography, motion, accessibility and security. Do not write HTML or CSS, and
do not try to position or style blocks: there is no field for it.

## The loop

1. **Discover once.** `ak-render catalog` lists every block type in about 5 kB.
2. **Describe only what you use.** `ak-render describe <type> --json` returns one
   block's props, defaults, bounds, slots and actions.
3. **Validate.** `ak-render validate page.yaml --json` returns
   `{ ok, diagnostics[] }`. Each diagnostic has a stable `code` and the JSON
   `path` to fix (for example `$.blocks[0].titl`); an unknown prop lists the
   allowed ones in `details.allowed`. Exit code 1 means "fix and retry".
4. **Compile.** `ak-render page.yaml --out page.html --json` writes the file and
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

`ak-render mcp` serves the same loop as MCP tools over stdio: `catalog`,
`describe`, `validate`, `render` and `themes`. `render` writes the HTML to the
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
- Use semantic blocks (`hero`, `steps`, `timeline`, `comparison`, `kpi`, `cta`)
  before primitives; they carry the design for you.
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
