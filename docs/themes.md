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
| `data-console` | Dense operations console: slate surfaces, a cyan accent, ledger tables and quiet charts. |
| `executive-report` | White and ink with a navy accent, headline metrics, outlined cards. |
| `product-studio` | Soft neutral surfaces, a violet accent, framed media and raised cards. |
| `research-notebook` | Paper with an oxblood accent, serif reading type, ledger tables and outlined notes. |
| `crimson-press` | Cream paper, black ink and a crimson accent, serif display, square ledger rules. |

Each preset declares a **light and a dark** token set, so the emitted artifact
supports both schemes and the built-in theme toggle. The legacy curated palettes
from the AgentKit HTML references were carried over as token data; see
[ADR 0001](./adr/0001-page-spec-compiler-boundary.md).

Every built-in meets WCAG 2.2 contrast in both schemes: body text at 7:1 or
more on the background, surface and raised surface, and muted text, the accent,
the four tones and text on the accent at 4.5:1 or more
(`tests/unit/theme-contrast.test.ts`).

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

## Recipes

Tokens change colour, type and spacing. **Recipes** change how a component is
drawn: a preset or a spec picks one value per surface from a closed list, and
the compiler owns the CSS behind each value. A recipe is never CSS.

| Surface | Values (first is the default) | What a non-default value does |
| --- | --- | --- |
| `cards` | `raised`, `flat`, `outlined` | `flat`: a tonal fill with no border or shadow. `outlined`: a firm hairline, no shadow. |
| `sections` | `ruled`, `divided`, `plain` | `divided`: a heavier full-width rule and a larger break. `plain`: no rule and no accent tab. |
| `tables` | `default`, `ledger`, `minimal` | `ledger`: zebra rows, lining tabular figures, a strong header rule. `minimal`: no frame, a quiet header, compact rows. |
| `charts` | `default`, `minimal` | Gridlines drop away except the baseline; axis labels lose weight but keep their contrast. |
| `hero` | `default`, `compact` | Left-aligned, tighter, one step down the display scale. |
| `metrics` | `default`, `headline` | Stats and KPI values grow, with the label above the value. |
| `media` | `default`, `framed` | Images sit in an inset frame with the caption inside it. |
| `callouts` | `tinted`, `outlined` | A tone outline on the page instead of a tinted fill; the glyph stays. |

Density is not a recipe: it stays the `density` token.

```yaml
theme:
  preset: data-console
  recipes:
    cards: raised        # override one surface; the rest come from the preset
```

Resolution, from lowest to highest: the defaults, then the `extends` chain from
its root, then the preset, then the spec's `theme.recipes`. A theme passed with
`--theme` (or the `theme` render option) replaces the spec's theme, recipes
included. Only non-default choices reach the page, as `data-r-<surface>`
attributes on `<html>` plus their sheets, and a sheet for a feature block (a
chart, a KPI, a data table) is emitted only when the page uses it. A page that
keeps every default renders the same bytes as one without recipes.

| Preset | Recipes |
| --- | --- |
| `data-console` | `hero: compact`, `tables: ledger`, `charts: minimal`, `cards: flat`, `sections: divided` (and `density: compact`) |
| `executive-report` | `metrics: headline`, `charts: minimal`, `sections: divided`, `cards: outlined` |
| `product-studio` | `media: framed`, `cards: raised` |
| `research-notebook` | `callouts: outlined`, `tables: ledger`, `hero: compact`, `cards: flat` |
| `crimson-press` | `cards: flat`, `tables: ledger`, `metrics: headline`, `callouts: outlined` (and square corners, no card shadow) |

An unknown surface or value is a `SPEC_VALIDATION_ERROR` whose
`details.allowed` lists the valid choices.

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
recipes:
  tables: ledger
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
import { buildThemeCatalog, loadTheme, render } from '@bestagentkits/render';

const catalog = buildThemeCatalog({ cwd: process.cwd(), files: ['./themes/team.yaml'] });
const theme = loadTheme('team-theme', { catalog });
const html = render(spec, { theme: 'team-theme', themeCatalog: catalog });
```

## Fonts

**Fonts are embedded, never fetched.** Each preset leads its display stack with
one bundled variable face under the SIL Open Font License 1.1, then falls back
to a system stack that ends in a generic family:

| Preset | Bundled face | Used for |
| --- | --- | --- |
| `blueprint` | `AK Geist` | headings and body |
| `editorial` | `AK Fraunces` | headings (body stays the system serif) |
| `paper-ink` | `AK Bricolage Grotesque` | headings |
| `swiss-clean` | `AK Inter Tight` | headings and body |
| `terminal-mono` | `AK JetBrains Mono` | headings, body, and code |
| `warm-signal` | `AK Plus Jakarta Sans` | headings and body |
| `data-console` | `AK Geist`, `AK JetBrains Mono` | headings and body; labels and code |
| `executive-report` | `AK Inter Tight` | headings and body |
| `product-studio` | `AK Plus Jakarta Sans` | headings and body |
| `research-notebook` | `AK Fraunces` | headings (body stays the system serif) |
| `crimson-press` | `AK Fraunces`, `AK Inter Tight`, `AK JetBrains Mono` | headings; body; labels and code |

The compiler inlines a face as a `data:` WOFF2 only when a resolved font stack
names it (`src/render/font-faces.ts`). The Latin subset is always emitted; the
Vietnamese subset is added only when the page text needs it. The CSP opens
`font-src data:` on those pages and keeps `font-src 'none'` everywhere else, and
verification rejects any `@font-face` source that is not inlined.

A custom stack that names no `AK ` family embeds nothing. A font stack is still
validated as a list of names only: `url(...)`, `@import`, expressions, and
backslashes are rejected. A non-colour token set under `tokens` (a font, a
spacing, a motion value) applies to both schemes; only colours differ between
light and dark.

The faces ship unmodified from their Fontsource packages in `assets/fonts/`,
each beside its `OFL.txt`, which the npm package includes. Every emitted
`@font-face` carries a comment naming the font, its copyright, and the licence.
After changing a file there, run `pnpm fonts:generate`; `pnpm fonts:check`
fails when the generated module is stale.

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
| `recipes: { tables: spreadsheet }` or an unknown surface | `SPEC_VALIDATION_ERROR` with `details.allowed` |
