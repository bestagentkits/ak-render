/**
 * Escaping and serialization.
 *
 * Escaping happens at emission, per context. Nothing here is applied at parse
 * time: a value that is safe as text is not automatically safe as an attribute,
 * in a URL, or inside a `script` element, and the compiler must not pretend
 * otherwise.
 */

const TEXT_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/&/gu, '&amp;'],
  [/</gu, '&lt;'],
  [/>/gu, '&gt;'],
];

const ATTRIBUTE_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/&/gu, '&amp;'],
  [/</gu, '&lt;'],
  [/>/gu, '&gt;'],
  [/"/gu, '&quot;'],
  [/'/gu, '&#39;'],
  [/`/gu, '&#96;'],
  [/=/gu, '&#61;'],
  [/\r/gu, '&#13;'],
  [/\n/gu, '&#10;'],
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters must be matched in order to be stripped from attribute values
  [/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, ''],
];

/** Escape text content for an element body. */
export function escapeText(value: string): string {
  let output = value;
  for (const [pattern, replacement] of TEXT_REPLACEMENTS) {
    output = output.replace(pattern, replacement);
  }
  return output;
}

/** Escape a value for a double-quoted attribute. */
export function escapeAttribute(value: string): string {
  let output = value;
  for (const [pattern, replacement] of ATTRIBUTE_REPLACEMENTS) {
    output = output.replace(pattern, replacement);
  }
  return output;
}

/** Characters that are never valid unescaped in an emitted URL reference. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: control and space characters must be percent-encoded, so they must be matched
const URL_UNSAFE = /[\u0000-\u0020"<>\\^`{|}\u007f-\u009f]/gu;

/**
 * Percent-encode a URL for emission.
 *
 * Scheme policy is enforced by the URL policy module before this runs; this
 * function only guarantees that the emitted reference cannot break out of the
 * attribute or introduce a control character.
 */
export function escapeUrl(value: string): string {
  return value.replace(URL_UNSAFE, (character) =>
    Array.from(new TextEncoder().encode(character))
      .map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`)
      .join(''),
  );
}

/**
 * Serialize embedded data for a `script type="application/json"` element.
 *
 * `<` and `>` are escaped so a value can never close the element, and the two
 * Unicode line separators are escaped because they terminate a JavaScript line
 * even inside a string literal.
 */
export function serializeJsonForScript(value: unknown): string {
  return JSON.stringify(value ?? null)
    .replace(/</gu, '\\u003c')
    .replace(/>/gu, '\\u003e')
    .replace(/&/gu, '\\u0026')
    .replace(/\u2028/gu, '\\u2028')
    .replace(/\u2029/gu, '\\u2029');
}

/**
 * Serialize a JSON payload for a `data-*` attribute (not for a script body).
 * Kept separate from `serializeJsonForScript` so the two contexts cannot be
 * confused.
 */
export function serializeJsonForAttribute(value: unknown): string {
  return escapeAttribute(JSON.stringify(value ?? null));
}

export interface AttributeValue {
  [name: string]: string | number | boolean | undefined | null;
}

/**
 * Render attributes in a fixed order.
 *
 * Ordering is deterministic regardless of the object's insertion order, so two
 * runs of the compiler cannot differ because of how a renderer happened to
 * build its attribute map.
 */
export function renderAttributes(attributes: AttributeValue): string {
  const names = Object.keys(attributes)
    .filter((name) => {
      const value = attributes[name];
      return value !== undefined && value !== null && value !== false;
    })
    .sort();
  if (names.length === 0) return '';
  const parts: string[] = [];
  for (const name of names) {
    const value = attributes[name];
    if (value === true) {
      parts.push(` ${name}`);
      continue;
    }
    parts.push(` ${name}="${escapeAttribute(String(value))}"`);
  }
  return parts.join('');
}
