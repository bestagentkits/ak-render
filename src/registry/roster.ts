/**
 * The block roster.
 *
 * Each entry is the machine-readable contract the issue requires: stable type
 * and version, purpose, compact prompt-facing summary, props schema with
 * defaults and bounds, slots and child constraints, responsive sizing behavior,
 * accessibility contract, supported actions, runtime features, network
 * capability, migration policy, and serializer behavior.
 *
 * The roster is data. Rendering lives in the renderer; validation, the JSON
 * Schema, and `catalog()`/`describe()` all derive from these definitions so they
 * cannot drift apart.
 */

import { EMBED_PROVIDER_NAMES } from '../spec/providers.js';
import type { ActionType } from './actions.js';
import type { PropSchema } from './prop-schema.js';

export type RuntimeFeature =
  | 'tabs'
  | 'accordion'
  | 'carousel'
  | 'slider'
  | 'copy'
  | 'filter'
  | 'theme'
  | 'dialog'
  | 'chart'
  | 'diagram'
  | 'media';

export interface SlotSpec {
  /** Types accepted by the slot; `'*'` accepts any block. */
  accepts: readonly string[] | '*';
  min?: number;
  max?: number;
}

export interface SizingContract {
  /** Semantic sizes the block supports. */
  sizes: readonly string[];
  default: string;
  /** How the block resolves available space. */
  responsive: string;
}

export interface BlockDefinition {
  type: string;
  version: number;
  kind: 'semantic' | 'primitive';
  purpose: string;
  /** One line, used by the compact `catalog()` surface. */
  summary: string;
  props: Record<string, PropSchema>;
  slots?: Record<string, SlotSpec>;
  sizing: SizingContract;
  a11y: string;
  actions: readonly ActionType[];
  runtimeFeatures: readonly RuntimeFeature[];
  /** Emitted assets the block needs, beyond the shared base stylesheet. */
  assets: readonly string[];
  network: 'none' | 'optional';
  migration: string;
  serializer: string;
}

const DEFAULT_MIGRATION =
  'Props are additive; removed props are reported as diagnostics, never silently dropped.';
const DEFAULT_SERIALIZER =
  'Serializes back to the same Page Spec shape; child blocks keep their order and slots.';
const DEFAULT_SIZING: SizingContract = {
  sizes: ['medium', 'large'],
  default: 'medium',
  responsive: 'Fills its parent slot and reflows its content; never clips or scales by transform.',
};

const str = (o: Omit<PropSchema & { kind: 'string' }, 'kind'> = {}): PropSchema => ({
  kind: 'string',
  ...o,
});
const txt = (
  o: { required?: boolean; default?: string; maxLength?: number; description?: string } = {},
): PropSchema => ({
  kind: 'text',
  ...o,
});
const num = (
  o: {
    required?: boolean;
    default?: number;
    min?: number;
    max?: number;
    integer?: boolean;
    description?: string;
  } = {},
): PropSchema => ({ kind: 'number', ...o });
const urlProp = (
  o: { required?: boolean; schemes?: readonly string[]; description?: string } = {},
): PropSchema => ({
  kind: 'url',
  ...o,
});
const list = (
  of: PropSchema,
  o: { required?: boolean; minItems?: number; maxItems?: number; description?: string } = {},
): PropSchema => ({ kind: 'list', of, ...o });
const obj = (
  fields: Record<string, PropSchema>,
  o: { required?: boolean; description?: string } = {},
): PropSchema => ({ kind: 'object', fields, ...o });
const oneOf = (
  options: readonly PropSchema[],
  o: { required?: boolean; description?: string } = {},
): PropSchema => ({ kind: 'oneOf', options, ...o });
const enumStr = (
  values: readonly string[],
  o: { required?: boolean; default?: string; description?: string } = {},
): PropSchema => ({
  kind: 'string',
  enum: values,
  ...o,
});
const idProp = (description: string): PropSchema => ({ kind: 'string', id: true, description });
const actionMap = (description: string): PropSchema => ({
  kind: 'json',
  description,
  maxBytes: 8_000,
  schemaRef: '#/$defs/actionMap',
});

/** Reusable prop fragments. */
const onProp = (description = 'Declarative action bindings for this block.'): PropSchema =>
  actionMap(description);

