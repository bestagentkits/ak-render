# Third-party notices

AK Render bundles a curated subset of glyphs from the icon packs below. Each
glyph is imported at build time from a pinned `@iconify-json/*` package by
`scripts/generate-icons.mjs` (`pnpm icons:generate`); the compiler never reads
a pack, a CDN or the network at render time. A page embeds only the glyphs it
uses, as same-document SVG symbols.

`ak-render icons packs` prints the same metadata, and `ICON_PACKS` in
`src/icons/icon-packs.ts` is the machine-readable record.

| Pack | Source package | Version | License | Copyright |
| --- | --- | --- | --- | --- |
| Lucide | `@iconify-json/lucide` | 1.2.143 | ISC | Lucide Contributors |
| Phosphor | `@iconify-json/ph` | 1.2.2 | MIT | Phosphor Icons |
| Tabler Icons | `@iconify-json/tabler` | 1.2.42 | MIT | Paweł Kuna |
| Pixelarticons | `@iconify-json/pixelarticons` | 1.2.10 | MIT | Gerrit Halfmann |
| Codicons | `@iconify-json/codicon` | 1.2.74 | CC BY 4.0 | Microsoft Corporation |

## Three.js

Pages that use a 3D block (`scene-3d` and the other `*-3d` blocks) inline the
shared 3D runtime, which bundles [three.js](https://threejs.org) 0.170.0 (MIT,
� 2010-2024 three.js authors). `scripts/generate-three-runtime.mjs`
(`pnpm three:generate`) builds it from the pinned devDependency into
`src/blocks/three/three-runtime.generated.ts`; each emitted page keeps the
license line. A page without a 3D block ships none of it. License:
https://github.com/mrdoob/three.js/blob/dev/LICENSE

## Fonts for 3D text

The `text-3d` block draws glyph outlines from static instances of Bricolage
Grotesque (800) and Fraunces (700), SIL Open Font License 1.1, taken unmodified
from their Fontsource packages into `assets/fonts/<family>/outline-*.woff`. The
licence and copyright are in each family's `OFL.txt`. `pnpm fonts:generate`
converts them to outline data; the fonts are not sold on their own.

## Attribution

Codicons © Microsoft Corporation, licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The glyphs are
reduced to the subset used by the compiler and normalised to `currentColor`;
no other change is made.

Lucide, Phosphor, Tabler Icons and Pixelarticons are distributed under the ISC
and MIT licenses of their authors; their license texts are at:

- Lucide: https://github.com/lucide-icons/lucide/blob/main/LICENSE
- Phosphor: https://github.com/phosphor-icons/core/blob/main/LICENSE
- Tabler Icons: https://github.com/tabler/tabler-icons/blob/master/LICENSE
- Pixelarticons: https://github.com/halfmage/pixelarticons/blob/master/LICENSE
- Codicons: https://github.com/microsoft/vscode-codicons/blob/main/LICENSE

Pixelarticons Premium is not used; only the free MIT set is bundled.
