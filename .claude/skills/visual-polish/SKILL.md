---
name: visual-polish
description: Polish ak-render output until it looks striking and refined, then prove it with screenshots and a scored QA gate. Use after a block, theme, 3D scene or export works but before its PR is opened, or when a reviewer says the output looks plain, muddy, loose or off-palette.
---

# Visual polish

Working output is the starting line. A page is done when a demanding designer
would stop on it. This skill is the loop that got the 3D scene from a muddy
slab to a framed, lit subject; it applies to any block.

## The loop

1. **Render the real thing.** Compile a representative fixture and capture it
   at 1440, 768 and 375 in light and dark, plus print/PDF:

   ```bash
   pnpm build && pnpm visual:check fixtures/<x>.yaml --out out/vc
   ```

   It writes all six captures, `page.pdf` and one thumbnail `sheet.png`, and
   prints `{frames:[{fill, offsetX, offsetY}]}` for each 3D frame. Read the
   sheet first; open a full capture only to inspect a detail. Never judge from
   code or a description. Rasterise the PDF with
   `pdftoppm -r 60 -png -f 1 -l 1 out/vc/page.pdf out/vc/pdf` when print changed.
2. **Name what is wrong in designer words**, one line each, with the image it
   shows in: loose framing, subject off centre, muddy or glaring surface, colour
   off the theme palette, flat light, duplicated hierarchy, dead space,
   controls that mean nothing in a still image.
3. **Fix the cause in the compiler or runtime, never in the fixture alone.**
   A fixture change is fine only when the fixture itself was wrong (a duplicate
   title, a caption that describes something not drawn).
4. **Re-render and compare** before and after side by side. Keep a change
   only if it is visibly better in both schemes and at phone width.
5. **Run `pnpm qa:pre`** (verify, snapshot, gallery and schema checks, browser
   tests). Regenerate snapshots and gallery for intended changes first. QA only
   ever sees a tree that passes it, so it spends its time on design.
6. **Score it.** Spawn the QA subagent described in `AGENTS.md`. While it runs,
   keep working; fold its findings in when the report lands and re-score until
   it scores 8 or above.

## QA prompt template

Give the QA subagent fixed inputs so it does not explore the repo:

```text
Score this round /10, engineering and design weighted equally. Budget 10 min.
Inputs: diff `git diff <last-qa-commit>..HEAD`, contact sheet <path>/sheet.png,
metrics <visual:check JSON>, qa:pre = green, open DoD from last round: <list>.
Round 1: review all. Later rounds: check open DoD and the new diff only.
Output, max 300 words: `Score: x/10 (eng y, design z)` then one line per
finding: `ID | blocker|minor | fix | DoD with a measurable threshold`.
```

## Defaults that held up

Start from these instead of searching again: camera fov 30, subject fill
0.84 of the frame (`visual:check` fill ≥ 0.6 on the stage, or fillY ≥ 0.7 with\nmarginY ≥ 0.06 when a wide stage fills by height; fit a loaded model in the\nruntime with the real aspect, centring its projected box), centre offset
≤ 0.05, shadow radius 9 with 16 blur samples, exposure 0.8 dark / 1 light,
metal metalness 0.85 roughness 0.32.

## Rules of taste that held up

- **Frame the subject, not the stage.** Fit the camera to the meaningful
  objects; floors and backdrops never set the framing. Centre the projected
  bounds, then fill about 84% of the frame.
- **Ground through shadow.** A floor reads best as soft contact shadow on the
  stage's own gradient, not as a hard-edged plane. Anything the reader cannot
  see must not appear in a legend or caption.
- **Light like a studio.** Key, fill and rim; an environment for reflections
  (generated in code, so still offline); filmic tone mapping; soft shadows sized
  to the scene. Dark themes need lower exposure so pastel tones keep their
  facets.
- **Colour only from tokens.** Derive surfaces by mixing theme tokens
  (`color-mix`) rather than reusing a text colour as a fill.
- **Atmosphere is subtle.** A faint accent glow from the top, an inset
  highlight, fog toward the page background. If you notice it first, it is too
  strong.
- **One title per idea.** A block title that repeats the page title is noise.
- **Phone width is a first-class layout.** Give a 3D stage 4:3 under 480px so
  it does not shrink to a strip.
- **Stills are stills.** In PNG and PDF, freeze the live frame at device scale
  2; hide interactive chrome that has no meaning on paper.

- **Graphs: dim, never erase.** For a selection in a dense graph, mix the
  other nodes a quarter toward the muted tone and about half toward the
  background, so group colour still reads; a full fade turns 1000 nodes into
  a grey blob. Do not select anything on load in a large graph.
- **Graphs: adjacent groups need distant hues.** Order the tone cycle so
  neighbouring clusters never share a warm hue (accent, info, success,
  danger, neutral, warning). Fit the camera to projected node bounds, not to
  the layout extent.
- **Products: details stand proud.** A driver, dial or port must sit in front
  of the panel it is mounted on, or the beauty shot shows a blank box. Check
  the plan for internal parts too: skip a part wholly inside another.
- **Products: neutral finishes are mixes, not tokens.** A graphite or chalk
  finish mixes the muted ink toward black or the surface toward white, so it
  reads as a material in both schemes instead of flipping with the theme.
- **Products: close-ups keep context.** A hotspot camera stands about three
  quarters of the home distance away, turned partly toward the hotspot's side;
  any closer and an exploded part fills the frame.
- **Morphs: soft shading, sharp outline.** A shaded SVG drawing of a smooth
  surface bands badly at 8 steps. Use about two dozen shade steps, then draw
  the faces once crisp and once blurred (stdDeviation about 4) under an alpha
  mask of the faces themselves: gradients read smooth and the silhouette stays
  sharp. Blurring the whole drawing looks out of focus.
- **Morphs: one material, glossy.** Clearcoat 1, roughness about 0.26, a little
  iridescence and sheen under the studio environment make a plain primitive
  look designed; blend the target tones with the shape so colour tells the
  reader which state is arriving.

## Done means

- Screenshots at 1440, 768 and 375 in light and dark, plus a rasterised PDF
  page, viewed and clean.
- Every gate green.
- QA score of 8 or above, with each finding's Definition of Done met.
