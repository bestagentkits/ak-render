# 3D effects

Recipes for `particles-3d`, `shader-3d` and `morph-3d`. Shared rules (state,
fallbacks, assets, export, troubleshooting) live in [3d.md](3d.md). Every YAML
example in this file compiles; `tests/unit/docs-3d-examples.test.ts` checks them.

Effects decorate. The `summary` is the text alternative, and motion never
carries information ([motion policy](adr/0002-motion-policy.md)).

## particles-3d

`particles-3d` draws a seeded particle effect from a named preset.

Minimal:

```yaml
- type: particles-3d
  summary: Nine thousand stars wind into three spiral arms.
```

Full:

```yaml
- type: particles-3d
  summary: Nine thousand stars wind into three spiral arms.
  preset: galaxy   # galaxy (default), nebula, fountain, snow, fireflies, vortex
  seed: 7          # the same seed always yields the same cloud
  # Optional overrides; the preset picks each one:
  shape: sphere            # point, sphere, ring, disc, box
  fields: [swirl, noise]   # swirl, noise, gravity, wind, attract (applied in that order)
  colors: [info, accent]   # 1-4 theme tones over each life (core to rim when orbiting)
  size: grow               # constant, grow, shrink, pulse
  count: 6000              # 64-20000
  speed: 0.8               # 0.1-4
```

- Every particle is a closed-form function of its seeded spawn and the clock
  (`src/blocks/three/particles-sim.ts`), so any frame is computed directly. The
  compiler draws the frame at 7.5 s as an SVG poster with the live camera; the
  live view starts at that frame, and reduced motion keeps it still. The poster
  carries the stage's night sky, so `export3dPosterSvg` returns the same picture.
- Two bounded paths: the GPU path evaluates the motion in the vertex shader for
  up to 20,000 particles; the CPU path (GPUs without highp vertex floats)
  evaluates it in JS for at most 4,000. `data-ak-3d-path` on the block reports
  which; `html[data-ak-3d-path="cpu|gpu"]` forces one for tests and tooling.
- Adaptive downgrade: the first 30 frames learn the display's own interval,
  snapped to a real refresh rate (144 to 30 Hz); a device slow from its first
  frame matches none and is judged against 60 Hz. After that, a window of 30
  frames whose median interval exceeds the larger of 28 ms and 1.5 times that
  baseline halves the drawn count, down to an eighth; from the second step the pixel
  ratio drops to 1. It never steps back up, and fewer sprites each carry more
  light. The low quality profile starts one step down. `data-ak-3d-level`
  reports the level.
- The clock pauses offscreen (the stage is observed, not the caption) and
  resumes without a jump. A Pause button stops the motion; print hides it.
- `stats().particleResources` counts live particle geometries and materials;
  it is zero after `unmountAll()`.

State: none. `particles-3d` has no `bind`; it is atmosphere, not data.

Fallback: the SVG poster of the 7.5 s frame. Fixtures:
`fixtures/3d/particles-3d-galaxy.yaml`, `particles-3d-presets.yaml`,
`particles-3d-seeds.yaml`.

## shader-3d

`shader-3d` draws a closed shader effect on a lit surface. A spec picks a
preset and sets numbers; it never carries shader source.

Minimal:

```yaml
- type: shader-3d
  summary: A glowing sphere with a fresnel rim.
```

Full:

```yaml
- type: shader-3d
  summary: A torus knot burns away along a noise front.
  preset: dissolve      # noise, fresnel (default), hologram, distortion, dissolve
  seed: 7               # the same seed always yields the same pattern
  # Optional; the preset picks each one:
  shape: torus-knot     # sphere, torus, torus-knot, plane
  colors: [info, warning]   # body, then glow
  intensity: 1.2        # 0-2, glow strength
  scale: 1.6            # 0.25-4, pattern frequency
  progress: 0.4         # 0-1, the preset's main dial (see below)
  speed: 1              # 0-4, 0 holds the frame
  post: [bloom, grain, vignette]   # or [none]
  controls: [preset, progress, intensity]   # built-in buttons and sliders
  bind: { preset: state.look, progress: state.reveal }
```

- `progress` is the swell (noise), rim width (fresnel), fill (hologram), wave
  height (distortion) or share burnt away (dissolve).
- Post passes run in a fixed order: bloom, chromatic, scanlines, grain,
  vignette. Each preset supports a set (`POST_COMPAT` in
  `src/blocks/three/shader-fx.ts`): scanlines only on the hologram, no
  chromatic split on the dissolve. A pass a preset does not support is an
  error that names the ones it does; when a bound preset switches live, the
  chain keeps the passes the new preset supports.
- No escape hatch: `shader`, `glsl`, `wgsl`, `vertexShader` and
  `fragmentShader` are rejected anywhere in a spec, and any other unknown prop
  (`source`, `uniforms`) fails validation. The GLSL lives in `shader-fx.ts`;
  spec values only reach it as uniforms.
