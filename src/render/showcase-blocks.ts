/**
 * Showcase block renderers.
 *
 * Blocks that present work rather than structure it: a bento mosaic, a ticker,
 * a terminal session, a file tree, a before/after slider, KPI cards with
 * sparklines, a framed feature spotlight, and a checklist.
 *
 * The same rules as `blocks.ts` apply: pure functions of the node and the IR,
 * exactly one `data-ak-id` per block, no style attributes or handlers. Every
 * motion these blocks get comes from CSS or the runtime, and the markup is
 * complete without either, so the content reads the same in a PDF, a
 * screenshot, or with script disabled.
 */

import type { IrNode, NetworkPolicy } from '../ir.js';
import { isPlainObject, type JsonValue } from '../json.js';
import {
  blockedReason,
  element,
  figureCaption,
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
import {
  escapeAttribute,
  escapeInlineText,
  escapeText,
  escapeUrl,
  renderAttributes,
} from './escape.js';

/** Minimal render context the showcase renderers need. */
export interface ShowcaseContext {
  ir: { policy: { network: NetworkPolicy } };
}

type ShowcaseRenderer = (node: IrNode, context: ShowcaseContext) => string;

/** An image allowed by the policy, or an honest note when it is not. */
export function framedImage(
  source: string,
  alt: string,
  policy: NetworkPolicy,
  loading: 'lazy' | 'eager' = 'lazy',
): string {
  const resolved = resolveMedia(source, policy, 'images');
  if (!resolved.allowed) {
    // The alt text still describes the picture, so it leads the note.
    const subject = alt === '' ? '' : `<strong>${escapeText(alt)}</strong>. `;
    return `<p class="ak-caption">${subject}Remote image not loaded: ${blockedReason(policy, 'images')}. <a href="${escapeAttribute(
      resolved.src,
    )}" rel="noreferrer noopener">Open image</a></p>`;
  }
  return `<img src="${escapeAttribute(resolved.src)}" alt="${escapeAttribute(alt)}" loading="${loading}" decoding="async" />`;
}

/** Browser chrome (decorative) around an image: the bar, then the viewport. */
export function browserShot(
  source: string,
  alt: string,
  address: string,
  policy: NetworkPolicy,
  loading: 'lazy' | 'eager' = 'lazy',
): string {
  const bar = `<div class="ak-frame-bar" aria-hidden="true"><span class="ak-window-dots"><span></span><span></span><span></span></span>${
    address === '' ? '' : `<span class="ak-frame-address">${escapeText(address)}</span>`
  }</div>`;
  return `${bar}<div class="ak-frame-view">${framedImage(source, alt, policy, loading)}</div>`;
}

export function paragraph(className: string, text: string): string {
  return text === '' ? '' : `<p class="${className}">${escapeText(text)}</p>`;
}

/** A paragraph of prose: backtick spans become inline code. */
export function prose(className: string, text: string): string {
  return text === '' ? '' : `<p class="${className}">${escapeInlineText(text)}</p>`;
}

// --- marquee ----------------------------------------------------------------

function marquee(node: IrNode): string {
  const items = listProp(node, 'items').filter((item): item is string => typeof item === 'string');
  const entries = items.map((item) => `<li>${escapeText(item)}</li>`).join('');
  const speed = stringProp(node, 'speed', 'normal');
  // The first track is the real list. The second repeats it so the loop has no
  // seam; it is hidden from assistive technology and only shown while moving.
  return element(
    'section',
    nodeAttributes(node, {
      class: 'ak-block ak-marquee',
      'data-speed': ['slow', 'normal', 'fast'].includes(speed) ? speed : 'normal',
      'aria-label': stringProp(node, 'label', 'Highlights'),
    }),
    `<div class="ak-marquee-viewport"><ul class="ak-marquee-track">${entries}</ul><ul class="ak-marquee-track" aria-hidden="true">${entries}</ul></div>`,
  );
}

// --- terminal ---------------------------------------------------------------

const LINE_KINDS = new Set(['command', 'output', 'comment', 'success', 'error']);

function terminal(node: IrNode): string {
  const title = stringProp(node, 'title', 'Terminal');
  const lines = objectListProp(node, 'lines').map((line) => {
    const kind = LINE_KINDS.has(str(line.kind)) ? str(line.kind) : 'output';
    return `<span class="ak-term-line" data-kind="${kind}">${escapeText(str(line.text))}</span>`;
  });
  const copy = renderAttributes({
    'data-ak-on-click': JSON.stringify([{ action: 'copy', target: node.id }]),
    'aria-label': `Copy ${title}`,
  });
  // The whole bar is the figure's caption, so the caption is a direct child of
  // the figure. The figure is named by the title alone, not the copy control.
  return [
    `<figure class="ak-block ak-terminal" aria-label="${escapeAttribute(title)}" data-ak-animate>`,
    '<figcaption class="ak-terminal-bar">',
    '<span class="ak-window-dots" aria-hidden="true"><span></span><span></span><span></span></span>',
    `<span class="ak-terminal-title">${escapeText(title)}</span>`,
    `<button type="button" class="ak-code-copy"${copy}>Copy</button>`,
    '</figcaption>',
    `<pre${renderAttributes({ 'data-ak-id': node.id, class: 'ak-terminal-body' })}>${lines.join('\n')}</pre>`,
    '</figure>',
  ].join('');
}

// --- file tree --------------------------------------------------------------

const FILE_STATUSES = new Set(['added', 'modified', 'deleted', 'renamed', 'unchanged']);

interface TreeFile {
  name: string;
  status: string;
  note: string;
}

interface TreeDir {
  name: string;
  dirs: Map<string, TreeDir>;
  files: TreeFile[];
}

function newDir(name: string): TreeDir {
  return { name, dirs: new Map(), files: [] };
}

/** Build a folder tree from slash-separated paths; a trailing slash names an empty folder. */
export function buildFileTree(items: Record<string, JsonValue>[]): TreeDir {
  const root = newDir('');
  for (const item of items) {
    const parts = str(item.path)
      .split('/')
      .map((part) => part.trim())
      .filter((part) => part !== '' && part !== '.');
    const isFolder = str(item.path).endsWith('/');
    let cursor = root;
    const folders = isFolder ? parts : parts.slice(0, -1);
    for (const part of folders) {
      let next = cursor.dirs.get(part);
      if (next === undefined) {
        next = newDir(part);
        cursor.dirs.set(part, next);
      }
      cursor = next;
    }
    const name = parts[parts.length - 1];
    if (!isFolder && name !== undefined) {
      const status = FILE_STATUSES.has(str(item.status)) ? str(item.status) : 'unchanged';
      cursor.files.push({ name, status, note: str(item.note) });
    }
  }
  return root;
}

/** Fold a chain of single-folder directories into one `a/b/c` entry, as editors do. */
function compact(dir: TreeDir): TreeDir {
  let current = dir;
  let name = dir.name;
  while (current.files.length === 0 && current.dirs.size === 1) {
    const [only] = current.dirs.values();
    if (only === undefined) break;
    name = `${name}/${only.name}`;
    current = only;
  }
  return { ...current, name };
}

/**
 * Case-insensitive order with a code-point tie-break. No `localeCompare`: its
 * collation comes from the runtime's ICU data, which would let the same spec
 * emit different bytes on different Node builds.
 */
function byName<T extends { name: string }>(left: T, right: T): number {
  const a = left.name.toLowerCase();
  const b = right.name.toLowerCase();
  if (a !== b) return a < b ? -1 : 1;
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

function treeEntries(dir: TreeDir): string {
  const dirs = [...dir.dirs.values()].map(compact).sort(byName);
  const files = [...dir.files].sort(byName);
  return [
    ...dirs.map(
      (child) =>
        `<li><details open><summary><span class="ak-tree-name" data-kind="folder">${escapeText(
          child.name,
        )}/</span></summary><ul>${treeEntries(child)}</ul></details></li>`,
    ),
    ...files.map(
      (file) =>
        `<li data-status="${file.status}"><span class="ak-tree-name" data-kind="file">${escapeText(
          file.name,
        )}</span>${file.status === 'unchanged' ? '' : `<span class="ak-tree-status">${file.status}</span>`}${
          file.note === '' ? '' : `<span class="ak-tree-note">${escapeText(file.note)}</span>`
        }</li>`,
    ),
  ].join('');
}

function fileTree(node: IrNode): string {
  const items = objectListProp(node, 'items');
  const counts = new Map<string, number>();
  for (const item of items) {
    const status = str(item.status, 'unchanged');
    if (status !== 'unchanged' && FILE_STATUSES.has(status)) {
      counts.set(status, (counts.get(status) ?? 0) + 1);
    }
  }
  const summary = ['added', 'modified', 'renamed', 'deleted']
    .filter((status) => counts.has(status))
    .map(
      (status) =>
        `<li data-status="${status}"><strong>${counts.get(status)}</strong> ${status}</li>`,
    )
    .join('');
  return element(
    'section',
    nodeAttributes(node, { class: 'ak-block ak-tree-block' }),
    [
      titleHeader(node),
      '<div class="ak-tree-panel">',
      summary === '' ? '' : `<ul class="ak-tree-summary">${summary}</ul>`,
      `<ul class="ak-tree">${treeEntries(buildFileTree(items))}</ul>`,
      '</div>',
    ].join(''),
  );
}

// --- before / after ---------------------------------------------------------

function beforeAfter(node: IrNode, context: ShowcaseContext): string {
  const side = (key: 'before' | 'after', fallbackLabel: string) => {
    const value = node.props[key];
    const item = isPlainObject(value) ? value : {};
    return {
      image: framedImage(str(item.src), str(item.alt), context.ir.policy.network),
      label: str(item.label, fallbackLabel),
    };
  };
  const before = side('before', 'Before');
  const after = side('after', 'After');
  const start = Math.min(Math.max(Math.round(numberProp(node, 'start', 50)), 0), 100);
  const title = stringProp(node, 'title');
  // Without script the two images sit side by side. The runtime switches the
  // stage to the overlay and keeps `--ak-split` in step with the range input.
  return [
    `<figure${renderAttributes(nodeAttributes(node, { class: 'ak-block ak-ba', 'data-ak-before-after': '' }))}>`,
    titleHeader(node),
    '<div class="ak-ba-stage">',
    `<div class="ak-ba-pane" data-side="before">${before.image}<span class="ak-ba-label">${escapeText(before.label)}</span></div>`,
    `<div class="ak-ba-pane" data-side="after">${after.image}<span class="ak-ba-label">${escapeText(after.label)}</span></div>`,
    '<span class="ak-ba-handle" aria-hidden="true"></span>',
    `<input type="range" class="ak-ba-range" min="0" max="100" step="1" value="${start}" aria-label="${escapeAttribute(
      `Reveal ${before.label} or ${after.label}${title === '' ? '' : ` of ${title}`}`,
    )}" />`,
    '</div>',
    figureCaption(stringProp(node, 'caption')),
    '</figure>',
  ].join('');
}

// --- kpi --------------------------------------------------------------------

const SPARK_WIDTH = 120;
const SPARK_HEIGHT = 36;

function round(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** Line and area paths for a sparkline, scaled into a fixed view box. */
export function sparkPaths(series: number[]): {
  line: string;
  area: string;
  end: [number, number];
} {
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min;
  const step = series.length > 1 ? SPARK_WIDTH / (series.length - 1) : 0;
  const inset = 3;
  const points = series.map((value, index): [number, number] => [
    index * step,
    // A flat series sits on the midline rather than the floor.
    span === 0 ? SPARK_HEIGHT / 2 : inset + (1 - (value - min) / span) * (SPARK_HEIGHT - inset * 2),
  ]);
  const line = points
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${round(x)} ${round(y)}`)
    .join(' ');
  const last = points[points.length - 1] ?? [0, SPARK_HEIGHT / 2];
  return {
    line,
    area: `${line} L${round(last[0])} ${SPARK_HEIGHT} L0 ${SPARK_HEIGHT} Z`,
    end: last,
  };
}

function verdict(trend: string, good: string): 'good' | 'bad' | 'neutral' {
  if (trend !== 'up' && trend !== 'down') return 'neutral';
  return trend === good ? 'good' : 'bad';
}

function kpi(node: IrNode): string {
  const cards = objectListProp(node, 'items').map((item, index) => {
    const trend = str(item.trend, 'flat');
    const judged = verdict(trend, str(item.good, 'up'));
    const delta = str(item.delta);
    const series = (Array.isArray(item.series) ? item.series : [])
      .map((value) => numProp(value, Number.NaN))
      .filter(Number.isFinite);
    const arrow = trend === 'up' ? '↗' : trend === 'down' ? '↘' : '→';
    const deltaMarkup =
      delta === ''
        ? ''
        : `<p class="ak-kpi-delta"><span aria-hidden="true">${arrow}</span>${escapeText(delta)}${
            judged === 'neutral'
              ? ''
              : `<span class="ak-sr"> (${judged === 'good' ? 'improving' : 'worsening'})</span>`
          }</p>`;
    let spark = '';
    if (series.length >= 2) {
      const paths = sparkPaths(series);
      const gradient = `ak-kpi-${node.id.replace(/[^A-Za-z0-9_-]/gu, '-')}-${index}`;
      spark = [
        `<svg class="ak-kpi-spark" viewBox="0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}" preserveAspectRatio="none" aria-hidden="true" focusable="false">`,
        `<defs><linearGradient id="${gradient}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="ak-kpi-stop" /><stop offset="1" class="ak-kpi-stop ak-kpi-stop--end" /></linearGradient></defs>`,
        `<path class="ak-kpi-area" d="${paths.area}" fill="url(#${gradient})" />`,
        `<path class="ak-kpi-line" d="${paths.line}" pathLength="1" />`,
        '</svg>',
      ].join('');
    }
    return [
      `<li class="ak-kpi-card" data-verdict="${judged}">`,
      `<p class="ak-kpi-label">${escapeText(str(item.label))}</p>`,
      `<p class="ak-kpi-value" data-ak-count>${escapeText(str(item.value))}</p>`,
      deltaMarkup,
      spark,
      paragraph('ak-caption', str(item.caption)),
      '</li>',
    ].join('');
  });
  return element(
    'section',
    nodeAttributes(node, { class: 'ak-block ak-kpis', 'data-ak-animate': '' }),
    `${titleHeader(node)}<ul class="ak-kpi-grid">${cards.join('')}</ul>`,
  );
}

