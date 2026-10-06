# Catalog scalability notes

Branch `gh10/wp10-catalog`. These notes cover categories, search, describe-many and compact describe.

## Changelog lines

- feat(registry): `catalog()` entries carry `category` and `tags`. `catalog({ category })` lists one category; an unknown category fails with `SPEC_VALIDATION_ERROR` at path `category` and lists the allowed names.
- feat(registry): `searchCatalog(query, limit = 8)` ranks block types by intent words. Weights per word: exact type 3 (or a type segment 2), tag 2, use-case word 2, category 2, summary word 1. Ties sort by type. The result is deterministic.
- feat(registry): `describeMany(types, { compact })` returns up to 12 contracts in input order, with duplicates dropped. The compact form has one line per prop (`name: kind[, required][, enum a|b]`), plus slots, parents, the data contract and actions. An unknown type error suggests up to 3 types from `searchCatalog`.
- feat(cli): `ak-render catalog [--category <c>]` prints one section per category. `ak-render search-catalog <terms...>` and `ak-render describe <type...> [--compact]` are new.
- feat(mcp): `catalog{category?}`, the new `search-catalog{query}` tool, and `describe{type | types, compact?}`. Both the stdio server and the remote HTTP server serve them. On the remote server, `search-catalog` is anonymous like `catalog`, `describe` and `themes`.
- feat: the library exports `searchCatalog`, `describeMany`, `CatalogSearchHit`, `CompactBlockDescription`, `BlockDescription`, `DescribeManyOptions` and `CatalogOptions`. `BLOCK_CATEGORIES` was already exported in wave 0.

## Output contract changes

- **Kept byte-identical:**
  - single-type `describe <type>`, as text and with `--json`;
  - MCP `describe{type}`, and `describe{type, compact: false}`.

  The tool tests assert this. Across all 54 types, the before and after outputs were compared byte for byte, including the unknown-type and missing-argument errors.
- **Catalog JSON** (`catalog --json` and MCP `catalog`): the fields are additive (`category` and `tags` are appended to each entry), and the top-level `category` appears only when the listing is filtered. The **formatting changed**: there is now one block and one action per line, where before every field was indented. With the new fields, the fully indented form would be 15,595 B today and about 25,700 B at 83 blocks, which breaks the 20,000 B budget. Any JSON parser reads the same value.
- **Catalog text** (`catalog`): grouped by category with a `## <category>` header. Each line is `type — summary`, and the `kind` column is gone. The header line and the `Actions:` line stay.
- **MCP `describe` input schema:** `required: ['type']` was dropped, and `types` and `compact` were added. Exactly one of `type` and `types` is enforced at call time. With neither, the error is still `"type" must be a non-empty string`.
- **Description changes:** the descriptions of the `catalog` and `describe` tools changed, and every local tool description is at most 200 characters (a test checks this). The CLI help aligns its summary column to the longest command name.
- **Reply shape follows the call:** `type` returns one object, and `types` returns a list. On the CLI, one type returns an object and several types return a list.
- **Search stop words:** the query drops a few filler words (a, an, and, by, for, in, of, on, or, the, to, with), so that words such as "by" do not create ties. Plurals match singulars (`logs` matches `log`, `tables` matches `table`).

## Budgets (measured on 54 blocks; projected to 83)

| Surface | Budget | Now | Projected at 83 |
| --- | --- | --- | --- |
| `catalog` text | 9,000 | 4,360 | ~6,700 |
| `catalog --json` | 20,000 | 11,017 | ~16,900 at the current average; 18,081 if all 29 new blocks have 5 tags and 80-character summaries |
| `catalog --category` text (largest: content) | 3,000 | 1,094 | data ≈ 1,300 with about 6 more blocks |
| compact describe per block (largest: before-after) | 1,500 | 565 | a v2 chart or a data-table with format fields is estimated at under 1,200 |
| summary length | 110 | 3 over (see below) | — |
| tags / useCases | 6 / 4 | enforced at registration as well | — |

`tests/unit/catalog-budget.test.ts` measures the live registry, so every package is checked when it merges. It also asserts that the current per-block average, projected to 83 blocks, fits the text and JSON budgets. That catches a roster whose blocks cost too much on average before the absolute ceiling is reached.

The category listing in JSON form is not budgeted, because the spec budgets the CLI listing, which is text. It includes the shared `actions` list, about 950 B. Today the largest is content at 3,655 B. Only the text form is held to 3,000 B.

## Needs the controller: summaries over 110 characters (frozen `roster.ts`)

The test lists `terminal` (126), `video` (121) and `audio` (123) in `SUMMARIES_AWAITING_TRIM`. Each entry must stay over the cap: once a summary is trimmed, its entry must be removed, so the list can only shrink. Suggested trims (they also change the generated schema descriptions):

- terminal: `Terminal: window-framed session that types in on load; commands, output and errors are styled apart.` (100)
- video: `Video: plays local sources; a provider or network source degrades to a poster plus link.` (88)
- audio: `Audio: plays local sources; a provider or network source degrades to metadata plus link.` (88)

## Deviations from the work package

- **The single-type describe check is an invariant, not a frozen snapshot.** The CLI `describe <type> --json` and MCP `describe{type}` must equal `JSON.stringify(describe(type), null, 2)`. A byte snapshot of today's `tabs` would break when the rich-composition package changes the tabs props, and it merges first. The original bytes were verified once, as described above.
- **The compact form includes `parents`.** It is included when a block restricts its parents, so that a compact-only author does not write an invalid nesting. The spec's "events" are the block's `actions` field, named as in the full contract.
- **`catalog({ category })` keeps the full `Catalog` shape,** including `actions`, so the library type does not change.
- **Search with no hits:** the CLI prints `no blocks match "<query>"` and exits 0. JSON returns `[]`.

## Docs to fold in during the docs wave (shared prose not edited here)

- README, `docs/agent-guide.md`, `skills/ak-render/SKILL.md`, `llms.txt`: describe the discovery loop as `catalog --category` or `search-catalog` → `describe <types...> --compact` → full `describe` for tricky blocks → `validate` → render.
- `apps/cloud/README.md` lists the remote MCP tools and the anonymous tools. Add `search-catalog` to both lists.
- `LOCAL_INSTRUCTIONS` and `REMOTE_INSTRUCTIONS` (MCP `initialize`) still say "call catalog once". They were not changed, to keep `initialize` byte-stable. Consider mentioning `search-catalog` and `compact` there.
- The remote `render` tool description is 215 characters, so it is over the 200-character guideline. The stdio tools are all within it.
