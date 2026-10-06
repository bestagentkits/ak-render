/**
 * Block renderers.
 *
 * One renderer per registry type. Renderers are pure functions of a node, the
 * IR, and the resolved theme: no clock, no randomness, no module-level mutable
 * state, because the emitted bytes must be reproducible.
 *
 * Two conventions apply to every renderer:
 *   1. Exactly one element in the emitted markup carries `data-ak-id`, so a
 *      `copy`/`download`/`toggle` target resolves to the content a reader means.
 *   2. Action bindings become `data-ak-on-*` attributes; the runtime owns what
 *      they do. No renderer emits a handler, a style attribute, or a script.
 */

import type { Diagnostic } from '../diagnostics.js';
import { type DiagramAdapter, runDiagramAdapter } from '../diagram/adapter.js';
import type { IrDocument, IrNode } from '../ir.js';
import { isPlainObject, type JsonValue } from '../json.js';
import type { RuntimeFeature } from '../registry/roster.js';
import { EMBED_PROVIDERS } from '../spec/providers.js';
import type { ResolvedTheme } from '../theme/load-theme.js';
import {
  blockedReason,
  element,
  figureCaption,
  heading,
  imageReferenceAllowed,
  listProp,
  nodeAttributes,
  numberProp,
  numProp,
  objectListProp,
  resolveMedia,
  str,
  stringProp,
  titleHeader,
} from './block-helpers.js';
import { type ChartSeries, renderChart } from './charts.js';
import { renderDiagramFallback } from './diagram-fallback.js';
import {
  type AttributeValue,
  escapeAttribute,
  escapeInlineText,
  escapeText,
  escapeUrl,
  renderAttributes,
} from './escape.js';
import { browserShot, SHOWCASE_RENDERERS } from './showcase-blocks.js';

export interface RenderContext {
  ir: IrDocument;
  theme: ResolvedTheme;
  features: Set<RuntimeFeature>;
  /**
   * Optional diagram adapter. Without one, every diagram-panel emits the
   * structured semantic fallback, which is the Core and Marketing behavior.
   */
  diagramAdapter?: DiagramAdapter;
  /** Diagnostics raised while rendering, such as a rejected adapter output. */
  warnings?: Diagnostic[];
  renderChildren(node: IrNode): string;
}

type Renderer = (node: IrNode, context: RenderContext) => string;

const NO_OP_RENDERER: Renderer = () => '';

/** Fragment id of a section, shared by the section renderer and the page outline. */
export function sectionAnchor(nodeId: string): string {
  return `ak-sec-${nodeId}`;
}

/** `data-ak-on-click` for a control, when the node binds a click action. */
function clickAttribute(bindings: Record<string, unknown>): AttributeValue {
  const actions = bindings.click;
  if (actions === undefined) return {};
  return { 'data-ak-on-click': JSON.stringify(actions) };
}

function toneAttribute(node: IrNode, fallback = 'info'): AttributeValue {
  return { 'data-tone': stringProp(node, 'tone', fallback) };
}

/**
 * Tone for a value a reader scans for severity or outcome. Only exact, known
 * words map to a tone; anything else stays neutral, so a label is never
 * coloured by guesswork.
 */
const VALUE_TONES: Readonly<Record<string, string>> = {
  high: 'danger',
  critical: 'danger',
  blocker: 'danger',
  bug: 'danger',
  issue: 'danger',
  deleted: 'danger',
  removed: 'danger',
  medium: 'warning',
  concern: 'warning',
  warning: 'warning',
  renamed: 'warning',
  modified: 'info',
  changed: 'info',
  question: 'info',
  note: 'info',
  low: 'success',
  good: 'success',
  praise: 'success',
  added: 'success',
  new: 'success',
};

function valueTone(value: string): string {
  return VALUE_TONES[value.trim().toLowerCase()] ?? 'neutral';
}

/** A status word rendered as a toned badge. */
function toneBadge(value: string): string {
  return `<span class="ak-badge" data-tone="${valueTone(value)}">${escapeText(value)}</span>`;
}

/** A cell reads as a number when it is digits with optional sign, grouping, decimals, percent or a short unit. */
const NUMERIC_CELL = /^[-+−]?[$€£]?\d[\d,]*(?:\.\d+)?\s?(?:%|[A-Za-z]{1,3})?$/u;

/** Column indexes whose every non-empty cell is numeric, so they can align on the right. */
function numericColumns(rows: JsonValue[], width: number): Set<number> {
  const numeric = new Set<number>();
  for (let column = 0; column < width; column += 1) {
    const cells = rows
      .map((row) => (Array.isArray(row) ? str(row[column]).trim() : ''))
      .filter((cell) => cell !== '');
    if (cells.length > 0 && cells.every((cell) => NUMERIC_CELL.test(cell))) numeric.add(column);
  }
  return numeric;
}

/** A diff line count; zero stays neutral so only real change is coloured. */
function lineCountCell(value: number, kind: 'add' | 'del'): string {
  const sign = kind === 'add' ? '+' : '\u2212';
  const tone = value === 0 ? 'ak-zero' : `ak-${kind}`;
  return `<td class="ak-num ${tone}">${sign}${escapeText(String(value))}</td>`;
}

/** Split code into one span per line so the stylesheet can number lines; newlines stay in the text. */
function codeLines(text: string): string {
  const lines = text.replace(/\n$/u, '').split('\n');
  return lines.map((line) => `<span class="ak-line">${escapeText(line)}</span>`).join('\n');
}