// --- showcase ---------------------------------------------------------------

function showcase(node: IrNode, context: ShowcaseContext): string {
  const frame = stringProp(node, 'frame', 'browser') === 'plain' ? 'plain' : 'browser';
  const address = stringProp(node, 'address');
  const bullets = listProp(node, 'bullets').filter(
    (item): item is string => typeof item === 'string',
  );
  return element(
    'section',
    nodeAttributes(node, {
      class: 'ak-block ak-showcase',
      'data-align': stringProp(node, 'align') === 'media-left' ? 'media-left' : 'media-right',
    }),
    [
      '<div class="ak-showcase-copy">',
      paragraph('ak-eyebrow', stringProp(node, 'eyebrow')),
      `<h2>${escapeText(stringProp(node, 'title'))}</h2>`,
      prose('ak-showcase-text', stringProp(node, 'text')),
      bullets.length === 0
        ? ''
        : `<ul class="ak-showcase-points">${bullets.map((item) => `<li>${escapeText(item)}</li>`).join('')}</ul>`,
      '</div>',
      `<figure class="ak-showcase-media" data-frame="${frame}">${
        frame === 'browser'
          ? browserShot(
              stringProp(node, 'src'),
              stringProp(node, 'alt'),
              address,
              context.ir.policy.network,
            )
          : `<div class="ak-frame-view">${framedImage(
              stringProp(node, 'src'),
              stringProp(node, 'alt'),
              context.ir.policy.network,
            )}</div>`
      }</figure>`,
    ].join(''),
  );
}

