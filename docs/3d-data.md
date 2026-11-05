# 3D data, places and stories

Recipes for `scatter-3d`, `bars-3d`, `network-3d`, `point-cloud-3d`,
`globe-3d`, `terrain-3d` and `timeline-3d`. Shared rules (state, fallbacks,
assets, export, troubleshooting) live in [3d.md](3d.md). Every YAML example in
this file compiles; `tests/unit/docs-3d-examples.test.ts` checks them against
`fixtures/3d/`.

These widgets carry data, so each fallback lists every value the live view can
show. Adaptive quality lowers decoration, never the data.

## scatter-3d

`scatter-3d` plots up to 20,000 points on real x/y/z axes. Data is columnar, so
a 20k-point spec stays compact; scalar columns (numbers or strings only) may hold
up to `maxColumnValues` (20,000) entries instead of the usual 200-item list bound.

Minimal:

```yaml
- type: scatter-3d
  summary: Latency, CPU load and memory per host.
  axes: { x: { label: Latency }, y: { label: CPU }, z: { label: Memory } }
  data: { x: [12, 40, 33], y: [55, 72, 90], z: [8, 16, 12] }
```

Full, with state (a pick writes the point id; a legend click writes the group,
`all` clears it):

```yaml
- type: scatter-3d
  title: Fleet load
  summary: Latency, CPU load and memory per host.
  bind: state.point
  filterBind: state.cluster
  axes:
    x: { label: Latency, unit: ms }
    y: { label: CPU load, unit: '%', min: 0, max: 100 }
    z: { label: Memory, unit: GB }
    size: { label: Requests, unit: k/s }
  groups:
    - { value: core, tone: accent }
    - { value: edge, tone: success }
  data:
    id: [h1, h2, h3]
    x: [12, 40, 33]
    y: [55, 72, 104]
    z: [8, 16, 12]
    size: [3, 9, 5]
    group: [core, edge, core]
```

- Scales: omitted bounds snap to 1-2-5 ticks around the data; explicit `min`/`max`
  are kept exact and points outside them are clipped (not drawn, flagged in the
  table and counted in the status line).
- Encodings: `group` colours by tone (up to 9 groups, each with a distinct
  default colour); otherwise `value` with `axes.color` uses a sequential
  info → accent → danger ramp. `size` scales the point radius. Each encoding
  gets a legend.
- Interaction: click or `n`/`p` picks a point; drag with the Brush tool (or
  Shift-drag) brushes a region and fires `brush` with the count; Escape clears.
- Rendering is one `Points` draw call with a lit sphere impostor shader.

Fallback: a full data table lists every point, so no-JS, print and screen
readers see every value. The SVG poster uses the live camera. Fixtures:
`fixtures/3d/scatter-3d-basic.yaml`, `scatter-3d-20k.yaml`.

## bars-3d

`bars-3d` draws a categories x series matrix as grouped or stacked bars. The
spec gives only data; the compiler owns the layout, scale, camera and colors.

Minimal:

```yaml
- type: bars-3d
  summary: Operations outpace investing every quarter.
  categories: [{ id: q1, label: Q1 }, { id: q2, label: Q2 }]
  series: [{ id: ops, label: Operations }, { id: invest, label: Investing }]
  values: [[42, 12], [38, 16]]
```

Full:

```yaml
- type: bars-3d
  summary: Operating cash builds while capital spend pulls the stack below zero.
  mode: stacked          # grouped (default): one depth row per series
  unit: ' M'
  bind: state.bar        # the picked bar id, `category/series`
  filterBind: state.flow # a series id shows only that series
  categories: [{ id: q1, label: Q1 }, { id: q2, label: Q2 }]
  series: [{ id: ops, label: Operations }, { id: invest, label: Investing }]
  values: [[42, -12], [38, -46]]   # one row per category, one value per series
```

- Every bar starts at zero. Grouped bars span `[min(0, v), max(0, v)]`; stacked
  positives build up and negatives build down from zero, so a stack ends at the
  category's positive and negative sums. A translucent zero plane and a full-ink
  zero line mark the baseline; ticks are round steps that include zero.