/**
 * Wrap each word of the hero title so it can rise into view on its own beat.
 * The spaces stay as text between the wrappers, so the heading's text content
 * and its line wrapping are unchanged.
 */
function heroWords(title: string): string {
  return title
    .split(/(\s+)/u)
    .map((part) =>
      part === '' || /^\s+$/u.test(part)
        ? part
        : `<span class="ak-word"><span>${escapeText(part)}</span></span>`,
    )
    .join('');
}

function mediaFallbackBody(
  title: string,
  description: string,
  url: string,
  poster: string,
  linkText: string,
  note: string,
): string {
  const posterMarkup =
    poster === '' ? '' : `<img src="${escapeAttribute(escapeUrl(poster))}" alt="" />`;
  const link =
    url === ''
      ? ''
      : `<a href="${escapeAttribute(escapeUrl(url))}" rel="noreferrer noopener">${escapeText(
          linkText === '' ? url : linkText,
        )}</a>`;
  return [
    posterMarkup,
    title === '' ? '' : `<p><strong>${escapeText(title)}</strong></p>`,
    `<p class="ak-muted">${escapeInlineText(description)}</p>`,
    `<p class="ak-caption">${escapeText(note)}</p>`,
    link,
  ]
    .filter((part) => part !== '')
    .join('');
}

