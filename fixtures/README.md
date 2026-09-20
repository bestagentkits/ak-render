# Fixture corpus

`fixtures/pages/` contains representative Page Specs. They are the compiler's
specification: a capability is not complete until a fixture exercises it, and
every milestone adds to this corpus rather than to a private scratch file.

## Page classes

| Fixture | Class | What it forces the compiler to handle |
| --- | --- | --- |
| `plan.yaml` | Implementation plan / plan review | Nested sections, ordered steps, timeline, comparison table, embedded diagram adapter, callout severity |
| `explain.yaml` | Code/system explanation | Long-form prose, code blocks with copy action, tabbed alternatives, alert levels, inline diagram |
| `recap.yaml` | Progress recap | Stats, timeline of events, card grid, sparkline/line chart, list with badges |
| `diff.yaml` | Change review | Table with status semantics, side-by-side comparison, risk matrix, collapsible detail |
| `dashboard.yaml` | Metrics dashboard | Every chart type (bar, line, area, pie/donut, sparkline, progress), KPI semantics, responsive grid |
| `media.yaml` | Media gallery | Local image gallery, network-denied video/audio degradation to poster plus link, carousel |
| `interactive.yaml` | Interaction coverage | Buttons, slider, carousel, tabs, accordion, copy, filter/search, theme toggle, dialog |

## Rules for fixtures

- **Semantic blocks first.** Use a semantic block whenever one expresses the
  intent; reach for primitives only to show the escape hatch.
- **No network in a default fixture.** Network-backed behavior is exercised with
  an explicit `policy.network` opt-in, in `media.yaml`, so the offline default
  keeps a fixture of its own.
- **Deterministic content only.** No dates that change per run, no random
  identifiers, no locale-dependent values. Fixtures feed byte-comparison tests.
- **Small but representative.** A fixture demonstrates a contract; it is not a
  demo page. Prefer the smallest spec that still exercises the contract.
- **Every fixture declares `version`, `meta`, `theme`, and `policy`.** Those four
  are the normalizer's minimum viable envelope.

## Fixtures are also benchmark input

The same specs feed the legacy-versus-AK-Render comparison: the content is
constant across the two implementations so the comparison measures presentation
cost rather than content differences.
