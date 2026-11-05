#!/usr/bin/env node
/**
 * Generate `src/blocks/three/outline-fonts.generated.ts`: glyph outlines,
 * advances and pair kerning for the `text-3d` block.
 *
 * Each source is a static SIL OFL 1.1 instance (WOFF 1.0, taken unmodified from
 * its Fontsource package) stored next to the family's `OFL.txt` in
 * `assets/fonts/<family>/outline-<subset>-<weight>.woff`. This script reads the
 * TrueType tables directly (cmap, hmtx, loca, glyf with composites, GPOS pair
 * kerning), so the compiler can lay out and extrude text with no font parser,
 * file read or network at render time. Coordinates stay in integer font units
 * (y up) and the output is byte-stable.
 *
 * Usage: node scripts/generate-outline-fonts.mjs [--check]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'src/blocks/three/outline-fonts.generated.ts');

/** Subsets in priority order: a code point takes its outline from the first subset that maps it. */
const SUBSETS = ['latin', 'latin-ext', 'vietnamese'];
const FONTS = [
  { id: 'display', dir: 'bricolage-grotesque', name: 'Bricolage Grotesque', weight: 800 },
  { id: 'serif', dir: 'fraunces', name: 'Fraunces', weight: 700 },
];

function readWoff(file) {
  const buf = readFileSync(file);
  if (buf.toString('latin1', 0, 4) !== 'wOFF') throw new Error(`${file} is not WOFF 1.0`);
  const count = buf.readUInt16BE(12);
  const tables = new Map();
  for (let i = 0; i < count; i += 1) {
    const at = 44 + i * 20;
    const tag = buf.toString('latin1', at, at + 4);
    const offset = buf.readUInt32BE(at + 4);
    const compLength = buf.readUInt32BE(at + 8);
    const origLength = buf.readUInt32BE(at + 12);
    const raw = buf.subarray(offset, offset + compLength);
    tables.set(tag, compLength < origLength ? inflateSync(raw) : Buffer.from(raw));
  }
  for (const tag of ['head', 'hhea', 'hmtx', 'cmap', 'loca', 'glyf', 'maxp']) {
    if (!tables.has(tag))
      throw new Error(`${file} has no ${tag} table (TrueType outlines required)`);
  }
  return tables;
}

function readCmap(cmap) {
  const map = new Map();
  const count = cmap.readUInt16BE(2);
  let best = null;
  for (let i = 0; i < count; i += 1) {
    const platform = cmap.readUInt16BE(4 + i * 8);
    const encoding = cmap.readUInt16BE(6 + i * 8);
    const offset = cmap.readUInt32BE(8 + i * 8);
    const format = cmap.readUInt16BE(offset);
    if (platform === 3 && encoding === 10 && format === 12) best = { offset, format };
    else if (platform === 3 && encoding === 1 && format === 4 && !best) best = { offset, format };
  }
  if (!best) throw new Error('no Unicode cmap');
  const { offset, format } = best;
  if (format === 12) {
    const groups = cmap.readUInt32BE(offset + 12);
    for (let g = 0; g < groups; g += 1) {
      const at = offset + 16 + g * 12;
      const start = cmap.readUInt32BE(at);
      const end = cmap.readUInt32BE(at + 4);
      const glyph = cmap.readUInt32BE(at + 8);
      for (let c = start; c <= end; c += 1) map.set(c, glyph + c - start);
    }
    return map;
  }
  const segX2 = cmap.readUInt16BE(offset + 6);
  const ends = offset + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const ranges = deltas + segX2;
  for (let s = 0; s < segX2 / 2; s += 1) {
    const end = cmap.readUInt16BE(ends + s * 2);
    const start = cmap.readUInt16BE(starts + s * 2);
    const delta = cmap.readInt16BE(deltas + s * 2);
    const rangeAt = ranges + s * 2;
    const range = cmap.readUInt16BE(rangeAt);
    for (let c = start; c <= end && c !== 0xffff; c += 1) {
      let glyph;
      if (range === 0) glyph = (c + delta) & 0xffff;
      else {
        const raw = cmap.readUInt16BE(rangeAt + range + (c - start) * 2);
        glyph = raw === 0 ? 0 : (raw + delta) & 0xffff;
      }
      if (glyph) map.set(c, glyph);
    }
  }
  return map;
}

