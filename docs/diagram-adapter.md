# Diagram adapter

AK Render does not lay out diagrams. A host that owns a typed diagram compiler —
AgentKit's Engineer install provides `ak:diagram` — registers an adapter, and
every `diagram-panel` block renders through it. Everything else keeps the
structured semantic fallback.

```ts
import { compile, type DiagramAdapter } from '@bestagentkits/render';

const akDiagram: DiagramAdapter = {
  name: 'ak-diagram',
  version: '1.0.0',
  render({ spec, title }) {
    const result = akDiagramCompiler.compile(spec, { title });
    return result.ok ? result.svg : undefined; // undefined means "fall back"
  },
};

const { html } = compile(pageSpec, { diagramAdapter: akDiagram });
```

## Contract

```ts
interface DiagramRenderRequest {
  readonly spec: JsonValue;   // the block's spec, exactly as authored
  readonly title: string;
  readonly nodeId: string;    // stable, usable as a cache key
  readonly contractVersion: 1 | 2; // the adapter's `contract`, or 1
}

interface DiagramAdapter {
  readonly name: string;
  readonly version: string;
  readonly contract?: 1 | 2;
  render(request: DiagramRenderRequest): string | DiagramRenderResult | undefined;
}
```

The request carries only the block's own data. An adapter never receives the
page, the theme, or the surrounding markup, so it cannot influence anything
outside its own figure.

Returning `undefined`, or throwing, means "fall back". Neither fails the
compile: a broken or absent adapter degrades the page.

## Contract 2: semantic manifest

An adapter that declares `contract: 2` receives `contractVersion: 2` and may
return a result instead of a bare string (a string still works and is treated
as contract 1 output):

```ts
const akDiagram: DiagramAdapter = {
  name: 'ak-diagram',
  version: '3.1.0',
  contract: 2,
  render({ spec, title }) {
    const out = akDiagramCompiler.compile(spec, { title });
    if (!out.ok) return undefined;
    return {
      svg: out.svg,
      manifest: {
        version: 2,
        // No `element`: matched by `data-node-id` / `data-edge-id`, which
        // ak:diagram already writes.
        nodes: out.nodes.map((node) => ({ id: node.id })),
        edges: out.edges.map((edge) => ({ from: edge.source, to: edge.target, id: edge.id })),
        groups: out.frames.map((frame) => ({ id: frame.id, element: frame.elementId })),
      },
      capabilities: { focus: true, trace: true, zoom: true, search: true },
    };
  },
};
```

| Field | Meaning |
| --- | --- |
| `nodes[].id` | A node id the spec declares. |
| `edges[].from`, `to` | A relationship the spec declares. Two declared relationships between the same pair may be drawn twice; a third may not. |
| `edges[].index` | Optional position of the relationship in the spec's list. Use it when the spec declares several relationships between the same pair with different labels; otherwise they are matched in declaration order. |
| `groups[].id` | A boundary, lane or stage id the spec declares. |
| `element` | The drawn element's `id`. Without it, a node binds the element whose `data-node-id` is its id, a relationship the element whose `data-edge-id` is its `id`, a group the element whose `data-group-id` is its id. |
| `capabilities` | Any of `focus`, `trace`, `zoom`, `search` set to `true`. Other keys are ignored. |

The compiler checks the result in this order, and any failure emits the
semantic fallback with a warning naming the reason:

