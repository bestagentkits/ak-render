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
`on*` handler, `javascript:` URLs, `data:text/html` URLs, `srcdoc`, empty output,
and output over 256 KB. A rejection emits the semantic fallback and a warning
naming the adapter and the reason.

This is the same posture the page itself takes, and it is the reason an adapter
cannot become an escape hatch around the "no raw script, no inline handler, no
arbitrary frame" contract. The check is exported so adapter authors can assert
the same contract in their own tests.

## The fallback is always present

`diagram-panel` always emits a structured description — the components, the
connections, and the title — derived from the diagram spec. With no adapter it
is the whole rendering; with an adapter it stays in the document as the text
equivalent, so assistive technology and a reader without the adapter both get
the content.

## AgentKit integration

The Engineer path installs `ak:diagram` and registers an adapter backed by its
typed compiler, embedding only that compiler's output. Core and Marketing
installs have no adapter and therefore keep the semantic fallback. No paid
diagram compiler is copied into this package; the dependency direction is that
AK Render defines the boundary and the host supplies the implementation.
