# @agentkit/render

Declarative page compiler for AgentKit: a constrained JSON/YAML **Page Spec**
in, a deterministic, self-contained, interactive **standalone HTML** out.

Agents describe meaning and composition. The compiler owns HTML, CSS,
interaction, accessibility, responsive layout, theming, asset bundling, security
policy, and byte-for-byte determinism.

```bash
npx @agentkit/render page.yaml --out page.html
```

The emitted file opens directly from disk (`file://`) and makes zero network
requests by default. The local compiler is canonical: no account, no network, no
server.

> **Status:** pre-1.0, in active construction. This repository is being built in
> milestones. The package skeleton, ADR, CI, and fixture corpus exist; the
> schema, compiler, themes, runtime, catalog, and cloud service land in the
> milestones described in [docs/adr/0001-page-spec-compiler-boundary.md](./docs/adr/0001-page-spec-compiler-boundary.md)
> and the [changelog](./CHANGELOG.md). Nothing below is advertised as available
> before it exists.

## Why

AgentKit's HTML-producing skills each carried the presentation layer in model
context: layout, CSS, JavaScript, charts, responsive rules, theming, and
verification. That costs tokens, adds latency, invites retries after
HTML/CSS/JS mistakes, and lets skills drift against each other.

`ak:diagram` already proved the alternative for diagrams: typed IR, deterministic
compiler, trusted fragment boundary. AK Render applies the same pattern to whole
pages.

## Design in one screen

```text
Page Spec (JSON/YAML, authored by a model)
   |  parse -> validate -> normalize
   v
internal IR (flat nodes, stable content-derived IDs)
   |  resolve registry -> resolve theme -> render
   v
single self-contained HTML document
   |  collect used assets/runtime features -> assemble -> verify
   v
deterministic artifact (opens from file://, zero network by default)
```

Six decisions define the boundary, argued in
[ADR 0001](./docs/adr/0001-page-spec-compiler-boundary.md):

1. **Page Spec is authoring; the IR is compiler-internal.** The nested,
   model-friendly spec normalizes into a flat node graph with stable IDs for
   rendering, future diff/patch/editor tooling, and MCP surfaces.
2. **Catalog and registry are separate.** `catalog()` is compact and cheap;
   `describe(type)` carries the full contract. Discovery stays out of the token
   budget until a block is actually selected.
3. **The interaction runtime is trusted and declarative.** A closed action
   vocabulary, one small event-delegation script, native HTML controls first,
   and only the feature modules a page uses.
4. **Themes are typed data, never CSS.** Built-in presets plus user presets that
   `extends` them. No CSS escape hatch, no CDN fonts.
5. **Local is canonical; cloud is opt-in.** The hosted renderer reuses the same
   compiler and is never the source of truth.
6. **Optional capabilities arrive as adapters.** Diagrams delegate to the
   existing `ak:diagram` compiler where installed; the public package never
   copies paid or Engineer-only implementation.

## Install

```bash
pnpm add @agentkit/render
# or run without installing
npx @agentkit/render --help
```

Requires Node.js >= 20.11.

## Library API

```ts
import {
  render,
  validate,
  normalize,
  catalog,
  describe,
  loadTheme,
} from '@agentkit/render';
```

| Export | Purpose | Status |
| --- | --- | --- |
| `VERSION` | Package version, matching `package.json` | Available |
| `RenderError`, `isRenderError` | Stable error codes with JSON path and node ID | Available |
| `render(spec, options)` | Compile a spec to a standalone HTML artifact | Available |
| `validate(spec)` | Report spec diagnostics without rendering | Available |
| `normalize(spec)` | Produce the flat internal IR | Available |
| `catalog()` | Compact list of available blocks and actions | Available |
| `describe(type)` | Full machine-readable contract for one entry | Available |
| `loadTheme(input)` | Validate and resolve a theme preset | Available |
| `buildThemeCatalog(options)` | Discover built-in, user, project, and explicit presets | Available |

## CLI

```bash
ak-render page.yaml --out page.html
ak-render validate page.json
ak-render catalog
ak-render describe carousel
ak-render themes

ak-render --help
ak-render --version
```

The CLI only advertises commands it can actually run; the compiler subcommands
are registered by the milestones that implement them.

## Fixtures and snapshots

`fixtures/pages/` holds the representative corpus the compiler is built
against: plan, explain, recap, diff, dashboard, media, interactive, and theme
showcase pages. `fixtures/snapshots/` holds one committed artifact per built-in
preset. See [fixtures/README.md](./fixtures/README.md) and
[docs/themes.md](./docs/themes.md). Fixtures are the specification: a new
capability is not done until a fixture exercises it.

## Repository layout

| Path | Contents |
| --- | --- |
| `src/` | Library and CLI source |
| `tests/unit/` | Vitest unit and contract tests |
| `tests/browser/` | Playwright browser tests, including the zero-network audit |
| `fixtures/` | Representative Page Spec corpus and committed cross-preset snapshots |
| `benchmarks/` | Reproducible measurement harnesses |
| `docs/adr/` | Architecture decision records |
| `docs/artifacts/` | Captured measurements and evidence |
| `apps/cloud/` | Opt-in Cloudflare renderer (cloud milestone) |

## Development

```bash
pnpm install
pnpm verify          # lint + typecheck + unit tests + build
pnpm test:browser    # Playwright, after: pnpm exec playwright install chromium
pnpm test:package    # pack, install into a temp project, exercise API and bin
pnpm bench:baseline  # re-run the legacy presentation-context measurement
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the determinism, trust, and testing
rules that changes are reviewed against, and
[docs/release-policy.md](./docs/release-policy.md) for versioning.

## Security

Spec input is untrusted. Report vulnerabilities privately through GitHub's
security advisory flow; see [SECURITY.md](./SECURITY.md) for the threat model and
the invariants the compiler must hold.

## License

MIT — see [LICENSE](./LICENSE).
