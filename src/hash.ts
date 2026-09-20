/**
 * Deterministic, platform-neutral content hashing.
 *
 * Used to derive stable node IDs. Deliberately not `node:crypto`: the same
 * compiler code runs in a CLI, in a library caller, and inside a Cloudflare
 * Worker, and node IDs only need to be stable and collision-resistant, not
 * cryptographically secure. Output is identical on every platform because the
 * arithmetic is 32-bit integer math.
 */

/** FNV-1a style 64-bit hash rendered as 14 base36 characters. */
export function stableHash(input: string): string {
  let high = 0x811c9dc5;
  let low = 0x01000193;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    high ^= code;
    high = Math.imul(high, 16777619) >>> 0;
    low = (low + code) >>> 0;
    low = Math.imul(low ^ (low >>> 13), 2246822519) >>> 0;
  }
  return `${high.toString(36).padStart(7, '0')}${low.toString(36).padStart(7, '0')}`;
}

/** A node ID derived from content identity. */
export function derivedNodeId(type: string, path: string): string {
  return `n-${stableHash(`${type}|${path}`).slice(0, 10)}`;
}