/** Each contour as a list of `[x, y, onCurve]` points, composites resolved. */
function glyphContours(tables, gid, depth = 0) {
  if (depth > 8) throw new Error('composite glyph nests too deep');
  const head = tables.get('head');
  const loca = tables.get('loca');
  const glyf = tables.get('glyf');
  const long = head.readInt16BE(50) === 1;
  const start = long ? loca.readUInt32BE(gid * 4) : loca.readUInt16BE(gid * 2) * 2;
  const end = long ? loca.readUInt32BE(gid * 4 + 4) : loca.readUInt16BE(gid * 2 + 2) * 2;
  if (end <= start) return [];
  const g = glyf.subarray(start, end);
  const contourCount = g.readInt16BE(0);
  if (contourCount >= 0) {
    const endPts = [];
    for (let i = 0; i < contourCount; i += 1) endPts.push(g.readUInt16BE(10 + i * 2));
    const pointCount = contourCount ? endPts[contourCount - 1] + 1 : 0;
    let at = 10 + contourCount * 2;
    at += 2 + g.readUInt16BE(at);
    const flags = [];
    while (flags.length < pointCount) {
      const flag = g[at++];
      flags.push(flag);
      if (flag & 8) {
        const repeat = g[at++];
        for (let r = 0; r < repeat; r += 1) flags.push(flag);
      }
    }
    const xs = [];
    let x = 0;
    for (const flag of flags) {
      if (flag & 2) {
        const d = g[at++];
        x += flag & 16 ? d : -d;
      } else if (!(flag & 16)) {
        x += g.readInt16BE(at);
        at += 2;
      }
      xs.push(x);
    }
    const ys = [];
    let y = 0;
    for (const flag of flags) {
      if (flag & 4) {
        const d = g[at++];
        y += flag & 32 ? d : -d;
      } else if (!(flag & 32)) {
        y += g.readInt16BE(at);
        at += 2;
      }
      ys.push(y);
    }
    const contours = [];
    let first = 0;
    for (const last of endPts) {
      const contour = [];
      for (let p = first; p <= last; p += 1) contour.push([xs[p], ys[p], (flags[p] & 1) === 1]);
      contours.push(contour);
      first = last + 1;
    }
    return contours;
  }
  const contours = [];
  let at = 10;
  let more = true;
  while (more) {
    const flags = g.readUInt16BE(at);
    const component = g.readUInt16BE(at + 2);
    at += 4;
    let dx;
    let dy;
    if (flags & 1) {
      dx = g.readInt16BE(at);
      dy = g.readInt16BE(at + 2);
      at += 4;
    } else {
      dx = g.readInt8(at);
      dy = g.readInt8(at + 1);
      at += 2;
    }
    if (!(flags & 2)) throw new Error('point-matched composite components are not supported');
    let [a, b, c, d] = [1, 0, 0, 1];
    const f2dot14 = (o) => g.readInt16BE(o) / 16384;
    if (flags & 8) {
      a = d = f2dot14(at);
      at += 2;
    } else if (flags & 0x40) {
      a = f2dot14(at);
      d = f2dot14(at + 2);
      at += 4;
    } else if (flags & 0x80) {
      a = f2dot14(at);
      b = f2dot14(at + 2);
      c = f2dot14(at + 4);
      d = f2dot14(at + 6);
      at += 8;
    }
    for (const contour of glyphContours(tables, component, depth + 1)) {
      contours.push(
        contour.map(([px, py, on]) => [
          Math.round(a * px + c * py + dx),
          Math.round(b * px + d * py + dy),
          on,
        ]),
      );
    }
    more = (flags & 0x20) !== 0;
  }
  return contours;
}

/** TrueType quadratic contours as a compact path: `M x y`, `L x y`, `Q cx cy x y`, `Z`. */
function contoursToPath(contours) {
  const out = [];
  const mid = (p, q) => [Math.round((p[0] + q[0]) / 2), Math.round((p[1] + q[1]) / 2), true];
  for (const raw of contours) {
    if (raw.length < 2) continue;
    // Start on an on-curve point; an all-off contour starts at an implied midpoint.
    let startIndex = raw.findIndex((p) => p[2]);
    let points = raw;
    if (startIndex < 0) {
      points = [mid(raw[raw.length - 1], raw[0]), ...raw];
      startIndex = 0;
    }
    const ring = [...points.slice(startIndex), ...points.slice(0, startIndex)];
    const startPoint = ring[0];
    out.push(`M${startPoint[0]} ${startPoint[1]}`);
    let control = null;
    for (let i = 1; i <= ring.length; i += 1) {
      const p = ring[i % ring.length];
      if (p[2]) {
        out.push(control ? `Q${control[0]} ${control[1]} ${p[0]} ${p[1]}` : `L${p[0]} ${p[1]}`);
        control = null;
      } else if (control) {
        const m = mid(control, p);
        out.push(`Q${control[0]} ${control[1]} ${m[0]} ${m[1]}`);
        control = p;
      } else control = p;
    }
    out.push('Z');
  }
  return out.join('');
}