- `shadeAt` (TypeScript) and the fragment program compute the same weights, so
  the compiler shades an SVG poster of the frame at 3 s with the live camera;
  the live view starts at that frame and reduced motion keeps it still. Poster
  facets mix theme tokens in oklab, and the post passes are SVG filters and
  overlays.
- The clock pauses offscreen, a Pause button stops the motion (print hides
  it), and `stats().shaderResources` is zero after `unmountAll()`.

State: preset buttons and range sliders render disabled and are enabled by the
runtime. A control sets the uniform, writes its `bind` path (`set-value`) and
fires `change` with `{ value, param }`. Any control bound to the same path
drives the effect back; numbers are clamped to range, unknown presets are
ignored. The compiler reads the initial state too, so the poster shows the
bound values.

```yaml
version: 1
meta: { title: Shader look }
state: { look: hologram }
blocks:
  - type: shader-3d
    summary: One surface, three looks.
    bind: { preset: state.look }
  - type: select
    label: Look
    bind: state.look
    options: [{ value: hologram, label: Hologram }, { value: noise, label: Noise }, { value: fresnel, label: Fresnel }]
```

Fallback: the SVG poster of the 3 s frame, which `export3dPosterSvg` returns
with its night stage. Fixtures: `fixtures/3d/shader-3d-presets.yaml`,
`shader-3d-controls.yaml`, `shader-3d-seeds.yaml`.

## morph-3d

`morph-3d` shows one glossy, studio-lit surface that morphs between typed
target shapes, on a timeline or when page state names a target.

Minimal:

```yaml
- type: morph-3d
  summary: A sphere that becomes a cube.
  targets:
    - { id: sphere, shape: sphere }
    - { id: cube, shape: cube }
```

Full:

```yaml
- type: morph-3d
  summary: A surface that springs from a sphere to a rounded cube to a star.
  bind: state.shape     # chosen target id; a state value morphs to it
  easing: spring        # smooth (default), spring, snap or linear
  duration: 1400        # ms per morph, 200-6000 (default 1300)
  timeline: loop        # loop (default), once or manual
  targets:              # 2-6, in timeline order
    - { id: sphere, label: Sphere, shape: sphere, tone: accent }
    - { id: cube, label: Cube, shape: cube, tone: info, description: Structured and stable. }
    - { id: star, label: Star, shape: star, tone: warning }
```

- Shapes come in two topologies. Closed surfaces: `sphere`, `cube`, `capsule`,
  `cylinder`, `cone`, `gem`, `blob`, `star`. Rings: `torus`, `knot` (a trefoil)
  and `twist` (a rounded-square band). Every target of one topology is sampled
  on one shared grid (a welded cube-sphere, or a wrapped tube), so each morph
  is a straight per-vertex blend with no seams, collapsed faces or tears.
- A closed surface and a ring differ in genus, so no morph joins them. Mixing
  them is a compile error that names the target, `invalid topology: "torus" is
  a ring (genus 1) and "sphere" is a closed surface (genus 0)`. A page whose
  config is edited to mix them keeps its drawing and sets
  `data-ak-3d-state="error"`.
- Target ids are unique. Each target's `tone` colours the surface, and the
  colour blends with the shape. A morph starts from whatever blend is on
  screen, so a choice made mid-morph turns smoothly instead of jumping;
  `spring` overshoots the target shape and settles.
- `loop` holds each target, morphs to the next and wraps, while the surface
  turns slowly. `once` plays through to the last target. Both show a Pause
  button that freezes the shape where it is, mid-morph included; `once`
  drops it after the last target. `manual` moves only on a choice.
- With reduced motion nothing turns and every choice lands at once.

State: a target button, a click on the surface, the keys `Enter`/`n`/`p` on the
canvas, or a change to `bind` chooses a target; a reader's choice stops the
loop (Play resumes it), writes the id to `bind` and fires `select` with
`{ value }`.

```yaml
version: 1
meta: { title: Shapes }
state: { shape: cube }
blocks:
  - type: morph-3d
    summary: Pick a shape and the surface morphs to it.
    bind: state.shape
    timeline: manual
    targets:
      - { id: sphere, label: Sphere, shape: sphere }
      - { id: cube, label: Cube, shape: cube }
  - type: select
    label: Shape
    bind: state.shape
    options: [{ value: sphere, label: Sphere }, { value: cube, label: Cube }]
```

Fallback: without JS or WebGL, and in print, a shaded drawing of the current
target (the bound one, else the first) under the live camera and light, and the
target list, each button with a small drawing of its shape. Fixtures:
`fixtures/3d/morph-3d-shapes.yaml`, `morph-3d-rings.yaml`.
