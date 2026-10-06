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
It also rejects markup that writes a `nonce` attribute or any `data-ak-*`
attribute (the page and its runtime use those as hooks), and any `<style>`
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
  `prefers-reduced-motion: reduce`, `motion-policy: none` and in print, so the
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
