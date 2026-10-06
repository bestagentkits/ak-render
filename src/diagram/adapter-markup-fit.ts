/**
 * The structural pass over diagram adapter markup.
 *
 * Adapter markup is embedded inside the page's own elements, so it must stay a
 * self-contained fragment: it may not close an element it did not open, leave
 * one open to swallow the page that follows, switch the HTML parser into a mode
 * that reads the rest of the page as text, or carry the attributes the page and
 * its runtime use as hooks. This pass walks the fragment once, in step with how
 * a browser would tokenize it, and refuses anything it cannot read the same way.
 *
 * The same walk fits accepted markup to the page's Content Security Policy:
 * `<style>` elements are marked for the page style nonce and their stylesheets
 * are filtered and scoped to the diagram canvas, and inline `style` attributes,
 * which the policy refuses, are removed and counted.
 *
 * Every step either advances past what it read or stops the walk, and no
 * pattern can scan past the next `<` except a quoted attribute value, so the
 * walk is linear in the length of the markup.
 */

import { filterAdapterStylesheet, scopeAdapterStylesheet } from './adapter-stylesheet-filter.js';

/**
 * Attribute that marks an adapter `<style>` element for the page style nonce.
 *
 * The nonce is a hash of the finished page stylesheet, which is only known
 * after every block has rendered, so the renderer marks the element and the
 * document assembler fills the nonce in (see `src/render/document.ts`). Adapter
 * markup that contains the marker itself is refused, so every marker on the
 * page is one this module wrote.
 */
export const ADAPTER_STYLE_MARKER = 'data-ak-adapter-style';

/** HTML whitespace. JavaScript's `\s` also matches characters HTML does not. */
const WS = '[\\t\\n\\f\\r ]';
/**
 * An attribute name. It excludes `<`, so an unterminated tag fails at the next
 * `<` instead of rescanning the rest of the markup.
 */
const ATTRIBUTE_NAME = `[^\\t\\n\\f\\r "'<>/=]+`;
/** An optional `=` and a quoted or unquoted attribute value. */
const ATTRIBUTE_VALUE = `(?:${WS}*=${WS}*(?:"[^"]*"|'[^']*'|[^\\t\\n\\f\\r "'=<>\`]+))?`;
/** A start tag at the current position: name, attribute list, self-closing slash. */
const START_TAG = new RegExp(
  `<([A-Za-z][A-Za-z0-9:-]*)((?:${WS}+${ATTRIBUTE_NAME}${ATTRIBUTE_VALUE})*)${WS}*(\\/?)>`,
  'yu',
);
/** An end tag at the current position. */
const END_TAG = new RegExp(`</([A-Za-z][A-Za-z0-9:-]*)${WS}*>`, 'yu');
/** One attribute inside a start tag's attribute list: its name and raw value. */
const ATTRIBUTE = new RegExp(
  `${WS}+(${ATTRIBUTE_NAME})(?:${WS}*=${WS}*("[^"]*"|'[^']*'|[^\\t\\n\\f\\r "'=<>\`]+))?`,
  'gu',
);

/**
 * A same-document fragment reference, written literally. Character references
 * are not decoded here, so a value that uses one is refused rather than read.
 */
const FRAGMENT_REFERENCE = /^#[A-Za-z0-9_.:-]+$/u;

/** True for an attribute that makes the browser fetch or navigate to a URL. */
function isUrlAttribute(lowered: string): boolean {
  return (
    lowered === 'href' || lowered.endsWith(':href') || lowered === 'src' || lowered === 'srcset'
  );
}

/** An attribute value without its quotes; an attribute with no value is empty. */
function unquote(value: string | undefined): string {
  if (value === undefined) return '';
  const first = value[0];
  return first === '"' || first === "'" ? value.slice(1, -1) : value;
}

/**
 * Elements refused anywhere. Some execute, frame or submit; some switch the
 * parser into raw text (`plaintext` never ends, so it would swallow the rest
 * of the page); some merge attributes into the page's own `html` or `body`, or
 * belong in the document head.
 */
const FORBIDDEN_ELEMENTS: ReadonlySet<string> = new Set([
  'script',
  'iframe',
  'object',
  'embed',
  'form',
  'base',
  'foreignobject',
  'plaintext',
  'textarea',
  'xmp',
  'noembed',
  'noframes',
  'noscript',
  'template',
  'html',
  'head',
  'body',
  'frameset',
  'frame',
  'meta',
  'link',
  'math',
]);

/** HTML elements that never have content or an end tag. */
const VOID_ELEMENTS: ReadonlySet<string> = new Set([
  'area',
  'br',
  'col',
  'hr',
  'img',
  'input',
  'source',
  'track',
  'wbr',
]);

/**
 * HTML elements that, met inside SVG, make the parser close the SVG and carry
 * on in HTML. The browser's tree would then differ from the markup's nesting,
 * so they are refused there.
 */
const SVG_BREAKOUT_ELEMENTS: ReadonlySet<string> = new Set([
  'b',
  'big',
  'blockquote',
  'br',
  'center',
  'code',
  'dd',
  'div',
  'dl',
  'dt',
  'em',
  'font',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'li',
  'listing',
  'menu',
  'nobr',
  'ol',
  'p',
  'pre',
  'ruby',
  's',
  'small',
  'span',
  'strike',
  'strong',
  'sub',
  'sup',
  'table',
  'tt',
  'u',
  'ul',
  'var',
]);

