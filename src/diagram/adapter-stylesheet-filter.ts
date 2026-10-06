/**
 * The stylesheet filter for diagram adapter `<style>` elements.
 *
 * Adapter styles receive the page style nonce, so they are live CSS. Two rules
 * keep them from becoming an escape hatch:
 *
 * - **They cannot load anything.** No `@import`, `@font-face` or other at-rule
 *   beyond `@media`, `@keyframes` and `@supports`; no `url()` except a fragment
 *   reference such as `url(#gradient)`; no `image-set()` or other function that
 *   takes a URL; no `expression()`.
 * - **They cannot reach past their own diagram.** Every accepted stylesheet is
 *   wrapped in an `@scope` rule rooted at the diagram's canvas, so a selector
 *   such as `.ak-shell` or `:root` matches nothing outside it. Braces must
 *   balance, so the stylesheet cannot close that rule early.
 *
 * The filter is a deliberately small, conservative scanner rather than a CSS
 * parser: anything that could hide a token from it is refused outright. That
 * covers backslash escapes, HTML character references (which an SVG `<style>`
 * decodes), and markup. Two things typed diagram compilers do emit are removed
 * rather than refused: comments, each replaced by a space so the tokens on
 * either side stay apart exactly as the comment kept them, and `!important`,
 * which would otherwise outrank the page's motion and print guards. Removing
 * either can only take power away from a declaration. The scanner visits each
 * character once, so it is linear in the stylesheet's length.
 */

/** At-rules an adapter stylesheet may use. Every other at-rule is refused. */
const ALLOWED_AT_RULES: ReadonlySet<string> = new Set(['media', 'keyframes', 'supports']);

/**
 * CSS functions that fetch a resource, take a URL as a string, or run code.
 * `url()` is handled separately, because a fragment reference is allowed.
 */
const FORBIDDEN_FUNCTIONS: ReadonlySet<string> = new Set([
  'image-set',
  '-webkit-image-set',
  'image',
  'src',
  'cross-fade',
  '-webkit-cross-fade',
  'element',
  '-moz-element',
  'paint',
  'expression',
]);

