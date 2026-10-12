/** Shared pieces of the editorial blocks: ISO date detection and link emission. */

import { escapeAttribute, escapeText, escapeUrl } from '../../render/escape.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * A `<time>` for a supplied date. The text is shown as authored; `datetime` is
 * added only when the text is already an ISO date, so the compiler never
 * parses or reformats a date and never reads a clock.
 */
export function timeElement(text: string, className: string): string {
  const attribute = ISO_DATE.test(text) ? ` datetime="${escapeAttribute(text)}"` : '';
  return `<time class="${className}"${attribute}>${escapeText(text)}</time>`;
}

/** An authored link; the label is plain text and the target is escaped. */
export function anchor(href: string, innerHtml: string, className = ''): string {
  const cls = className === '' ? '' : ` class="${className}"`;
  return `<a${cls} href="${escapeAttribute(escapeUrl(href))}" rel="noreferrer noopener">${innerHtml}</a>`;
}
