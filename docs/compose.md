# Compose a page from an intent

`compose` is a shortcut in front of the Page Spec. For a known page kind, the
agent writes only the content in typed slots. AK Render checks the slots,
expands them into an ordinary Page Spec made of existing blocks, and compiles
it with the same `compile()` that `render` uses. There is no catalog lookup, no
block contract to read and no layout to choose.

The spec comes back too. When the page needs something the intent does not
cover, keep editing that spec with the full block vocabulary and `render` it as
usual.

## When to use it

- The page matches an intent: list them with `ak-render compose intents`.
- You want a good default page in one call and few retries.

Write a Page Spec directly when no intent fits or when you need full control
over block choice and order. Compose is additive: `render`, `validate` and the
Page Spec are unchanged.

## CLI

```bash
ak-render compose intents --json          # intents, summaries, content schemas
ak-render compose input.yaml --out page.html --spec-out page.yaml
ak-render compose input.yaml --dry-run    # print the expanded spec, compile nothing
ak-render compose - --json < input.yaml   # read stdin, print a JSON summary
```

`--json` prints `ok`, `diagnostics` and the render summary (`bytes`, `hash`,
`title`, `theme`, `nodes`, `warnings`), or the spec on a dry run. Without
`--out` the HTML goes to stdout. A failed input exits 1 with diagnostics; an
unreadable file exits 2.

## Input

```yaml
intent: investment-report
theme: executive-report     # optional; each intent has a default
content:
  title: Northwind Robotics Series B
  thesis:
    summary: Lowest cost per pick in the segment. We recommend leading the round.
    recommendation: invest
```

Only `intent`, `content` and `theme` are allowed at the top level. Every slot
is checked before anything is expanded, and each problem is a diagnostic with
the JSON path of the offending value, such as `content.scenarios.items[1].values`.
Unknown fields are errors that list the expected ones; nothing is silently
dropped.

A complete example is
[`fixtures/compose/investment-report.input.yaml`](../fixtures/compose/investment-report.input.yaml),
and the spec it expands to is
[`investment-report.spec.yaml`](../fixtures/compose/investment-report.spec.yaml).

## Intent: `investment-report`

Default theme `executive-report`. Only `title` and `thesis.summary` are
required; every other section appears only when its slot is filled.

| Slot | Shape | Becomes |
| --- | --- | --- |
| `title`, `subtitle`, `eyebrow` | strings | `hero` (eyebrow defaults to "Investment report") |
| `facts` | up to 12 `{label, value}` | `key-value` sidebar beside the thesis |
| `thesis` | `{summary, recommendation?, points?}` | `callout` titled "Recommendation: Invest", plus a "Why" `list` |
| `metrics` | up to 8 `{label, value, delta?, trend?, good?, caption?}` | `kpi` |
| `scenarios` | `{title?, metric?, format?, periods, items}` | `section` with a line `chart` and a `data-table` over shared datasets |
| `risks` | up to 12 `{area, impact, likelihood, mitigation?}` | `risk-matrix` |
| `milestones` | up to 12 `{when, title, text?}` | `timeline` |
| `sources` | up to 20 `{title, href?, authors?, publisher?, year?, note?}` | `references` |
| `currency` | ISO code | currency of scenario values when `format: currency` |

`recommendation` is one of `invest`, `pass`, `hold`, `watch`, `buy`, `sell`.
`pass` and `sell` use a warning tone; the rest use info.

### Scenarios

`periods` holds 2 to 24 labels. Each of the 1 to 6 `items` has a unique
`name`, exactly one number per period in `values`, and optional `probability`
(0 to 1) and `note`. `format` is `number`, `integer`, `compact`, `currency` or
`percent`. The chart and the summary table read the same data, so they cannot
disagree. When every item has a probability and they do not sum to 1, compose
warns but still builds the page.

## MCP

Both servers expose a `compose` tool with `intent`, `content` and optional
`theme`. Its input schema is the full content schema, so a client sees every
slot in `tools/list`.

- Local (`ak-render mcp`): pass `out` to write the HTML. The reply is the render
  summary, never the HTML.
- Remote (`https://render.agentkit.best/mcp`): needs a bearer like `render`,
  stores the page the same way and returns `artifactUrl`; `share: true` asks
  for a share link.
- `dryRun: true` returns the expanded spec as YAML without compiling or
  storing. `returnSpec: true` adds the spec to a normal reply.

## Library

```ts
import { compose, composeSpec, composeIntents, composeInputJsonSchema } from '@bestagentkits/render';

const { ok, diagnostics, spec, result } = compose(inputYamlOrObject);
// result.html is byte-identical to compile(spec).html
```

`composeSpec()` expands and validates without compiling. `composeIntents()`
returns each intent with its default theme and content schema, and
`composeInputJsonSchema()` returns the schema of a whole compose input.

## Guarantees

- **Deterministic.** The same input and compiler version produce the same spec
  and the same bytes.
- **No second compiler.** Expansion emits only existing blocks, then the
  standard validate and compile run. Any diagnostic from that step is reported
  at a `spec.` path you can inspect in the returned spec.
- **Bounded.** Lists have item caps, and dataset cells keep the dataset string
  limit.