const RENDERERS: Record<string, Renderer> = {
  ...SHOWCASE_RENDERERS,
  page: (node, context) => {
    // Every page needs exactly one h1. A hero (or an explicit level-1 heading)
    // provides it; otherwise the document title does, so a page without a hero
    // is still correctly structured.
    const hasH1 = context.ir.nodes.some(
      (candidate) =>
        candidate.type === 'hero' ||
        (candidate.type === 'heading' && numberProp(candidate, 'level', 2) === 1),
    );
    const title = hasH1
      ? ''
      : `<h1 class="ak-page-title">${escapeText(context.ir.meta.title)}</h1>`;
    return element(
      'main',
      { class: 'ak-main', id: 'ak-main-content', 'aria-label': context.ir.meta.title },
      `${title}${context.renderChildren(node)}`,
    );
  },

  section: (node, context) =>
    element(
      'section',
      // The id is the outline's link target; node ids are unique, so it is too.
      nodeAttributes(node, {
        class: 'ak-block ak-section',
        id: sectionAnchor(node.id),
        'data-surface': stringProp(node, 'surface') === 'inverse' ? 'inverse' : undefined,
      }),
      `${titleHeader(node)}${context.renderChildren(node)}`,
    ),

  stack: (node, context) =>
    element(
      'div',
      nodeAttributes(node, {
        class: 'ak-block ak-stack',
        'data-gap': stringProp(node, 'gap', 'normal'),
      }),
      context.renderChildren(node),
    ),

  grid: (node, context) =>
    element(
      'div',
      nodeAttributes(node, {
        class: 'ak-block ak-grid',
        'data-ak-columns': String(Math.min(Math.max(numberProp(node, 'columns', 3), 1), 6)),
      }),
      context.renderChildren(node),
    ),

  split: (node, context) =>
    element(
      'div',
      nodeAttributes(node, {
        class: 'ak-block ak-split',
        'data-ratio': stringProp(node, 'ratio', 'even'),
      }),
      context.renderChildren(node),
    ),

  spacer: (node) =>
    element(
      'div',
      {
        class: 'ak-spacer',
        'data-size': stringProp(node, 'size', 'medium'),
        'aria-hidden': 'true',
      },
      '',
    ),

  divider: (node) => {
    const label = stringProp(node, 'label');
    return element(
      'div',
      nodeAttributes(node, { class: 'ak-block' }),
      `<hr class="ak-divider" />${label === '' ? '' : `<p class="ak-label">${escapeText(label)}</p>`}`,
    );
  },

  heading: (node) => {
    const level = Math.min(Math.max(numberProp(node, 'level', 2), 1), 6);
    return `<h${level}${renderAttributes(nodeAttributes(node, { class: 'ak-block' }))}>${escapeText(
      stringProp(node, 'text'),
    )}</h${level}>`;
  },

  text: (node) => {
    const variant = stringProp(node, 'variant', 'body');
    const className =
      variant === 'lead'
        ? 'ak-block ak-lead'
        : variant === 'caption'
          ? 'ak-block ak-caption'
          : 'ak-block';
    return `<p${renderAttributes(nodeAttributes(node, { class: className }))}>${escapeInlineText(
      stringProp(node, 'text'),
    )}</p>`;
  },

  'rich-text': (node) => {
    const paragraphs = stringProp(node, 'text')
      .split(/\n{2,}/u)
      .map((part) => part.trim())
      .filter((part) => part !== '');
    return element(
      'div',
      nodeAttributes(node, { class: 'ak-block ak-prose' }),
      paragraphs.map((part) => `<p>${escapeInlineText(part.replace(/\n/gu, ' '))}</p>`).join(''),
    );
  },

  quote: (node) => {
    const cite = stringProp(node, 'cite');
    return element(
      'blockquote',
      nodeAttributes(node, { class: 'ak-block ak-quote' }),
      `<p>${escapeInlineText(stringProp(node, 'text'))}</p>${
        cite === '' ? '' : `<cite>${escapeText(cite)}</cite>`
      }`,
    );
  },

  code: (node) => {
    const title = stringProp(node, 'title');
    const language = stringProp(node, 'language', 'text');
    const copy = renderAttributes({
      'data-ak-on-click': JSON.stringify([{ action: 'copy', target: node.id }]),
      'aria-label': title === '' ? 'Copy code' : `Copy ${title}`,
    });
    return [
      `<div class="ak-block ak-code">`,
      '<div class="ak-code-head">',
      `<span class="ak-label">${escapeText(title === '' ? language : title)}</span>`,
      title === '' || language === ''
        ? ''
        : `<span class="ak-code-lang">${escapeText(language)}</span>`,
      `<button type="button" class="ak-code-copy"${copy}>Copy</button>`,
      '</div>',
      `<pre${renderAttributes({ 'data-ak-id': node.id })}><code${renderAttributes({
        class: `language-${language}`,
      })}>${codeLines(stringProp(node, 'text'))}</code></pre>`,
      '</div>',
    ]
      .filter((part) => part !== '')
      .join('');
  },

  badge: (node) =>
    `<span${renderAttributes(
      nodeAttributes(node, { class: 'ak-badge', ...toneAttribute(node, 'neutral') }),
    )}>${escapeText(stringProp(node, 'text'))}</span>`,

  kbd: (node) =>
    element(
      'span',
      nodeAttributes(node, { class: 'ak-block ak-kbd' }),
      listProp(node, 'keys')
        .map((key) => `<kbd>${escapeText(str(key))}</kbd>`)
        .join(''),
    ),

  'key-value': (node) =>
    element(
      'div',
      nodeAttributes(node, { class: 'ak-block' }),
      `${titleHeader(node)}<dl class="ak-kv">${objectListProp(node, 'items')
        .map(
          (item) => `<dt>${escapeText(str(item.key))}</dt><dd>${escapeText(str(item.value))}</dd>`,
        )
        .join('')}</dl>`,
    ),

  card: (node, context) => {
    const text = stringProp(node, 'text');
    return element(
      'div',
      nodeAttributes(node, { class: 'ak-block ak-card ak-card--elevated' }),
      [
        stringProp(node, 'title') === ''
          ? ''
          : heading(3, stringProp(node, 'title'), 'ak-card-title'),
        text === '' ? '' : `<p>${escapeInlineText(text)}</p>`,
        context.renderChildren(node),
      ].join(''),
    );
  },

  alert: (node) => {
    const tone = stringProp(node, 'tone', 'info');
    const role = tone === 'danger' || tone === 'warning' ? ' role="alert"' : '';
    return [
      `<div${renderAttributes(nodeAttributes(node, { class: 'ak-block ak-alert', ...toneAttribute(node) }))}${role}>`,
      `<p><strong>${escapeText(stringProp(node, 'title'))}</strong></p>`,
      `<p>${escapeInlineText(stringProp(node, 'text'))}</p>`,
      '</div>',
    ].join('');
  },

  callout: (node) => {
    const tone = stringProp(node, 'tone', 'info');
    const icon =
      tone === 'danger'
        ? 'Danger'
        : tone === 'warning'
          ? 'Warning'
          : tone === 'success'
            ? 'Done'
            : 'Note';
    return [
      `<aside${renderAttributes(nodeAttributes(node, { class: 'ak-block ak-callout', ...toneAttribute(node) }))}>`,
      `<p class="ak-label">${escapeText(icon)}</p>`,
      `<p><strong>${escapeText(stringProp(node, 'title'))}</strong></p>`,
      `<p>${escapeInlineText(stringProp(node, 'text'))}</p>`,
      '</aside>',
    ].join('');
  },

  hero: (node, context) => {
    const eyebrow = stringProp(node, 'eyebrow');
    const description = stringProp(node, 'description');
    const source = stringProp(node, 'src');
    return [
      `<div${renderAttributes(
        nodeAttributes(node, {
          class: 'ak-block ak-hero',
          'data-align': stringProp(node, 'align') === 'center' ? 'center' : undefined,
          'data-media': source === '' ? undefined : 'true',
        }),
      )}>`,
      eyebrow === '' ? '' : `<p class="ak-eyebrow">${escapeText(eyebrow)}</p>`,
      `<h1>${heroWords(stringProp(node, 'title'))}</h1>`,
      description === '' ? '' : `<p>${escapeInlineText(description)}</p>`,
      // The shot is the first thing on screen, so it loads eagerly.
      source === ''
        ? ''
        : `<figure class="ak-hero-media"><div class="ak-hero-stage">${browserShot(
            source,
            stringProp(node, 'alt'),
            stringProp(node, 'address'),
            context.ir.policy.network,
            'eager',
          )}</div></figure>`,
      '</div>',
    ].join('');
  },

  stats: (node) => {
    const items = objectListProp(node, 'items');
    return element(
      'section',
      nodeAttributes(node, { class: 'ak-block' }),
      [
        titleHeader(node),
        items.length === 0
          ? ''
          : `<dl class="ak-stats">${items
              .map(
                (item) =>
                  `<div class="ak-stat"><dt>${escapeText(str(item.label))}</dt><dd>${escapeText(
                    str(item.value),
                  )}</dd></div>`,
              )
              .join('')}</dl>`,
      ].join(''),
    );
  },

  progress: (node) => {
    const value = numberProp(node, 'value');
    const max = Math.max(numberProp(node, 'max', 100), 1);
    const bounded = Math.min(Math.max(value, 0), max);
    const label = stringProp(node, 'label');
    return element(
      'div',
      nodeAttributes(node, { class: 'ak-block ak-progress' }),
      [
        `<p class="ak-label">${escapeText(label)}</p>`,
        `<progress value="${bounded}" max="${max}">${bounded} / ${max}</progress>`,
        `<p class="ak-caption">${bounded} of ${max}</p>`,
      ].join(''),
    );
  },

  steps: (node) => {
    const items = objectListProp(node, 'items');
    return element(
      'section',
      nodeAttributes(node, { class: 'ak-block' }),
      [
        titleHeader(node),
        `<ol class="ak-steps">${items
          .map((item) => {
            const text = str(item.text);
            return `<li><p><strong>${escapeText(str(item.title))}</strong></p>${
              text === '' ? '' : `<p>${escapeInlineText(text)}</p>`
            }</li>`;
          })
          .join('')}</ol>`,
      ].join(''),
    );
  },

  timeline: (node) => {
    const items = objectListProp(node, 'items');
    return element(
      'section',
      nodeAttributes(node, { class: 'ak-block' }),
      [
        titleHeader(node),
        `<ol class="ak-timeline">${items
          .map((item) => {
            const text = str(item.text);
            return `<li><time>${escapeText(str(item.when))}</time><p><strong>${escapeText(
              str(item.title),
            )}</strong></p>${text === '' ? '' : `<p>${escapeInlineText(text)}</p>`}</li>`;
          })
          .join('')}</ol>`,
      ].join(''),
    );
  },

  list: (node) => {
    const items = objectListProp(node, 'items');
    return element(
      'section',
      nodeAttributes(node, { class: 'ak-block' }),
      [
        titleHeader(node),
        `<ul class="ak-list">${items
          .map((item) => {
            const badge = str(item.badge);
            return `<li data-ak-filter-item data-ak-label="${escapeAttribute(
              str(item.text),
            )}"><span>${escapeInlineText(str(item.text))}</span>${
              badge === '' ? '' : `<span class="ak-badge">${escapeText(badge)}</span>`
            }</li>`;
          })
          .join('')}</ul>`,
      ].join(''),
    );
  },

  'card-grid': (node) => {
    const items = objectListProp(node, 'items');
    return element(
      'section',
      nodeAttributes(node, { class: 'ak-block' }),
      [
        titleHeader(node),
        `<ul class="ak-grid" data-ak-columns="3">${items
          .map((item) => {
            const text = str(item.text);
            return `<li class="ak-card ak-card--elevated"><p><strong>${escapeText(
              str(item.title),
            )}</strong></p>${text === '' ? '' : `<p>${escapeInlineText(text)}</p>`}</li>`;
          })
          .join('')}</ul>`,
      ].join(''),
    );
  },

  table: (node) => {
    const columns = listProp(node, 'columns');
    const rows = listProp(node, 'rows');
    const title = stringProp(node, 'title');
    const numeric = numericColumns(rows, columns.length);
    const align = (index: number): string => (numeric.has(index) ? ' class="ak-num"' : '');
    const head = columns
      .map((column, index) => `<th scope="col"${align(index)}>${escapeText(str(column))}</th>`)
      .join('');
    const body = rows
      .map((row) => {
        const cells = (Array.isArray(row) ? row : [])
          .map((cell, index) => `<td${align(index)}>${escapeText(str(cell))}</td>`)
          .join('');
        return `<tr>${cells}</tr>`;
      })
      .join('');
    return element(
      'section',
      nodeAttributes(node, { class: 'ak-block' }),
      [
        title === '' ? '' : heading(2, title),
        // The visible heading already names the table, so the caption stays for
        // assistive technology only instead of printing the title twice.
        `<div class="ak-table-wrap"><table>${title === '' ? '' : `<caption class="ak-sr">${escapeText(title)}</caption>`}<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`,
      ].join(''),
    );
  },

  comparison: (node) => {
    const left = isPlainObject(node.props.left) ? node.props.left : {};
    const right = isPlainObject(node.props.right) ? node.props.right : {};
    const side = (sideValue: Record<string, JsonValue>): string =>
      `<div class="ak-surface"><h3>${escapeText(str(sideValue.label))}</h3><ul>${(Array.isArray(
        sideValue.items,
      )
        ? sideValue.items
        : []
      )
        .map((item) => `<li>${escapeText(str(item))}</li>`)
        .join('')}</ul></div>`;
    return element(
      'section',
      nodeAttributes(node, { class: 'ak-block' }),
      [titleHeader(node), `<div class="ak-compare">${side(left)}${side(right)}</div>`].join(''),
    );
  },

  'risk-matrix': (node) => {
    const items = objectListProp(node, 'items');
    return element(
      'section',
      nodeAttributes(node, { class: 'ak-block' }),
      [
        titleHeader(node),
        `<div class="ak-table-wrap"><table><caption>Risk by impact and likelihood</caption><thead><tr><th scope="col">Area</th><th scope="col">Impact</th><th scope="col">Likelihood</th><th scope="col">Note</th></tr></thead><tbody>${items
          .map(
            (item) =>
              `<tr><th scope="row">${escapeText(str(item.area))}</th><td>${toneBadge(
                str(item.impact),
              )}</td><td>${toneBadge(str(item.likelihood))}</td><td>${escapeInlineText(
                str(item.note),
              )}</td></tr>`,
          )
          .join('')}</tbody></table></div>`,
      ].join(''),
    );
  },

  'diff-summary': (node) => {
    const items = objectListProp(node, 'items');
    const header = titleHeader(node);
    // A visible block title already names the table; the caption then stays for screen readers only.
    const caption = header === '' ? '<caption>' : '<caption class="ak-sr">';
    return element(
      'section',
      nodeAttributes(node, { class: 'ak-block' }),
      [
        header,
        `<div class="ak-table-wrap"><table>${caption}Changed files</caption><thead><tr><th scope="col">Path</th><th scope="col">Status</th><th scope="col" class="ak-num">Additions</th><th scope="col" class="ak-num">Deletions</th></tr></thead><tbody>${items
          .map(
            (item) =>
              `<tr><th scope="row"><code>${escapeText(str(item.path))}</code></th><td>${toneBadge(
                str(item.status),
              )}</td>${lineCountCell(numProp(item.additions, 0), 'add')}${lineCountCell(
                numProp(item.deletions, 0),
                'del',
              )}</tr>`,
          )
          .join('')}</tbody></table></div>`,
      ].join(''),
    );
  },

  'code-review': (node) => {
    const items = objectListProp(node, 'items');
    return element(
      'section',
      nodeAttributes(node, { class: 'ak-block' }),
      [
        titleHeader(node),
        `<ul class="ak-grid" data-ak-columns="2">${items
          .map(
            (item) =>
              `<li class="ak-card ak-surface" data-tone="${valueTone(str(item.kind))}"><p class="ak-label">${escapeText(
                str(item.kind),
              )}</p><p><strong>${escapeText(str(item.title))}</strong></p><p>${escapeInlineText(
                str(item.text),
              )}</p></li>`,
          )
          .join('')}</ul>`,
      ].join(''),
    );
  },

  tabs: (node) => {
    const items = objectListProp(node, 'items');
    const base = node.id;
    const tabs = items
      .map((item, index) => {
        const tabId = str(item.id, `${base}-tab-${index}`);
        return `<button type="button" role="tab" id="${escapeAttribute(
          tabId,
        )}" data-ak-tab-id="${escapeAttribute(tabId)}" aria-controls="${escapeAttribute(
          `${base}-panel-${index}`,
        )}" aria-selected="${index === 0 ? 'true' : 'false'}" tabindex="${index === 0 ? '0' : '-1'}">${escapeText(
          str(item.title),
        )}</button>`;
      })
      .join('');
    const panels = items
      .map(
        (item, index) =>
          `<div role="tabpanel" id="${escapeAttribute(`${base}-panel-${index}`)}" aria-labelledby="${escapeAttribute(
            str(item.id, `${base}-tab-${index}`),
          )}" tabindex="${index === 0 ? '0' : '-1'}"${index === 0 ? '' : ' hidden'}>${escapeInlineText(
            str(item.text),
          )}</div>`,
      )
      .join('');
    return element(
      'section',
      nodeAttributes(node, { class: 'ak-block ak-tabs', 'data-ak-tabs': 'true' }),
      [
        titleHeader(node),
        `<div role="tablist" aria-label="${escapeAttribute(stringProp(node, 'title', 'Tabs'))}">${tabs}</div>${panels}`,
      ].join(''),
    );
  },

  accordion: (node) => {
    const items = objectListProp(node, 'items');
    return element(
      'section',
      nodeAttributes(node, { class: 'ak-block ak-accordion' }),
      [
        titleHeader(node),
        items
          .map(
            (item, index) =>
              // Each disclosure carries its own id so a declarative expand or
              // collapse action can address one section. Native <details> remains
              // the behavior; the action only drives it.
              `<details${index === 0 ? ' open' : ''}${renderAttributes({
                'data-ak-id': `${node.id}-item-${index}`,
              })}><summary>${escapeText(str(item.title))}</summary><p>${escapeInlineText(
                str(item.text),
              )}</p></details>`,
          )
          .join(''),
      ].join(''),
    );
  },

  carousel: (node) => {
    const items = objectListProp(node, 'items');
    const label = stringProp(node, 'ariaLabel', 'Carousel');
    const slides = items
      .map(
        (item, index) =>
          `<div class="ak-carousel-slide" data-ak-slide tabindex="-1" aria-hidden="${
            index === 0 ? 'false' : 'true'
          }"${index === 0 ? '' : ' hidden'}><h3>${escapeText(str(item.title))}</h3><p>${escapeInlineText(
            str(item.text),
          )}</p></div>`,
      )
      .join('');
    return element(
      'section',
      nodeAttributes(node, {
        class: 'ak-block ak-carousel',
        'data-ak-carousel-root': 'true',
        role: 'group',
        'aria-roledescription': 'carousel',
        'aria-label': label,
      }),
      [
        `<div class="ak-carousel-slides">${slides}</div>`,
        `<div class="ak-carousel-controls">
<button type="button" class="ak-btn" data-ak-carousel="prev" aria-label="Previous slide">Previous</button>
<button type="button" class="ak-btn" data-ak-carousel="next" aria-label="Next slide">Next</button>
<span class="ak-carousel-status" data-ak-carousel-status aria-live="polite">1 / ${Math.max(items.length, 1)}</span>
</div>`,
      ].join(''),
    );
  },

  toolbar: (node) => {
    const items = objectListProp(node, 'items');
    return element(
      'div',
      nodeAttributes(node, { class: 'ak-block ak-toolbar', role: 'toolbar' }),
      [
        titleHeader(node),
        ...items.map((item) => {
          const kind = str(item.type);
          if (kind === 'badge') {
            return `<span class="ak-badge" data-tone="${escapeAttribute(
              str(item.tone, 'neutral'),
            )}">${escapeText(str(item.text))}</span>`;
          }
          if (kind === 'link') {
            const href = str(item.href);
            return `<a${renderAttributes({
              href: escapeUrl(href),
              rel: 'noreferrer noopener',
              ...clickAttribute(isPlainObject(item.on) ? item.on : {}),
            })}>${escapeText(str(item.label))}</a>`;
          }
          if (kind === 'button') {
            const on = isPlainObject(item.on) ? item.on : {};
            return `<button type="button" class="ak-btn"${renderAttributes({
              'data-variant': str(item.variant, 'secondary'),
              'data-ak-id': str(item.id) === '' ? undefined : str(item.id),
              ...clickAttribute(on),
            })}>${escapeText(str(item.label))}</button>`;
          }
          return '';
        }),
      ].join(''),
    );
  },

  chart: (node) => {
    const series: ChartSeries[] = objectListProp(node, 'series').map((entry) => ({
      label: str(entry.label),
      values: (Array.isArray(entry.values) ? entry.values : []).map((value) => numProp(value, 0)),
    }));
    const description = stringProp(node, 'description');
    const title = stringProp(node, 'title');
    return `<div${renderAttributes(nodeAttributes(node, { class: 'ak-block' }))}>${renderChart({
      kind: stringProp(node, 'kind', 'bar'),
      id: node.id,
      labels: listProp(node, 'labels').map((label) => str(label)),
      series,
      ...(title === '' ? {} : { title }),
      ...(description === '' ? {} : { description }),
    })}</div>`;
  },

  'diagram-panel': (node, context) => {
    const spec = isPlainObject(node.props.spec) ? node.props.spec : {};
    const asObjects = (value: unknown): Record<string, JsonValue>[] =>
      (Array.isArray(value) ? value.filter(isPlainObject) : []) as Record<string, JsonValue>[];
    const described = [...asObjects(spec.components), ...asObjects(spec.nodes)];
    const edges = asObjects(spec.connections);
    const meta = isPlainObject(spec.meta) ? (spec.meta as Record<string, JsonValue>) : {};
    const diagramTitle = str(meta.title, stringProp(node, 'title', 'Diagram'));
    const caption = stringProp(node, 'caption');

    // The semantic fallback is always available: it is the only rendering when
    // no adapter is installed, and it stays in the document as the accessible
    // description when one is.
    const fallbackBody = renderDiagramFallback(described, edges);

    const adapterResult = runDiagramAdapter(context.diagramAdapter, {
      spec: (node.props.spec ?? null) as JsonValue,
      title: diagramTitle,
      nodeId: node.id,
    });
    if (adapterResult?.rejected !== undefined) {
      context.warnings?.push({
        code: 'POLICY_VIOLATION',
        severity: 'warning',
        path: `$.blocks.${node.id}`,
        message: `diagram adapter "${adapterResult.adapter}" output was rejected (${adapterResult.rejected}); the structured fallback is used`,
      });
    }
    if (adapterResult?.removedInlineStyles !== undefined) {
      context.warnings?.push({
        code: 'POLICY_VIOLATION',
        severity: 'warning',
        path: `$.blocks.${node.id}`,
        message: `diagram adapter "${adapterResult.adapter}" output had ${adapterResult.removedInlineStyles} inline style attribute(s), which the page Content Security Policy refuses; they were removed. Move those styles into a <style> element.`,
      });
    }
    const accepted =
      adapterResult !== undefined &&
      adapterResult.rejected === undefined &&
      adapterResult.markup !== '';

    const description = `<p class="ak-diagram-title">${escapeText(diagramTitle)}</p>${fallbackBody}`;

    return [
      `<figure${renderAttributes(nodeAttributes(node, { class: 'ak-block ak-diagram' }))}>`,
      titleHeader(node, 2),
      // Adapter output keeps its natural size: a wide diagram scrolls sideways
      // inside a keyboard-focusable region instead of shrinking its labels. The
      // text description then folds away behind a disclosure, so it does not
      // repeat the drawing; it stays in the document, and the static SVG reads
      // without script and in print.
      accepted
        ? `<div class="ak-diagram-rendered" data-ak-diagram-adapter="${escapeAttribute(
            adapterResult.adapter,
          )}" role="region" aria-label="${escapeAttribute(diagramTitle)}" tabindex="0">${
            adapterResult.markup
          }</div><details class="ak-diagram-details" data-ak-diagram-fallback><summary>Text description</summary><div class="ak-diagram-fallback">${description}</div></details>`
        : `<div class="ak-diagram-fallback" data-ak-diagram-fallback>${description}<p class="ak-caption">Rendered as a structured fallback because no diagram adapter is configured.</p></div>`,
      figureCaption(caption),
      '</figure>',
    ]
      .filter((part) => part !== '')
      .join('');
  },

  image: (node, context) => {
    const resolved = resolveMedia(stringProp(node, 'src'), context.ir.policy.network, 'images');
    const alt = stringProp(node, 'alt');
    const captionText = stringProp(node, 'caption');
    if (!resolved.allowed) {
      return [
        `<figure${renderAttributes(nodeAttributes(node, { class: 'ak-block ak-media' }))}>`,
        `<div class="ak-media-fallback"><p><strong>${escapeText(alt)}</strong></p><p class="ak-caption">Remote image not loaded: ${blockedReason(context.ir.policy.network, 'images')}.</p><a href="${escapeAttribute(
          resolved.src,
        )}" rel="noreferrer noopener">Open image</a></div>`,
        figureCaption(captionText),
        '</figure>',
      ].join('');
    }
    return [
      `<figure${renderAttributes(nodeAttributes(node, { class: 'ak-block ak-media' }))}>`,
      `<img src="${escapeAttribute(resolved.src)}" alt="${escapeAttribute(alt)}" loading="lazy" decoding="async" />`,
      figureCaption(captionText),
      '</figure>',
    ].join('');
  },

  gallery: (node, context) => {
    const columns = Math.min(Math.max(numberProp(node, 'columns', 3), 1), 6);
    const items = objectListProp(node, 'items');
    return element(
      'section',
      nodeAttributes(node, { class: 'ak-block' }),
      [
        titleHeader(node),
        `<ul class="ak-gallery" data-ak-columns="${columns}">${items
          .map((item) => {
            const resolved = resolveMedia(str(item.src), context.ir.policy.network, 'images');
            const captionText = str(item.caption);
            const body = resolved.allowed
              ? `<img src="${escapeAttribute(resolved.src)}" alt="${escapeAttribute(
                  str(item.alt),
                )}" loading="lazy" decoding="async" />`
              : `<a href="${escapeAttribute(resolved.src)}" rel="noreferrer noopener">${escapeText(
                  str(item.alt),
                )}</a>`;
            return `<li><figure>${body}${
              captionText === '' ? '' : `<figcaption>${escapeInlineText(captionText)}</figcaption>`
            }</figure></li>`;
          })
          .join('')}</ul>`,
      ].join(''),
    );
  },

  video: (node, context) => {
    const source = stringProp(node, 'src');
    const provider = stringProp(node, 'provider');
    const resolved = resolveMedia(source, context.ir.policy.network, 'media', provider);
    const fallback = isPlainObject(node.props.fallback) ? node.props.fallback : {};
    const captionText = stringProp(node, 'caption');
    // A poster is a still image, so it passes the same `images` gate as an image
    // block. Validation rejects a blocked remote poster; dropping it here keeps
    // the renderer safe for an IR that did not come through validation.
    const requestedPoster = stringProp(node, 'poster');
    const poster = imageReferenceAllowed(context.ir.policy.network, requestedPoster)
      ? requestedPoster
      : '';
    // A provider reference never becomes a frame, whether or not it is allowed:
    // the page links to the provider and keeps the poster, so the artifact stays
    // frame-free. Only the explanation differs between allowed and denied.
    if (provider !== '') {
      const label = EMBED_PROVIDERS[provider]?.label ?? provider;
      return [
        `<figure${renderAttributes(nodeAttributes(node, { class: 'ak-block ak-media' }))}>`,
        `<div class="ak-media-fallback">${mediaFallbackBody(
          stringProp(node, 'title'),
          str(fallback.description, `${label} content`),
          source,
          poster,
          str(fallback.linkText, `Open on ${label}`),
          resolved.allowed
            ? `Embedded players are not emitted; this page links to ${label} instead.`
            : `Embedded players are not emitted and ${blockedReason(context.ir.policy.network, 'media')}; this page links to ${label} instead.`,
        )}</div>`,
        figureCaption(captionText),
        '</figure>',
      ].join('');
    }
    if (!resolved.allowed) {
      return [
        `<figure${renderAttributes(nodeAttributes(node, { class: 'ak-block ak-media' }))}>`,
        `<div class="ak-media-fallback">${mediaFallbackBody(
          stringProp(node, 'title'),
          str(fallback.description, 'Remote video is not available on this page.'),
          str(fallback.url, source),
          poster,
          str(fallback.linkText, 'Open video'),
          `Remote media is not embedded because ${blockedReason(context.ir.policy.network, 'media')}.`,
        )}</div>`,
        figureCaption(captionText),
        '</figure>',
      ].join('');
    }
    return [
      `<figure${renderAttributes(nodeAttributes(node, { class: 'ak-block ak-media' }))}>`,
      `<video controls preload="metadata"${poster === '' ? '' : ` poster="${escapeAttribute(escapeUrl(poster))}"`}><source src="${escapeAttribute(
        resolved.src,
      )}" />${escapeInlineText(str(fallback.description, 'Video content'))}</video>`,
      figureCaption(captionText),
      '</figure>',
    ].join('');
  },

  audio: (node, context) => {
    const source = stringProp(node, 'src');
    const provider = stringProp(node, 'provider');
    const resolved = resolveMedia(source, context.ir.policy.network, 'media', provider);
    const fallback = isPlainObject(node.props.fallback) ? node.props.fallback : {};
    const captionText = stringProp(node, 'caption');
    // A provider reference never becomes a frame, whether or not it is allowed:
    // the page links to the provider. Only the explanation differs.
    if (provider !== '') {
      const label = EMBED_PROVIDERS[provider]?.label ?? provider;
      return [
        `<figure${renderAttributes(nodeAttributes(node, { class: 'ak-block ak-media' }))}>`,
        `<div class="ak-media-fallback">${mediaFallbackBody(
          stringProp(node, 'title'),
          str(fallback.description, `${label} audio`),
          source,
          '',
          str(fallback.linkText, `Open on ${label}`),
          resolved.allowed
            ? `Embedded players are not emitted; this page links to ${label} instead.`
            : `Embedded players are not emitted and ${blockedReason(context.ir.policy.network, 'media')}; this page links to ${label} instead.`,
        )}</div>`,
        figureCaption(captionText),
        '</figure>',
      ].join('');
    }
    if (!resolved.allowed) {
      return [
        `<figure${renderAttributes(nodeAttributes(node, { class: 'ak-block ak-media' }))}>`,
        `<div class="ak-media-fallback">${mediaFallbackBody(
          stringProp(node, 'title'),
          str(fallback.description, 'Remote audio is not available on this page.'),
          str(fallback.url, source),
          '',
          str(fallback.linkText, 'Open audio'),
          `Remote media is not embedded because ${blockedReason(context.ir.policy.network, 'media')}.`,
        )}</div>`,
        figureCaption(captionText),
        '</figure>',
      ].join('');
    }
    return [
      `<figure${renderAttributes(nodeAttributes(node, { class: 'ak-block ak-media' }))}>`,
      `<audio controls preload="metadata" src="${escapeAttribute(resolved.src)}">${escapeInlineText(
        str(fallback.description, 'Audio content'),
      )}</audio>`,
      figureCaption(captionText),
      '</figure>',
    ].join('');
  },

  button: (node) => {
    const variant = stringProp(node, 'variant', 'secondary');
    return `<button type="button"${renderAttributes({
      class: 'ak-btn',
      'data-variant': variant,
      ...nodeAttributes(node, {}),
      ...clickAttribute(node.bindings),
    })}>${escapeText(stringProp(node, 'label'))}</button>`;
  },

  link: (node) => {
    const href = stringProp(node, 'href');
    return `<a${renderAttributes({
      href: escapeUrl(href),
      rel: 'noreferrer noopener',
      ...nodeAttributes(node, {}),
    })}>${escapeText(stringProp(node, 'label'))}</a>`;
  },

  slider: (node) => {
    const min = numberProp(node, 'min', 0);
    const max = numberProp(node, 'max', 100);
    const step = numberProp(node, 'step', 1);
    const value = Math.min(Math.max(numberProp(node, 'value', min), min), max);
    const inputId = `${node.id}-input`;
    const outputId = `${node.id}-output`;
    return [
      `<div${renderAttributes(nodeAttributes(node, { class: 'ak-block ak-slider' }))}>`,
      `<label for="${escapeAttribute(inputId)}">${escapeText(stringProp(node, 'label'))}</label>`,
      `<input type="range" id="${escapeAttribute(inputId)}" data-ak-slider min="${min}" max="${max}" step="${step}" value="${value}" aria-describedby="${escapeAttribute(
        outputId,
      )}" />`,
      `<output id="${escapeAttribute(outputId)}" for="${escapeAttribute(inputId)}" data-ak-slider-output>${value}</output>`,
      '</div>',
    ].join('');
  },

  search: (node) => {
    const inputId = `${node.id}-input`;
    return [
      `<div${renderAttributes(nodeAttributes(node, { class: 'ak-block ak-search' }))}>`,
      `<label for="${escapeAttribute(inputId)}">${escapeText(stringProp(node, 'label'))}</label>`,
      `<input type="search" id="${escapeAttribute(inputId)}" data-ak-search="${escapeAttribute(
        searchTarget(node),
      )}" data-ak-match="${escapeAttribute(searchMatch(node))}" placeholder="${escapeAttribute(
        stringProp(node, 'placeholder'),
      )}" />`,
      '</div>',
    ].join('');
  },

  dialog: (node) => {
    const actions = objectListProp(node, 'actions');
    const text = stringProp(node, 'text');
    return [
      `<dialog${renderAttributes(
        nodeAttributes(node, {
          class: 'ak-dialog',
          'aria-label': stringProp(node, 'ariaLabel', stringProp(node, 'title')),
        }),
      )}>`,
      heading(2, stringProp(node, 'title'), 'ak-dialog-title'),
      text === '' ? '' : `<p>${escapeInlineText(text)}</p>`,
      `<div class="ak-dialog-actions">${actions
        .map((action) => {
          const on = isPlainObject(action.on) ? action.on : {};
          return `<button type="button" class="ak-btn"${renderAttributes(
            clickAttribute(on),
          )}>${escapeText(str(action.label))}</button>`;
        })
        .join('')}<button type="button" class="ak-btn" data-ak-dialog-close>Close</button></div>`,
      '</dialog>',
    ].join('');
  },
};

/** The collection a `search` block filters, taken from its filter binding. */
function searchTarget(node: IrNode): string {
  for (const actions of Object.values(node.bindings)) {
    for (const action of actions) {
      const target = action.target;
      if (typeof target === 'string') return target;
    }
  }
  return '';
}

function searchMatch(node: IrNode): string {
  for (const actions of Object.values(node.bindings)) {
    for (const action of actions) {
      const match = action.match;
      if (typeof match === 'string') return match;
    }
  }
  return 'text';
}

/** Render one node, falling back to an empty string for an unregistered type. */
export function renderNode(node: IrNode, context: RenderContext): string {
  const renderer = RENDERERS[node.type] ?? NO_OP_RENDERER;
  return renderer(node, context);
}

/** True when a renderer exists for the type. */
export function hasRenderer(type: string): boolean {
  return RENDERERS[type] !== undefined;
}

export { element, nodeAttributes };
