# WP10 — Catalog scalability: categories, search, describe-many, compact describe

Catalog section of the issue. Depends on W0. Branch `gh10/wp10-catalog`. Estimate 4h.

## Goal

The roster grows from 54 to about 83 blocks without making discovery expensive for agents. An agent can list one
category, search by intent, and describe several blocks at once in compact form.

## Context (verified)

- `src/registry/registry.ts`: `catalog()` at `:43`, `describe()` at `:61`.
- Measured today (54 blocks): catalog text 5,164 B, catalog JSON 10,439 B. Describe JSON: tabs 1,756, chart
  2,064, kpi 2,426, bento 2,295, table 1,360.
- `src/cli.ts:174-298` `COMMANDS` (compile, validate, catalog, describe, mcp, themes). Help is generated from the
  table (`:302`).
- `src/mcp-server.ts:93-187` `TOOLS` (catalog, describe, validate, render, themes).
- `tests/unit/cli-stdin-and-mcp.test.ts:113` asserts the exact `tools/list` names.
- `tests/unit/registry-catalog.test.ts` and `tests/unit/cli.test.ts` cover catalog and describe output.
- W0 adds `category`, `tags` and `useCases` to every `BlockDefinition`, and `BLOCK_CATEGORIES`.

## Files

| Ownership | File |
| --- | --- |
| exclusive (wave 1) | `src/registry/registry.ts` (catalog, describe, search functions only; the JSON-schema builder stays as W0 left it), `src/cli.ts`, `src/mcp-server.ts`, `src/index.ts` |
| create | `src/registry/catalog-search.ts`, `tests/unit/catalog-search.test.ts`, `tests/unit/catalog-budget.test.ts` |
| exclusive (edit) | `tests/unit/registry-catalog.test.ts`, `tests/unit/cli.test.ts`, `tests/unit/cli-stdin-and-mcp.test.ts` |
| notes | `reports/wp10-notes.md` |

W2-A later edits `cli.ts`, `mcp-server.ts`, `index.ts` and the MCP tools test to add recipes. It does so
sequentially, after WP10 merges.

## Contracts

```ts
export interface CatalogEntry { type; summary; category: BlockCategory; tags: string[] }   // + existing fields
export function catalog(options?: { category?: BlockCategory }): Catalog;
// text form (CLI default): grouped by category in BLOCK_CATEGORIES order, "## data" header, one line per block
// "data-table — Sortable typed table bound to a dataset" ; unknown category → diagnostic with allowed list.
export interface CatalogSearchHit { type: string; category: BlockCategory; summary: string; score: number }
export function searchCatalog(query: string, limit = 8): CatalogSearchHit[];
// tokens = lowercase ASCII words of query (≤8 tokens, ≤200 chars). Score per token:
// exact type 3 (or type segment, e.g. "table" in data-table, 2), tag 2, useCase word 2, category 2, summary word 1.
// Sort score desc, then type asc (code-unit). Zero-score entries dropped. Deterministic.
export function describeMany(types: string[], options?: { compact?: boolean }): BlockDescription[];  // ≤12 types
// compact: props as "name: kind[, required][, enum a|b|c]" one-liners, slots, data contract, events;
// omits long descriptions and examples. Unknown type → error listing closest 3 types by searchCatalog.
```

CLI:

- `ak-render catalog [--category <c>] [--json]`
- `ak-render search-catalog <terms…> [--json]`
- `ak-render describe <type…> [--compact] [--json]`

A single type keeps today's output byte-identical unless `--compact` is given.

MCP:

- `catalog{category?}`
- the new tool `search-catalog{query}`
- `describe{type?|types?, compact?}` (exactly one of type and types)

Each MCP tool description is ≤ 200 characters. Library exports: `searchCatalog`, `describeMany`,
`BLOCK_CATEGORIES`.

## Steps

1. Write `catalog-search.ts`. Extend `catalog` and `describe`.
2. Wire the CLI and MCP. Update the help and the tool tests.
3. Write the budget test, which runs over the **full** registry at test time, so it guards every WP after its
   merge:
   - catalog text ≤ 9,000 B;
   - catalog JSON ≤ 20,000 B;
   - every `--category` listing ≤ 3,000 B;
   - compact describe ≤ 1,500 B per block;
   - every summary ≤ 110 characters;
   - tags ≤ 6;
   - useCases ≤ 4.
4. Write a searchCatalog golden test. The queries "sortable table", "pricing", "logs", "kanban board" and
   "compare benchmark" must rank the expected type first. Expected types that don't exist yet (other WPs) are
   asserted only when registered (`if (has(type))`). The controller tightens this in wave 2.

## Tests

- Category filter.
- An unknown category diagnostic.
- Search ranking and tiebreak.
- describeMany order follows the input order, and duplicates are de-duplicated.
- Compact describe size.
- The CLI `--help` lists the new commands.
- The MCP `tools/list` includes `search-catalog`.
- Single-type describe output is unchanged (snapshot of today's `describe tabs --json`).

## Acceptance

- [ ] The budget test passes on the merged roster of all WPs (the controller re-runs it after each merge).
- [ ] An agent can find a block for "filter rows by status" in one call (`search-catalog` returns `filter-bar`
  in the top 3 after WP8 merges).

## Risks

| Risk | Mitigation |
| --- | --- |
| Other WPs' summaries blow the budget | The budget test fails at merge time. The controller asks the owning WP to trim, or trims the summary in its module file |
| CLI output change breaks agent scripts | Single-type describe and full catalog JSON keep their existing fields; only new fields are added |

Rollback: revert and regenerate. No other WP depends on these functions at build time. W2-C docs reference them.