/** The argument of an allowed `url()`: a same-document fragment reference only. */
const FRAGMENT_URL_ARGUMENT = /^[\t\n\f\r ]*(["']?)#[A-Za-z0-9_-]+\1[\t\n\f\r ]*$/u;

/**
 * Keyframes names the page itself defines. Keyframes are page-wide even inside
 * `@scope`, so an adapter must not redefine them. A unit test keeps this list
 * equal to the names in the compiler's stylesheets.
 */
export const PAGE_KEYFRAMES_NAMES: ReadonlySet<string> = new Set([
  'ak-aurora',
  'ak-caret',
  'ak-draw',
  'ak-drift',
  'ak-enter',
  'ak-fade',
  'ak-line-in',
  'ak-marquee',
  'ak-reading',
  'ak-reveal',
  'ak-rise',
  'ak-scroll-edges',
  'ak-settle',
  'ak-tilt',
  'ak-type',
]);

/** `!important`, with the whitespace CSS allows between its two parts. */
const IMPORTANT = /^![\t\n\f\r ]*important/iu;

const CLOSERS: Readonly<Record<string, string>> = { '{': '}', '(': ')', '[': ']' };

function isIdentCharacter(character: string): boolean {
  const code = character.charCodeAt(0);
  return (
    (code >= 0x61 && code <= 0x7a) || // a-z
    (code >= 0x41 && code <= 0x5a) || // A-Z
    (code >= 0x30 && code <= 0x39) || // 0-9
    character === '-' ||
    character === '_' ||
    code >= 0x80
  );
}

function isCssWhitespace(character: string): boolean {
  return (
    character === ' ' ||
    character === '\t' ||
    character === '\n' ||
    character === '\r' ||
    character === '\f'
  );
}

/** True when `&` at this position would start an HTML character reference. */
function startsCharacterReference(css: string, index: number): boolean {
  const next = css[index + 1] ?? '';
  return next === '#' || (next !== '' && /[A-Za-z0-9]/u.test(next));
}

/** End index (exclusive) of the identifier that starts at `start`. */
function identifierEnd(css: string, start: number): number {
  let end = start;
  while (end < css.length && isIdentCharacter(css[end] ?? '')) end += 1;
  return end;
}

/**
 * Check one character that may appear anywhere, including inside a string.
 * Returns a rejection reason, or `undefined` when the character is harmless.
 */
function hiddenTokenReason(css: string, index: number): string | undefined {
  const character = css[index];
  if (character === '<') return 'markup inside a style element';
  if (character === '&' && startsCharacterReference(css, index)) {
    return 'character reference inside a style element';
  }
  return undefined;
}

/** An accepted stylesheet with its comments removed, or the reason it was refused. */
export type FilteredStylesheet =
  | { readonly ok: true; readonly css: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Filter the stylesheet text of one adapter `<style>` element.
 *
 * Returns the stylesheet with its comments removed, or the rejection reason.
 */
export function filterAdapterStylesheet(css: string): FilteredStylesheet {
  const reason = scanAdapterStylesheet(css);
  if (typeof reason === 'string') return { ok: false, reason };
  return { ok: true, css: reason.css };
}

function scanAdapterStylesheet(css: string): string | { css: string } {
  // An escape can spell any token, so it is refused before anything is read.
  if (css.includes('\\')) return 'CSS escape';
  const open: string[] = [];
  let cleaned = '';
  let copied = 0;
  let index = 0;
  while (index < css.length) {
    const character = css[index] ?? '';
    const hidden = hiddenTokenReason(css, index);
    if (hidden !== undefined) return hidden;

    if (character === '/' && css[index + 1] === '*') {
      // A comment runs to the first `*/`. Its text is scanned too: in an SVG
      // `<style>` a character reference such as `&#42;` could otherwise end the
      // comment for the browser earlier than it ends here.
      const end = css.indexOf('*/', index + 2);
      if (end < 0) return 'unterminated CSS comment';
      for (let cursor = index + 2; cursor < end; cursor += 1) {
        const inner = hiddenTokenReason(css, cursor);
        if (inner !== undefined) return inner;
      }
      cleaned += `${css.slice(copied, index)} `;
      index = end + 2;
      copied = index;
      continue;
    }
    if (character === '!') {
      const important = IMPORTANT.exec(css.slice(index, index + 32));
      if (important === null) return 'CSS ! other than !important';
      cleaned += css.slice(copied, index);
      index += important[0].length;
      copied = index;
      continue;
    }

    if (character === '"' || character === "'") {
      // A string runs to its matching quote on the same line. Its content is
      // inert, but it is still scanned for the characters that hide tokens.
      let cursor = index + 1;
      while (cursor < css.length && css[cursor] !== character) {
        const inner = css[cursor] ?? '';
        if (inner === '\n' || inner === '\r' || inner === '\f') return 'unterminated CSS string';
        const reason = hiddenTokenReason(css, cursor);
        if (reason !== undefined) return reason;
        cursor += 1;
      }
      if (cursor >= css.length) return 'unterminated CSS string';
      index = cursor + 1;
      continue;
    }

    if (character === '@') {
      const nameEnd = identifierEnd(css, index + 1);
      const name = css.slice(index + 1, nameEnd).toLowerCase();
      if (!ALLOWED_AT_RULES.has(name)) return name === '' ? 'CSS at-rule' : `CSS @${name}`;
      if (name === 'keyframes') {
        let cursor = nameEnd;
        while (cursor < css.length && isCssWhitespace(css[cursor] ?? '')) cursor += 1;
        const quoted = css[cursor] === '"' || css[cursor] === "'";
        const keyframesStart = quoted ? cursor + 1 : cursor;
        const keyframesName = css
          .slice(keyframesStart, identifierEnd(css, keyframesStart))
          .toLowerCase();
        if (PAGE_KEYFRAMES_NAMES.has(keyframesName)) {
          return 'CSS @keyframes name reserved by the page';
        }
      }
      index = nameEnd;
      continue;
    }

    if (isIdentCharacter(character)) {
      const end = identifierEnd(css, index);
      if (css[end] === '(') {
        const name = css.slice(index, end).toLowerCase();
        if (FORBIDDEN_FUNCTIONS.has(name)) return `CSS ${name}()`;
        if (name === 'url') {
          const close = css.indexOf(')', end + 1);
          if (close < 0 || !FRAGMENT_URL_ARGUMENT.test(css.slice(end + 1, close))) {
            return 'CSS url() other than a fragment reference';
          }
          index = close + 1;
          continue;
        }
      }
      index = end;
      continue;
    }

    const closer = CLOSERS[character];
    if (closer !== undefined) {
      open.push(closer);
    } else if (character === '}' || character === ')' || character === ']') {
      if (open.pop() !== character) return 'unbalanced CSS brackets';
    }
    index += 1;
  }
  if (open.length > 0) return 'unbalanced CSS brackets';
  return { css: cleaned + css.slice(copied) };
}

/** Attribute naming the canvas element an adapter stylesheet is scoped to. */
export const ADAPTER_SCOPE_ATTRIBUTE = 'data-ak-diagram-scope';

/**
 * Wrap an accepted adapter stylesheet so it applies only inside its canvas.
 *
 * Inside `@scope`, a selector without `:scope` or `&` is read as a descendant
 * of the scope root, and no selector can match an element outside the root.
 * `scope` is a token from `[A-Za-z0-9_-]`, so it needs no CSS escaping.
 */
export function scopeAdapterStylesheet(css: string, scope: string): string {
  return `@scope (.ak-diagram-canvas[${ADAPTER_SCOPE_ATTRIBUTE}="${scope}"]){${css}}`;
}
