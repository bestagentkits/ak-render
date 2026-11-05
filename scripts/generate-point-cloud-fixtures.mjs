#!/usr/bin/env node
/**
 * Generate the point cloud fixtures under `fixtures/3d/`: a LiDAR-style survey
 * of a small depot (rolling ground, a road with lane markings, a gabled shed,
 * trees, a water tank, power lines and parked cars) as `x y z intensity` text
 * at 100,000 and 30,000 points, plus a small inline fixture of one tree.
 *
 * A fixed-seed LCG drives every number, so the output is deterministic.
 * Coordinates are metres (z up), intensity is an 8-bit return strength.
 *
 * Usage: node scripts/generate-point-cloud-fixtures.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures/3d');
mkdirSync(join(root, 'point-cloud'), { recursive: true });

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const W = 80;
const D = 60;
const ground = (x, y) =>
  0.6 * Math.sin(x / 13) + 0.4 * Math.cos(y / 9) + 0.15 * Math.sin((x + y) / 4);
const TREES = [
  [8, 8, 3.0],
  [16, 12, 2.6],
  [70, 10, 3.2],
  [62, 16, 2.4],
  [6, 46, 3.4],
  [40, 52, 2.8],
  [46, 44, 2.5],
  [74, 34, 3.0],
  [30, 12, 2.2],
];
const POLES = [4, 40, 76];

/** One surface sample per call, by feature; returns [x, y, z, intensity]. */
function sampler(rand) {
  const n = () => (rand() + rand() + rand() - 1.5) * 0.08;
  const clampI = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return {
    ground() {
      const x = rand() * W;
      const y = rand() * D;
      let i = 95 + rand() * 30;
      const road = Math.abs(y - 28) < 4;
      if (road) {
        i = 30 + rand() * 18;
        // Dashed centre line and solid edge lines read bright, as painted lines do.
        if (Math.abs(y - 28) < 0.15 && x % 6 < 3) i = 230 + rand() * 20;
        if (Math.abs(Math.abs(y - 28) - 3.7) < 0.12) i = 215 + rand() * 25;
      }
      return [x, y, ground(x, y) + n() * 0.5 - (road ? 0.12 : 0), clampI(i)];
    },
    shed() {
      // Gabled shed: x 12..34, y 38..54, eaves at 7 m, ridge along x at 10.5 m.
      const [x0, x1, y0, y1, eave, ridge] = [12, 34, 38, 54, 7, 10.5];
      const base = ground(23, 46);
      const k = rand();
      if (k < 0.62) {
        const x = x0 + rand() * (x1 - x0);
        const y = y0 + rand() * (y1 - y0);
        const t = 1 - Math.abs(y - (y0 + y1) / 2) / ((y1 - y0) / 2);
        return [x, y, base + eave + (ridge - eave) * t + n(), clampI(165 + rand() * 40)];
      }
      const h = rand();
      if (k < 0.85) {
        const x = rand() < 0.5 ? x0 : x1;
        const y = y0 + rand() * (y1 - y0);
        const t = 1 - Math.abs(y - (y0 + y1) / 2) / ((y1 - y0) / 2);
        return [x + n(), y, base + h * (eave + (ridge - eave) * t), clampI(120 + rand() * 30)];
      }
      const y = rand() < 0.5 ? y0 : y1;
      return [x0 + rand() * (x1 - x0), y + n(), base + h * eave, clampI(120 + rand() * 30)];
    },
    tree() {
      const [cx, cy, r] = TREES[Math.floor(rand() * TREES.length)];
      const base = ground(cx, cy);
      if (rand() < 0.08) {
        const a = rand() * Math.PI * 2;
        return [
          cx + Math.cos(a) * 0.3,
          cy + Math.sin(a) * 0.3,
          base + rand() * 4,
          clampI(70 + rand() * 20),
        ];
      }
      // Crowns: a lumpy ellipsoid shell, denser on top where the beam hits first.
      const u = rand() * 2 - 1;
      const a = rand() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const top = u > -0.2 || rand() < 0.4;
      const lump = 0.82 + 0.18 * Math.sin(a * 5 + u * 4) * Math.cos(a * 3);
      const depth = top ? 0.9 + rand() * 0.1 : 0.55 + rand() * 0.45;
      const rr = r * lump * depth;
      return [
        cx + Math.cos(a) * s * rr,
        cy + Math.sin(a) * s * rr,
        base + 4 + r * 0.9 + u * rr * 0.9,
        clampI(45 + rand() * 45),
      ];
    },
    tank() {
      const [cx, cy, r, h] = [58, 47, 5, 9];
      const base = ground(cx, cy);
      const a = rand() * Math.PI * 2;
      if (rand() < 0.7)
        return [
          cx + Math.cos(a) * r,
          cy + Math.sin(a) * r,
          base + rand() * h,
          clampI(185 + rand() * 30),
        ];
      const t = Math.sqrt(rand());
      return [
        cx + Math.cos(a) * r * t,
        cy + Math.sin(a) * r * t,
        base + h + 3.2 * (1 - t * t),
        clampI(200 + rand() * 30),
      ];
    },
    wire() {
      // Two conductors sagging between three poles along y = 20.
      const span = Math.floor(rand() * 2);
      const [a, b] = [POLES[span], POLES[span + 1]];
      const t = rand();
      const x = a + (b - a) * t;
      const side = rand() < 0.5 ? -0.8 : 0.8;
      const sag = 1.6 * 4 * t * (1 - t);
      return [x, 20 + side, ground(x, 20) + 10.6 - sag, clampI(140 + rand() * 30)];
    },
    pole() {
      const x = POLES[Math.floor(rand() * 3)];
      const a = rand() * Math.PI * 2;
      const z = rand() * 11;
      if (z > 10.4)
        return [x + (rand() * 2 - 1) * 1.1, 20 + n(), ground(x, 20) + 10.6, clampI(110)];
      return [
        x + Math.cos(a) * 0.18,
        20 + Math.sin(a) * 0.18,
        ground(x, 20) + z,
        clampI(100 + rand() * 20),
      ];
    },
    car() {
      const cars = [
        [18, 25.6],
        [27, 25.6],
        [52, 30.4],
        [66, 25.6],
      ];
      const [cx, cy] = cars[Math.floor(rand() * cars.length)];
      const x = cx + (rand() * 2 - 1) * 2.2;
      const y = cy + (rand() * 2 - 1) * 0.9;
      const cabin = Math.abs(x - cx) < 1.1;
      return [x, y, ground(cx, cy) + (cabin ? 1.5 : 0.9) + n(), clampI(205 + rand() * 45)];
    },
  };
}

