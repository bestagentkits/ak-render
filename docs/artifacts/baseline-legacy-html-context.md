# Baseline: legacy HTML presentation context

Captured by `benchmarks/legacy-context-cost.mjs`. Machine-readable companion:
[`baseline-legacy-html-context.json`](./baseline-legacy-html-context.json).

## What this measures

Before AK Render, an AgentKit HTML task loads presentation guidance from
`kits/core/skills/ak-preview/references/` (plus diagram and project-block
references in Engineer installations). This artifact records the size of that
guidance, because it is the part of the cost that AK Render is designed to
remove from model context.

**Measurement.** File bytes, characters, words, and lines are exact, read
directly from the AgentKit checkout. Token counts are **estimates** derived from
the character count at 4 chars/token (point), bounded by 4.5 and 3.5
chars/token. No tokenizer was run, so no exact token count is claimed.

**Source.** AgentKit checkout revision `1035b17c`.

**Scope limits.** This measures *presentation guidance* only. It excludes skill
bodies, fixture content, model output, and retries. The guidance a legacy run
actually loads is decided by the model following the contract, so these numbers
are a ceiling for a compliant run, not a per-run observation.

## Result

| Measure | Value |
| --- | --- |
| Presentation reference files | 16 |
| Total characters | 181,558 |
| Total words | 26,343 |
| Estimated tokens (point) | ~45,390 |
| Estimated tokens (range) | ~40,347 – 51,874 |
| Per-task context, minimum | ~3,203 tokens (`ak:page-builder` block integration) |
| Per-task context, maximum | ~40,631 tokens (`ak:preview --diagram` + editorial layer) |
| Per-task context, mean | ~33,669 tokens across 20 representative tasks |

The dominant costs are `html-css-patterns.md` (~10,375 tokens),
`html-slide-patterns.md` (~9,998 tokens), and `html-libraries.md` (~5,374
tokens). Those three are the concrete, copy-pasteable presentation
implementation that the compiler is meant to replace.

## Per-reference detail

| Group | Reference | Chars | Est. tokens |
| --- | --- | ---: | ---: |
| shared contract | `html-skill-composition.md` | 4,697 | 1,175 |
| shared contract | `html-mode-workflow.md` | 5,642 | 1,411 |
| always loaded | `html-design-guidelines.md` | 15,655 | 3,914 |
| mode specific | `html-css-patterns.md` | 41,498 | 10,375 |
| mode specific | `html-libraries.md` | 21,493 | 5,374 |
| mode specific | `html-responsive-nav.md` | 5,805 | 1,452 |
| mode specific | `html-slide-patterns.md` | 39,991 | 9,998 |
| editorial alternates | `html-diagram-design.md` | 8,710 | 2,178 |
| editorial alternates | `html-antv-infographic.md` | 7,609 | 1,903 |
| preview routing | `generation-modes.md` | 8,350 | 2,088 |
| preview routing | `view-mode.md` | 1,378 | 345 |
| preview routing | `visual-explanation-routing.md` | 1,693 | 424 |
| diagram engine | `typed-ir.md` | 6,228 | 1,557 |
| project blocks | `block-contract.md` | 3,683 | 921 |
| project blocks | `widget-sizing.md` | 5,130 | 1,283 |
| project blocks | `agent-interfaces.md` | 3,996 | 999 |

## Representative task inventory

Twenty legacy HTML-producing tasks, with the guidance a compliant run loads for
each. This is the task set the A/B comparison uses.

| Task | Skill | Mode | Refs | Est. tokens |
| --- | --- | --- | ---: | ---: |
| `explain-html` | `ak:explain` | `--html` | 7 | 33,696 |
| `explain-diagram` | `ak:explain` | `--diagram` | 8 | 35,253 |
| `explain-slides` | `ak:explain` | `--slides` | 7 | 33,696 |
| `brainstorm-html` | `ak:brainstorm` | `--html` | 7 | 33,696 |
| `plan-review-engineer` | `ak:plan` (Engineer) | `--html` | 7 | 33,696 |
| `plan-review-marketing` | `ak:plan` (Marketing) | `--html` | 7 | 33,696 |
| `plan-html-diagram-panel` | `ak:plan` (Engineer) | `--html` + diagram | 8 | 35,253 |
| `plan-html-kpi-panel` | `ak:plan` (Engineer) | `--html` + KPI panel | 9 | 37,775 |
| `preview-diff` | `ak:preview` | `--diff` | 10 | 36,551 |
| `preview-plan-review` | `ak:preview` | `--plan-review` | 10 | 36,551 |
| `preview-recap` | `ak:preview` | `--recap` | 10 | 36,551 |
| `preview-diagram` | `ak:preview` | `--diagram` | 11 | 38,108 |
| `preview-slides` | `ak:preview` | `--slides` | 10 | 36,551 |
| `preview-editorial-architecture` | `ak:preview` | `--diagram` + editorial | 12 | 40,631 |
| `show-off` | `ak:show-off` | always HTML | 7 | 33,696 |
| `retro-html` | `ak:retro` | `--format html` | 7 | 33,696 |
| `advise-html` | `ak:advise` | `--html` | 7 | 33,696 |
| `cti-html` | `ak:cti-expert` | `--format html` | 7 | 33,696 |
| `issue-to-plan-html` | `ak:issue-to-plan` | delegates `ak:plan --html` | 7 | 33,696 |
| `page-builder-blocks` | `ak:page-builder` | project block integration | 3 | 3,203 |

## Not yet measured

These require live model runs or the A/B fixture harness, and are deliberately
left unmeasured rather than estimated:

- model output tokens per HTML-producing task;
- wall-clock generation time per task;
- retries and repair count per task;
- emitted HTML bytes for legacy tasks (AgentKit has no committed legacy artifact
  corpus to measure; capture during the A/B fixtures);
- browser console errors, network requests, a11y critical failures, and viewport
  overflow at 375 / 768 / 1440 px for legacy output.

Each is recorded in the `notMeasured` array of the JSON artifact so the gap
travels with the data instead of being forgotten.

## Target gates from the epic

Recorded here as targets, not results, and reported against once the A/B
fixtures run:

| Gate | Target |
| --- | --- |
| Presentation prompt/context tokens | ≥ 50% reduction |
| Model output tokens for HTML tasks | ≥ 60% reduction |
| Invalid HTML/CSS/JS retries | material reduction |
| Critical accessibility regressions | none |
| Responsive overflow at 375 / 768 / 1440 px | none |
| Factual/content completeness | not worse than legacy |

## Reproducing

```bash
node benchmarks/legacy-context-cost.mjs \
  --agentkit /path/to/agentkit \
  --revision "$(git -C /path/to/agentkit rev-parse --short HEAD)"
```

The script fails loudly if a reference file is missing, so a rename in AgentKit
surfaces as a broken baseline instead of a silently smaller number.