function coverage(t, offset) {
  const format = t.readUInt16BE(offset);
  const map = new Map();
  if (format === 1) {
    const count = t.readUInt16BE(offset + 2);
    for (let i = 0; i < count; i += 1) map.set(t.readUInt16BE(offset + 4 + i * 2), i);
  } else {
    const count = t.readUInt16BE(offset + 2);
    for (let i = 0; i < count; i += 1) {
      const at = offset + 4 + i * 6;
      const start = t.readUInt16BE(at);
      const end = t.readUInt16BE(at + 2);
      const index = t.readUInt16BE(at + 4);
      for (let g = start; g <= end; g += 1) map.set(g, index + g - start);
    }
  }
  return map;
}

function classDef(t, offset) {
  const format = t.readUInt16BE(offset);
  const map = new Map();
  if (format === 1) {
    const startGlyph = t.readUInt16BE(offset + 2);
    const count = t.readUInt16BE(offset + 4);
    for (let i = 0; i < count; i += 1) map.set(startGlyph + i, t.readUInt16BE(offset + 6 + i * 2));
  } else {
    const count = t.readUInt16BE(offset + 2);
    for (let i = 0; i < count; i += 1) {
      const at = offset + 4 + i * 6;
      const cls = t.readUInt16BE(at + 4);
      for (let g = t.readUInt16BE(at); g <= t.readUInt16BE(at + 2); g += 1) map.set(g, cls);
    }
  }
  return map;
}

const bits = (n) => n.toString(2).replace(/0/gu, '').length;
/** The XAdvance of a value record, or 0 when the format carries none. */
const xAdvance = (t, at, format) => (format & 4 ? t.readInt16BE(at + bits(format & 3) * 2) : 0);

/** GPOS pair adjustments from the `kern` feature, as a lookup `(left, right) => units`. */
function readKerning(gpos) {
  if (!gpos) return () => 0;
  const featureList = gpos.readUInt16BE(6);
  const lookupList = gpos.readUInt16BE(8);
  const lookups = new Set();
  const featureCount = gpos.readUInt16BE(featureList);
  for (let i = 0; i < featureCount; i += 1) {
    const at = featureList + 2 + i * 6;
    if (gpos.toString('latin1', at, at + 4) !== 'kern') continue;
    const feature = featureList + gpos.readUInt16BE(at + 4);
    const n = gpos.readUInt16BE(feature + 2);
    for (let k = 0; k < n; k += 1) lookups.add(gpos.readUInt16BE(feature + 4 + k * 2));
  }
  const subtables = [];
  for (const index of [...lookups].sort((a, b) => a - b)) {
    const lookup = lookupList + gpos.readUInt16BE(lookupList + 2 + index * 2);
    const type = gpos.readUInt16BE(lookup);
    const count = gpos.readUInt16BE(lookup + 4);
    for (let s = 0; s < count; s += 1) {
      let sub = lookup + gpos.readUInt16BE(lookup + 6 + s * 2);
      let subType = type;
      if (type === 9) {
        subType = gpos.readUInt16BE(sub + 2);
        sub += gpos.readUInt32BE(sub + 4);
      }
      if (subType === 2) subtables.push(sub);
    }
  }
  const parsed = subtables.map((sub) => {
    const format = gpos.readUInt16BE(sub);
    const cover = coverage(gpos, sub + gpos.readUInt16BE(sub + 2));
    const vf1 = gpos.readUInt16BE(sub + 4);
    const vf2 = gpos.readUInt16BE(sub + 6);
    const size1 = bits(vf1) * 2;
    const size2 = bits(vf2) * 2;
    if (format === 1) {
      return (left, right) => {
        const ci = cover.get(left);
        if (ci === undefined) return null;
        const set = sub + gpos.readUInt16BE(sub + 10 + ci * 2);
        const n = gpos.readUInt16BE(set);
        for (let i = 0; i < n; i += 1) {
          const at = set + 2 + i * (2 + size1 + size2);
          if (gpos.readUInt16BE(at) === right) return xAdvance(gpos, at + 2, vf1);
        }
        return null;
      };
    }
    const class1 = classDef(gpos, sub + gpos.readUInt16BE(sub + 8));
    const class2 = classDef(gpos, sub + gpos.readUInt16BE(sub + 10));
    const class2Count = gpos.readUInt16BE(sub + 14);
    return (left, right) => {
      if (!cover.has(left)) return null;
      const c1 = class1.get(left) ?? 0;
      const c2 = class2.get(right) ?? 0;
      const at = sub + 16 + (c1 * class2Count + c2) * (size1 + size2);
      return xAdvance(gpos, at, vf1);
    };
  });
  // The first subtable that covers a pair decides it, as a shaper applies them.
  return (left, right) => {
    for (const lookup of parsed) {
      const value = lookup(left, right);
      if (value !== null) return value;
    }
    return 0;
  };
}

