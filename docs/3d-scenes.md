# 3D scenes and objects

Recipes for `scene-3d`, `model-3d`, `product-3d` and `text-3d`. Shared rules
(state, fallbacks, assets, export, troubleshooting) live in [3d.md](3d.md).
Every YAML example in this file compiles; `tests/unit/docs-3d-examples.test.ts`
checks them against `fixtures/3d/`.

## scene-3d

`scene-3d` composes primitives into a scene graph.

Minimal:

```yaml
- type: scene-3d
  summary: A core router on a base plate.
  objects:
    - { id: base, label: Base plate, shape: plane, size: 6, rotation: [-90, 0, 0], tone: neutral }
    - { id: core, label: Core router, shape: icosahedron, position: [0, 1, 0] }
```

Full:

```yaml
- type: scene-3d
  title: Edge cluster
  summary: A core router linked to three edge nodes.
  bind: state.part
  objects:
    - { id: base, label: Base plate, shape: plane, size: 6, rotation: [-90, 0, 0], tone: neutral }
    - { id: core, label: Core router, shape: icosahedron, position: [0, 1, 0] }
    - { id: rig, label: Edge rig, shape: group }
    - { id: edge-a, label: Edge A, parent: rig, shape: box, position: [2, 0.5, 0] }
  timeline:
    - { target: core, property: rotation, to: [0, 360, 0], duration: 8000 }
```

- `objects`: up to 200, each with an `id` and a `label`, nested by `parent` at most 8 levels. Shapes, materials
  and tones are closed vocabularies; vectors are exactly 3 bounded numbers.
- `lighting`: a preset (`studio`, `soft`, `dramatic`, `night`).
- `camera`: position and target; omitted, the compiler frames the scene.
- `timeline`: rotation spins, position and scale ease back and forth.
- `views` + `viewBind`: a state value moves the camera and highlights an object.
- `bind`: picking an object (pointer, keyboard or the object list) writes its id.
- Errors: a duplicate id, a `parent` cycle, or a `parent`, `timeline` target or view
  `focus` that names no object.

State: a pick writes `state.part`; the select drives the scene back. A view
value moves the camera to that view and highlights its `focus`.

```yaml
version: 1
meta: { title: Edge cluster }
state: { part: core, view: overview }
blocks:
  - type: scene-3d
    summary: A core router linked to an edge node.
    bind: state.part
    viewBind: state.view
    views:
      - { value: overview }
      - { value: edge, focus: edge-a, camera: { position: [4, 3, 4], target: [2, 0.5, 0] } }
    objects:
      - { id: core, label: Core router, shape: icosahedron, position: [0, 1, 0] }
      - { id: edge-a, label: Edge A, shape: box, position: [2, 0.5, 0] }
  - type: select
    label: Part
    bind: state.part
    options: [{ value: core, label: Core router }, { value: edge-a, label: Edge A }]
  - type: select
    label: View
    bind: state.view
    options: [{ value: overview, label: Overview }, { value: edge, label: Edge close-up }]
```