const MIX = [
  ['ground', 0.5],
  ['shed', 0.12],
  ['tree', 0.21],
  ['tank', 0.08],
  ['wire', 0.025],
  ['pole', 0.01],
  ['car', 0.055],
];

function survey(count, seed) {
  const rand = rng(seed);
  const s = sampler(rand);
  const rows = [];
  for (const [kind, share] of MIX) {
    const k = kind === 'car' ? count - rows.length : Math.round(count * share);
    for (let i = 0; i < k; i += 1) rows.push(s[kind]());
  }
  // Interleave features the way a scanner's sweep would, deterministically.
  for (let i = rows.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  return rows;
}

const fixed = (v) => (Math.round(v * 100) / 100).toFixed(2);
function xyz(rows, note) {
  return `# ${note}\n# Generated by scripts/generate-point-cloud-fixtures.mjs; metres, z up.\nx y z intensity\n${rows
    .map(([x, y, z, i]) => `${fixed(x)} ${fixed(y)} ${fixed(z)} ${i}`)
    .join('\n')}\n`;
}

writeFileSync(
  join(root, 'point-cloud/depot-100k.xyz'),
  xyz(survey(100_000, 20261106), 'Depot survey, 100,000 points (seed 20261106).'),
);
writeFileSync(
  join(root, 'point-cloud/depot-30k.xyz'),
  xyz(survey(30_000, 20261107), 'Depot survey, 30,000 points (seed 20261107).'),
);

// A small inline cloud: one tree and the ground under it.
{
  const rand = rng(7);
  const rows = [];
  for (let i = 0; i < 900; i += 1) {
    const ground = i < 300;
    if (ground) {
      const x = rand() * 10 - 5;
      const y = rand() * 10 - 5;
      rows.push([x, y, 0.05 * Math.sin(x) + 0.04 * Math.cos(y), Math.round(90 + rand() * 30)]);
      continue;
    }
    if (i < 360) {
      const a = rand() * Math.PI * 2;
      rows.push([Math.cos(a) * 0.25, Math.sin(a) * 0.25, rand() * 3, Math.round(80 + rand() * 20)]);
      continue;
    }
    const u = rand() * 2 - 1;
    const a = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const r = 2.4 * (0.85 + 0.15 * Math.sin(a * 4 + u * 3));
    rows.push([
      Math.cos(a) * s * r,
      Math.sin(a) * s * r,
      4.6 + u * r * 0.85,
      Math.round(40 + rand() * 60),
    ]);
  }
  const col = (k, digits) => `[${rows.map((r) => r[k].toFixed(digits)).join(', ')}]`;
  writeFileSync(
    join(root, 'point-cloud-3d-basic.yaml'),
    `# One scanned tree and the ground under it: 900 inline points (seed 7), metres, z up.
# Generated by scripts/generate-point-cloud-fixtures.mjs. The clip box trims the
# ground to 4 m around the trunk, so the page counts the hidden points.
version: 1
meta:
  title: Tree scan
state:
  point: p420
blocks:
  - type: point-cloud-3d
    id: tree
    title: A scanned oak
    summary: Nine hundred laser returns from one tree and the ground under it, coloured by return intensity. The canopy is about 4.8 metres across.
    bind: state.point
    axes:
      x: { label: East, unit: m, min: -4, max: 4 }
      y: { label: North, unit: m, min: -4, max: 4 }
      z: { label: Height, unit: m }
      intensity: { label: Intensity }
    data:
      x: ${col(0, 2)}
      y: ${col(1, 2)}
      z: ${col(2, 2)}
      intensity: ${col(3, 0)}
`,
  );
}
