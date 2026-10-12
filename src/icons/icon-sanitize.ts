/**
 * SVG glyph validation.
 *
 * Glyph bodies come from pinned packages, not from a spec, but they still pass
 * a strict allowlist so a pack update can never introduce script, external
 * references, animation or anything the compiler does not own. The same check
 * runs in the test suite over every bundled glyph.
 */

const ALLOWED_ELEMENTS = new Set([
  'g',
  'path',
  'circle',
  'ellipse',
  'rect',
  'line',
  'polyline',
  'polygon',
]);

const ALLOWED_ATTRIBUTES = new Set([
  'd',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'width',
  'height',
  'points',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'fill-rule',
  'clip-rule',
  'opacity',
  'fill-opacity',
  'stroke-opacity',
  'transform',
]);

const PAINT_VALUES = new Set(['none', 'currentColor']);
const NUMBER_LIST = /^[0-9eE.,\s+-]*$/u;
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]*$/u;
const TRANSFORM = /^(?:(?:translate|scale|rotate|matrix)\([0-9eE.,\s+-]*\)\s*)+$/u;
const ENUMS: Record<string, readonly string[]> = {
  'stroke-linecap': ['butt', 'round', 'square'],
  'stroke-linejoin': ['miter', 'round', 'bevel', 'miter-clip', 'arcs'],
  'fill-rule': ['nonzero', 'evenodd'],
  'clip-rule': ['nonzero', 'evenodd'],
};

export type SvgCheck = { ok: true } | { ok: false; reason: string };

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z-]+="[^"]*")*)\s*(\/?)>/gy;
const ATTRIBUTE = /([a-zA-Z-]+)="([^"]*)"/gu;

function attributeProblem(name: string, value: string): string | undefined {
  if (!ALLOWED_ATTRIBUTES.has(name)) return `attribute "${name}" is not allowed`;
  if (name === 'fill' || name === 'stroke') {
    return PAINT_VALUES.has(value) ? undefined : `${name} must be none or currentColor`;
  }
  if (name === 'd')
    return PATH_DATA.test(value) ? undefined : 'path data has unexpected characters';
  if (name === 'transform') return TRANSFORM.test(value) ? undefined : 'transform is not allowed';
  const allowed = ENUMS[name];
  if (allowed !== undefined) {
    return allowed.includes(value) ? undefined : `${name} has an unexpected value`;
  }
  return NUMBER_LIST.test(value) ? undefined : `${name} must be numeric`;
}

/**
 * Check one glyph body: the inner markup of an icon, without the `<svg>`
 * wrapper. Elements, attributes and values come from fixed allowlists; there is
 * no text, style, script, link, animation or `url()` reference.
 */
export function checkGlyphBody(body: string): SvgCheck {
  if (body.length === 0 || body.length > 20_000) return { ok: false, reason: 'unexpected length' };
  const stack: string[] = [];
  let index = 0;
  TAG.lastIndex = 0;
  while (index < body.length) {
    TAG.lastIndex = index;
    const match = TAG.exec(body);
    if (match === null) return { ok: false, reason: `unexpected markup at offset ${index}` };
    index = TAG.lastIndex;
    const [, closing, name = '', attributes = '', selfClosing] = match;
    if (!ALLOWED_ELEMENTS.has(name))
      return { ok: false, reason: `element "${name}" is not allowed` };
    if (closing === '/') {
      if (stack.pop() !== name) return { ok: false, reason: `unbalanced </${name}>` };
      continue;
    }
    for (const attribute of attributes.matchAll(ATTRIBUTE)) {
      const problem = attributeProblem(attribute[1] ?? '', attribute[2] ?? '');
      if (problem !== undefined) return { ok: false, reason: `<${name}>: ${problem}` };
    }
    if (selfClosing !== '/') stack.push(name);
  }
  return stack.length === 0 ? { ok: true } : { ok: false, reason: 'unclosed element' };
}
