/**
 * Value tones: the badge colour for a status word a reader scans for severity
 * or outcome.
 */

import { escapeText } from './escape.js';

/**
 * Tone for a value a reader scans for severity or outcome. Only exact, known
 * words map to a tone; anything else stays neutral, so a label is never
 * coloured by guesswork.
 */
export const VALUE_TONES: Readonly<Record<string, string>> = {
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

export function valueTone(value: string): string {
  return VALUE_TONES[value.trim().toLowerCase()] ?? 'neutral';
}

/** A status word rendered as a toned badge. */
export function toneBadge(value: string): string {
  return `<span class="ak-badge" data-tone="${valueTone(value)}">${escapeText(value)}</span>`;
}