1. the SVG passes the [trust boundary](#trust-boundary) exactly like contract 1
   markup;
2. the manifest has the shape above, at most 400 nodes, 1200 relationships and
   100 groups, and element references are plain tokens;
3. every node, relationship and group is one the spec declares
   (`semantic-graph.ts`) and none is listed twice, so a drawing can never claim
   a relationship the spec does not state;
4. every entry binds exactly one element.

Then it writes its own hooks onto the bound elements: `data-ak-node`,
`data-ak-edge` with `data-ak-from` and `data-ak-to`, `data-ak-group` with
`data-ak-members`, and a `data-ak-label` taken from the spec, never from the
adapter. Every `id` in the drawing, and every `href="#…"`, `url(#…)` and
`aria-labelledby`/`aria-describedby` reference to one, is prefixed with the
panel scope, so two diagrams on a page never share an id. Drawn ids must be
plain tokens (`[A-Za-z][A-Za-z0-9_.:-]*`). Style a contract 2 drawing by class,
not by `#id` selector: id selectors no longer match once ids are scoped. The canvas carries
`data-ak-diagram-contract="2"` and the declared capabilities, which the
compiler-owned viewer and diagram motion read. A manifest may list only part
of the drawing; what it leaves out stays static.

## Trust boundary

Adapter output is verified before it is embedded. `checkAdapterMarkup` rejects
script, iframe, object, embed, `foreignObject`, `base`, and `form` elements,
moving elements that no stylesheet can stop under reduced motion or in print
(`marquee` and the SMIL `animate`, `animateTransform`, `animateMotion`, `set`
and `discard`), any `on*` handler, `javascript:` URLs, `data:text/html` URLs, `srcdoc`, CSS
`@import`, remote CSS `url()` references, empty output, and output over 256 KB.
It also rejects markup that writes a `nonce` attribute or any `data-ak-*`
attribute (the page and its runtime use those as hooks), an `href`,
`xlink:href`, `src` or `srcset` (in any case) whose value is not a literal
same-document fragment such as `#arrow`, and any `<style>`
element whose stylesheet breaks the rules in
[Styling adapter output](#styling-adapter-output).

The markup must also be a self-contained fragment, read the same way a browser
would read it:

- every element is closed, in order, inside the fragment, and no end tag closes
  an element the fragment did not open, so the drawing can neither close the
  page's own elements nor swallow what follows it;
- no element that switches the parser into raw text or merges into the page
  document: `plaintext`, `textarea`, `xmp`, `noembed`, `noframes`, `noscript`,
  `template`, `html`, `head`, `body`, `frameset`, `frame`, `meta`, `link` and
  `math`, and `title` outside SVG;
- no HTML element that would break out of SVG (`div`, `p`, `span`, `table`
  and the rest of the parser's list) inside an `<svg>`, and no self-closing
  HTML element such as `<div/>`, which HTML leaves open;
- no comment, CDATA section, doctype or XML declaration (`<!` or `<?`), and no
  tag the check cannot parse.

A rejection emits the semantic fallback and a warning naming the adapter and
the reason. The check is linear in the size of the markup.

This is the same posture the page itself takes, and it is the reason an adapter
cannot become an escape hatch around the "no raw script, no inline handler, no
arbitrary frame" contract. The check is exported so adapter authors can assert
the same contract in their own tests.

## Styling adapter output

The page's Content Security Policy allows styles only by nonce
(`style-src 'nonce-…'`, never `'unsafe-inline'`). Accepted adapter markup is
fitted to that policy before it is embedded:

- **`<style>` elements work, inside the diagram only.** Each one receives the
  page style nonce, so the browser applies it, and its stylesheet is wrapped in
  `@scope` rooted at the diagram's canvas (a `div.ak-diagram-canvas` with a
  `data-ak-diagram-scope` token unique to the panel). A selector matches only
  inside that canvas: `.node` styles your nodes, while `.ak-shell`, `:root` or
  `body` match nothing. `:scope` is the canvas itself. The panel around it
  contains paint, so even a `position: fixed` element stays inside the panel.
  Browsers without `@scope` (Firefox before 146) drop the stylesheet and draw
  the SVG with its presentation attributes only; this is an accepted
  degradation, so prefer `fill` and `stroke` attributes for anything the
  drawing needs to read.
- **Inline `style="…"` attributes do not.** The policy refuses them, and a
  nonce cannot be attached to an attribute. They are removed before embedding,
  and the compile returns a warning naming the adapter and how many were
  removed. Move those declarations into a `<style>` element, or use SVG
  presentation attributes such as `fill` and `stroke`, which the policy does not
  govern.
- **Adapter CSS cannot load anything or hide a token.** A stylesheet may use
  rules, nesting, strings, `@media`, `@supports` and `@keyframes`, and
  `url(#id)` to point at a gradient, pattern, marker or filter in the same
  drawing. The output is rejected when a stylesheet contains:
  - any other at-rule, including `@import`, `@font-face`, `@namespace`,
    `@layer`, `@property` and a nested `@scope`;
  - `url()` with anything but a `#fragment`, or `image-set()`, `image()`,
    `src()`, `cross-fade()`, `element()`, `paint()` or `expression()`;
  - a backslash escape, an HTML character reference such as `&#64;` (also
    inside a comment), or markup (`<`, including CDATA and `<!--`);
  - a `!` other than `!important`;
  - unbalanced brackets, or an unterminated string or comment;
  - a `@keyframes` name the page itself defines, such as `ak-rise` or
    `ak-fade`. Other names, including other `ak-` names, are fine.

  Two things are removed rather than rejected, because diagram compilers emit
  them and removing them only takes power away: comments (each becomes a
  space) and `!important`, which would otherwise outrank the page's motion and
  print guards.

  A `<style>` element must be plain text that runs straight to its `</style>`
  end tag; a self-closing `<style/>` is rejected.
- **Motion decorates.** Adapter animation and transitions stop under
  `prefers-reduced-motion: reduce`, `motion-policy: reduced` or `none` and in print, so the
  drawing must read completely in its unanimated state. Keyframes names are
  page-wide, so two panels from the same adapter share them.

## The fallback is always present

`diagram-panel` always emits a structured description — the components, the
connections, and the title — derived from the diagram spec. With no adapter it
is the whole rendering. With an adapter it stays in the document as the text
equivalent, folded behind a closed "Text description" disclosure so it does not
repeat the drawing beside it; a reader opens it on demand, and find-in-page and
assistive technology still reach it. In print the description is shown open:
the print stylesheet opens it through `::details-content`, and where a browser
lacks that selector the runtime opens it for the print and folds it again
afterwards.

The description reads every ak:diagram archetype the same way the adapter does
(`src/diagram/semantic-graph.ts`), and shows only what the spec declares:

| `diagram_type` | Nodes | Relationships (label fields) | Groups |
| --- | --- | --- | --- |
| `architecture` | `components` | `connections` (`label`, `protocol`) | `boundaries[].components` |
| `workflow` | `steps` | `transitions` (`label`, `condition`) | `lanes`, by `step.lane` |
| `sequence` | `participants` | `messages`, numbered in order (`label`) | — |
| `dataflow` | `nodes` | `flows` (`label`, `schema_type`) | `stages` by `order`, by `node.stage` |
| `lifecycle` | `states` | `transitions` (`event`, `action`) | `lanes`, by `state.lane` |
| none or other | `components`, `nodes` | `connections`, `edges` (`label`) | — |

A simple chain without groups is drawn as a flow; anything else lists the
groups with their members, then every relationship. `validate` warns at the
exact spec path when a relationship, lane, stage or boundary member names an
undeclared id, when a node id repeats or is missing, when a typed diagram has
no nodes, and when `diagram_type` is not one of the archetypes above. The
hosted renderer has no adapter, so this description is what its pages show.

## Size and scrolling

Adapter output is shown at its natural size. A diagram wider than the column is
not shrunk to fit, because that makes its labels unreadable; it scrolls
sideways inside its panel instead. The panel is a named region (`role="region"`
labelled with the diagram title) with `tabindex="0"`, so the arrow keys scroll
it, and a soft shade on an edge shows there is more in that direction. Give the
root `<svg>` explicit `width` and `height` (or a `viewBox` the column can fill)
at the size the labels read well. In print the drawing is scaled to the page
width.

## AgentKit integration

The Engineer path installs `ak:diagram` and registers an adapter backed by its
typed compiler, embedding only that compiler's output. Core and Marketing
installs have no adapter and therefore keep the semantic fallback. No paid
diagram compiler is copied into this package; the dependency direction is that
AK Render defines the boundary and the host supplies the implementation.

## The viewer

A contract 2 result that declares capabilities gets a viewer. It reads only the hooks the compiler wrote while binding the manifest, never adapter selectors.

| Capability | What the reader gets |
| --- | --- |
| `focus` | Select a node (click, Enter or Space) to highlight its neighbours and dim the rest; a details panel lists the connections as buttons and offers everything downstream. Clicking a relationship inspects it. |
| `trace` | Shift+select a second node to highlight the shortest directed route, or a note that none exists. |
| `search` | A find box that matches labels and ids, ignoring case and diacritics; Enter selects the first match. |
| `zoom` | Zoom out, zoom in, Fit and 1:1 buttons, `+`, `-`, `0` and `f` on the focused scroller, Ctrl+wheel, and drag to pan when the drawing is wider than the panel. |

Escape or Clear resets the view. The selection or route is kept in the link as `#<panel>:node:<id>` or `#<panel>:route:<from>:<to>`, so a shared link opens on it. The controls ship hidden and the runtime reveals them, so without script the drawing and its text description read as before; print drops the controls and the dimming. The only transition, the dimming, sits behind the motion guard.

## Golden cases and baseline

`tests/unit/support/diagram-golden.ts` holds 22 diagram shapes: one node, chains, branches, fan-out and fan-in, a diamond, cycles, bidirectional and parallel relationships, a dense graph, disconnected parts, long Vietnamese labels, markup-like labels, empty labels, nested boundaries, a 60-node drawing, and the workflow, sequence, dataflow and lifecycle archetypes. They are drawn with the reference grid adapter.

- `tests/unit/diagram-golden.test.ts` checks each case:
  - it compiles to the same bytes every time;
  - every declared node is drawn exactly once;
  - exactly the declared relationships appear, in spec order, so nothing is fabricated;
  - ids are unique and labels stay inert;
  - its canvas digest matches the snapshot.

  It also checks that every built-in preset leaves the drawing unchanged.
- `tests/browser/diagram-golden.spec.ts` opens each case at 1440 and 375. It checks:
  - no console errors and no network requests;
  - no sideways page scroll;
  - no node outside its drawing and no overlapping nodes;
  - an accessible name on every node;
  - node geometry against `tests/browser/diagram-golden.geometry.json`.

  It also covers print, no script, every preset in light and dark, and motion under full, reduced and `none`.
- `AK_RECORD_DIAGRAM_BASELINE=1 npx playwright test tests/browser/diagram-golden.spec.ts` records the geometry and [docs/artifacts/diagram-baseline.json](./artifacts/diagram-baseline.json). That file holds compile time, HTML bytes, DOM size and JS heap for small to 60-node drawings. It is a baseline for later thresholds, not a threshold.

## Export and Motion Studio

`exportDiagramSvg(spec, { diagramAdapter, blockId?, scheme? })` returns one
standalone SVG of a contract 2 drawing: the theme colours are written onto the
root, scoped styles are unwrapped, nonces, scripts and motion state are
dropped, and the output is deterministic. A page or block with no contract 2
drawing fails with `SPEC_VALIDATION_ERROR`; there is no fallback picture to
fake.

Any capture tool can stop diagram motion first: `window.akRenderDiagram.freeze()`
halts the governor, ends sequence playback and clears every viewer selection, so
a screenshot shows the settled drawing. It is a capture-only API: motion stays
stopped until the page reloads.

PNG export waits on the shared page export (`src/export/page-export.ts`), which
will call this freeze hook; until it lands, render the SVG with any rasteriser.
WebM recording was investigated and not built: it needs a browser at export
time, which breaks the offline compile, so it stays an opt-in idea.

Motion Studio takes the same `diagramAdapter`, offers the diagram recipes on a
`diagram-panel`, and its inspector reports the drawing it previews (nodes,
relationships, groups and capabilities) or says that nothing is drawn. Export
and the adapter are library APIs; the CLI has no adapter to pass.