// --- checklist --------------------------------------------------------------

function checklist(node: IrNode): string {
  const items = objectListProp(node, 'items');
  const done = items.filter((item) => item.done === true).length;
  const title = stringProp(node, 'title');
  const progress = items.length === 0 ? 0 : Math.round((done / items.length) * 100);
  return element(
    'section',
    nodeAttributes(node, { class: 'ak-block ak-checklist' }),
    [
      `<header class="ak-checklist-head">${title === '' ? '' : `<h2>${escapeText(title)}</h2>`}<p class="ak-checklist-count"><strong>${done}</strong> of ${items.length} done</p></header>`,
      `<progress class="ak-checklist-meter" max="100" value="${progress}" aria-hidden="true">${progress}%</progress>`,
      `<ul>${items
        .map((item) => {
          const state = item.done === true ? 'done' : 'open';
          return `<li data-state="${state}"><span class="ak-check" aria-hidden="true"></span><span class="ak-check-text">${escapeText(
            str(item.text),
          )}</span><span class="ak-sr"> (${state})</span></li>`;
        })
        .join('')}</ul>`,
    ].join(''),
  );
}

// --- cta --------------------------------------------------------------------

function cta(node: IrNode): string {
  const actions = objectListProp(node, 'actions')
    .map(
      (action) =>
        `<a${renderAttributes({
          class: 'ak-btn',
          'data-variant': str(action.variant) === 'primary' ? 'primary' : 'secondary',
          href: escapeUrl(str(action.href)),
          rel: 'noreferrer noopener',
        })}>${escapeText(str(action.label))}</a>`,
    )
    .join('');
  return element(
    'section',
    nodeAttributes(node, { class: 'ak-block ak-cta', 'data-surface': 'inverse' }),
    [
      paragraph('ak-eyebrow', stringProp(node, 'eyebrow')),
      `<h2 class="ak-cta-title">${escapeText(stringProp(node, 'title'))}</h2>`,
      prose('ak-cta-text', stringProp(node, 'text')),
      actions === '' ? '' : `<div class="ak-cta-actions">${actions}</div>`,
    ].join(''),
  );
}

export const SHOWCASE_RENDERERS: Record<string, ShowcaseRenderer> = {
  marquee,
  terminal,
  'file-tree': fileTree,
  'before-after': beforeAfter,
  kpi,
  showcase,
  checklist,
  cta,
};