/** Space separators and controls advance or break but draw nothing. */
const drawable = (cp) => cp >= 0x20 && !(cp >= 0x7f && cp < 0xa0) && cp !== 0xad;

function buildFont({ id, dir, name, weight }) {
  const glyphs = new Map();
  const kerning = new Map();
  let metrics = null;
  let notdef = '';
  for (const subset of SUBSETS) {
    const tables = readWoff(join(root, 'assets/fonts', dir, `outline-${subset}-${weight}.woff`));
    const head = tables.get('head');
    const hhea = tables.get('hhea');
    const hmtx = tables.get('hmtx');
    const unitsPerEm = head.readUInt16BE(18);
    const subsetMetrics = {
      unitsPerEm,
      ascender: hhea.readInt16BE(4),
      descender: hhea.readInt16BE(6),
    };
    if (!metrics) metrics = subsetMetrics;
    else if (JSON.stringify(metrics) !== JSON.stringify(subsetMetrics))
      throw new Error(`${dir} subsets disagree on metrics`);
    const longMetrics = hhea.readUInt16BE(34);
    const advance = (gid) => hmtx.readUInt16BE(Math.min(gid, longMetrics - 1) * 4);
    if (!notdef) notdef = contoursToPath(glyphContours(tables, 0));
    const cmap = readCmap(tables.get('cmap'));
    const kern = readKerning(tables.get('GPOS'));
    const local = [];
    for (const [cp, gid] of [...cmap].sort((a, b) => a[0] - b[0])) {
      if (!drawable(cp) || glyphs.has(cp)) continue;
      glyphs.set(cp, [advance(gid), contoursToPath(glyphContours(tables, gid))]);
      local.push([cp, gid]);
    }
    for (const [left, lg] of local) {
      for (const [right, rg] of local) {
        const value = kern(lg, rg);
        // Adjustments under 1% of the em are invisible at display sizes; dropping them keeps the table small.
        if (Math.abs(value) * 100 >= unitsPerEm)
          kerning.set(`${String.fromCodePoint(left)}${String.fromCodePoint(right)}`, value);
      }
    }
  }
  const notdefAdvance = Math.round(metrics.unitsPerEm * 0.6);
  return {
    id,
    name,
    weight,
    ...metrics,
    notdef: [notdefAdvance, notdef],
    glyphs: Object.fromEntries(
      [...glyphs].sort((a, b) => a[0] - b[0]).map(([cp, g]) => [String.fromCodePoint(cp), g]),
    ),
    kerning: Object.fromEntries([...kerning].sort((a, b) => (a[0] < b[0] ? -1 : 1))),
  };
}

const fonts = FONTS.map(buildFont);
const header = FONTS.map(
  (f) =>
    `// ${f.name} ${f.weight} (SIL OFL 1.1, assets/fonts/${f.dir}/OFL.txt), outline-{${SUBSETS.join(',')}}-${f.weight}.woff`,
).join('\n');
const output = `// Generated by scripts/generate-outline-fonts.mjs. Do not edit.
${header}

/** One glyph: advance width and outline path, both in font units with y up. */
export type OutlineGlyph = readonly [advance: number, path: string];

export interface OutlineFont {
  readonly id: string;
  readonly name: string;
  readonly weight: number;
  readonly unitsPerEm: number;
  readonly ascender: number;
  readonly descender: number;
  /** The font's missing-glyph box, drawn for a character it does not cover. */
  readonly notdef: OutlineGlyph;
  readonly glyphs: Readonly<Record<string, OutlineGlyph>>;
  /** GPOS pair adjustments keyed by the two characters, in font units. */
  readonly kerning: Readonly<Record<string, number>>;
}

export const OUTLINE_FONTS: Readonly<Record<${fonts.map((f) => JSON.stringify(f.id)).join(' | ')}, OutlineFont>> = {
${fonts.map((f) => `  ${JSON.stringify(f.id)}: ${JSON.stringify(f)},`).join('\n')}
};
`;

if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== output) {
    console.error('outline-fonts.generated.ts is stale; run pnpm fonts:generate');
    process.exit(1);
  }
  console.log('outline fonts up to date');
} else {
  writeFileSync(target, output);
  for (const f of fonts)
    console.log(
      `${f.id}: ${Object.keys(f.glyphs).length} glyphs, ${Object.keys(f.kerning).length} kern pairs`,
    );
  console.log(`wrote ${target} (${output.length} bytes)`);
}
