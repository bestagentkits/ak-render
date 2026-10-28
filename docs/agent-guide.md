# Writing a Page Spec as an agent

AK Render turns a short YAML or JSON **Page Spec** into one self-contained HTML
file. You describe what the page says; the compiler owns layout, colour,
typography, motion, accessibility and security. Do not write HTML or CSS, and
do not try to position or style blocks: there is no field for it.

## The loop

**Shortcut for known page kinds.** When the page is one `compose` knows (see
`ak-render compose intents`), fill its typed content slots and run
`ak-render compose input.yaml --out page.html --spec-out page.yaml`. One call
replaces the whole loop; diagnostics point into your input
(`content.scenarios.items[1].values`), and `page.yaml` is an ordinary spec you
can keep editing with the loop below. See [compose](./compose.md).

1. **Find the blocks.** `ak-render search-catalog <intent words>` ranks block
   types for what the page needs, for example `search-catalog sortable table`
   or `search-catalog pricing`. Vietnamese works too, with or without
   diacritics (`search-catalog biểu đồ`, `search-catalog bang gia`).
   `ak-render catalog --category <c>` lists one
   category; `ak-render catalog` lists every block and action (about 8 kB).
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
   allowed ones in `details.allowed`, and an unknown block type names up to
   three near types in `details.closest` (`catalog` and `search-catalog` list
   the rest). Exit code 1 means "fix and retry".
   Add `--suggest` to get `fixes` on each diagnostic it can fix: RFC 6902
   patches whose first operation is a `test` of the current value, with a
   `rule` id and a `classification`. `safe` fixes keep the author's meaning
   (a single item or block where a list is required, an enum value that
   differs only in letter case); `ambiguous` ones are guesses (a near block,
   action or property name, or wrapping text such as `a, b` that may mean
   several items) for you to choose. Apply one fix per diagnostic, then
   validate again. `ak-render repair page.yaml --out page.yaml` applies only
   the safe fixes, revalidates and logs each change; it keeps YAML comments
   when it can replay the edit in place (otherwise it re-emits the spec), and
   it never deletes a field, changes data or picks between guesses.
   Icons are named by meaning (`icon: gauge`); find names with
   `ak-render icons search <words>` and see [icons.md](./icons.md).
5. **Compile.** `ak-render page.yaml --out page.html --json` writes the file and
   prints a summary (bytes, hash, features, warnings).
6. **Check the page (optional).** `ak-render audit-ui page.yaml --json` lists
   visual problems in the compiled page, each with the block's `path` and a
   `fix`; add `--preset publication` when a Chromium is available for the
   real-browser pass. See [audit-ui.md](./audit-ui.md).

Pass `-` instead of a path to read the spec from standard input, so no temporary
file is needed:

```bash
ak-render - --out page.html < spec.yaml
cat spec.yaml | ak-render validate - --json
```

Every command accepts `--json` and never prompts.

## Edit an existing page

Change a page with a small patch instead of rewriting or resending its spec.
`ak-render patch` applies an [RFC 6902](https://www.rfc-editor.org/rfc/rfc6902)
JSON Patch to the spec file in place and prints a hash and the applied changes,
never the spec:

```bash
ak-render patch page.yaml '[{"op":"replace","path":"/blocks/@revenue/title","value":"Revenue, FY26"}]' --json
ak-render patch page.yaml ops.json --base-hash s-0h3k2...   # ops from a file, or - for stdin
```

- **Address blocks by id.** A path that starts `/blocks/@<id>` resolves to the
  block whose `id` field is `<id>`, at any depth (sections, columns, tab
  panels), so a nested edit needs no array indexes. Give a block an `id` to
  make it addressable; compiler-derived ids are not, because they change when
  the page changes. An unknown id is refused and lists the ids that exist
  (`details.known`); a duplicate id lists the blocks that share it
  (`details.matches`). Plain pointers such as `/meta/title` and
  `/blocks/2` work as RFC 6902 specifies.
- **Optimistic concurrency.** Every reply carries `hash`, the spec's content
  hash (formatting and comments do not change it). Pass it back as
  `--base-hash` (MCP `baseHash`): if the spec changed since, nothing is applied
  and the diagnostic `SPEC_PATCH_CONFLICT` carries the current hash. `patch
  page.yaml '[]'` reads the hash without changing anything.
- **All or nothing.** Operations run in order on a copy. One failing
  operation (missing target, failed `test`, unknown id) applies none and
  reports `SPEC_PATCH_ERROR` at `ops[i].path`, `ops[i].from` or `ops[i].value`.
  A patch may not grow the spec past 4 MiB of JSON.
- **Canonical file kept.** YAML comments, key order and untouched blocks stay as
  written; JSON keeps its indentation, and CRLF line endings stay CRLF. The
  file is replaced atomically and the patch is refused if the file changed
  during the write. Only a file that reads as a Page Spec (`version` and a
  `blocks` list) is edited. A patch that raises the error count is not written
  (`written: false`); one that lowers it on an already broken spec is. The exit
  code is 0 only when the patched spec has no errors, so a written partial fix
  still exits 1: read `written`. `--dry-run` reports without writing.

The patched spec is validated like any other, so the reply's `diagnostics`
list what to fix next. Over MCP, `patch` takes `ops`, optional `baseHash`, and
either `file` (local server: a spec file under its working directory, edited
in place, no spec in the reply) or `spec`
(the reply carries the patched spec, as text when you sent text). The
library exports `patch(spec, ops, { baseHash })`, `patchSpecText(text, ops)`
and `specHash(spec)`. A fix from `validate --suggest` is itself a patch, so an
ambiguous fix you choose applies with `ak-render patch page.yaml '<its patch>'`.

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
`types` with optional `compact`), `search-icons` (`query`, optional `pack`, `limit`),
`describe-icon` (`icon`), `icon-packs`, `motions` (optional `query`, or `id`
with `compact`), `recipes`, `recipe` (`name`), `validate` (optional `suggest`), `repair`, `patch` (`ops` with `file`
or `spec`, optional `baseHash`), `audit-motion`
(`spec` or `html`), `audit-ui` (`spec` or `html`, optional `preset`), `compose` (`intent`, `content`, optional `theme`, `out`,
`dryRun`, `returnSpec`), `render` and `themes`. `render` and `compose` write the HTML to the
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
`search-icons`, `describe-icon`, `icon-packs`, `motions`, `recipes`, `recipe`, `validate`, `repair`, `patch`, `audit-motion`, `audit-ui` (quick preset only), `compose`, `render` and `themes` with the same names and
contracts, and the
loop is the same. Two things differ:

