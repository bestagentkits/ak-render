# Visual audit

`ak-render audit-ui` checks how a compiled page looks and behaves: whether it
scrolls sideways on a phone, cuts off chart labels, draws text a reader cannot
read, or depends on JavaScript to show content. It complements the compiler's
own checks rather than replacing them:

- `validate` checks the spec. It never opens a browser.
- `verifyDocument` (run on every compile) and `motion audit` stay the fast,
  structural compiler checks.
- `audit-ui` looks at the artifact a reader actually receives.

```bash
ak-render audit-ui page.yaml                         # quick: structural, no browser
ak-render audit-ui page.yaml --preset publication    # real browser
ak-render audit-ui page.html --preset publication --evidence-dir audit/ --json
```

## Presets

| Preset | Runs | Cost |
| --- | --- | --- |
| `quick` (default) | Reads the resolved theme and the compiled markup. | Milliseconds, synchronous, no browser. Safe to run after every render, and on the remote MCP server. |
| `publication` | Every quick check, plus a headless Chromium at 375×812, 768×1024 and 1440×900 in light and dark, then no-JS, reduced motion and print (A4). | About 1–3 s per page. Local only. |

`publication` needs Playwright (`playwright-core`, `playwright` or
`@playwright/test`) and a Chromium build: install one with
`npx playwright install chromium`, or point `--chromium <path>` at an existing
binary. When no browser starts, the report says `audit/browser-unavailable`
and is marked incomplete; the quick findings still come with it.

## Budget and isolation

- **Time.** `--timeout <ms>` (default 60 000, at most 300 000) bounds the whole
  browser run, browser start included. A run that hits it stops, reports `audit/budget-exceeded` with
  the number of checks that finished, and is marked incomplete.
- **Network.** Every request the page makes is blocked. Relative assets
  (images, video, audio, captions) are served from the directory beside the
  spec or page and never from outside it, symlinks included. Each blocked URL
  is a finding. The bundled launcher also starts Chromium with no name
  resolution and a dead proxy, so hints the page gives the browser itself
  (preconnect, DNS prefetch) cannot reach the network either.
- **Concurrency.** One process runs at most two browsers at once; further
  publication audits (for example concurrent MCP calls) wait their turn.
- **Scripts.** Given a spec, the audit compiles it itself, so the only script
  that runs is the runtime this compiler emitted. Given HTML, the page did not
  come from this audit, so it runs with JavaScript off and the report says
  `scripts: disabled`; interaction and no-JS comparisons are skipped.

## Findings

Every finding carries a `rule`, a `severity`, a `message`, the block's spec
`path` (or `html` / `$` when no spec path applies) and `nodeId`, the
`viewport`, `scheme` and `mode` it was measured in, the measured `evidence`
(selector and numbers, enough to reproduce it), an `evidenceRef` to the
check's screenshot when `--evidence-dir` is given, and a deterministic `fix`.
A report lists at most 20 findings per rule plus one that counts the rest;
`counts` always covers every finding. Findings are sorted, so the same input,
compiler and browser build give the same report.

| Rule | Preset | Severity | What it catches |
| --- | --- | --- | --- |
| `ui/theme-contrast` | quick | error | A theme text colour below WCAG 2.2 AA (4.5:1) on a surface it is drawn on. |
| `ui/wide-table` | both | warning | A table much wider than a phone screen (7 or more columns), read by scrolling sideways. |
| `ui/long-chart-label` | quick | info | A chart category label longer than 16 characters. |
| `ui/horizontal-overflow` | publication | error | The page scrolls sideways at a viewport, as rendered or with its disclosures open. |
| `ui/clipped-chart-label` | publication | warning | A chart label drawn outside its chart and cut off. |
| `ui/text-contrast` | publication | error | Rendered text below WCAG 2.2 AA against the background it is drawn on. |
| `ui/small-text` | publication | warning | Readable text set below 10px on a phone. |
| `ui/touch-target` | publication | warning | A control (or its label) under 24px in its shorter dimension on a phone (WCAG 2.5.8). |
| `ui/broken-image` | publication | error | An image that failed to load. |
| `ui/script-error` | publication | error | The compiled runtime threw or logged an error. |
| `ui/interaction-failed` | publication | error | A tab, disclosure or theme toggle that did not change state when activated. |
| `ui/no-js-hidden` | publication | warning | A block visible with JavaScript and hidden without it. |
| `ui/reduced-motion` | publication | error | An element that still animates with reduced motion requested. |
| `audit/network-request` | publication | error | A request the page attempted; the audit blocked it. |
| `audit/scripts-disabled` | publication | info | HTML audited with JavaScript off. |
| `audit/budget-exceeded` | publication | error | The run stopped at its time budget. |
| `audit/aborted` | publication | error | The browser stopped the run (a crash or a closed page). |
| `audit/browser-unavailable` | publication | error | No browser could be launched. |

The registry lives in [`src/audit/ui-audit-rules.ts`](../src/audit/ui-audit-rules.ts)
and the library exports it as `UI_RULES`. Add a rule there, with its fix,
rather than a second checker.

## Gates

`--fail-on <error|warning|info|none>` (default `error`) sets the exit code: 1
when a finding at or above that severity exists, 0 otherwise, 2 for a usage
error. An incomplete report fails every gate except `none`: a check that did
not run is not a pass. HTML input always carries the info notice
`audit/scripts-disabled`, so `--fail-on info` cannot pass for HTML; gate HTML
at `warning` or above. `--json` prints the report with `gate: { failOn,
failed }`.

## MCP and library

The local MCP server (`ak-render mcp`) exposes `audit-ui` with `spec` or
`html`, an optional `preset`, `theme` and `timeoutMs`. The remote server runs
only the `quick` preset (bearer, the `validate` limit) and answers a
`publication` request with an error that points at the local CLI.

```ts
import { auditUi, auditUiQuick, uiAuditFails } from '@bestagentkits/render';

const quick = auditUiQuick(spec);                       // synchronous, no browser
const full = await auditUi(spec, { preset: 'publication', timeoutMs: 30_000 });
if (uiAuditFails(full, 'error')) process.exitCode = 1;
```

`auditUi` takes `launch` to supply your own Playwright-compatible browser and
`executablePath` to pick a Chromium binary; it closes the browser it is given.
A browser from `launch` is yours to start offline (see `OFFLINE_CHROMIUM_ARGS`
in [`src/audit/ui-audit-browser.ts`](../src/audit/ui-audit-browser.ts)); request
interception still blocks every request it makes.