const anchorProps: Record<string, PropSchema> = {
  id: idProp('Stable node id. Author-provided ids are used verbatim and must be unique.'),
};

const itemsOf = (
  fields: Record<string, PropSchema>,
  o: { minItems?: number; maxItems?: number } = {},
): PropSchema =>
  list(obj(fields), { required: true, minItems: o.minItems ?? 1, maxItems: o.maxItems ?? 200 });

const TITLE = str({ required: true, maxLength: 200 });
const OPTIONAL_TITLE = str({ maxLength: 200 });
const LABEL = str({ required: true, maxLength: 200 });

/** Chart kinds, SVG-first and deterministic. */
export const CHART_KINDS = [
  'bar',
  'line',
  'area',
  'pie',
  'donut',
  'sparkline',
  'progress',
] as const;

function define(
  specification: Partial<BlockDefinition> &
    Pick<BlockDefinition, 'type' | 'purpose' | 'summary' | 'props'>,
): BlockDefinition {
  return {
    version: 1,
    kind: 'primitive',
    sizing: DEFAULT_SIZING,
    a11y: 'Renders semantic markup; text alternatives come from the authored content.',
    actions: [],
    runtimeFeatures: [],
    assets: [],
    network: 'none',
    migration: DEFAULT_MIGRATION,
    serializer: DEFAULT_SERIALIZER,
    ...specification,
  };
}

function semantic(
  specification: Partial<BlockDefinition> &
    Pick<BlockDefinition, 'type' | 'purpose' | 'summary' | 'props'>,
): BlockDefinition {
  return define({ kind: 'semantic', ...specification });
}

