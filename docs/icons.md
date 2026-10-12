# Icons

Authors name an icon by meaning. The compiler owns which pack draws it, at what
size, and how it is embedded. There is no raw SVG, no icon font, no CDN and no
inline style: an icon is a same-document reference, so a page with icons still
makes no network request and keeps its strict Content-Security-Policy.

## Writing an icon

Every block that takes an `icon` accepts three forms:

```yaml
icon: gauge                               # a meaning; the theme picks the pack
icon: phosphor:rocket                     # an exact glyph, never swapped
icon: { name: gauge, size: lg, label: Speed }   # size and an accessible name
```

Blocks with an `icon` prop: `card`, `callout`, `alert`, `button`, and the items
of `stats`, `steps` and `timeline`. The `icon` block shows one glyph with a
visible caption.

- **Size** is `xs`, `sm`, `md`, `lg` or `xl`. Each block has a default that fits
  its layout; icons scale with the surrounding text (`em` based).
- **Accessibility.** An icon without a `label` is decorative
  (`aria-hidden="true"`). A `label` makes it a named image (`role="img"`).
  Meaning is never carried by the glyph alone: give a status icon a text label.
- **Colour** is `currentColor` throughout, so light, dark, print and
  forced-colors modes follow the text.

## Packs and licenses

| Pack | Role | License |
| --- | --- | --- |
| `lucide` | Default neutral outline set | ISC |
| `phosphor` | Regular, bold and fill weights | MIT |
| `tabler` | Wide technical coverage, brand marks | MIT |
| `pixelarticons` | Pixel-perfect glyphs (free MIT set only) | MIT |
| `codicons` | Compact technical glyphs | CC BY 4.0 (attribution required) |

Each pack is a curated, pinned subset imported at build time from the
`@iconify-json/*` dev dependencies by `pnpm icons:generate`. `pnpm icons:check`
fails when the generated data is stale, and a test runs every bundled glyph
through an element and attribute allowlist (fills and strokes are only `none`
or `currentColor`; no script, style, link, animation or `url()`).
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) carries the licenses and the
Codicons attribution, and ships in the npm package.

## Theme icon profiles

A theme chooses a pack and variant with `icons`. It is typed data, not a
stylesheet, and is inherited through `extends`.

| Profile | Pack and variant |
| --- | --- |
| `lucide` (default) | Lucide outline |
| `phosphor`, `phosphor-bold`, `phosphor-fill` | Phosphor regular, bold, fill |
| `tabler` | Tabler outline |
| `pixelarticons` | Pixelarticons |
| `codicons` | Codicons |

Built-in presets: `blueprint` uses `tabler`, `editorial` `lucide`, `paper-ink`,
`crimson-press` and `newspaper` `phosphor`, `terminal-mono` and `data-console` `codicons`.
Other presets use the default. There is no preset for pixel-art, neobrutalism,
newspaper, cowboy or hacker looks yet; `icons: pixelarticons` in an inline theme
gives the pixel set today.

```yaml
theme:
  preset: team-theme
  extends: editorial
  icons: phosphor-bold
```

## Precedence and fallback

1. An explicit `pack:name` or `{ pack, name }` always wins and is never swapped.
2. Otherwise the theme's `icons` profile decides the pack for a meaning.
3. If that pack has no glyph for the meaning, the compiler tries Lucide, Tabler,
   Phosphor, Codicons, then Pixelarticons, and reports a warning
   (`icon "x" is not in <pack>; drawn with <pack> instead`). It only ever picks
   the same meaning in another pack.
4. An unknown name is an error with close suggestions.

## Output

Each use is `<svg class="ak-icon"><use href="#aki-<pack>-<glyph>"/></svg>`. One
hidden sprite at the end of the page holds the glyphs the page used, once each
and in sorted order, so the same spec writes the same bytes and a repeated icon
costs one reference. A page with no icon carries no icon markup and no icon CSS.

## Discovery

Agents find names without reading a catalog:

```bash
ak-render icons search gauge --limit 5     # English or Vietnamese: "bieu do", "cai dat"
ak-render icons search arrow --pack tabler
ak-render icons describe gauge             # packs, variants, fallback order, license
ak-render icons packs                      # bundled packs, glyph counts, licenses
```

The same three operations are MCP tools, `search-icons`, `describe-icon` and
`icon-packs`, on both the local stdio server and the hosted one. Replies are
limited (8 hits by default, at most 20) and never contain SVG.