- Up to 100 categories, 12 series and 1,000 bars. `values` must match both lists.
- The legend filters by series: hidden bars collapse to the baseline and the
  rest restack. Filtering eases (about half a second) and bars rise once on load
  only when motion is allowed; with reduced motion every change is immediate,
  and export or print settles any transition before the frame is frozen.
- Series take theme tones in order; past the sixth a tone repeats one shade deeper.

State: a select on the `filterBind` path filters the bars; any value that is not
a series id shows them all.

```yaml
version: 1
meta: { title: Cash flow }
state: { flow: all }
blocks:
  - type: bars-3d
    summary: Operating and investing cash by quarter.
    filterBind: state.flow
    categories: [{ id: q1, label: Q1 }, { id: q2, label: Q2 }]
    series: [{ id: ops, label: Operations }, { id: invest, label: Investing }]
    values: [[42, -12], [38, -46]]
  - type: select
    label: Show
    bind: state.flow
    options: [{ value: all, label: All }, { value: ops, label: Operations }, { value: invest, label: Investing }]
```

Fallback: without JavaScript or WebGL, and in print, a flat SVG bar chart of the
same extents and a table of every value (with stack totals). Each table value is
a button that selects its bar once the runtime runs. Fixtures:
`fixtures/3d/bars-3d-stacked.yaml`, `bars-3d-dense.yaml`.

## network-3d

`network-3d` draws a node-link graph in 3D. The compiler lays it out at compile
time with a seeded generator, so the same spec gives byte-identical HTML.

Minimal:

```yaml
- type: network-3d
  summary: A gateway in front of two services.
  nodes: [{ id: gateway }, { id: auth }, { id: orders }]
  edges: [{ from: gateway, to: auth }, { from: gateway, to: orders }]
```

Full, with state (picking a node writes its id and the state selects it back;
legend chips write a group id, `""` shows all):

```yaml
- type: network-3d
  title: Service mesh
  summary: Eighteen services in four tiers.
  layout: force            # force | hierarchical | radial (radial uses `root`)
  directed: true
  bind: state.service
  filterBind: state.tier
  groups: [{ id: edge, label: Edge }, { id: core, label: Core }]
  nodes: [{ id: gateway, label: API gateway, group: edge }, { id: auth, group: core }]
  edges: [{ from: gateway, to: auth }]
```

- `nodes` and `edges` take up to 200 entries each. Larger graphs use the compact
  text props: `nodeList` (one `id [group] [label…]` per line) and `edgeList`
  (`from>to` tokens). A graph holds up to 2000 nodes and 4000 links.
- Errors: duplicate node or group ids, an edge or root naming no node, a
  self-link, a node group missing from `groups`. Cycles are allowed.
- A selection lights the node, its links and neighbours and dims the rest; the
  camera flies to it (a jump under reduced motion). `n`/`p` walk nodes, `Enter`
  picks, `Escape` returns home.
- One instanced mesh draws every node and two line sets draw every link, so the
  1000-node stress fixture mounts in a handful of draw calls.

Fallback: a static SVG plan and a table of every node with its group, link count
and neighbours. The table rows carry `data-ak-net-near` while the graph is live.
Fixtures: `fixtures/3d/network-3d-basic.yaml`, `network-3d-stress.yaml`.

## point-cloud-3d

