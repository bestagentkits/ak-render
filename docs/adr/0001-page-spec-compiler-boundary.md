# ADR 0001 — Page Spec compiler boundary

- **Status:** Accepted
- **Date:** 2026-09-20
- **Scope:** `@bestagentkits/render` (this repository) and the AgentKit integration
  that consumes it.

## Context

AgentKit's HTML-producing skills each carry the knowledge needed to emit a
complete document: layout, CSS, JavaScript, charts, responsiveness,
accessibility, theming, and verification. The shared composition contract
converged on trusted typed fragments, but the *presentation implementation*
still lives in model context, which costs tokens, adds latency, and lets skills
drift apart.

`ak:diagram` already demonstrates the pattern that fixes this: a typed JSON IR,
deterministic validation, a compiler that owns geometry and rendering, and a
trusted fragment boundary at the output. AK Render generalizes that pattern from
diagrams to full pages.

Sources reviewed before writing this record (all in `bestagentkits/agentkit`):

| Source | What this decision takes from it |
| --- | --- |
| `kits/core/skills/ak-preview/references/html-skill-composition.md` | The activation sequence, responsibility boundaries, fragment trust boundary, and the fallback matrix that currently have the invoking skill own the document shell. |
| `kits/core/skills/ak-preview/references/html-mode-workflow.md` | The per-mode reference-loading table and the output/location/theme-toggle requirements an emitted artifact must satisfy. |
| `kits/core/skills/ak-preview/references/html-design-guidelines.md` | The six curated style presets (Blueprint, Editorial, Paper/Ink, Terminal Mono, and the anti-slop rules) that become compiler-owned theme presets. |
| `kits/core/skills/ak-preview/references/html-css-patterns.md` | The concrete token structure (surfaces, borders, semantic colors, theme toggle, responsive containment) a preset must be able to express. |
| `kits/core/skills/ak-preview/references/html-libraries.md` | Which external libraries and CDN loads the offline contract has to replace, and what the charts/media surface has to cover. |
| `kits/engineer/skills/ak-page-builder/references/block-contract.md` | The registry contract fields (stable type/version, props schema, slots, sizing, actions, migration) and the "store data, not executable code" rule. |
| `kits/engineer/skills/ak-page-builder/references/widget-sizing.md` | Size as a semantic presentation contract, deterministic presentation resolution, and the ban on duplicated DOM IDs or hidden focus targets across variants. |
| `kits/engineer/skills/ak-page-builder/references/agent-interfaces.md` | Compact capability discovery first, detailed schemas on demand, stable tool names, and untrusted-content assumptions. |
| `kits/engineer/skills/ak-diagram/references/typed-ir.md` | The typed-IR envelope, archetype modeling, and the rule that authors never supply coordinates. |
| `kits/engineer/skills/ak-diagram/scripts/compiler/compile.mjs` | Deterministic instance IDs derived from content hashes, safe JSON-in-script serialization, option validation with explicit error messages, and tree-shaken asset loading. |

Observed drift this decision must resolve: `html-skill-composition.md` requires
100% offline artifacts with no CDNs, while `html-libraries.md` still hands models
copy-paste snippets that load Mermaid, Chart.js, and anime.js from
`cdn.jsdelivr.net` and Google Fonts (for example lines 14, 23, 39, 428, 488,
548–550 of that file). Both documents are loaded for the same `--html` task.
That contradiction is a symptom of presentation knowledge living in prose.

## Decision

### 1. Page Spec is an authoring format; the internal IR is a compiler format

Authors (and models) write a **Page Spec**: nested, semantic, tolerant of
omission, with defaults, and stable across schema versions. It carries
`version`, `meta`, `theme`, `policy`, an optional initial `state`, and
`blocks`.

The compiler normalizes that into an **internal IR**: a flat node list where
every node has a stable, content-derived ID, a resolved block type and version,
validated props, explicit slot edges, and resolved presentation. Everything
downstream — rendering, diffing, patching, a future editor, MCP tooling —
operates on the IR.

Consequences:

- The nested author-facing shape can be optimized for model token cost and
  ergonomics without destabilizing the compiler.
- Stable node IDs make future diff/patch/editor work possible without changing
  the emission pipeline. IDs derive from spec content, never from a counter or
  clock, which keeps output deterministic.
- The IR is not a second public schema. It is versioned with the compiler and
  changes without a spec migration; the Page Spec is the compatibility
  boundary.

### 2. Catalog and registry are separate surfaces

The **registry** is the compiler-side implementation of blocks, widgets, and
actions. The **catalog** is the machine-readable discovery surface over it:
compact `catalog()` for names and one-line purposes, `describe(type)` for the
full contract (props schema, defaults, bounds, slots and child constraints,
responsive sizing behavior, accessibility contract, supported actions, asset and
runtime features, network capability, migration policy, serializer behavior).

This split follows `block-contract.md` and `agent-interfaces.md`: discovery must
be cheap enough to put in a prompt, and detail must be paid for only for the
blocks actually selected. A registry item without a contract in the catalog is
incomplete, not merely undocumented.

### 3. The interaction runtime is trusted, declarative, and tree-shaken

