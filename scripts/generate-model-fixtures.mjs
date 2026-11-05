#!/usr/bin/env node
/**
 * Generate the glTF 2.0 fixtures under `fixtures/3d/models/`: a small crate
 * with a texture, two animation clips and two KHR_materials_variants, as a
 * `.gltf` with relative `.bin` and `.png` files and as a single `.glb`, plus a
 * Draco-compressed stand-in that must fail with the decoder diagnostic.
 *
 * Every byte is computed, so the output is deterministic.
 *
 * Usage: node scripts/generate-model-fixtures.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures/3d/models');
mkdirSync(out, { recursive: true });

// --- PNG: a 64x64 plank texture, stripes with a soft vignette ---
function crc32(bytes) {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}
function png(size) {
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x += 1) {
      const plank = Math.floor(y / 16) % 2;
      const grain = ((x * 7 + y * 3) % 11) / 11;
      const edge = y % 16 === 0 || x === 0 || x === size - 1 ? 0.55 : 1;
      const base = plank ? [214, 150, 92] : [196, 128, 74];
      for (let c = 0; c < 3; c += 1)
        row[1 + x * 3 + c] = Math.round(base[c] * edge * (0.9 + grain * 0.1));
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Geometry: a unit cube with normals and UVs ---
const FACES = [
  [
    [1, 0, 0],
    [0, 0, -1],
    [0, 1, 0],
  ],
  [
    [-1, 0, 0],
    [0, 0, 1],
    [0, 1, 0],
  ],
  [
    [0, 1, 0],
    [1, 0, 0],
    [0, 0, -1],
  ],
  [
    [0, -1, 0],
    [1, 0, 0],
    [0, 0, 1],
  ],
  [
    [0, 0, 1],
    [1, 0, 0],
    [0, 1, 0],
  ],
  [
    [0, 0, -1],
    [-1, 0, 0],
    [0, 1, 0],
  ],
];
const positions = [];
const normals = [];
const uvs = [];
const indices = [];
FACES.forEach(([n, u, v], face) => {
  for (const [a, b] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    for (let i = 0; i < 3; i += 1) positions.push(n[i] * 0.5 + u[i] * a * 0.5 + v[i] * b * 0.5);
    normals.push(...n);
    uvs.push((a + 1) / 2, 1 - (b + 1) / 2);
  }
  const o = face * 4;
  indices.push(o, o + 1, o + 2, o, o + 2, o + 3);
});

// Animation: "Spin" turns the lid a full circle, "Lift" raises and lowers it.
const times = [0, 1, 2];
// Quaternions about +Y at 0, 180 and 360 degrees.
const spinQ = [0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, -1];
const lift = [0, 0.5, 0, 0, 0.95, 0, 0, 0.5, 0];

const parts = [
  new Float32Array(positions),
  new Float32Array(normals),
  new Float32Array(uvs),
  new Uint16Array(indices),
  new Float32Array(times),
  new Float32Array(spinQ),
  new Float32Array(lift),
];
const views = [];
let offset = 0;
const chunks = [];
for (const part of parts) {
  const bytes = Buffer.from(part.buffer);
  const pad = (4 - (bytes.length % 4)) % 4;
  views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length });
  chunks.push(bytes, Buffer.alloc(pad));
  offset += bytes.length + pad;
}
const bin = Buffer.concat(chunks);
const texture = png(64);

function gltfJson(bufferUri, imageSource) {
  const json = {
    asset: { version: '2.0', generator: 'ak-render fixtures' },
    extensionsUsed: ['KHR_materials_variants'],
    extensions: {
      KHR_materials_variants: {
        variants: [{ name: 'oak' }, { name: 'graphite' }, { name: 'coral' }],
      },
    },
    scene: 0,
    scenes: [{ name: 'Crate', nodes: [0, 1] }],
    nodes: [
      { name: 'Base', mesh: 0, scale: [1.6, 0.5, 1.6] },
      { name: 'Lid', mesh: 1, translation: [0, 0.5, 0], scale: [0.9, 0.5, 0.9] },
    ],
    meshes: [0, 1].map((m) => ({
      name: m === 0 ? 'Base' : 'Lid',
      primitives: [
        {
          attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
          indices: 3,
          material: 0,
          extensions: {
            KHR_materials_variants: {
              mappings: [
                { material: 0, variants: [0] },
                { material: 1, variants: [1] },
                { material: 2, variants: [2] },
              ],
            },
          },
        },
      ],
    })),
    materials: [
      {
        name: 'Oak',
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
          metallicFactor: 0,
          roughnessFactor: 0.7,
        },
      },
      {
        name: 'Graphite',
        pbrMetallicRoughness: {
          baseColorFactor: [0.16, 0.17, 0.2, 1],
          metallicFactor: 0.85,
          roughnessFactor: 0.3,
        },
      },
      {
        name: 'Coral',
        pbrMetallicRoughness: {
          baseColorFactor: [0.95, 0.42, 0.36, 1],
          metallicFactor: 0,
          roughnessFactor: 0.45,
        },
      },
    ],
    textures: [{ source: 0, sampler: 0 }],
    samplers: [{ magFilter: 9729, minFilter: 9987 }],
    images: [imageSource],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 24,
        type: 'VEC3',
        min: [-0.5, -0.5, -0.5],
        max: [0.5, 0.5, 0.5],
      },
      { bufferView: 1, componentType: 5126, count: 24, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: 24, type: 'VEC2' },
      { bufferView: 3, componentType: 5123, count: 36, type: 'SCALAR' },
      { bufferView: 4, componentType: 5126, count: 3, type: 'SCALAR', min: [0], max: [2] },
      { bufferView: 5, componentType: 5126, count: 3, type: 'VEC4' },
      { bufferView: 6, componentType: 5126, count: 3, type: 'VEC3' },
    ],
    bufferViews: views.map((view, i) =>
      i === 3 ? { ...view, target: 34963 } : i < 3 ? { ...view, target: 34962 } : view,
    ),
    buffers: [{ byteLength: bin.length, ...(bufferUri === undefined ? {} : { uri: bufferUri }) }],
    animations: [
      {
        name: 'Spin',
        samplers: [{ input: 4, output: 5, interpolation: 'LINEAR' }],
        channels: [{ sampler: 0, target: { node: 1, path: 'rotation' } }],
      },
      {
        name: 'Lift',
        samplers: [{ input: 4, output: 6, interpolation: 'LINEAR' }],
        channels: [{ sampler: 0, target: { node: 1, path: 'translation' } }],
      },
    ],
  };
  return json;
}

// .gltf with relative files
writeFileSync(join(out, 'crate.bin'), bin);
writeFileSync(join(out, 'crate-oak.png'), texture);
writeFileSync(
  join(out, 'crate.gltf'),
  `${JSON.stringify(gltfJson('crate.bin', { uri: 'crate-oak.png', mimeType: 'image/png' }), null, 2)}\n`,
);

// .glb: the texture lives in the binary chunk
const texturePad = (4 - (texture.length % 4)) % 4;
const glbBin = Buffer.concat([bin, texture, Buffer.alloc(texturePad)]);
const glbJson = gltfJson(undefined, { bufferView: views.length, mimeType: 'image/png' });
glbJson.bufferViews.push({ buffer: 0, byteOffset: bin.length, byteLength: texture.length });
glbJson.buffers[0].byteLength = glbBin.length;
const jsonBytes = Buffer.from(JSON.stringify(glbJson));
const jsonPadded = Buffer.concat([jsonBytes, Buffer.alloc((4 - (jsonBytes.length % 4)) % 4, 0x20)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + glbBin.length, 8);
const chunkHead = (length, type) => {
  const b = Buffer.alloc(8);
  b.writeUInt32LE(length, 0);
  b.writeUInt32LE(type, 4);
  return b;
};
writeFileSync(
  join(out, 'crate.glb'),
  Buffer.concat([
    header,
    chunkHead(jsonPadded.length, 0x4e4f534a),
    jsonPadded,
    chunkHead(glbBin.length, 0x004e4942),
    glbBin,
  ]),
);

// Draco stand-in: a valid glTF that requires a decoder the runtime does not bundle.
const draco = gltfJson('crate.bin', { uri: 'crate-oak.png', mimeType: 'image/png' });
draco.extensionsUsed.push('KHR_draco_mesh_compression');
draco.extensionsRequired = ['KHR_draco_mesh_compression'];
writeFileSync(join(out, 'crate-draco.gltf'), `${JSON.stringify(draco, null, 2)}\n`);

console.log(`model fixtures written to ${out}`);
