# Code review: GH-10 wave 0 and wave 1 (`50c9b1d..840ace0 -- src apps scripts`)

Date: 2026-10-06 (Asia/Saigon). Read-only review; nothing was edited or committed. Every finding was reproduced by compiling a small spec with `npx tsx` or by running Playwright from the scratchpad.

## Scope
- Files: every file under `src/`, `apps/cloud/src` and `scripts/` touched by the range. That covers nested blocks, layout blocks, datasets, transforms, state and visibleWhen, data-table, chart v2, the engineering, evidence and product widgets, the controls and filter-bar, theme recipes and presets, catalog search, the diagram adapter fit and the cloud worker.
- Focus, in priority order: injection, then network policy, determinism, correctness, no-JS/print/a11y, and bounds.
- Scout checks performed:
  - An injection fuzzer compiled 14,978 variants. It inserted a payload into every string leaf and every object key of every fixture. The payloads were `a" onzz="1`, `</script><zz>`, `</style><zz>`, `}zz{color:red}` and `javascript:zz()`. **None broke out of its context.**
  - A chart edge-case probe ran every chart kind against zero, negative, tiny, huge, identical, null, mixed-sign and single-row data.
  - A determinism grep found no `Math.random`, `Intl` or `toLocale*`. The only clock-style API is `Date.UTC` in date-input, and it is pure.
  - A Playwright run checked the filter-bar at 1440px and 375px.

## Overall assessment
The escaping and network surfaces are solid:
- `renderAttributes`, `escapeUrl` and `serializeJsonForScript` are used consistently.
- State paths are lowercase-only, so `__proto__` and `constructor` cannot be addressed.
- Every image prop goes through `resolveMedia` and the policy.
- Runtime selectors use only validated ids.

No Critical issues were found. There is one High bug: filtering does nothing on phones. There are several real correctness bugs in chart number handling, plus a group of Low hardening items.

## Critical Issues
None verified.

## High Priority

### H1. Filtered rows stay visible at ≤560px: filter-bar and the core `filter` action do nothing on phones
- **Where:** `src/blocks/data-table/data-table-styles.ts:63`, in the CARDS media query: `${ROOT} table,${ROOT} tbody,${ROOT} tbody tr,... {display:block;...}`.
- **Cause:** The filter-bar runtime (`controls-runtime.ts`) and the core filter both hide a row with `row.hidden = true`. That relies on the user-agent rule `[hidden]{display:none}`. The author rule `.ak-data-table tbody tr{display:block}` is more specific and wins. Search is unaffected because it uses `tr[data-ak-dt-miss]{display:none}` (line 30), which outranks the card rule.
- **Failing input:** a `filter-bar` with a `select` (`field: status`, `optionsFrom: status`) targeting a 6-row `data-table`. After selecting one status:
  - At 1440px, 3 of 6 rows show and the count reads "3 of 6 rows". Correct.
  - At 375px, **all 6 rows show** while the count still reads "3 of 6 rows". The page states something that is false.
- **Fix:** add `${ROOT} tbody tr[hidden]{display:none}` to BASE_TABLE, or inside CARDS after the card rule. Then audit the other `filterable` blocks (kanban, log-viewer and the other filter targets) for the same `display:` override on a hidden item. Add a 375px Playwright assertion to the controls spec.

## Medium Priority

### M1. Chart ticks and accessible text round values to 2 decimals before formatting
- **Where:** `src/render/chart-scales.ts`:
  - `:77`, `numberFormatter` → `formatValue(round(value), …)`.
  - `:175`, `tickValues` → `round(bounds.min + bounds.step*index)`.
- **Failing inputs:**
  - A line chart with values `[0.001, 0.002, 0.003]`. The y ticks render as `0 | 0 | 0 | 0`: the step is 0.001, so every tick rounds to 0.
  - The same data with `encoding.y.format: {format: 'percent', decimals: 3}`. The `<desc>` and `<title>` read "a 0.000%, b 0.000%", while the fallback `<table>` reads "0.004%". The SR and tooltip text disagree with the table and are wrong.
