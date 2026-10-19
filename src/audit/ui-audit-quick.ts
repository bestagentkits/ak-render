/**
 * The quick audit-ui preset: structural visual-quality checks with no browser.
 * This module imports nothing Node-only, so the remote MCP Worker runs it too.
 *
 * It reads the resolved theme (when the audit compiled the spec) and the
 * compiled markup as text. It never executes the page, so it is cheap enough
 * to run on every render; the publication preset measures what only a browser
 * can.
 */

import type { IrDocument } from '../ir.js';
import { type CompileResult, compile } from '../render/render.js';
import type { ResolvedTheme } from '../theme/load-theme.js';
import type { ThemeCatalog } from '../theme/theme-catalog.js';
import type { Tokens } from '../theme/tokens.js';
import { contrastRatio } from './color-contrast.js';
import {
  buildUiReport,
  type UiAuditReport,
  type UiColorScheme,
  type UiFinding,
  uiFinding,
} from './ui-audit-report.js';

/** A table this many columns wide is read by scrolling sideways on a phone. */
export const WIDE_TABLE_COLUMNS = 7;

/** Chart category labels longer than this crowd the axis at narrow widths. */
export const LONG_CHART_LABEL = 16;

const SURFACES = ['background', 'surface', 'surface-raised'] as const;
const TONES = ['accent', 'info', 'success', 'warning', 'danger'] as const;

/** Every text/surface pair the theme draws, with the WCAG AA minimum. */
const CONTRAST_PAIRS: readonly [foreground: string, background: string][] = [
  ...SURFACES.map((surface): [string, string] => ['text', surface]),
  ...SURFACES.map((surface): [string, string] => ['text-muted', surface]),
  ['accent-contrast', 'accent'],
  ...TONES.flatMap((tone) => SURFACES.map((surface): [string, string] => [tone, surface])),
];

const AA_TEXT = 4.5;

function themeContrastFindings(tokens: Tokens, scheme: UiColorScheme, path: string): UiFinding[] {
  return CONTRAST_PAIRS.flatMap(([foreground, background]) => {
    const fg = tokens[`color-${foreground}`];
    const bg = tokens[`color-${background}`];
    if (fg === undefined || bg === undefined) return [];
    const ratio = contrastRatio(fg, bg);
    if (ratio >= AA_TEXT) return [];
    return [
      uiFinding('ui/theme-contrast', {
        message: `color-${foreground} on color-${background} is ${ratio.toFixed(2)}:1 in the ${scheme} scheme, below 4.5:1`,
        path,
        scheme,
        evidence: `color-${foreground}=${fg} color-${background}=${bg} ratio=${ratio.toFixed(2)}`,
      }),
    ];
  });
}

interface BlockLocator {
  /** The innermost block whose opening tag precedes `index` in the markup. */
  at(index: number): { nodeId?: string; path: string; blockType?: string };
}

/**
 * Locate markup positions by the nearest preceding `data-ak-id`. Blocks nest,
 * so this is the innermost block that opened before the position: exact for
 * the tables and charts this preset reads, which hold no nested blocks.
 */
function blockLocator(markup: string, ir: IrDocument | undefined): BlockLocator {
  const marks = [...markup.matchAll(/data-ak-id="([^"<>]+)"/gu)].map((match) => ({
    index: match.index,
    id: match[1] ?? '',
  }));
  const nodes = new Map((ir?.nodes ?? []).map((node) => [node.id, node]));
  return {
    at(index) {
      let found: string | undefined;
      for (const mark of marks) {
        if (mark.index > index) break;
        found = mark.id;
      }
      if (found === undefined) return { path: ir === undefined ? 'html' : '$' };
      const node = nodes.get(found);
      return node === undefined
        ? { nodeId: found, path: 'html' }
        : { nodeId: found, path: node.path, blockType: node.type };
    },
  };
}

function decodeText(text: string): string {
  return text
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&amp;/gu, '&')
    .trim();
}

function wideTableFindings(markup: string, locate: BlockLocator): UiFinding[] {
  const findings: UiFinding[] = [];
  const marker = '<div class="ak-table-wrap';
  for (let at = markup.indexOf(marker); at !== -1; ) {
    const end = markup.indexOf('</table>', at);
    if (end === -1) break;
    const table = markup.slice(at, end);
    const index = at;
    at = markup.indexOf(marker, end);
    const head = between(table, '<thead>', '</thead>') ?? '';
    const row = between(head, '<tr', '</tr>') ?? '';
    const columns = (row.match(/<th[\s>]/gu) ?? []).length;
    if (columns < WIDE_TABLE_COLUMNS) continue;
    findings.push(
      uiFinding('ui/wide-table', {
        message: `table has ${columns} columns; on a 375px screen it is read by scrolling sideways`,
        ...locate.at(index),
        viewport: '375x812',
        evidence: `columns=${columns} threshold=${WIDE_TABLE_COLUMNS}`,
      }),
    );
  }
  return findings;
}

