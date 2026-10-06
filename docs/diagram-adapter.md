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
  readonly contractVersion: 1;
}

interface DiagramAdapter {
  readonly name: string;
  readonly version: string;
  render(request: DiagramRenderRequest): string | undefined;
}
```

The request carries only the block's own data. An adapter never receives the
page, the theme, or the surrounding markup, so it cannot influence anything
outside its own figure.

Returning `undefined`, or throwing, means "fall back". Neither fails the
compile: a broken or absent adapter degrades the page.

## Trust boundary

Adapter output is verified before it is embedded. `checkAdapterMarkup` rejects
script, iframe, object, embed, `foreignObject`, `base`, and `form` elements, any
`on*` handler, `javascript:` URLs, `data:text/html` URLs, `srcdoc`, CSS
`@import`, remote CSS `url()` references, empty output, and output over 256 KB.
A rejection emits the semantic fallback and a warning naming the adapter and the
reason.

This is the same posture the page itself takes, and it is the reason an adapter
cannot become an escape hatch around the "no raw script, no inline handler, no
arbitrary frame" contract. The check is exported so adapter authors can assert
the same contract in their own tests.

## Styling adapter output

The page's Content Security Policy allows styles only by nonce
(`style-src 'nonce-…'`, never `'unsafe-inline'`). Accepted adapter markup is
fitted to that policy before it is embedded:

- **`<style>` elements work.** Each one receives the page style nonce, so the
  browser applies it. Any `nonce` the adapter wrote is replaced. The stylesheet
  is page-wide like any other, so scope selectors under your SVG's own class
  (for example `.ak-diagram-svg .node`).
- **Inline `style="…"` attributes do not.** The policy refuses them, and a
  nonce cannot be attached to an attribute. They are removed before embedding,
  and the compile returns a warning naming the adapter and how many were
  removed. Move those declarations into a `<style>` element, or use SVG
  presentation attributes such as `fill` and `stroke`, which the policy does not
  govern.
- Adapter CSS cannot `@import` another stylesheet or reference a remote
  `url()`; output that does is rejected (see above).

## The fallback is always present

`diagram-panel` always emits a structured description — the components, the
connections, and the title — derived from the diagram spec. With no adapter it
is the whole rendering. With an adapter it stays in the document as the text
equivalent, folded behind a closed "Text description" disclosure so it does not
repeat the drawing beside it; a reader opens it on demand, and find-in-page and
assistive technology still reach it.

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