- **Impact:** any small-magnitude series loses its ticks and its accessible values. Typical cases are error rates, p-values, ratios and percent data stored as fractions.
- **Fix:**
  - Keep `round()` for SVG coordinates only, and never round a value before `formatValue`.
  - In `tickValues`, derive precision from the step, for example `Number(x.toFixed(max(0, -floor(log10(step)) + 1)))`. Alternatively use `toPrecision(12)`, as the histogram does, instead of a fixed 2 decimals.

### M2. Histogram emits `NaN` path data when the value magnitude dwarfs the range
- **Where:** `src/render/chart-kinds-histogram-waterfall.ts:59`, where `Number((best.start + best.step*index).toPrecision(12))`. Downstream, `scaleX` divides by `last - first`.
- **Cause:** when |value| / range exceeds about 1e12, `toPrecision(12)` collapses every edge to the same number. `span` becomes 0:
  - `histogramCounts` divides by zero (line 75).
  - `scaleX` produces `NaN`.
- **Failing input:** dataset x values `[1e16, 1e16+4, 1e16+2]` give `<path d="MNaN,250 hNaN…">`. The markup is invalid and the bars are invisible. Determinism holds, but the output is broken.
- **Fix:** drop the `toPrecision(12)` snap when it would merge adjacent edges (check `edges[i] === edges[i-1]`), or fall back to `[low, high]` as a single bin. Also guard `span === 0` in `histogramCounts` and `last === first` before calling `scaleX`.

### M3. The page outline (TOC) links to sections hidden by `visibleWhen`
- **Where:**
  - `src/render/outline.ts:43–54`: `outlineEntries` ignores `node.when`.
  - `src/render/render.ts`: `renderVisible` wraps the section in `<div class="ak-when" … hidden>`.
- **Failing input:** a page with sections Alpha, Beta, Gamma and Delta, where Beta has `visibleWhen: {path: state.show, equals: true}` and `state.show` is false. The TOC reads "Alpha Beta Gamma Delta", and the Beta link scrolls nowhere. Screen-reader users get a dead link in the landmark nav.
- **Fix:** do one of the following.
  - Omit entries whose node, or any ancestor, has a `when` that is initially false. The outline is static, so it should list only initially visible content.
  - Emit `data-ak-when` on the `<li>` too, so `syncConditions` toggles it alongside the section.

## Low Priority

### L1. Log-viewer looks up the level tone through the prototype chain
- **Where:** `src/blocks/engineering/log-viewer.ts:115`, `data-tone="${LEVEL_TONES[line.level] ?? 'neutral'}"`. This is interpolated without `escapeAttribute`.
- **Failing input:** a dataset row with `level: "constructor"` emits `data-tone="function Object() { [native code] }"`. A level of `toString` behaves similarly. This is not exploitable, because native source contains no quotes. It is still unescaped output driven by data, and it bypasses the tone enum.
- **Fix:** `Object.hasOwn(LEVEL_TONES, line.level) ? LEVEL_TONES[line.level] : 'neutral'`, or use a `Map`, and route the value through `renderAttributes`.

### L2. The `__proto__` dataset field key passes validation and then misbehaves
- **Where:**
  - `src/data/dataset-types.ts:33`: `FIELD_KEY_PATTERN` admits `__proto__`.
  - `src/data/validate-datasets.ts:95`: `row[key] = cell`.
  - `src/data/transform-pipeline.ts:251`: `selected[field] = …`.
- **Failing input:** `datasets.d.rows: [{"__proto__": null, "a": 1}]` sets the row's prototype to null instead of storing a field. A string value is silently dropped. The effect is per-object, not global pollution, because reads use `Object.hasOwn`. It is still silent data loss.
- **Fix:** reject `__proto__`, `constructor` and `prototype` in `FIELD_KEY_PATTERN` validation with a diagnostic. Alternatively build rows with `Object.create(null)` or `Object.defineProperty`.