- `render` has no `out`, because a remote server cannot write into your
  filesystem. It stores the page and returns the same summary plus
  `artifactUrl` and `expiresAt`. The artifact lives for one hour; pass
  `share: true` for a share link that lives for 30 days. The HTML is never in
  the reply. Add `retainSpec: true` to keep the spec with the page's owner
  and expiry.
- `artifact-export` exists only here. Given the `artifactUrl` (or its id) and
  `formats` (`html`, `png`, `pdf`, `spec`; default `html`), it returns signed
  download URLs that last an hour and never outlive the page. Download the
  spec to keep editing locally, where the file stays canonical; a `theme`
  argument is not part of the spec, so the reply names it as `themeOverride`.
- Every request needs an AgentKit bearer: an OAuth access token the client
  obtains by signing in, or a personal API key (`ck_live_…`). `themes` lists
  the built-in presets only, since the server has no project presets to
  discover.

```json
{
  "mcpServers": {
    "ak-render": { "type": "http", "url": "https://render.agentkit.best/mcp" }
  }
}
```

The client signs in to agentkit.best through OAuth the first time it connects
and refreshes on its own; a grant in regular use lasts indefinitely, and one
left idle expires after 365 days. For CI or a client without OAuth, send a
personal AgentKit API key (`ck_live_…`) instead, which lasts until revoked:
add `"headers": { "Authorization": "Bearer ${AGENTKIT_TOKEN}" }`.

A refused call comes back as a tool error whose text is JSON with a `code`:
`ENTITLEMENT_INACTIVE` or `FORBIDDEN`
(the account is not entitled), `RATE_LIMITED` (wait for the next minute), or a
compiler code such as `SPEC_UNKNOWN_BLOCK` with the JSON path to fix. A token
that is missing or rejected fails the whole request with HTTP 401 instead: an
OAuth client signs in again, and an API key must be replaced in the client
configuration. Under protocol revision 2025-06-18 or later
send one message per request: batches are refused. The remote server also
speaks the stateless 2026-07-28 revision, and `GET /v1/version` lists the tools
it currently serves. Local
rendering never needs the token or the network.

## Rules that save retries

- The output is offline. A remote image or video stays a labelled fallback
  unless the spec opts in under `policy.network`; see
  [media-policy.md](./media-policy.md). A remote video `poster` is rejected at
  its path unless the page allows remote `images`.
- Write commands, paths, URLs and identifiers in prose between backticks:
  `` `ak-render catalog` `` renders as inline code. Wrap a key phrase in double
  asterisks for bold: `**AgentKit customers**`. Those two are the only markup
  text props understand. Block titles, table cells and comparison items render
  them too; `meta.title`, `code` and `terminal` text stay literal.
- URLs accept `https`, `http`, `mailto` and relative paths; `javascript:` and
  similar schemes are rejected.
- Use semantic blocks (`hero`, `steps`, `timeline`, `comparison`, `kpi`,
  `data-table`, `cta`) before primitives; they carry the design for you.
- For a plan the user has to approve, put each open question in a `decision`
  (mark the option you would pick `recommended`) and end the page with one
  `feedback` block. The user copies their answers and comments back to you as
  one prompt. A `decision` without a `feedback` block fails validation.
- For a news or journal page use `preset: newspaper` with `publication-header`
  and `editorial-layout` (`lead`, `secondary`, `aside` slots holding `story` and
  `digest-list`). Say what each story is (`prominence`, `category`, `byline`,
  `summary`, `body`); the compiler picks the columns, rules and drop cap. Start
  from `ak-render recipe newspaper`.
- Put shared numbers in `datasets` once and bind blocks with `dataRef`, instead
  of repeating rows in a chart and a table. A field a block names that the rows
  lack comes back with `details.allowed`. `percent` takes `87` for "87%".
  Compute ratios, deltas and totals with `transform.derive` and
  `transform.rollup`, and let a `kpi` item `cite` its dataset instead of
  copying the number. See
  [data-and-state.md](./data-and-state.md).
- State keys are lowercase kebab case (`state.show-details`), and every key a
  control binds must be declared under `state`.
- Themes are presets, not CSS. Custom presets extend a built-in; see
  [themes.md](./themes.md).
- Motion is opt-in per block and named, never authored: `motion: reveal-soft`
  on a card, `stagger` on steps, `tabs-slide` on tabs. `describe --compact`
  lists a type's recipes under `motion:`, and `fade-swap` fits any block with
  `visibleWhen`. `ak-render motions search <intent>` ranks recipes and
  `ak-render motion audit <spec> --json` checks the result. A person can tune
  the same spec by eye with `ak-render motion studio <spec>`. See
  [motion.md](./motion.md).
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