export const BLOCK_DEFINITIONS: readonly BlockDefinition[] = [
  // --- root ---------------------------------------------------------------
  define({
    type: 'page',
    kind: 'semantic',
    purpose: 'The document root. Synthesized by the normalizer from the spec envelope.',
    summary: 'Page root: title, description, locale, and top-level blocks.',
    props: {
      title: str({ required: true, maxLength: 200 }),
      description: str({ maxLength: 400 }),
      locale: str({ maxLength: 35, default: 'en' }),
    },
    slots: { children: { accepts: '*', min: 1, max: 200 } },
    a11y: 'Emits one <main> landmark, a document <title>, and a language attribute.',
  }),

  // --- layout primitives --------------------------------------------------
  define({
    type: 'section',
    purpose: 'A titled group of blocks.',
    summary: 'Section with an optional heading wrapping child blocks.',
    props: { title: OPTIONAL_TITLE, ...anchorProps },
    slots: { children: { accepts: '*', min: 1, max: 200 } },
  }),
  define({
    type: 'stack',
    purpose: 'Vertical flow container.',
    summary: 'Stack: children flow vertically with a controlled gap.',
    props: { gap: enumStr(['tight', 'normal', 'loose'], { default: 'normal' }), ...anchorProps },
    slots: { children: { accepts: '*', min: 1, max: 200 } },
  }),
  define({
    type: 'grid',
    purpose: 'Responsive grid container.',
    summary: 'Grid: children in N columns that collapse on narrow viewports.',
    props: {
      columns: num({ integer: true, min: 1, max: 6, default: 3 }),
      ...anchorProps,
    },
    slots: { children: { accepts: '*', min: 1, max: 200 } },
  }),
  define({
    type: 'split',
    purpose: 'Two-column split container.',
    summary: 'Split: two child groups side by side, stacking when narrow.',
    props: {
      ratio: enumStr(['even', 'wide-left', 'wide-right'], { default: 'even' }),
      ...anchorProps,
    },
    slots: { children: { accepts: '*', min: 2, max: 2 } },
  }),
  define({
    type: 'spacer',
    purpose: 'Vertical rhythm spacer.',
    summary: 'Spacer: vertical space without content.',
    props: { size: enumStr(['small', 'medium', 'large'], { default: 'medium' }), ...anchorProps },
    a11y: 'Presentational only; hidden from assistive technology.',
  }),
  define({
    type: 'divider',
    purpose: 'Horizontal rule with an optional label.',
    summary: 'Divider: semantic separator with an optional label.',
    props: { label: str({ maxLength: 120 }), ...anchorProps },
    a11y: 'Renders <hr>; a label is exposed as text, never as the only separator cue.',
  }),

  // --- typography and content --------------------------------------------
  define({
    type: 'heading',
    purpose: 'Section heading at a chosen level.',
    summary: 'Heading: h1–h6 with the author-chosen level.',
    props: {
      level: num({ integer: true, min: 1, max: 6, default: 2 }),
      text: TITLE,
      ...anchorProps,
    },
    a11y: 'Heading levels are preserved as authored; the compiler warns on skipped levels.',
  }),
  define({
    type: 'text',
    purpose: 'A paragraph, lead sentence, or caption.',
    summary: 'Text: single paragraph with body, lead, or caption treatment.',
    props: {
      variant: enumStr(['body', 'lead', 'caption'], { default: 'body' }),
      text: txt({ required: true }),
      ...anchorProps,
    },
  }),
  define({
    type: 'rich-text',
    purpose: 'Multi-paragraph prose.',
    summary: 'RichText: multiple paragraphs from line breaks.',
    props: { text: txt({ required: true }), ...anchorProps },
  }),
  define({
    type: 'quote',
    purpose: 'Pulled quotation.',
    summary: 'Quote: blockquote with an optional attribution.',
    props: { text: txt({ required: true }), cite: str({ maxLength: 200 }), ...anchorProps },
  }),
  define({
    type: 'code',
    purpose: 'Code or configuration sample.',
    summary: 'Code: preformatted block with optional language and copy target.',
    props: {
      language: str({ maxLength: 32, default: 'text' }),
      title: OPTIONAL_TITLE,
      text: txt({ required: true, maxLength: 100_000 }),
      ...anchorProps,
    },
    assets: ['code'],
    a11y: 'Renders <pre><code> with the authored text; no syntax highlighting requires network access.',
    serializer:
      'Emits the code text verbatim inside the fenced block when serialized back to Markdown.',
  }),
  define({
    type: 'badge',
    purpose: 'Short status or category label.',
    summary: 'Badge: inline status chip.',
    props: {
      text: str({ required: true, maxLength: 60 }),
      tone: enumStr(['neutral', 'info', 'success', 'warning', 'danger'], { default: 'neutral' }),
      ...anchorProps,
    },
  }),
  define({
    type: 'kbd',
    purpose: 'Keyboard key sequence.',
    summary: 'Kbd: one or more keys rendered as <kbd> elements.',
    props: {
      keys: list(str({ maxLength: 24 }), { required: true, minItems: 1, maxItems: 8 }),
      ...anchorProps,
    },
    a11y: 'Keys are read as text in order, not as an image.',
  }),
  define({
    type: 'key-value',
    purpose: 'Compact definition list.',
    summary: 'KeyValue: label/value pairs rendered as a description list.',
    props: {
      title: OPTIONAL_TITLE,
      items: itemsOf({ key: LABEL, value: str({ required: true, maxLength: 400 }) }),
      ...anchorProps,
    },
    a11y: 'Renders <dl> with <dt>/<dd> pairs.',
  }),

  // --- information --------------------------------------------------------
  define({
    type: 'card',
    purpose: 'Bounded content container.',
    summary: 'Card: titled container that holds child blocks.',
    props: { title: OPTIONAL_TITLE, text: txt(), ...anchorProps },
    slots: { children: { accepts: '*', min: 0, max: 40 } },
  }),
  define({
    type: 'alert',
    purpose: 'Inline notice.',
    summary: 'Alert: notice with tone and title.',
    props: {
      tone: enumStr(['info', 'success', 'warning', 'danger'], { default: 'info' }),
      title: TITLE,
      text: txt({ required: true }),
      ...anchorProps,
    },
    a11y: 'Danger and warning tones use role="alert"; informational tones are not announced.',
  }),
  semantic({
    type: 'callout',
    purpose: 'Emphasized aside for a key point or risk.',
    summary: 'Callout: highlighted aside with tone, title, and body.',
    props: {
      tone: enumStr(['info', 'success', 'warning', 'danger'], { default: 'info' }),
      title: TITLE,
      text: txt({ required: true }),
      ...anchorProps,
    },
  }),
  semantic({
    type: 'hero',
    purpose: 'Page opener that states the artifact subject.',
    summary: 'Hero: eyebrow, title, and one-line description.',
    props: {
      eyebrow: str({ maxLength: 80 }),
      title: TITLE,
      description: txt(),
      ...anchorProps,
    },
    sizing: {
      sizes: ['medium', 'large'],
      default: 'large',
      responsive: 'Full width; text reflows.',
    },
    a11y: 'The hero title is an <h1>; the eyebrow is supporting text, not a heading.',
  }),
  semantic({
    type: 'stats',
    purpose: 'KPI or summary figures.',
    summary: 'Stats: labeled values as a figure list.',
    props: {
      title: OPTIONAL_TITLE,
      items: itemsOf({ label: LABEL, value: str({ required: true, maxLength: 60 }) }),
      ...anchorProps,
    },
    a11y: 'Each figure pairs its label and value as text; no color-only meaning.',
  }),
  define({
    type: 'progress',
    purpose: 'Single progress or completeness value.',
    summary: 'Progress: single bar with an accessible value range.',
    props: {
      label: LABEL,
      value: num({ required: true, min: 0, max: 1_000_000 }),
      max: num({ min: 1, max: 1_000_000, default: 100 }),
      ...anchorProps,
    },
    runtimeFeatures: ['chart'],
    a11y: 'Renders role="progressbar" with aria-valuenow/min/max and a text value.',
  }),
  semantic({
    type: 'steps',
    purpose: 'Ordered procedure.',
    summary: 'Steps: numbered sequence of titled steps.',
    props: {
      title: OPTIONAL_TITLE,
      items: itemsOf({ title: LABEL, text: txt() }),
      ...anchorProps,
    },
    a11y: 'Renders an ordered list so sequence is conveyed without numbering characters.',
    serializer: 'Serializes to an ordered Markdown list.',
  }),
  semantic({
    type: 'timeline',
    purpose: 'Chronological or staged events.',
    summary: 'Timeline: ordered entries with a when/title/body shape.',
    props: {
      title: OPTIONAL_TITLE,
      items: itemsOf({ when: str({ required: true, maxLength: 80 }), title: LABEL, text: txt() }),
      ...anchorProps,
    },
    a11y: 'Ordered list; the `when` value is text, not a colour or position cue.',
  }),

  // --- collections --------------------------------------------------------
  define({
    type: 'list',
    purpose: 'Short item list with optional badges.',
    summary: 'List: bulleted items with optional status badges.',
    props: {
      title: OPTIONAL_TITLE,
      items: itemsOf({ text: txt({ required: true }), badge: str({ maxLength: 40 }) }),
      ...anchorProps,
    },
    runtimeFeatures: ['filter'],
    actions: ['filter'],
    a11y: 'Renders <ul>; filtering also hides items from assistive technology and announces the count.',
  }),
  semantic({
    type: 'card-grid',
    purpose: 'Grid of short cards.',
    summary: 'CardGrid: titled cards in a responsive grid.',
    props: {
      title: OPTIONAL_TITLE,
      items: itemsOf({ title: LABEL, text: txt() }),
      ...anchorProps,
    },
  }),
  define({
    type: 'table',
    purpose: 'Tabular data with a header row.',
    summary: 'Table: columns and rows with a real header row.',
    props: {
      title: OPTIONAL_TITLE,
      columns: list(str({ maxLength: 120 }), { required: true, minItems: 1, maxItems: 12 }),
      rows: list(list(str({ maxLength: 400 })), { required: true, maxItems: 500 }),
      ...anchorProps,
    },
    a11y: 'Renders <table> with <thead>/<th scope="col">; rows with the wrong width are a diagnostic.',
    serializer: 'Serializes to a Markdown table.',
  }),
  semantic({
    type: 'comparison',
    purpose: 'Side-by-side comparison of two alternatives.',
    summary: 'Comparison: two labeled columns of points.',
    props: {
      title: OPTIONAL_TITLE,
      left: obj(
        { label: LABEL, items: list(str({ maxLength: 300 }), { required: true, maxItems: 40 }) },
        { required: true },
      ),
      right: obj(
        { label: LABEL, items: list(str({ maxLength: 300 }), { required: true, maxItems: 40 }) },
        { required: true },
      ),
      ...anchorProps,
    },
    a11y: 'Each side is a labeled list; the labels are headings, not just column position.',
  }),
  semantic({
    type: 'risk-matrix',
    purpose: 'Impact/likelihood risk table.',
    summary: 'RiskMatrix: risks rated by impact and likelihood.',
    props: {
      title: OPTIONAL_TITLE,
      severity: list(enumStr(['low', 'medium', 'high']), { maxItems: 5 }),
      items: itemsOf({
        area: LABEL,
        impact: enumStr(['low', 'medium', 'high'], { required: true }),
        likelihood: enumStr(['low', 'medium', 'high'], { required: true }),
        note: txt(),
      }),
      ...anchorProps,
    },
    a11y: 'Ratings are text values in table cells, never colour-only.',
  }),

  // --- interactive collections -------------------------------------------
  define({
    type: 'tabs',
    purpose: 'Tabbed groups of related content.',
    summary: 'Tabs: roving-tabindex tablist with tabpanels.',
    props: {
      title: OPTIONAL_TITLE,
      items: itemsOf(
        { id: idProp('Tab id.'), title: LABEL, text: txt({ required: true }) },
        { minItems: 2 },
      ),
      on: onProp('Optional state binding fired when a tab is selected.'),
      ...anchorProps,
    },
    runtimeFeatures: ['tabs'],
    actions: ['select-tab'],
    a11y: 'role="tablist" with arrow-key roving focus, aria-selected, aria-controls, and labelled tabpanels.',
  }),
  define({
    type: 'accordion',
    purpose: 'Collapsible sections.',
    summary: 'Accordion: disclosure sections that expand and collapse.',
    props: {
      title: OPTIONAL_TITLE,
      items: itemsOf({ title: LABEL, text: txt({ required: true }) }),
      on: onProp('Optional state binding fired when a section toggles.'),
      ...anchorProps,
    },
    runtimeFeatures: ['accordion'],
    actions: ['toggle', 'expand', 'collapse'],
    a11y: 'Native <details>/<summary> where possible; otherwise button + region with aria-expanded.',
  }),
  define({
    type: 'carousel',
    purpose: 'Sequenced slides with manual navigation.',
    summary: 'Carousel: prev/next, keyboard, and swipe across slides.',
    props: {
      ariaLabel: str({ required: true, maxLength: 120 }),
      items: itemsOf({ title: LABEL, text: txt({ required: true }) }, { minItems: 1 }),
      on: onProp('Optional state binding fired when the active slide changes.'),
      ...anchorProps,
    },
    runtimeFeatures: ['carousel'],
    actions: ['next', 'previous'],
    a11y: 'Labeled region with prev/next buttons, arrow-key support, a slide counter, and no autoplay.',
  }),
  semantic({
    type: 'toolbar',
    purpose: 'Row of controls or chips.',
    summary: 'Toolbar: buttons, badges, and links in one accessible row.',
    props: {
      title: OPTIONAL_TITLE,
      items: list(
        oneOf([
          obj({
            type: enumStr(['button'], { required: true }),
            label: LABEL,
            variant: enumStr(['primary', 'secondary', 'ghost'], { default: 'secondary' }),
            on: onProp(),
            id: idProp('Stable node id for the button.'),
          }),
          obj({
            type: enumStr(['badge'], { required: true }),
            text: str({ required: true, maxLength: 60 }),
            tone: enumStr(['neutral', 'info', 'success', 'warning', 'danger'], {
              default: 'neutral',
            }),
          }),
          obj({
            type: enumStr(['link'], { required: true }),
            label: LABEL,
            href: urlProp({ required: true }),
            on: onProp(),
          }),
        ]),
        { required: true, minItems: 1, maxItems: 20 },
      ),
      ...anchorProps,
    },
    runtimeFeatures: ['copy'],
    actions: ['copy', 'open-url', 'download', 'toggle', 'set-value', 'theme'],
    a11y: 'role="toolbar" with roving focus order; every control is a real button or link.',
  }),

  // --- data visualization -------------------------------------------------
  define({
    type: 'chart',
    purpose: 'Deterministic SVG chart with a text summary.',
    summary: 'Chart: bar, line, area, pie, donut, sparkline, or progress from labeled series.',
    props: {
      kind: enumStr(CHART_KINDS, { required: true }),
      title: OPTIONAL_TITLE,
      description: txt(),
      labels: list(str({ maxLength: 80 }), { required: true, minItems: 1, maxItems: 200 }),
      series: itemsOf(
        { label: LABEL, values: list(num(), { required: true, minItems: 1, maxItems: 200 }) },
        { minItems: 1 },
      ),
      ...anchorProps,
    },
    runtimeFeatures: ['chart'],
    assets: ['chart'],
    a11y: 'SVG carries role="img" plus a generated text summary; the same values are available as a table for assistive technology.',
    serializer: 'Serializes to the labels/series data, never to rendered SVG.',
  }),

  // --- diagrams (adapter) -------------------------------------------------
  semantic({
    type: 'diagram-panel',
    purpose: 'Typed diagram rendered through an adapter.',
    summary:
      'DiagramPanel: embeds trusted output from a diagram adapter (ak:diagram when installed).',
    props: {
      title: OPTIONAL_TITLE,
      /** Validated by the adapter, bounded here. */
      spec: {
        kind: 'json',
        required: true,
        description: 'Typed diagram IR (ak:diagram schema).',
        maxBytes: 200_000,
      },
      caption: txt(),
      ...anchorProps,
    },
    runtimeFeatures: ['diagram'],
    assets: ['diagram'],
    actions: ['toggle', 'filter'],
    a11y: 'Requires a textual fallback summary when the adapter cannot render; the fallback is always emitted.',
    migration:
      'Adapter contract is versioned separately; a spec that no longer compiles degrades to the fallback.',
  }),

  // --- media --------------------------------------------------------------
  define({
    type: 'image',
    purpose: 'Single image or picture.',
    summary: 'Image: local asset or allowlisted URL with required alt text.',
    props: {
      src: urlProp({ required: true }),
      alt: str({ required: true, maxLength: 300 }),
      caption: txt(),
      ...anchorProps,
    },
    network: 'optional',
    assets: ['media'],
    a11y: 'Alt text is required; decorative images must use an empty alt explicitly.',
  }),
  semantic({
    type: 'gallery',
    purpose: 'Image grid.',
    summary: 'Gallery: responsive image grid with captions.',
    props: {
      title: OPTIONAL_TITLE,
      columns: num({ integer: true, min: 1, max: 6, default: 3 }),
      items: itemsOf({
        src: urlProp({ required: true }),
        alt: str({ required: true, maxLength: 300 }),
        caption: txt(),
      }),
      ...anchorProps,
    },
    network: 'optional',
    assets: ['media'],
    a11y: 'Every image keeps its alt text; captions are visible text, not tooltips.',
  }),
  define({
    type: 'video',
    purpose: 'Local video or a network-denied fallback.',
    summary:
      'Video: plays local sources; a provider reference becomes a poster plus link; network sources degrade to poster plus link.',
    props: {
      title: LABEL,
      src: urlProp({ required: true }),
      poster: urlProp(),
      provider: enumStr(EMBED_PROVIDER_NAMES, {
        description:
          'Network media provider. Requires the media capability and this provider in the page provider allowlist; the page still links out instead of embedding.',
      }),
      caption: txt(),
      fallback: obj({
        description: txt({ required: true }),
        linkText: str({ maxLength: 120 }),
        url: urlProp(),
      }),
      ...anchorProps,
    },
    runtimeFeatures: ['media'],
    assets: ['media'],
    network: 'optional',
    a11y: 'Uses <video controls> with a poster; the fallback description is always available as text.',
  }),
  define({
    type: 'audio',
    purpose: 'Local audio or a network-denied fallback.',
    summary:
      'Audio: plays local sources; a provider reference becomes metadata plus link; network sources degrade to metadata plus link.',
    props: {
      title: LABEL,
      src: urlProp({ required: true }),
      provider: enumStr(EMBED_PROVIDER_NAMES, {
        description:
          'Network media provider. Requires the media capability and this provider in the page provider allowlist; the page still links out instead of embedding.',
      }),
      caption: txt(),
      fallback: obj({
        description: txt({ required: true }),
        linkText: str({ maxLength: 120 }),
        url: urlProp(),
      }),
      ...anchorProps,
    },
    runtimeFeatures: ['media'],
    assets: ['media'],
    network: 'optional',
    a11y: 'Uses <audio controls>; the fallback description is always available as text.',
  }),

  // --- controls -----------------------------------------------------------
  define({
    type: 'button',
    purpose: 'Single actionable control.',
    summary: 'Button: clickable control with declarative action bindings.',
    props: {
      label: LABEL,
      variant: enumStr(['primary', 'secondary', 'ghost'], { default: 'secondary' }),
      on: onProp('Action bindings; a button without bindings is a diagnostic.'),
      ...anchorProps,
    },
    runtimeFeatures: ['copy'],
    actions: ['copy', 'open-url', 'download', 'toggle', 'set-value', 'theme'],
    a11y: 'Renders <button type="button">: pointer, Enter, and Space activation, with a visible focus ring.',
  }),
  define({
    type: 'link',
    purpose: 'Navigational link.',
    summary: 'Link: allowlisted URL with descriptive text.',
    props: { label: LABEL, href: urlProp({ required: true }), ...anchorProps },
    actions: ['open-url'],
    a11y: 'Renders <a>; external links are marked with rel="noreferrer noopener" and a visible cue.',
  }),
  define({
    type: 'slider',
    purpose: 'Bounded numeric input.',
    summary: 'Slider: range input with pointer drag and full keyboard support.',
    props: {
      label: LABEL,
      min: num({ default: 0, min: -1_000_000, max: 1_000_000 }),
      max: num({ default: 100, min: -1_000_000, max: 1_000_000 }),
      step: num({ default: 1, min: 0.0001, max: 1_000_000 }),
      value: num(),
      on: onProp('Binding fired when the value changes.'),
      ...anchorProps,
    },
    runtimeFeatures: ['slider'],
    actions: ['set-value'],
    a11y: 'Native <input type="range"> with a <label>, output text, and arrow/Home/End keyboard behavior.',
  }),
  define({
    type: 'search',
    purpose: 'Filter input for a collection.',
    summary: 'Search: labeled filter input bound to a collection.',
    props: {
      label: LABEL,
      placeholder: str({ maxLength: 120 }),
      on: onProp('Filter binding; requires a target collection.'),
      ...anchorProps,
    },
    runtimeFeatures: ['filter'],
    actions: ['filter'],
    a11y: 'Labeled <input type="search"> with a results count announced politely.',
  }),
  define({
    type: 'dialog',
    purpose: 'Modal detail surface.',
    summary: 'Dialog: native <dialog> with labeled title and close controls.',
    props: {
      title: TITLE,
      ariaLabel: str({ maxLength: 120 }),
      text: txt(),
      actions: list(obj({ label: LABEL, on: onProp() }), { maxItems: 6 }),
      ...anchorProps,
    },
    runtimeFeatures: ['dialog'],
    actions: ['toggle', 'copy', 'set-value'],
    a11y: 'Native <dialog> with aria-modal, focus trapping, Escape to close, and focus restoration.',
  }),

  // --- review-specific semantic blocks ------------------------------------
  semantic({
    type: 'diff-summary',
    purpose: 'Changed-file summary from a diff.',
    summary: 'DiffSummary: file paths with change status and line counts.',
    props: {
      title: OPTIONAL_TITLE,
      items: itemsOf({
        path: str({ required: true, maxLength: 400 }),
        status: enumStr(['added', 'modified', 'deleted', 'renamed'], { required: true }),
        additions: num({ integer: true, min: 0, max: 1_000_000 }),
        deletions: num({ integer: true, min: 0, max: 1_000_000 }),
      }),
      ...anchorProps,
    },
    a11y: 'Status is a text label in the table, not a colour-only cue.',
  }),
  semantic({
    type: 'code-review',
    purpose: 'Structured review findings.',
    summary: 'CodeReview: good/bad/ugly/concern/question findings.',
    props: {
      title: OPTIONAL_TITLE,
      items: itemsOf({
        kind: enumStr(['good', 'bad', 'ugly', 'concern', 'question'], { required: true }),
        title: LABEL,
        text: txt({ required: true }),
      }),
      ...anchorProps,
    },
    a11y: 'The finding kind is written as text; tone colour is decorative.',
  }),
];

export const BLOCKS_BY_TYPE: ReadonlyMap<string, BlockDefinition> = new Map(
  BLOCK_DEFINITIONS.map((definition) => [definition.type, definition]),
);