### L3. `date-input` rejects ISO dates with years 0001–0099
- **Where:** `src/blocks/controls/date-input.ts:18`, `isIsoDate`, which uses `Date.UTC(y, m-1, d)`. That call maps years 0–99 to 1900–1999, so the round-trip check fails.
- **Failing input:** `value: "0050-01-01"` produces a validation error. This is an edge case. It is deterministic, but the result is wrong.
- **Fix:** validate the date by arithmetic (days-in-month and leap-year rule), or call `setUTCFullYear` after `Date.UTC`.

### L4. Diagram adapter markup fit misses non-`href`/`src` URL-bearing attributes (defense in depth)
- **Where:** `src/diagram/adapter-markup-fit.ts:63–67`. `isUrlAttribute` covers only `href`, `*:href`, `src` and `srcset`.
- **Verified:** `fitAdapterMarkup` returns `ok: true` for both inputs below. By comparison, `<image href="https://…">` is correctly refused.
  - `<svg><image href="#a"><set attributeName="href" to="https://evil.example/x.png"/></image></svg>`
  - `<video poster="https://evil.example/p.png"></video>`
- **Impact:** these are currently blocked at load time by the page CSP. `default-src 'none'` covers media, and `img-src` lists only `data: file: 'self'` plus the origins the policy allows. So the sanitizer is no longer an independent layer, and any future CSP relaxation would turn this into a network bypass. The adapter output is tool-generated, not raw spec input, which lowers exposure further.
- **Fix:**
  - Add `poster`, `background`, `action`, `formaction`, `xlink:href` and `ping` to `isUrlAttribute`.
  - Refuse SMIL `<set>`, `<animate>` and `<animatetransform>` whose `attributeName` is `href` or `xlink:href`, or refuse the SMIL elements entirely.

### L5. Minor
- `src/data/format-value.ts`: `groupedNumber` prints exponent notation (`1e+21`) for values of 1e21 and above, unlike the grouped style. Cosmetic.
- Cloud share responses use `cache-control: public, max-age=60`, so a revoked share can be served from cache for up to 60 seconds. Acceptable if documented.

## Edge Cases Found by Scout (verified non-issues)
- **`</script>` in state and in `data-ak-row` JSON:** `serializeJsonForScript` and the attribute escaping hold. The fuzzer was clean.
- **State path prototype access:** blocked by `STATE_PATH_PATTERN`, which is lowercase-only, and by `readOwnPath` with `hasOwn`.
- **`maxBlocks` across nested slots:** `bounds.ts` counts only arrays keyed `blocks`, so rail, sidebar and aside slots are not counted there. The fallback in `normalize.ts:874` on `context.nodes.length` does fire, which I verified. A cleanup would be nice but is not required.
- **Calendar:** integer epoch-day math, timezone-free.
- **Avatar, logo, poster and annotated-image props:** all carry the `asset: 'images'` flag and go through `resolveMedia`. Remote URLs under deny produce a diagnostic.
- **Print:** the data-table print CSS forces `data-ak-dt-miss` rows visible, and the filter-bar `beforeprint` unhides rows. Tabs and carousel show every panel in print.
- **Catalog search:** bounded input with no backtracking-prone regex.

## Recommended Actions
1. Fix H1 with the `tr[hidden]{display:none}` rule, and add a 375px Playwright regression test for both filter-bar and the core filter.
2. Fix M1 by not rounding before formatting and by deriving tick precision from the step. Then regenerate the snapshots.
3. Guard the degenerate histogram edges in M2.
4. Make the outline respect `when` (M3).
5. Harden L1, L2 and L4. L3 and L5 are optional.

## Metrics
- Type coverage: strict TS. No `any` widening found in scope.
- Test coverage: not measured in this review.
- Lint issues: not run. This was a review-only pass, and the gates are the implementer's job per REVIEW.md.

## Unresolved Questions
- Should `visibleWhen`-hidden content be reachable in print or without JS? It is currently hidden in both, because the rendered page is described as the "initial view". That arguably conflicts with "every page reads fully without JS / in print". This is a product decision for the author.
- Are the adapter tools (L4) considered trusted? If a spec can influence adapter source in a way that yields arbitrary SVG, L4 should move up to Medium.
