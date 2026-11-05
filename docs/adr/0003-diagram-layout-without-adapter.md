# ADR 0003 — Where diagram layout runs when no adapter is installed

- **Status:** Accepted as the default; the owner may revisit option 3 below
- **Date:** 2026-11-05
- **Scope:** `diagram-panel`, `src/diagram/`, the hosted MCP renderer and the
  plain `ak-render` CLI. Issue
  [#123](https://github.com/bestagentkits/ak-render/issues/123), epic
  [#121](https://github.com/bestagentkits/ak-render/issues/121).

## Context

[ADR 0001](./0001-page-spec-compiler-boundary.md) says AK Render does not lay
out diagrams: a host registers a `DiagramAdapter` and AK Render embeds its
checked output. AgentKit's `ak:diagram` v3 is that host implementation. It
already ships the typed IR for architecture, workflow, sequence, dataflow and
lifecycle diagrams, layered ranking, orthogonal routing, geometry tests, four
visual presets and finite CSS motion.

Two surfaces never have an adapter: the hosted MCP renderer (a Cloudflare
Worker) and the plain CLI. Since #128 their structured fallback reads every
archetype, but they still draw no picture. Epic #121 then asks for an
interactive viewer, semantic motion and golden fixtures, and those need to know
where the geometry comes from.

The options in #123:

1. Keep the boundary and improve the fallback only.
2. Bundle the `ak:diagram` compiler as the hosted renderer's adapter.
3. Extract the layout engine into a shared package both repositories consume.

## Decision

**Option 1 is the default.** AK Render keeps no layout engine of its own.

- Geometry comes only from an adapter. Without one, `diagram-panel` emits the
  structured semantic fallback, as today.
- AK Render owns everything *around* the geometry: the adapter contract and its
  trust boundary, the semantic manifest that binds drawn elements to the spec's
  graph (#122), the viewer runtime (#124), diagram motion and its governor
  (#125), quality checks (#126) and export (#127). Each of these works on any
  adapter that returns a v2 manifest, so it is not tied to one layout engine.
- Tests, snapshots and visual fixtures use a small reference adapter that lives
  under `tests/` and is never exported from the package. It places nodes on a
  plain grid so the contract can be exercised end to end; it is not a layout
  engine and the gallery does not depend on it.

**Option 2 is rejected for the public package** (ADR 0001 already rejects
vendoring the paid compiler) and **deferred for the hosted Worker**: the
`ak:diagram` skill is licensed as proprietary, and shipping it inside a Worker
bundle is a distribution decision only the owner can make.

**Option 3 is the recommended next step if hosted pictures become a
requirement.** A shared, separately licensed layout package that the Worker
registers as an adapter keeps one engine, keeps AK Render free of layout code
and needs no change to the v2 contract defined here.

## Consequences

- No second layout engine appears in this repository; diagram quality work
  lands in `ak:diagram` and is consumed through the adapter.
- Hosted and CLI renders keep the text fallback until option 3 (or an owner
  decision on option 2) lands. That is visible, documented degradation, not a
  silent gap: the fallback caption says no adapter is configured.
- The viewer, motion and export features are inert on fallback-only pages. They
  never invent geometry or relationships the spec does not declare.
- `ak:diagram` integrates by returning a v2 result: it already emits
  `data-node-id` and `data-edge-id`, which the v2 manifest can reference
  directly, so the adapter change on the AgentKit side is small.

## Revisit when

- the owner decides the licensing of the `ak:diagram` compiler for the hosted
  Worker, or
- a shared layout package exists that both repositories can depend on.