function longChartLabelFindings(markup: string, locate: BlockLocator): UiFinding[] {
  const longest = new Map<string, { label: string; count: number; at: number }>();
  for (const match of markup.matchAll(
    /<text class="ak-chart-label[^"<>]*"[^<>]*>([^<]*)<\/text>/gu,
  )) {
    const label = decodeText(match[1] ?? '');
    if ([...label].length <= LONG_CHART_LABEL) continue;
    const block = locate.at(match.index);
    const key = block.nodeId ?? block.path;
    const current = longest.get(key);
    if (current === undefined) longest.set(key, { label, count: 1, at: match.index });
    else {
      current.count += 1;
      if ([...label].length > [...current.label].length) current.label = label;
    }
  }
  return [...longest.values()].map(({ label, count, at }) =>
    uiFinding('ui/long-chart-label', {
      message: `${count} chart label(s) longer than ${LONG_CHART_LABEL} characters; the longest is "${label}"`,
      ...locate.at(at),
      evidence: `longest=${[...label].length} threshold=${LONG_CHART_LABEL} count=${count}`,
    }),
  );
}

/** ASCII-only lowercase, so every index still lines up with the original. */
function asciiLower(text: string): string {
  return text.replace(/[A-Z]+/gu, (run) => run.toLowerCase());
}

/**
 * Empty every `<tag>` element. One forward scan: an element with no closing
 * tag runs to the end of the input, as it does in a browser, so unbalanced
 * markup costs no more than balanced markup.
 */
function emptyElements(html: string, tag: string): string {
  const lower = asciiLower(html);
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let out = '';
  let from = 0;
  let at = lower.indexOf(open);
  while (at !== -1) {
    const next = lower[at + open.length] ?? '';
    if (/[a-z0-9-]/u.test(next)) {
      at = lower.indexOf(open, at + 1);
      continue;
    }
    out += `${html.slice(from, at)}<${tag}></${tag}>`;
    const end = lower.indexOf(close, at);
    if (end === -1) return out;
    from = end + close.length;
    at = lower.indexOf(open, from);
  }
  return out + html.slice(from);
}

/** Keep only markup: scripts and styles are not content. */
function markupOnly(html: string): string {
  return emptyElements(emptyElements(html, 'script'), 'style');
}

/** The text between `open` and the next `close` after `from`, by plain search. */
function between(text: string, open: string, close: string, from = 0): string | undefined {
  const start = text.indexOf(open, from);
  if (start === -1) return undefined;
  const end = text.indexOf(close, start + open.length);
  return end === -1 ? undefined : text.slice(start + open.length, end);
}

export interface QuickAuditInput {
  html: string;
  /** Present when the audit compiled the spec: blocks map to spec paths. */
  ir?: IrDocument;
  theme?: ResolvedTheme;
}

export function quickUiFindings(input: QuickAuditInput): UiFinding[] {
  const markup = markupOnly(input.html);
  const locate = blockLocator(markup, input.ir);
  const findings: UiFinding[] = [];
  if (input.theme !== undefined) {
    findings.push(...themeContrastFindings(input.theme.light, 'light', '$.theme'));
    findings.push(...themeContrastFindings(input.theme.dark, 'dark', '$.theme'));
  }
  findings.push(...wideTableFindings(markup, locate));
  findings.push(...longChartLabelFindings(markup, locate));
  return findings;
}

export interface UiQuickOptions {
  /** Label for diagnostics when the input is a spec. */
  source?: string;
  /** Theme preset override, as `render` takes it. */
  theme?: string;
  themeCatalog?: ThemeCatalog;
}

export interface PreparedUiInput {
  input: 'spec' | 'html';
  html: string;
  compiled?: CompileResult;
}

/** True for input that is already a compiled page rather than a spec. */
export function isHtmlInput(input: unknown): input is string {
  return typeof input === 'string' && /^\uFEFF?\s*</u.test(input);
}

/** Compile a spec, or take compiled HTML as it is. Throws a `RenderError` for an invalid spec. */
export function prepareUiInput(input: unknown, options: UiQuickOptions): PreparedUiInput {
  if (isHtmlInput(input)) return { input: 'html', html: input };
  const compiled = compile(input as Parameters<typeof compile>[0], {
    source: options.source ?? '<spec>',
    ...(options.themeCatalog === undefined ? {} : { themeCatalog: options.themeCatalog }),
    ...(options.theme === undefined ? {} : { theme: options.theme }),
  });
  return { input: 'spec', html: compiled.html, compiled };
}

export function preparedQuickFindings(prepared: PreparedUiInput): UiFinding[] {
  return quickUiFindings({
    html: prepared.html,
    ...(prepared.compiled === undefined
      ? {}
      : { ir: prepared.compiled.ir, theme: prepared.compiled.theme }),
  });
}

/** The quick preset, synchronously. Throws a `RenderError` for an invalid spec. */
export function auditUiQuick(input: unknown, options: UiQuickOptions = {}): UiAuditReport {
  const prepared = prepareUiInput(input, options);
  return buildUiReport(
    {
      preset: 'quick',
      input: prepared.input,
      complete: true,
      scripts: 'none',
      checks: [],
      budget: { timeoutMs: 0, network: 'blocked' },
      blockedRequests: 0,
    },
    preparedQuickFindings(prepared),
  );
}