/** SVG elements whose content the parser reads as HTML again. */
const SVG_HTML_INTEGRATION_POINTS: ReadonlySet<string> = new Set(['title', 'desc']);

/** Attribute prefix the page and its runtime use as hooks. */
const RESERVED_ATTRIBUTE_PREFIX = 'data-ak-';

/** Markup fitted to the page policy, or the reason it could not be. */
export type FittedMarkup =
  | { readonly ok: true; readonly markup: string; readonly removedInlineStyles: number }
  | { readonly ok: false; readonly reason: string };

interface OpenElement {
  readonly name: string;
  /** True when the element's children are parsed as SVG rather than HTML. */
  readonly svgContent: boolean;
}

function refuse(reason: string): FittedMarkup {
  return { ok: false, reason };
}

/**
 * Walk adapter markup, refuse what cannot be embedded safely, and fit the rest
 * to the page's Content Security Policy.
 */
export function fitAdapterMarkup(markup: string, scope: string): FittedMarkup {
  const open: OpenElement[] = [];
  const startTag = new RegExp(START_TAG);
  const endTag = new RegExp(END_TAG);
  let removedInlineStyles = 0;
  let fitted = '';
  let copied = 0;
  let index = markup.indexOf('<');

  while (index >= 0) {
    const next = markup[index + 1] ?? '';
    if (next === '!' || next === '?') return refuse('comment or markup declaration');

    if (next === '/') {
      endTag.lastIndex = index;
      const match = endTag.exec(markup);
      if (match === null) return refuse('malformed end tag');
      const name = (match[1] ?? '').toLowerCase();
      if (open.pop()?.name !== name) return refuse(`end tag </${name}> without a matching element`);
      index = markup.indexOf('<', endTag.lastIndex);
      continue;
    }

    if (!/[A-Za-z]/u.test(next)) {
      // A `<` that cannot start a tag is text to the browser too.
      index = markup.indexOf('<', index + 1);
      continue;
    }

    startTag.lastIndex = index;
    const match = startTag.exec(markup);
    if (match === null) return refuse('malformed tag');
    const [tag, rawName = '', attributes = '', selfClosing = ''] = match;
    const name = rawName.toLowerCase();
    if (FORBIDDEN_ELEMENTS.has(name)) return refuse(`${name} element`);

    const parent = open.at(-1);
    const inSvg = parent?.svgContent === true;
    if (inSvg && SVG_BREAKOUT_ELEMENTS.has(name)) return refuse(`HTML ${name} element inside svg`);
    if (!inSvg && name === 'title') return refuse('title element outside svg');
    const isSvgElement = inSvg || name === 'svg';

    let reserved: string | undefined;
    let external: string | undefined;
    const kept = attributes.replace(
      ATTRIBUTE,
      (attribute: string, attributeName: string, value?: string) => {
        const lowered = attributeName.toLowerCase();
        if (lowered.startsWith(RESERVED_ATTRIBUTE_PREFIX)) reserved = lowered;
        // A drawing may point at its own gradients, markers and symbols, never
        // at another document, a remote resource or a navigation target.
        if (isUrlAttribute(lowered) && !FRAGMENT_REFERENCE.test(unquote(value))) external = lowered;
        if (lowered === 'style') {
          removedInlineStyles += 1;
          return '';
        }
        return lowered === 'nonce' ? '' : attribute;
      },
    );
    if (reserved !== undefined) return refuse(`reserved attribute ${reserved}`);
    if (external !== undefined) {
      return refuse(`${external} attribute that is not a same-document #fragment`);
    }

    fitted += markup.slice(copied, index);
    copied = index + tag.length;
    index = markup.indexOf('<', copied);

    if (name === 'style') {
      // In HTML a self-closing style tag still opens a stylesheet, while in SVG
      // it does not; the two readings disagree, so neither is accepted.
      if (selfClosing !== '') return refuse('self-closing style element');
      // The stylesheet must be plain text up to its end tag, so the text
      // checked here is exactly the text a browser applies.
      if (index < 0 || !markup.startsWith('</', index)) {
        return refuse('style element containing markup or missing its end tag');
      }
      const filtered = filterAdapterStylesheet(markup.slice(copied, index));
      if (!filtered.ok) return refuse(filtered.reason);
      fitted += `<style ${ADAPTER_STYLE_MARKER}${kept}>${scopeAdapterStylesheet(filtered.css, scope)}`;
      copied = index;
      open.push({ name, svgContent: false });
      continue;
    }

    fitted += `<${rawName}${kept}${selfClosing === '' ? '' : ' /'}>`;
    if (selfClosing !== '') {
      // Only SVG honours a self-closing slash; in HTML the element stays open.
      if (!isSvgElement && !VOID_ELEMENTS.has(name)) {
        return refuse(`self-closing HTML ${name} element`);
      }
      continue;
    }
    if (!isSvgElement && VOID_ELEMENTS.has(name)) continue;
    open.push({
      name,
      svgContent: isSvgElement && !SVG_HTML_INTEGRATION_POINTS.has(name),
    });
  }

  const unclosed = open.at(-1);
  if (unclosed !== undefined) return refuse(`unclosed ${unclosed.name} element`);
  fitted += markup.slice(copied);
  return { ok: true, markup: fitted, removedInlineStyles };
}