Page Spec declares intent via a closed action vocabulary (`copy`, `open-url`,
`toggle`, `set-value`, `next`/`previous`, `select-tab`, `expand`/`collapse`,
`filter`, `theme`, `download`). It cannot express an expression, a selector
language, or a handler body.

The runtime is one small event-delegation script that reads action data
attributes, owns focus management, keyboard behavior, pointer and touch
handling, ARIA state updates, and reduced-motion policy. Native HTML behavior
(`<details>`, `<button>`, `<input type=range>`, `<dialog>`) is preferred, and
JavaScript exists only where the platform cannot do the job.

Only the feature modules a page actually uses are emitted. A page without a
carousel does not ship carousel code, which also keeps the emitted artifact
small enough to open from `file://` with no ceremony.

This is why emitted pages must not use a browser framework: a framework brings
its own runtime, its own escaping rules, and its own version drift into the
trust boundary. The compiler owns that boundary instead.

### 4. Themes are typed data, never CSS

A preset is structured data: `name`, `extends`, semantic color tokens,
typography tokens, spacing/density, radius, border/elevation, and motion policy.
Built-ins (`blueprint`, `editorial`, `paper-ink`, `terminal-mono`,
`swiss-clean`, `warm-signal`) are versioned data in the compiler, and the
built-in set is derived from the curated presets in `html-design-guidelines.md`
so existing visual language survives the migration.

User presets extend a built-in and override tokens. Unknown fields, unknown
token names, and values that are not literal token values are rejected. There is
no CSS escape hatch: if a page can inject CSS, it can exfiltrate data with a
selector-based side channel and break every determinism guarantee at once.

Fonts are not fetched. If a preset specifies a font the compiler cannot render
without a network request, the compiler falls back to a bundled or system stack
rather than emitting a remote `@import`; bundled fonts must carry their license
and ship only the glyphs actually used.

### 5. Local is canonical; cloud is opt-in and non-authoritative

The compiler runs locally with no account and no network. Emitted output is
self-contained and opens over `file://`.

The hosted path in `apps/cloud` reuses the same `@bestagentkits/render` code and the
same options. It exists for convenience (preview, share, screenshot, PDF), never
as the semantic source of truth. Concretely:

- Local compilation never contacts the network, and cloud mode is an explicit
  request, not a fallback.
- A render request is transient: it is not persisted unless the caller asks for
  a share or export artifact.
- Render permission and public-share permission are separate. An authenticated
  render does not publish anything.
- Share artifacts are unguessable, expiring, revocable, and stored in private
  object storage with explicit retention.
- Browser Run (headless browser) is used only for screenshot, PDF, and visual
  verification — never for primary compilation.
- Content telemetry is off by default.

Authentication reuses AgentKit's existing model: an API key establishes a
session, and cloud requests carry the derived session/access token. The worker
validates that token through the canonical AgentKit entitlements endpoint
instead of copying signing secrets or database auth logic into this public
repository. A locally-verifying fast path is a separate, reviewed change if
latency ever requires it.

### 6. Optional capability integration is an adapter, not a copy

AK Render defines adapter interfaces for capabilities it does not own. The
first is diagrams: in an AgentKit Engineer installation the adapter calls the
existing `ak:diagram` typed compiler and embeds only trusted compiler output
(SVG or fragment). Where that compiler is absent (Core, Marketing), the adapter
returns a semantic fallback rendered by AK Render itself.

Paid or Engineer-only implementations are never copied into this public package,
and the public package never requires them. The same rule applies to future
capabilities: an adapter declares a capability, the host provides an
implementation or the compiler degrades in a documented, visible way.

## Consequences

- Skills stop carrying presentation knowledge. `html-skill-composition.md`
  becomes a thin delegation contract: emit a Page Spec, invoke the pinned
  compiler, verify the artifact. The CDN snippets in `html-libraries.md` must be
  removed or quarantined, because they contradict the offline contract and are
  now unimplementable by design.
- Token and latency cost for presentation guidance should fall sharply and the
  measurement is captured in `docs/artifacts/`, with the target gates recorded
  in the epic treated as targets, not as results.
- The compiler becomes the single place where a security fix or an
  accessibility fix lands, which is the main long-term maintenance win.
- Determinism constrains the compiler: no timestamps, no random IDs, no
  unordered iteration, no locale-dependent sorting in emitted bytes. Any future
  feature that cannot respect this is out of scope for the compiler.
- A page can express less than raw HTML can. That is the point, and additions
  must justify themselves against the trust and determinism budget.

## Rejected alternatives

- **Compile Markdown or a DSL to HTML in each skill.** Keeps presentation
  knowledge in model context and leaves determinism per-run.
- **Emit a framework app (React/Vue/Svelte).** Adds a runtime, a build step,
  and a hydration model to an artifact whose whole value is being a single
  offline file.
- **Allow a `css` or `html` escape hatch on blocks.** Destroys the trust
  boundary, determinism, and the theme model simultaneously.
- **Make cloud the primary path.** Breaks the offline/no-account requirement
  and turns an installed tool into a service dependency.
- **Vendor the paid diagram compiler into the public package.** Creates a
  licensing problem and duplicates a maintained implementation.
