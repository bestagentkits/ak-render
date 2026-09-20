/**
 * JSON value model and canonical serialization.
 *
 * Canonical serialization is a determinism primitive: stable node IDs and
 * determinism hashes are derived from it, so key order must not depend on how a
 * document happened to be written.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** True for a plain object (not an array, not null). */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True for any JSON-serializable value. */
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return true;
  if (type === 'number') return Number.isFinite(value as number);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (isPlainObject(value)) return Object.values(value).every(isJsonValue);
  return false;
}

/**
 * Serialize a JSON value with object keys sorted lexicographically.
 *
 * Used for content hashes, never for emitted HTML: emitted output uses the
 * spec's own ordering where ordering is meaningful to a reader.
 */
export function canonicalStringify(value: JsonValue): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalStringify(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
