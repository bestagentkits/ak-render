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
import type { BlockCategory } from './block-module.js';
import {
  anchorProps,
  bool,
  define,
  enumStr,
  idProp,
  itemsOf,
  LABEL,
  LANGUAGE_DESCRIPTION,
  list,
  num,
  OPTIONAL_TITLE,
  obj,
  oneOf,
  onProp,
  semantic,
  str,
  TITLE,
  txt,
  urlProp,
  VERBATIM_DESCRIPTION,
} from './define-helpers.js';
import type { PropSchema } from './prop-schema.js';

/** Up to three link buttons, shared by the hero and the CTA band. */
function linkActions(): PropSchema {
  return list(
    obj({
      label: LABEL,
      href: urlProp({ required: true }),
      variant: enumStr(['primary', 'secondary'], { default: 'secondary' }),
    }),
    { maxItems: 3 },
  );
}

export { CHART_KINDS } from '../blocks/chart/chart-kinds.js';
export * from './define-helpers.js';

/**
 * Features the core compiler emits. Block groups may add their own features
 * (see `FeatureModule`); the registry rejects any name outside both lists.
 */
export const CORE_RUNTIME_FEATURES = [
  'tabs',
  'accordion',
  'carousel',
  'slider',
  'copy',
  'syntax',
  'filter',
  'theme',
  'dialog',
  'chart',
  'diagram',
  'media',
  'outline',
  'bento',
  'marquee',
  'terminal',
  'tree',
  'before-after',
  'kpi',
  'showcase',
  'cta',
  'frame',
  'checklist',
  'state',
] as const;

export type CoreRuntimeFeature = (typeof CORE_RUNTIME_FEATURES)[number];

/**
 * A runtime feature name: a core feature or one a block group registers. The
 * open string arm is checked at registration rather than by the type system.
 */
export type RuntimeFeature = CoreRuntimeFeature | (string & {});

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
  /** Catalog grouping for discovery. */
  category: BlockCategory;
  /** Up to 6 kebab-case search tags. */
  tags: readonly string[];
  /** Up to 4 short phrases (40 characters max) naming what the block is for. */
  useCases: readonly string[];
  /** Allowed direct parent types; absent means any parent, including the page. */
  parents?: readonly string[];
  /** Rows carry `data-ak-filter-item` and a `data-ak-row` JSON payload a filter can read. */
  filterable?: boolean;
  /** The block reads rows from `dataRef` or inline `data`, reshaped by an optional `transform`. */
  data?: { required: boolean; description: string };
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

/**
 * Core blocks: the roster entries that have not moved into a block module
 * under `src/blocks/`. The registry appends every module's definition.
 */
