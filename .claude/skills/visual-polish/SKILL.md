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
   node dist/cli.js export fixtures/<x>.yaml --format png --out out/s-1440-light.png --scheme light --width 1440 --scale 1
   node dist/cli.js export fixtures/<x>.yaml --format pdf --out out/page.pdf
   pdftoppm -r 60 -png -f 1 -l 1 out/page.pdf out/pdf
   ```

   Look at every image. Never judge from code or a description.
2. **Name what is wrong in designer words**, one line each, with the image it
   shows in: loose framing, subject off centre, muddy or glaring surface, colour
   off the theme palette, flat light, duplicated hierarchy, dead space,
   controls that mean nothing in a still image.
3. **Fix the cause in the compiler or runtime, never in the fixture alone.**
   A fixture change is fine only when the fixture itself was wrong (a duplicate
   title, a caption that describes something not drawn).
4. **Re-render and compare** before and after side by side. Keep a change
   only if it is visibly better in both schemes and at phone width.
5. **Run the gates** (`pnpm verify`, `snapshots:check`, `gallery:check`, the
   browser tests) and regenerate snapshots and gallery for intended changes.
6. **Score it.** Spawn the QA subagent described in `AGENTS.md`. While it runs,
   keep working; fold its findings in when the report lands and re-score until
   it is above 8.

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

## Done means

- Screenshots at 1440, 768 and 375 in light and dark, plus a rasterised PDF
  page, viewed and clean.
- Every gate green.
- QA score above 8, with each finding's Definition of Done met.