Fallback: the shared labelled SVG plan plus the object list
([Fallbacks](3d.md#fallbacks)). Fixtures: `fixtures/3d/scene-3d-basic.yaml`,
`scene-3d-dense.yaml`.

## model-3d

`model-3d` shows a local or allowed `.glb`/`.gltf`. Asset rules (paths, sizes,
extensions, decoders, CSP) are in [Assets and network](3d.md#assets-and-network).

Minimal (paths resolve against the spec's directory):

```yaml
- type: model-3d
  summary: A storage crate with a hinged lid.
  src: models/crate.glb
```

Full:

```yaml
- type: model-3d
  id: crate
  summary: A storage crate with a hinged lid.
  src: models/crate.glb        # or .gltf with relative .bin/.png
  bind: state.part             # chosen hotspot id
  clipBind: state.clip         # animation clip name
  variantBind: state.finish    # KHR_materials_variants name
  hotspots:
    - { id: latch, label: Latch, position: [0, 0.55, 0.46] }
```

- Orbit by drag, pan with shift- or right-drag, zoom with wheel or pinch.
  Keys: arrows orbit, shift+arrows pan, `+`/`-` zoom, `Home`/`0` reset,
  `n`/`p` next or previous hotspot.
- The compiler reads clip names, variant names and bounds from the glTF, and
  frames the camera from them. Clip and variant buttons and the numbered hotspot
  list render server-side; reduced motion shows a clip's first pose. A remote
  model is not read at compile time, so it gets orbit and hotspots but no clip
  or variant controls. Unnamed clips are `animation_<i>`, as GLTFLoader names them.
  The runtime fits the loaded model to the stage's real aspect (projected box
  centred, 5% margin across and 7% down) and refits on resize while at home; an authored
  `camera.position` or `target` is kept. The stage keeps the shared 16:9 (4:3 on
  phones) aspect so model and scene blocks align in a page, so a near-cubic
  model fills by height.
  The wheel zooms only after the stage is clicked or focused (or with Ctrl).
- States: `static` → `loading` → `ready`, or `error` (load or decoder failure,
  with a message over the plan), or `unsupported` without WebGL 2.

State: the variant, the clip and the hotspot each bind to a path that page
controls share.

```yaml
version: 1
meta: { title: Shipping crate }
state: { part: latch, clip: Spin, finish: oak }
blocks:
  - type: model-3d
    summary: A shipping crate in three finishes.
    src: models/crate.glb
    bind: state.part
    clipBind: state.clip
    variantBind: state.finish
    hotspots:
      - { id: latch, label: Latch, position: [0, 0.55, 0.46] }
  - type: select
    label: Finish
    bind: state.finish
    options: [{ value: oak, label: Oak }, { value: graphite, label: Graphite }, { value: coral, label: Coral }]
```

Fallback: the `poster` or a compiler-drawn plan (bounds box plus numbered pins)
and the hotspot list. Fixture: `fixtures/3d/model-3d-crate.yaml`, models
generated by `scripts/generate-model-fixtures.mjs` (including a Draco stand-in
that must fail).

## product-3d

`product-3d` shows a product built from typed parts under the studio light rig,
with finish variants, numbered hotspots and an exploded view.

Minimal:

```yaml
- type: product-3d
  summary: A compact studio speaker.
  parts:
    - { id: body, shape: rounded-box, position: [0, 1.2, 0], scale: [1.5, 2.2, 1.3], tone: dark }
```

Full:

```yaml
- type: product-3d
  summary: A compact studio speaker offered in four finishes.
  bind: state.feature          # chosen hotspot id
  variantBind: state.finish    # variant id
  explodeBind: state.view      # `exploded` (or true) explodes; anything else assembles
  parts:                       # scene objects + `explode`
    - { id: body, shape: rounded-box, position: [0, 1.2, 0], scale: [1.5, 2.2, 1.3], tone: dark, explode: [0, 0.35, -0.6] }
    - { id: woofer, shape: cylinder, rotation: [90, 0, 0], position: [0, 0.86, 0.72], scale: [1, 0.08, 1], material: metal, explode: [0, 0.35, 1.5] }
  variants:
    - { id: graphite, label: Graphite, finishes: [{ part: body, tone: dark, material: matte }] }
    - { id: silver, label: Silver, finishes: [{ part: body, tone: light, material: metal }] }
  hotspots:
    - { id: woofer, label: 5-inch woofer, part: woofer, offset: [0.3, 0, 0.1], description: Long-throw cone. }
```

- Parts are scene objects without a `description` (hotspots carry the words);
  an optional `label` names the part in the plan's tooltip. Every part is drawn:
  shapes leave out `group`, `plane`, `torus-knot` and `icosahedron`, and add
  `rounded-box` and `capsule`. `parent` still hangs one part off another.
- Up to 64 parts, 12 variants and 24 hotspots. Part tones add `dark` and
  `light`, neutral finishes mixed from the theme's ink and paper. Variant and
  hotspot ids are unique, and every `part` reference must name a part.
- The compiler applies the bound (or first) variant to the parts, frames the
  camera, and resolves each hotspot's point, its exploded shift and a close-up
  bearing that turns from the home view toward the hotspot's side.
- Choosing a hotspot (list, pin, canvas pick or state) highlights its part,
  shows its card and flies the camera to it. The exploded view moves each part
  by `explode` and stands the camera back. A hotspot on a part sealed inside
  another opens the exploded view when chosen, and its plan pin is hollow.
  Parts drift together once on load. With reduced motion every change is
  immediate.
- Keys on the canvas: arrows orbit, `+`/`-` zoom, `Enter`/`n`/`p` cycle
  hotspots, `e` toggles the exploded view, `Home`, `0` or `Escape` reset.

State: the block's own finish dropdown, `variantBind` and any page control on
the same path stay in step; finishes ease in about half a second.

```yaml
version: 1
meta: { title: Studio speaker }
state: { finish: silver, view: assembled }
blocks:
  - type: product-3d
    summary: A speaker in two finishes.
    variantBind: state.finish
    explodeBind: state.view
    parts:
      - { id: body, shape: rounded-box, scale: [1.5, 2.2, 1.3], tone: dark, explode: [0, 0, -0.6] }
      - { id: cone, shape: cylinder, rotation: [90, 0, 0], position: [0, 0, 0.7], scale: [1, 0.08, 1], explode: [0, 0, 1.2] }
    variants:
      - { id: graphite, label: Graphite, finishes: [{ part: body, tone: dark }] }
      - { id: silver, label: Silver, finishes: [{ part: body, tone: light, material: metal }] }
  - type: select
    label: View
    bind: state.view
    options: [{ value: assembled, label: Assembled }, { value: exploded, label: Exploded }]
```

Fallback: without JS or WebGL, and in print, a drawn plan with the same numbered
pins, the finish list and the hotspot list. Export and print settle any
transition and paint the pins into the frozen frame. Fixture:
`fixtures/3d/product-3d-speaker.yaml`.

## text-3d

`text-3d` extrudes lettering from a bundled font. The text itself is the label
of the poster and of the live canvas.

Minimal:

```yaml
- type: text-3d
  text: Ship it.
```

Full:

```yaml
- type: text-3d
  text: Ship it.          # up to 80 characters, at most 3 lines split by a line break
  summary: Optional caption.
  font: display           # display: Bricolage Grotesque 800; serif: Fraunces 700
  material: satin         # satin, metal, chrome, glass, neon
  tone: accent            # any theme tone
  depth: 0.28             # 0.05-1 of the font size
  bevel: soft             # none, soft, round
  animation: rise         # rise, wave, float, spin, none
  split: character        # character or word: what moves as one
```

- Fonts are SIL OFL 1.1 static instances taken unmodified from their
  Fontsource packages (`assets/fonts/<family>/outline-*.woff`, next to the
  family's `OFL.txt`). `pnpm fonts:generate` reads their TrueType outlines,
  advances and GPOS pair kerning into `outline-fonts.generated.ts`; a page
  carries only the outlines its text uses. Nothing is fetched.
- Unicode: text is NFC-normalized, so a base letter plus combining marks draws
  the precomposed glyph. Basic Latin, Latin-1, Latin Extended-A and Vietnamese
  are covered. A character the font lacks (CJK, emoji, symbols) draws the font's
  box glyph, compiles with a warning naming its code point (and suggests the
  other font when that one covers it), and the caption spells the whole text
  out so the page stays readable.
- The compiler lays the text out (kerning, lines, centring) once; the poster
  and the live view share that layout.
- Motion is a closed-form pose per unit (`text-motion.ts`): `rise` is a
  staggered entrance that lands in a gentle float; `wave`, `float` and `spin`
  loop. Reduced motion and export show the rest pose; looping motion gets a
  Pause button, stops offscreen and hides in print. Drag or arrow keys orbit
  within a small cone; `Home` resets.

State: none. `text-3d` has no `bind`; the words are the content, so there is
nothing to select.

Fallback: an SVG poster of the same layout (rest pose, extrusion receding below
each glyph) with the text as its label. Fixtures: `fixtures/3d/text-3d-hero.yaml`,
`text-3d-materials.yaml`, `text-3d-unicode.yaml`.
