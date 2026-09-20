# Themes

A theme in AK Render is **typed data, never CSS**. A preset names a set of
declared tokens and their values; the compiler turns the resolved token set into
CSS custom properties. There is deliberately no field that accepts a selector, a
declaration, a stylesheet, or a font URL, so a shared team preset is exactly as
constrained as a built-in one.

## Built-in presets

| Preset | Voice |
| --- | --- |
| `blueprint` | Technical drawing: cool slate surfaces, precise borders, monospace labels. |
| `editorial` | Serif headlines, generous whitespace, deep navy with gold accents. |
| `paper-ink` | Warm cream paper with terracotta and sage. |
| `terminal-mono` | Near-black terminal with green and amber, monospace throughout. |
| `swiss-clean` | Neutral high-contrast grid: one red accent, no decoration. |
| `warm-signal` | Warm neutral surfaces signalling with amber and emerald. |

Each preset declares a **light and a dark** token set, so the emitted artifact
supports both schemes and the built-in theme toggle. The legacy curated palettes
from the AgentKit HTML references were carried over as token data; see
[ADR 0001](./adr/0001-page-spec-compiler-boundary.md).

## Token catalogue

Tokens are grouped, and every value is validated against its declared kind. A
hex colour, a length or duration, a font stack of names only, an enum, or a
bounded number — nothing else is accepted.

| Group | Tokens |
| --- | --- |
| Color | `color-background`, `color-surface`, `color-surface-raised`, `color-border`, `color-text`, `color-text-muted`, `color-accent`, `color-accent-contrast`, `color-info`, `color-success`, `color-warning`, `color-danger` |
| Typography | `font-heading`, `font-body`, `font-mono`, `font-size-base`, `font-scale`, `line-height`, `measure` |
| Spacing | `space-unit`, `density` (`compact` / `comfortable` / `spacious`) |
| Radius | `radius-small`, `radius-medium`, `radius-large` |
| Border and elevation | `border-width`, `elevation-card`, `elevation-popover` (`none` / `subtle` / `medium` / `strong`) |
| Motion | `motion-duration`, `motion-easing`, `motion-policy` (`full` / `reduced` / `none`) |

Elevation, easing, density, and motion policy are enums resolved to fixed
values, so a preset cannot supply an arbitrary shadow or transition. Lengths
accept `px`, `rem`, `em`, `ch`, `ex`, `%`, `vw`, `vh`, `ms`, and `s`. Colours are
hex.

`motion-policy: none` and the `prefers-reduced-motion` media query both zero the
transition duration in the emitted artifact.

## Defining a preset inline

```yaml
version: 1
meta:
  title: Team page
theme:
  preset: team-theme      # the name of the result
  extends: editorial      # the catalog preset it inherits from
  tokens:                 # light-scheme overrides
    color-accent: "#b8860b"
  dark:                   # optional dark-scheme overrides
    color-accent: "#e0b64a"
blocks:
  - type: hero
    title: Team page
```

`extends` selects the base; `preset` labels the result. A bare name
(`theme: { preset: blueprint }`) resolves straight through the catalog. Tokens
the chain never sets fall back to the default preset and produce a warning
rather than a silently incomplete artifact.

## Preset files

A preset file is the same data with a filename-derived or declared name:

```yaml
name: team-theme
extends: editorial
description: Team palette
tokens:
  color-accent: "#b8860b"
dark:
  color-accent: "#e0b64a"
```

Reusable presets are discovered from, in **increasing** precedence:

1. built-in presets;
2. `~/.ak-render/themes/` and `~/.config/ak-render/themes/` (user);
3. `<project>/.ak-render/themes/` (project);
4. files named explicitly (`--theme-file <file>`, or `files:` in
   `buildThemeCatalog`).

YAML, YML, and JSON files are accepted. A preset may extend another file preset,
and an extends cycle is reported as an error rather than recursing.

```bash
ak-render page.yaml --out page.html --theme team-theme
ak-render page.yaml --theme-file ./themes/team.yaml
ak-render page.yaml --no-theme-discovery      # built-ins only
ak-render themes                              # lists presets with their origin
```

A malformed preset file is reported as a warning and skipped; it does not make
unrelated pages uncompilable.

```ts
import { buildThemeCatalog, loadTheme, render } from '@agentkit/render';

const catalog = buildThemeCatalog({ cwd: process.cwd(), files: ['./themes/team.yaml'] });
const theme = loadTheme('team-theme', { catalog });
const html = render(spec, { theme: 'team-theme', themeCatalog: catalog });
```

## Fonts

**No fonts are bundled, and none are fetched.** Every preset uses a system font
stack that ends in a generic family, which is why the emitted artifact makes no
network request and why this project carries no font licence. A font stack is
validated as a list of names only: `url(...)`, `@import`, expressions, and
backslashes are rejected.

If bundled fonts are ever added, they must ship their licence and only the
glyphs actually used. Until then, the [SECURITY](../SECURITY.md) and offline
contracts hold with no font assets at all.

## Snapshots

One content spec is rendered under every built-in preset and committed:

```bash
pnpm snapshots:generate   # rewrite fixtures/snapshots/
pnpm snapshots:check      # fail when they are stale (CI)
```

Each snapshot's first line records the preset and the content hash, so a theme
change that alters emitted bytes shows up as a reviewable diff rather than only
as a failing hash assertion.

## Rejected input

| Input | Result |
| --- | --- |
| Unknown token name | `POLICY_VIOLATION` with the known token list |
| Unknown preset or extends target | `SPEC_VALIDATION_ERROR` with the known preset list |
| Extends cycle | `SPEC_VALIDATION_ERROR` naming the chain |
| `color-accent: url(...)` or a non-hex colour | `POLICY_VIOLATION` |
| `font-body: Inter; background: url(x)` | `POLICY_VIOLATION` |
| `space-unit: 8px; color: red` | `POLICY_VIOLATION` |
| `density: gigantic` | `POLICY_VIOLATION` |
| Unknown field in a preset file | `SPEC_VALIDATION_ERROR` listing allowed fields |