export const CORE_BLOCK_DEFINITIONS: readonly BlockDefinition[] = [
  // --- root ---------------------------------------------------------------
  define({
    type: 'page',
    category: 'layout',
    tags: ['root', 'document'],
    useCases: ['page shell'],
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
    category: 'layout',
    tags: ['container', 'heading', 'band'],
    useCases: ['group related blocks', 'dark feature band'],
    purpose: 'A titled group of blocks.',
    summary:
      'Section with an optional heading wrapping child blocks; an inverse surface sets it on a night band.',
    props: {
      title: OPTIONAL_TITLE,
      surface: enumStr(['plain', 'inverse'], {
        default: 'plain',
        description:
          'inverse renders the section on a dark band using the theme dark palette, in both schemes.',
      }),
      ...anchorProps,
    },
    slots: { children: { accepts: '*', min: 1, max: 200 } },
  }),
  define({
    type: 'spacer',
    category: 'layout',
    tags: ['spacing'],
    useCases: ['vertical breathing room'],
    purpose: 'Vertical rhythm spacer.',
    summary: 'Spacer: vertical space without content.',
    props: { size: enumStr(['small', 'medium', 'large'], { default: 'medium' }), ...anchorProps },
    a11y: 'Presentational only; hidden from assistive technology.',
  }),
  define({
    type: 'divider',
    category: 'layout',
    tags: ['rule', 'separator'],
    useCases: ['separate sections'],
    purpose: 'Horizontal rule with an optional label.',
    summary: 'Divider: semantic separator with an optional label.',
    props: { label: str({ maxLength: 120 }), ...anchorProps },
    a11y: 'Renders <hr>; a label is exposed as text, never as the only separator cue.',
  }),

  // --- typography and content --------------------------------------------
  define({
    type: 'heading',
    category: 'content',
    tags: ['title', 'outline'],
    useCases: ['section title'],
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
    category: 'content',
    tags: ['prose', 'paragraph'],
    useCases: ['body copy'],
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
    category: 'content',
    tags: ['prose', 'inline-marks'],
    useCases: ['formatted paragraphs'],
    purpose: 'Multi-paragraph prose.',
    summary: 'RichText: multiple paragraphs from line breaks.',
    props: { text: txt({ required: true }), ...anchorProps },
  }),
  define({
    type: 'quote',
    category: 'content',
    tags: ['testimonial', 'citation'],
    useCases: ['customer quote', 'pull quote'],
    purpose: 'Pulled quotation.',
    summary: 'Quote: blockquote with an optional attribution.',
    props: { text: txt({ required: true }), cite: str({ maxLength: 200 }), ...anchorProps },
  }),
  define({
    type: 'code',
    category: 'content',
    tags: ['source', 'snippet', 'copy'],
    useCases: ['code sample', 'command to copy'],
    purpose: 'Code or configuration sample.',
    summary: 'Code: preformatted block with optional language and copy target.',
    props: {
      language: str({ maxLength: 32, default: 'text', description: LANGUAGE_DESCRIPTION }),
      title: OPTIONAL_TITLE,
      text: txt({ required: true, maxLength: 100_000, description: VERBATIM_DESCRIPTION }),
      ...anchorProps,
    },
    assets: ['code'],
    runtimeFeatures: ['copy'],
    a11y: 'Renders <pre><code> with the authored text and a labelled Copy button; no syntax highlighting requires network access.',
    serializer:
      'Emits the code text verbatim inside the fenced block when serialized back to Markdown.',
  }),
  define({
    type: 'badge',
    category: 'content',
    tags: ['label', 'status'],
    useCases: ['status label'],
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
    category: 'content',
    tags: ['keyboard', 'shortcut'],
    useCases: ['keyboard shortcut'],
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
    category: 'content',
    tags: ['metadata', 'pairs'],
    useCases: ['spec sheet', 'document metadata'],
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
    category: 'layout',
    tags: ['surface', 'container'],
    useCases: ['boxed summary', 'feature card'],
    purpose: 'Bounded content container.',
    summary: 'Card: titled container that holds child blocks.',
    props: { title: OPTIONAL_TITLE, text: txt(), ...anchorProps },
    slots: { children: { accepts: '*', min: 0, max: 40 } },
  }),
  define({
    type: 'alert',
    category: 'content',
    tags: ['notice', 'status'],
    useCases: ['warning banner', 'status notice'],
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
    category: 'content',
    tags: ['note', 'aside'],
    useCases: ['tip or note', 'highlighted aside'],
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
    category: 'content',
    tags: ['landing', 'headline', 'intro'],
    useCases: ['landing page header', 'report title'],
    purpose: 'Page opener that states the artifact subject.',
    summary:
      'Hero: eyebrow, title, and one-line description, optionally over a framed product shot.',
    props: {
      eyebrow: str({ maxLength: 80 }),
      title: TITLE,
      description: txt(),
      actions: linkActions(),
      align: enumStr(['start', 'center'], { default: 'start' }),
      src: urlProp({
        asset: 'images',
        description: 'Optional product shot shown in a browser frame below the copy.',
      }),
      alt: str({ maxLength: 300, description: 'Required when src is set.' }),
      address: str({
        maxLength: 120,
        description: 'Text shown in the frame address bar; not a link.',
      }),
      ...anchorProps,
    },
    network: 'optional',
    sizing: {
      sizes: ['medium', 'large'],
      default: 'large',
      responsive:
        'Full width; text reflows and the product shot scales to the column without cropping.',
    },
    a11y: 'The hero title is an <h1>; the eyebrow is supporting text, not a heading. Every action is a real link with its own text. The shot keeps its alt text and its frame is decorative.',
  }),
  semantic({
    type: 'stats',
    category: 'data',
    tags: ['numbers', 'summary'],
    useCases: ['headline numbers', 'report summary'],
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
    category: 'data',
    tags: ['completion', 'bars'],
    useCases: ['completion status', 'goal tracking'],
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
    category: 'content',
    tags: ['process', 'ordered'],
    useCases: ['how-to steps', 'onboarding flow'],
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
    category: 'content',
    tags: ['chronology', 'history'],
    useCases: ['release history', 'project milestones'],
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
    category: 'content',
    tags: ['bullets', 'items'],
    useCases: ['bullet list', 'checklist of points'],
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
    category: 'content',
    tags: ['cards', 'overview'],
    useCases: ['feature overview', 'link directory'],
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
    category: 'data',
    tags: ['tabular', 'rows', 'columns'],
    useCases: ['tabular data', 'comparison rows'],
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
    category: 'data',
    tags: ['versus', 'options'],
    useCases: ['compare options', 'plan comparison'],
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
    category: 'data',
    tags: ['risk', 'impact', 'likelihood'],
    useCases: ['risk register', 'threat assessment'],
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
  semantic({
    type: 'toolbar',
    category: 'interaction',
    tags: ['controls', 'actions'],
    useCases: ['page actions', 'quick links'],
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

  // --- diagrams (adapter) -------------------------------------------------
  semantic({
    type: 'diagram-panel',
    category: 'engineering',
    tags: ['diagram', 'architecture'],
    useCases: ['architecture diagram', 'flow chart'],
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

  // --- showcase -----------------------------------------------------------
  define({
    type: 'marquee',
    category: 'showcase',
    tags: ['ticker', 'logos'],
    useCases: ['customer logos', 'highlight ticker'],
    purpose: 'Continuously scrolling strip of short highlights.',
    summary:
      'Marquee: looping ticker of short items that pauses on hover and stops under reduced motion.',
    props: {
      label: str({ maxLength: 120, default: 'Highlights' }),
      items: list(str({ required: true, maxLength: 80 }), {
        required: true,
        minItems: 1,
        maxItems: 30,
      }),
      speed: enumStr(['slow', 'normal', 'fast'], { default: 'normal' }),
      ...anchorProps,
    },
    runtimeFeatures: ['marquee'],
    a11y: 'Screen readers get one static list; the duplicated scrolling track is aria-hidden, and motion stops under prefers-reduced-motion.',
  }),
  define({
    type: 'terminal',
    category: 'engineering',
    tags: ['shell', 'commands', 'output'],
    useCases: ['install steps', 'cli session'],
    purpose: 'A command-line session: commands with their output.',
    summary:
      'Terminal: window-framed session that types in on load; commands, output and errors are styled apart.',
    props: {
      title: str({ maxLength: 120, default: 'Terminal' }),
      lines: itemsOf(
        {
          kind: enumStr(['command', 'output', 'comment', 'success', 'error'], {
            default: 'output',
          }),
          text: txt({ required: true, maxLength: 2_000, description: VERBATIM_DESCRIPTION }),
        },
        { minItems: 1, maxItems: 60 },
      ),
      ...anchorProps,
    },
    runtimeFeatures: ['terminal', 'copy'],
    a11y: 'Renders <pre> text; the prompt glyph is decorative, and the line reveal is skipped under reduced motion.',
  }),
  semantic({
    type: 'file-tree',
    category: 'engineering',
    tags: ['files', 'paths', 'repository'],
    useCases: ['project layout', 'changed files'],
    purpose: 'Files and folders, optionally with change status, derived from flat paths.',
    summary:
      'File tree: nested folders built from slash-separated paths, with per-file status and notes.',
    props: {
      title: OPTIONAL_TITLE,
      items: itemsOf(
        {
          path: str({ required: true, maxLength: 300 }),
          status: enumStr(['added', 'modified', 'deleted', 'renamed', 'unchanged'], {
            default: 'unchanged',
          }),
          note: str({ maxLength: 200 }),
        },
        { minItems: 1, maxItems: 200 },
      ),
      ...anchorProps,
    },
    runtimeFeatures: ['tree'],
    a11y: 'Nested lists mirror the folder structure; status is written as text, not only color.',
  }),
  semantic({
    type: 'before-after',
    category: 'media',
    tags: ['comparison', 'slider', 'images'],
    useCases: ['redesign comparison', 'visual diff'],
    purpose: 'Before and after: two images of the same frame, revealed by a draggable divider.',
    summary:
      'Compare: before/after image slider driven by a native range input; without script both images stay visible.',
    props: {
      title: OPTIONAL_TITLE,
      before: obj(
        {
          src: urlProp({ required: true, asset: 'images' }),
          alt: str({ required: true, maxLength: 300 }),
          label: str({ maxLength: 40, default: 'Before' }),
        },
        { required: true },
      ),
      after: obj(
        {
          src: urlProp({ required: true, asset: 'images' }),
          alt: str({ required: true, maxLength: 300 }),
          label: str({ maxLength: 40, default: 'After' }),
        },
        { required: true },
      ),
      start: num({ min: 0, max: 100, default: 50 }),
      caption: txt(),
      ...anchorProps,
    },
    runtimeFeatures: ['before-after'],
    network: 'optional',
    a11y: 'The divider is a labelled <input type="range">: keyboard, pointer, and touch all move it, and both images keep their alt text.',
  }),
  semantic({
    type: 'kpi',
    category: 'data',
    tags: ['metrics', 'sparkline', 'trend'],
    useCases: ['dashboard metrics', 'performance summary'],
    purpose: 'Headline metrics with direction of change and a small trend line.',
    summary:
      'KPI: metric cards with value, signed delta, good/bad direction, and an optional sparkline series.',
    props: {
      title: OPTIONAL_TITLE,
      items: itemsOf(
        {
          label: LABEL,
          value: str({ required: true, maxLength: 40 }),
          delta: str({ maxLength: 24 }),
          trend: enumStr(['up', 'down', 'flat'], { default: 'flat' }),
          good: enumStr(['up', 'down'], {
            default: 'up',
            description: 'Which direction counts as an improvement for this metric.',
          }),
          series: list(num({ required: true, min: -1e12, max: 1e12 }), { maxItems: 60 }),
          caption: str({ maxLength: 120 }),
        },
        { minItems: 1, maxItems: 8 },
      ),
      ...anchorProps,
    },
    runtimeFeatures: ['kpi'],
    a11y: 'Value, delta, and direction are text; the sparkline is decorative and aria-hidden.',
  }),
  semantic({
    type: 'showcase',
    category: 'showcase',
    tags: ['spotlight', 'screenshot'],
    useCases: ['feature spotlight', 'product tour'],
    purpose: 'Feature spotlight: copy beside a framed screenshot.',
    summary:
      'Showcase: eyebrow, title, text, and bullets beside an image in a browser frame; the image side can flip.',
    props: {
      eyebrow: str({ maxLength: 60 }),
      title: TITLE,
      text: txt(),
      bullets: list(str({ required: true, maxLength: 200 }), { maxItems: 8 }),
      src: urlProp({ required: true, asset: 'images' }),
      alt: str({ required: true, maxLength: 300 }),
      frame: enumStr(['browser', 'plain'], { default: 'browser' }),
      address: str({
        maxLength: 120,
        description: 'Text shown in the browser frame address bar; not a link.',
      }),
      align: enumStr(['media-right', 'media-left'], { default: 'media-right' }),
      ...anchorProps,
    },
    runtimeFeatures: ['showcase'],
    network: 'optional',
    sizing: {
      sizes: ['large'],
      default: 'large',
      responsive:
        'Copy and media sit side by side on wide screens and stack, media last, on narrow ones.',
    },
    a11y: 'The title is a heading; the frame chrome is decorative and the image keeps its alt text.',
  }),
  define({
    type: 'checklist',
    category: 'data',
    tags: ['tasks', 'status'],
    useCases: ['launch checklist', 'review checklist'],
    purpose: 'Task list with done and open items and a completion count.',
    summary: 'Checklist: items marked done or open, with a visible completion count.',
    props: {
      title: OPTIONAL_TITLE,
      items: itemsOf({ text: LABEL, done: bool({ default: false }) }, { maxItems: 100 }),
      ...anchorProps,
    },
    a11y: 'Each item states "done" or "open" in text; the check glyph is decorative.',
    runtimeFeatures: ['checklist'],
  }),
  semantic({
    type: 'cta',
    category: 'showcase',
    tags: ['conversion', 'action'],
    useCases: ['sign-up prompt', 'closing call to action'],
    purpose: 'Closing call to action that sends the reader somewhere next.',
    summary: 'CTA: eyebrow, oversized title, text, and up to three link actions on a night band.',
    props: {
      eyebrow: str({ maxLength: 60 }),
      title: TITLE,
      text: txt(),
      actions: linkActions(),
      ...anchorProps,
    },
    runtimeFeatures: ['cta'],
    sizing: {
      sizes: ['large'],
      default: 'large',
      responsive: 'Full width; the title scales with the viewport and the actions wrap.',
    },
    a11y: 'The title is an <h2>; every action is a real link with its own text.',
  }),

  // --- media --------------------------------------------------------------
  define({
    type: 'image',
    category: 'media',
    tags: ['picture', 'figure'],
    useCases: ['screenshot', 'illustration'],
    purpose: 'Single image or picture.',
    summary: 'Image: local asset or allowlisted URL with required alt text.',
    props: {
      src: urlProp({ required: true, asset: 'images' }),
      alt: str({ required: true, maxLength: 300 }),
      caption: txt(),
      ...anchorProps,
    },
    network: 'optional',
    assets: ['media'],
    a11y: 'Alt text is required; decorative images must use an empty alt explicitly.',
  }),
  define({
    type: 'video',
    category: 'media',
    tags: ['player', 'poster'],
    useCases: ['product demo', 'recorded talk'],
    purpose: 'Local video or a network-denied fallback.',
    summary:
      'Video: plays local sources; a provider or network source degrades to a poster plus link.',
    props: {
      title: LABEL,
      src: urlProp({ required: true, asset: 'media' }),
      poster: urlProp({ asset: 'images', rejectBlocked: true }),
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
    category: 'media',
    tags: ['player', 'sound'],
    useCases: ['podcast clip', 'voice note'],
    purpose: 'Local audio or a network-denied fallback.',
    summary:
      'Audio: plays local sources; a provider or network source degrades to metadata plus link.',
    props: {
      title: LABEL,
      src: urlProp({ required: true, asset: 'media' }),
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
    category: 'interaction',
    tags: ['action', 'control'],
    useCases: ['trigger an action', 'primary call'],
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
    category: 'interaction',
    tags: ['navigation', 'anchor'],
    useCases: ['external link', 'related page'],
    purpose: 'Navigational link.',
    summary: 'Link: allowlisted URL with descriptive text.',
    props: { label: LABEL, href: urlProp({ required: true }), ...anchorProps },
    actions: ['open-url'],
    a11y: 'Renders <a>; external links are marked with rel="noreferrer noopener" and a visible cue.',
  }),
  define({
    type: 'slider',
    category: 'interaction',
    tags: ['range', 'input', 'state'],
    useCases: ['adjust a value', 'what-if input'],
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
    category: 'interaction',
    tags: ['filter', 'input'],
    useCases: ['filter a list', 'find an item'],
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
    category: 'interaction',
    tags: ['modal', 'overlay'],
    useCases: ['confirmation', 'detail popup'],
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
    category: 'engineering',
    tags: ['diff', 'changes'],
    useCases: ['change summary', 'pull request files'],
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
    category: 'engineering',
    tags: ['review', 'findings'],
    useCases: ['review findings', 'audit notes'],
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