`point-cloud-3d` draws a scanned point cloud at its true proportions: one
uniform scale for all three axes, so a survey stays flat and a tree stays round.
Points come from a local text file (up to 100,000) or inline columns (up to
20,000, the document's column bound).

Minimal (inline columns; `id` is optional):

```yaml
- type: point-cloud-3d
  summary: Four survey returns at a corner.
  axes:
    x: { label: East, unit: m }
    y: { label: North, unit: m }
    z: { label: Height, unit: m }
  data: { x: [0, 1, 0, 1], y: [0, 0, 1, 1], z: [0, 0.2, 0.1, 0.4] }
```

Full, from a file beside the spec:

```yaml
- type: point-cloud-3d
  title: Depot survey scan
  summary: Thirty thousand laser returns over the depot, coloured by intensity.
  src: point-cloud/depot-30k.xyz   # or data: { x, y, z, intensity, id }
  bind: state.point                # a pick writes the point id (p1, p2, ... by line)
  up: z                            # z (default, survey/LiDAR) or y
  budget: 60000                    # optional: most points the live view draws
  axes:
    x: { label: Easting, unit: m }
    y: { label: Northing, unit: m }
    z: { label: Elevation, unit: m, max: 11 }   # min/max form the clip box
    intensity: { label: Intensity }
```

- File input: `.xyz`, `.csv` or `.txt` beside the spec, one point per line,
  `x y z [intensity]` separated by spaces, tabs, commas or semicolons, with
  optional `#` comments and an optional header naming `x`, `y`, `z` and
  `intensity` (or `i`). Reads are confined to the spec directory like model
  assets (8 MiB per file, 16 MiB per page) and never touch the network; a
  remote URL is rejected. Header columns the widget does not draw (RGB, return
  number) raise a warning.
- No silent truncation: a file over 100,000 points, a ragged row or a value
  that is not a finite number fails with the line number and a fix. Points
  outside the clip box are hidden by an explicit, counted rule.
- Level of detail: the compiler orders the in-box points so every prefix
  spreads over the whole cloud (Morton order walked in bit-reversed rank). The
  live view draws the first `budget` of them, at most 50,000 on a low quality
  profile, and the status line states the drawn count, so a bounded draw never
  reads as the whole cloud.
- Interaction: click or `n`/`p` picks a point; the pick writes `bind`, fires
  `select` and shows the authored coordinates with their units. Any point of
  the cloud can be selected from state, drawn or not. A `Cut above` slider
  hides points above a height on the up axis; Home or Reset view restores the
  camera and the cut. A click picks the front point under the cursor, never
  one hidden behind a surface.
- Colour: intensity on a ramp through the theme's info, success, warning and
  danger hues, or height when the cloud has no intensity. Lightness runs one
  way (darker toward the top on a light page, lighter on a dark one), so a
  high value always stands out more than a low one.
- Rendering: one `Points` draw into an offscreen target, then an eye-dome
  lighting pass that outlines roofs, crowns and walls against what lies behind
  them and fills pinholes between points.

Fallback: an SVG drawing of an even 5,000-point sample through the live camera,
the selected point, min/max/mean of every column over all points, and a table of
the first 100 points plus the selected one. The status line says which of these
are samples. Fixtures: `fixtures/3d/point-cloud-3d-basic.yaml` (inline),
`point-cloud-3d-depot.yaml` (30k file) and `point-cloud-3d-100k.yaml` (100k
file, clip box and budget), generated by
`scripts/generate-point-cloud-fixtures.mjs`.

## globe-3d

`globe-3d` puts places and routes on a dotted globe. The land is Natural Earth's
1:110m outline (public domain), bundled in the compiler and regenerated with
`scripts/generate-world-land.mjs`, so the page stays offline.

Minimal:

```yaml
- type: globe-3d
  summary: Two offices and the link between them.
  markers:
    - { id: lhr, label: London, lat: 51.47, lon: -0.45 }
    - { id: sin, label: Singapore, lat: 1.36, lon: 103.99 }
  arcs: [{ from: lhr, to: sin }]
```

Full:

```yaml
- type: globe-3d
  summary: Offices on five continents and the links between them.
  bind: state.city          # picking a place writes its id; the state selects it back
  timeBind: state.year      # the time step writes here ("" shows everything)
  valueLabel: Staff
  layers: [{ id: hubs, label: Hubs }, { id: links, label: Links, tone: info }]
  markers:
    - { id: lhr, label: London, lat: 51.47, lon: -0.45, value: 1840, layer: hubs, time: "2016" }
    - { id: sin, label: Singapore, lat: 1.36, lon: 103.99, value: 1320, layer: hubs, time: "2017" }
  arcs:
    - { from: lhr, to: sin, value: 240, layer: links, time: "2017" }
  markerList: |             # id lat lon [layer] [value] [time] [label…]; `-` skips a field
    hnd 35.55 139.78 hubs 1490 2017 Tokyo
  arcList: |                # from>to [layer] [value] [time] [label…]
    sin>hnd links 220 2017
```

- Latitude is north-positive, longitude east-positive. `markers` and `arcs`
  take up to 200 entries each; the compact lists add more, up to 1,000 markers
  and 500 arcs. Times are `YYYY`, `YYYY-MM` or `YYYY-MM-DD`.
- Errors: duplicate marker or layer ids, an arc naming no marker or linking a
  marker to itself, a layer missing from `layers`, a malformed time, and, in the
  compact lists, the line and field that is wrong.
- The compiler frames the camera on the marker `bind` selects when the page
  opens, else on the middle of the markers (or `center: [lat, lon]`), sets
  the sun west of the view so the eastern limb falls into night, raises markers
  with a `value` as spikes, thickens arcs by `value` and clusters markers at two
  zoom levels (7° far out, 2.5° closer, none close up; a small stage clusters
  coarser, up to 14°). `cluster: false` turns clustering off.
- Choosing a place (table button, canvas, `n`/`p`/`Enter`, or state) writes
  `bind` and flies the camera to it; a cluster flies in until it splits. The time
  slider shows items up to the chosen step, compared at its precision (a
  `timeBind` value such as `2019-06` works between steps, with or without JS); layer
  chips hide a layer's places and routes. Routes to a hidden place hide with it.
  Under reduced motion every flight is a jump.
- Keys on the canvas: arrows turn the globe, `+`/`-` zoom, `Escape` clears the
  selection and returns home, `Home` or `0` return home.
- Land dots are one point batch, markers and clusters one instanced mesh each
  and all arcs one merged mesh, so 500 markers and 200 arcs draw in about ten
  calls.

State: a select on the `bind` path flies the globe to that office.

```yaml
version: 1
meta: { title: Offices }
state: { city: sin }
blocks:
  - type: globe-3d
    summary: Two offices.
    bind: state.city
    markers:
      - { id: lhr, label: London, lat: 51.47, lon: -0.45 }
      - { id: sin, label: Singapore, lat: 1.36, lon: 103.99 }
  - type: select
    label: Office
    bind: state.city
    options: [{ value: lhr, label: London }, { value: sin, label: Singapore }]
```

Fallback: without JS or WebGL, and in print, the home view as SVG (land dots,
night side, arcs, markers and clusters with counts) plus a table of every place
with its coordinates and a table of every route with its great-circle distance.
Print shows every row whatever the filters. Fixtures:
`fixtures/3d/globe-3d-routes.yaml`, `globe-3d-stress.yaml`.

## terrain-3d

`terrain-3d` shows a block of ground from a heightmap: lit relief, contour
lines, a colour ramp, numbered places and a flyover.

Minimal (a seeded relief; give `heights` rows for measured ground):

```yaml
- type: terrain-3d
  summary: A rolling block of hills.
  relief: { seed: 7 }
```

Full:

```yaml
- type: terrain-3d
  summary: A 12 km alpine block with two summits and a glacial valley.
  unit: m              # elevation unit (default m)
  width: 12000         # ground width in the same unit: true scale
  exaggeration: 2      # vertical scale; omitted picks a round factor
  contours: 100        # interval; omitted picks a round one, 0 hides them
  ramp: terrain        # terrain (default), glacier, desert, volcanic, viridis
  bind: state.place    # chosen place id
  relief:              # or `heights`: rows of elevations, up to 256 x 256
    seed: 7
    resolution: 256    # 16-256 samples a side (default 128)
    roughness: 0.55
    range: [820, 3120]
    features:          # peak, ridge, valley, crater, basin (ridge/valley need `to`)
      - { kind: peak, at: [0.38, 0.34], radius: 0.24, height: 1.2 }
  annotations:         # up to 12 places, `at` is [x, y] across the block, 0-1
    - { id: summit, label: Grand Pic, at: [0.38, 0.34] }
```

- Give `heights` or `relief`, not both. Rows must all have the same count. The
  bounds let a `heights` grid and its rows reach 256 items (`maxGridSide`)
  instead of the usual 200.
- Each place lists its elevation, read from the heightmap with bilinear
  interpolation, so the label and the drawn ground agree.
- The flyover tours the places and returns home, with a Pause button. A place
  button, a pin, the keys `Enter`/`n`/`p` on the canvas or a change to `bind`
  chooses a place, flies to it, writes its id to `bind` and fires `select`.
  `Home`, `0` or `Escape` flies home; any `bind` value that is not a place does
  too. A pointer drag stops the tour. With reduced motion there is no flyover
  and every flight lands at once.

State:

```yaml
version: 1
meta: { title: Valley }
state: { place: hut }
blocks:
  - type: terrain-3d
    summary: A valley with a hut and a pass.
    bind: state.place
    heights:
      - [100, 120, 140, 160]
      - [110, 90, 100, 170]
      - [120, 95, 105, 180]
      - [130, 150, 170, 190]
    annotations:
      - { id: hut, label: Hut, at: [0.4, 0.5] }
      - { id: pass, label: Pass, at: [0.9, 0.9] }
  - type: select
    label: Place
    bind: state.place
    options: [{ value: hut, label: Hut }, { value: pass, label: Pass }, { value: home, label: Overview }]
```

Fallback: without JS or WebGL, and in print, a shaded drawing of the block under
the live camera with numbered pins, the elevation legend (ramp, range, contour
interval, vertical scale and sample count) and the place list. Fixtures:
`fixtures/3d/terrain-3d-alpine.yaml`, `terrain-3d-crater.yaml`.

## timeline-3d

`timeline-3d` lays milestones out in order along a glowing path in space and
flies the camera from one to the next.

Minimal:

```yaml
- type: timeline-3d
  summary: Two spaceflight firsts.
  milestones:
    - { id: sputnik, label: Sputnik 1, date: '1957' }
    - { id: apollo-11, label: Apollo 11, date: '1969' }
```

Full:

```yaml
- type: timeline-3d
  summary: Spaceflight milestones from Sputnik to JWST.
  bind: state.milestone   # chosen milestone id; a state value flies to it
  layout: auto            # auto (default), ribbon, spiral or line
  milestones:             # 2-200, in time order
    - { id: sputnik, date: 1957-10-04, label: Sputnik 1, tone: info, description: The first satellite. }
    - { id: apollo-11, date: 1969-07-20, label: Apollo 11, tone: warning }
```

- `auto` lays up to 18 milestones along a swaying, climbing ribbon and coils
  more into a rising spiral at even spacing. The path is lit up to the current
  milestone; later milestones are faded.
- Ids are unique. A `date` is shown as written; ISO-like dates (`1969`,
  `1969-07`, `1969-07-20`) must run in order, or compiling fails naming the
  milestone. Free text such as `Q3` is never ordered.
- The page opens on the overview. Prev and Next, the scrubber, the milestone
  list, a click or tap on a marker, the canvas keys (Right/`n`/Enter/Page Down
  forward, Left/`p`/Page Up back, Home and End, Escape or `o` for the
  overview) and a change to `bind` choose a milestone; the narrative card
  (step, date, name, description) follows and is announced politely. The list
  is one tab stop whose arrow keys, Home and End move the selection. A choice
  writes the id to `bind` and fires `select` with `{ value }`.
- With reduced motion the camera moves at once.

State:

```yaml
version: 1
meta: { title: Spaceflight }
state: { milestone: apollo-11 }
blocks:
  - type: timeline-3d
    summary: Two spaceflight firsts.
    bind: state.milestone
    milestones:
      - { id: sputnik, label: Sputnik 1, date: '1957' }
      - { id: apollo-11, label: Apollo 11, date: '1969' }
  - type: select
    label: Milestone
    bind: state.milestone
    options: [{ value: sputnik, label: Sputnik 1 }, { value: apollo-11, label: Apollo 11 }]
```

Fallback: without JS or WebGL, and in print, a drawing of the path from the
overview camera with the current milestone ringed, the narrative card and the
ordered list. Fixtures: `fixtures/3d/timeline-3d-space.yaml`,
`timeline-3d-hundred.yaml`.
