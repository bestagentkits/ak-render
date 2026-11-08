---
name: ak-render
description: Build a polished offline HTML report, dashboard or architecture review page with AK Render. Write a short YAML Page Spec, validate it, and compile it to one self-contained HTML file instead of hand-writing HTML, CSS or JavaScript. Use when the user asks for an HTML report, a status or incident report, a KPI dashboard, an architecture or design review page, or a shareable page that presents results already in the conversation. Needs Node.js 20.11+ on the machine running Claude; not for images, video, audio or slide decks.
---

# AK Render

AK Render compiles a YAML or JSON **Page Spec** into one deterministic,
self-contained HTML file. The page opens from `file://` and makes no network
request. You describe what the page says; the compiler owns layout, colour,
typography, accessibility and security.

This plugin pins `@bestagentkits/render@0.3.0`. Everything below works with
that version; don't use commands that it does not list in `--help`.

## Tools

When the `ak-render` MCP tools are available (`catalog`, `search-catalog`,
`describe`, `recipes`, `recipe`, `validate`, `render`, `themes`), use them.
`spec` may be YAML or JSON text. `render` writes the HTML to `out` and returns
only a summary.

Otherwise use the CLI with the same pinned version. Every command except
`mcp` accepts `--json`, and none of them prompts:

```bash
npx -y @bestagentkits/render@0.3.0 --version
```

If `npx` is missing or Node is older than 20.11, stop and tell the user to
install Node.js 20.11 or later. Don't fall back to hand-written HTML.

## The loop: brief → spec → validate → render → inspect

1. **Pick a starting point.** For a report, dashboard or architecture review,
   start from a recipe or from a bundled example and replace its content:

   | Brief | Recipe | Bundled example |
   | --- | --- | --- |
   | Report, recap, postmortem | `research-report`, `incident-report`, `release-recap` | `examples/report.yaml` |
   | KPI or service dashboard | `dashboard` | `examples/dashboard.yaml` |
   | Architecture or design review | `architecture-review`, `decision-memo` | `examples/architecture.yaml` |

   ```bash
   npx -y @bestagentkits/render@0.3.0 recipes
   npx -y @bestagentkits/render@0.3.0 recipe dashboard > page.yaml
   ```

   The examples sit in the `examples/` folder next to this file. Their numbers
   are fictional sample data, so replace every value.

2. **Find and describe only the blocks you need.**

   ```bash
   npx -y @bestagentkits/render@0.3.0 search-catalog sortable table
   npx -y @bestagentkits/render@0.3.0 describe kpi chart data-table --compact
   ```

3. **Write the spec** to a `.yaml` file. Every number, date, name and finding
   must come from the conversation, the repository or tool output. If a value
   is unknown, leave the block out or ask; never fill it with a guess.

4. **Validate and fix.** Exit code 1 means fix and retry:

   ```bash
   npx -y @bestagentkits/render@0.3.0 validate page.yaml --json
   ```

   The result is `{ ok, diagnostics[] }`. Each diagnostic has a stable `code`
   and a JSON `path` such as `$.blocks[0].titl`; for an unknown prop,
   `details.allowed` lists the valid ones. Fix each diagnostic at its path and
   validate again until `ok` is `true`.

5. **Render** to an `.html` file:

   ```bash
   npx -y @bestagentkits/render@0.3.0 page.yaml --out page.html --json
   ```

   Exit code 1 means the spec is invalid and nothing was written; exit code 2
   means a file could not be read or written. Report the message to the user.

6. **Inspect the result.** Read the JSON summary, not the HTML: confirm `out`
   is the path you asked for, `title` is right and `warnings` is empty (fix the
   spec for each warning and render again). Don't read the HTML back into
   context. Give the user the file path, and open it once with `open` (macOS),
   `xdg-open` (Linux) or `start` (Windows) only if the file did not exist
   before this render; otherwise ask them to refresh.

## Rules

- **No raw HTML, CSS or JS.** The spec has no field for them; keys such as
  `rawHTML`, `iframe`, `srcdoc` or `script` are rejected. Don't post-process
  the emitted file. Links accept `https`, `http`, `mailto` and relative paths.
- **Keep the page offline.** `policy.network` defaults to `deny`; only opt in
  when the user asks for remote media.
- **Choose a theme by name.** List them with `themes` and set
  `theme.preset`; don't restyle the page.
- **Not for generated media.** AK Render lays out text, tables, charts and
  diagrams from data you already have. It does not create images, video or
  audio.

## Minimal spec

```yaml
version: 1
meta:
  title: Migration plan
  description: How we move the API to the new gateway.
blocks:
  - type: hero
    eyebrow: Plan
    title: Migration plan
    description: Move the public API to the new gateway without downtime.
  - type: steps
    items:
      - title: Mirror traffic
        text: Send a copy of production requests to the new gateway.
      - title: Switch reads
        text: Route read endpoints once error rates match.
```
