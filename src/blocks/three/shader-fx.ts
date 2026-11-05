/**
 * The `shader-3d` effects, shared by the compiler (the poster frame) and the
 * bundled runtime (the GPU program and its inputs).
 *
 * A spec only names a closed preset and sets typed numbers; every line of GLSL
 * lives here, written by the compiler's authors. The shading is one formula in
 * two languages: `shadeAt` (TypeScript) and `SHADE_GLSL` return the same
 * weights, so the compiler's poster and the live frame agree on what each
 * point of the surface looks like. Nothing here reads the DOM or the network.
 */

export const SHADER_PRESETS = ['noise', 'fresnel', 'hologram', 'distortion', 'dissolve'] as const;
export const SHADER_SHAPES = ['sphere', 'torus', 'torus-knot', 'plane'] as const;
/** Post-processing passes, applied in this order. */
export const POST_PASSES = ['bloom', 'chromatic', 'scanlines', 'grain', 'vignette'] as const;
/** The numbers a spec, a control or a state value may set. */
export const SHADER_PARAMS = ['intensity', 'scale', 'progress', 'speed'] as const;

export type ShaderPreset = (typeof SHADER_PRESETS)[number];
export type ShaderShape = (typeof SHADER_SHAPES)[number];
export type PostPass = (typeof POST_PASSES)[number];
export type ShaderParam = (typeof SHADER_PARAMS)[number];

/** Inclusive bounds and slider step of each parameter. */
export const PARAM_RANGES: Record<ShaderParam, { min: number; max: number; step: number }> = {
  intensity: { min: 0, max: 2, step: 0.05 },
  scale: { min: 0.25, max: 4, step: 0.05 },
  progress: { min: 0, max: 1, step: 0.01 },
  speed: { min: 0, max: 4, step: 0.05 },
};

/**
 * Which passes suit which effect. Scanlines are the hologram's own grammar; a
 * chromatic split would fray the dissolve's burning edge into fringes.
 */
export const POST_COMPAT: Record<ShaderPreset, readonly PostPass[]> = {
  noise: ['bloom', 'chromatic', 'grain', 'vignette'],
  fresnel: ['bloom', 'chromatic', 'grain', 'vignette'],
  hologram: ['bloom', 'chromatic', 'scanlines', 'grain', 'vignette'],
  distortion: ['bloom', 'chromatic', 'grain', 'vignette'],
  dissolve: ['bloom', 'grain', 'vignette'],
};

/** Seconds of effect time shown by the poster, the first live frame and reduced motion. */
export const POSTER_TIME = 3;

export interface ShaderParams {
  preset: ShaderPreset;
  shape: ShaderShape;
  /** Two theme tones: the body and the glow. */
  colors: [string, string];
  intensity: number;
  scale: number;
  progress: number;
  speed: number;
  post: PostPass[];
  seed: number;
  camera: { position: [number, number, number]; target: [number, number, number]; fov: number };
}

type PresetDefaults = Pick<
  ShaderParams,
  'shape' | 'colors' | 'intensity' | 'scale' | 'progress' | 'post'
>;

export const PRESET_DEFAULTS: Record<ShaderPreset, PresetDefaults> = {
  noise: {
    shape: 'sphere',
    colors: ['info', 'accent'],
    intensity: 1,
    scale: 1.3,
    progress: 0.5,
    post: ['bloom', 'vignette'],
  },
  fresnel: {
    shape: 'torus-knot',
    colors: ['accent', 'info'],
    intensity: 1.1,
    scale: 1.2,
    progress: 0.4,
    post: ['bloom', 'vignette'],
  },
  hologram: {
    shape: 'torus',
    colors: ['info', 'success'],
    intensity: 1,
    scale: 1,
    progress: 0.35,
    post: ['bloom', 'chromatic', 'scanlines', 'vignette'],
  },
  distortion: {
    shape: 'plane',
    colors: ['info', 'accent'],
    intensity: 1,
    scale: 1,
    progress: 0.6,
    post: ['bloom', 'chromatic', 'vignette'],
  },
  dissolve: {
    shape: 'torus-knot',
    colors: ['info', 'warning'],
    intensity: 1.2,
    scale: 1.6,
    progress: 0.42,
    post: ['bloom', 'grain', 'vignette'],
  },
};

export const CAMERA: ShaderParams['camera'] = { position: [0, 0, 5.2], target: [0, 0, 0], fov: 34 };

export const presetIndex = (preset: ShaderPreset): number => SHADER_PRESETS.indexOf(preset);

/** The passes a preset keeps from a chain, in pass order. */
export const compatiblePost = (preset: ShaderPreset, post: readonly PostPass[]): PostPass[] =>
  POST_PASSES.filter((pass) => post.includes(pass) && POST_COMPAT[preset].includes(pass));

/** A seeded offset into the noise field, so a seed picks its own pattern. */
export function seedOffset(seed: number): [number, number, number] {
  let a = (seed >>> 0) + 0x6d2b79f5;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return [next() * 20, next() * 20, next() * 20];
}

/** How each shape sits and turns: a fixed tilt about x, then a spin about y. */
export function poseAt(shape: ShaderShape, time: number): { tilt: number; spin: number } {
  if (shape === 'plane') return { tilt: -0.95, spin: 0.35 * Math.sin(time * 0.25) };
  if (shape === 'torus') return { tilt: 1.05, spin: time * 0.22 };
  if (shape === 'torus-knot') return { tilt: 0.3, spin: time * 0.2 };
  return { tilt: 0.25, spin: time * 0.18 };
}

type V3 = [number, number, number];

const S = Math.sin;
/** Smooth, seed-free pseudo-noise from nested sines; the GLSL twin is in `NOISE_GLSL`. */
export function noise3(x: number, y: number, z: number): number {
  return (
    S(x + S(y * 1.3 + z * 0.7)) *
    S(y * 1.1 + S(z * 1.7 + x * 0.5)) *
    S(z * 0.9 + S(x * 1.5 + y * 0.3))
  );
}
export function fbm(x: number, y: number, z: number): number {
  return (
    0.55 * noise3(x, y, z) +
    0.3 * noise3(x * 2.03 + 1.7, y * 2.03 + 9.2, z * 2.03 + 4.1) +
    0.15 * noise3(x * 4.01 + 3.1, y * 4.01 + 5.3, z * 4.01 + 7.7)
  );
}

/** Where the noise field is sampled for an object-space point. */
export function noiseDomain(p: V3, params: ShaderParams, seed: V3, time: number): V3 {
  return [
    p[0] * params.scale + seed[0],
    p[1] * params.scale + seed[1] + time * 0.21,
    p[2] * params.scale + seed[2] + time * 0.13,
  ];
}

/** Moves a surface point along its normal: the noise swell and the distortion wave. */
export function displace(p: V3, n: V3, params: ShaderParams, seed: V3, time: number): V3 {
  const q = noiseDomain(p, params, seed, time);
  let d = 0;
  if (params.preset === 'noise') d = fbm(...q) * params.progress * 0.7;
  else if (params.preset === 'distortion') {
    const wave =
      Math.sin(p[0] * 2.4 * params.scale + time * 1.5) *
      Math.cos(p[1] * 2.1 * params.scale + time * 1.1);
    d = (wave * 0.6 + fbm(...q) * 0.5) * params.progress * 0.55;
  } else return p;
  return [p[0] + n[0] * d, p[1] + n[1] * d, p[2] + n[2] * d];
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: V3): V3 => {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};

/** The displaced point and its normal, recomputed from two nearby displaced points. */
export function surfaceAt(p: V3, n: V3, params: ShaderParams, seed: V3, time: number) {
  const moved = displace(p, n, params, seed, time);
  if (params.preset !== 'noise' && params.preset !== 'distortion') return { p: moved, n };
  const t1 = unit(cross(n, Math.abs(n[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0]));
  const t2 = cross(n, t1);
  const e = 0.01;
  const a = sub(
    displace([p[0] + t1[0] * e, p[1] + t1[1] * e, p[2] + t1[2] * e], n, params, seed, time),
    moved,
  );
  const b = sub(
    displace([p[0] + t2[0] * e, p[1] + t2[1] * e, p[2] + t2[2] * e], n, params, seed, time),
    moved,
  );
  return { p: moved, n: unit(cross(a, b)) };
}

/** Rotates an object-space vector into the world: tilt about x, then spin about y. */
export function pose(v: V3, tilt: number, spin: number): V3 {
  let c = Math.cos(tilt);
  let s = Math.sin(tilt);
  const x = v[0];
  const y = v[1] * c - v[2] * s;
  const z = v[1] * s + v[2] * c;
  c = Math.cos(spin);
  s = Math.sin(spin);
  return [x * c + z * s, y, -x * s + z * c];
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const fract = (x: number) => x - Math.floor(x);
const mix = (a: number, b: number, k: number) => a + (b - a) * k;

/** Dissolve's noise, spread to cover 0..1 evenly enough that `progress` reads as a share. */
export const DISSOLVE_GAIN = 2.3;
const KEY_LIGHT = unit([0.45, 0.8, 0.55]);

/**
 * The color at one surface point as weights: `body * a + glow * b + white * w`,
 * with `alpha`, or `alpha < 0` where the surface is cut away. The GLSL twin is
 * `SHADE_GLSL`; keep the two in step.
 */
export function shadeAt(
  params: ShaderParams,
  normal: V3,
  view: V3,
  worldY: number,
  q: V3,
  time: number,
): { a: number; b: number; w: number; alpha: number } {
  let n = normal;
  const facing = dot(n, view);
  if (facing < 0) n = [-n[0], -n[1], -n[2]];
  const back = facing < 0 ? 1 : 0;
  const diff = Math.max(dot(n, KEY_LIGHT), 0);
  const fres = 1 - clamp(dot(n, view), 0, 1);
  const h = unit([KEY_LIGHT[0] + view[0], KEY_LIGHT[1] + view[1], KEY_LIGHT[2] + view[2]]);
  const spec = Math.max(dot(n, h), 0) ** 48;
  const I = params.intensity;
  const P = params.progress;
  const lit = 0.1 + 0.72 * diff;
  switch (params.preset) {
    case 'noise': {
      const f = fbm(...q);
      const k = smoothstep(-0.3, 0.35, f);
      return {
        a: (1 - k) * lit,
        b: k * lit * 0.8 + fres ** 2.5 * I * 0.7 + smoothstep(0.22, 0.5, f) * I * 0.45,
        w: spec * 0.35,
        alpha: 1,
      };
    }
    case 'fresnel': {
      const fr = fres ** mix(4.5, 1.3, P);
      const inner = 0.5 + 0.5 * fbm(...q);
      return {
        a: 0.04 + 0.12 * diff + (1 - fr) * fr * I * 1.2,
        b: fr * fr * I * 2.6 + 0.05 * inner,
        w: spec * 0.5,
        alpha: 1,
      };
    }
    case 'hologram': {
      const stripe = 0.55 + 0.45 * (fract(worldY * 7 * params.scale - time * 0.6) >= 0.5 ? 1 : 0);
      const line = smoothstep(0.9, 1, fract(worldY * 38 - time * 1.8));
      const flick = 0.93 + 0.07 * Math.sin(time * 17) * Math.sin(time * 2.3);
      const g = (0.22 + 1.5 * fres ** 1.6) * stripe * I * flick;
      return {
        a: g * (1 - fres),
        b: g * fres + line * 0.4 * I,
        w: 0,
        alpha: clamp((0.1 + 0.45 * P + fres ** 1.4 * 0.8) * stripe, 0, 1),
      };
    }
    case 'distortion': {
      const f = fbm(...q);
      const irid = 0.5 + 0.5 * Math.sin(6 * fres + f * 4 + time * 0.4);
      return {
        a: (1 - irid) * lit,
        b: irid * lit + fres ** 3 * I * 0.9,
        w: spec * 0.55,
        alpha: 1,
      };
    }
    default: {
      const m = clamp(fbm(...q) * DISSOLVE_GAIN * 0.5 + 0.5, 0, 1);
      const threshold = P * 1.08 - 0.04 + 0.06 * Math.sin(time * 0.45);
      const d = m - threshold;
      if (d < 0) return { a: 0, b: 0, w: 0, alpha: -1 };
      const e = 1 - smoothstep(0, 0.075, d);
      const body = lit * 0.8 * (1 - back * 0.6);
      return {
        a: body * (1 - e * 0.6),
        b: e * I * 2.6,
        w: e * e * I * 0.6 + spec * 0.3 * (1 - back),
        alpha: 1,
      };
    }
  }
}

/** A parametric surface sampled on a grid: positions and normals, `(segU + 1) * (segV + 1)` vertices. */
export interface SurfaceGrid {
  segU: number;
  segV: number;
  position: Float32Array;
  normal: Float32Array;
}

function knotPoint(u: number, radius: number): V3 {
  const cs = Math.cos(1.5 * u);
  return [
    radius * (2 + cs) * 0.5 * Math.cos(u),
    radius * (2 + cs) * 0.5 * Math.sin(u),
    radius * Math.sin(1.5 * u) * 0.5,
  ];
}

/** Samples a shape on a `segU x segV` grid; the poster and the live mesh share it. */
export function surfaceGrid(shape: ShaderShape, segU: number, segV: number): SurfaceGrid {
  const count = (segU + 1) * (segV + 1);
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  let at = 0;
  const put = (p: V3, n: V3) => {
    position.set(p, at * 3);
    normal.set(n, at * 3);
    at += 1;
  };
  for (let j = 0; j <= segV; j += 1) {
    for (let i = 0; i <= segU; i += 1) {
      const u = (i / segU) * Math.PI * 2;
      const v = j / segV;
      if (shape === 'sphere') {
        const theta = v * Math.PI;
        const n: V3 = [
          Math.sin(theta) * Math.cos(u),
          Math.cos(theta),
          Math.sin(theta) * Math.sin(u),
        ];
        put([n[0] * 1.2, n[1] * 1.2, n[2] * 1.2], n);
      } else if (shape === 'torus') {
        const a = v * Math.PI * 2;
        const n: V3 = [Math.cos(a) * Math.cos(u), Math.sin(a), Math.cos(a) * Math.sin(u)];
        const ring = 1.05 + 0.42 * Math.cos(a);
        put([ring * Math.cos(u), 0.42 * Math.sin(a), ring * Math.sin(u)], n);
      } else if (shape === 'torus-knot') {
        // The tube frame three.js uses for its torus knot (p = 2, q = 3).
        const a = v * Math.PI * 2;
        const p1 = knotPoint(u * 2, 0.8);
        const p2 = knotPoint(u * 2 + 0.01, 0.8);
        const t = sub(p2, p1);
        const b = unit(cross(t, [p1[0] + p2[0], p1[1] + p2[1], p1[2] + p2[2]]));
        const nn = unit(cross(b, t));
        const cx = -0.26 * Math.cos(a);
        const cy = 0.26 * Math.sin(a);
        const p: V3 = [
          p1[0] + cx * nn[0] + cy * b[0],
          p1[1] + cx * nn[1] + cy * b[1],
          p1[2] + cx * nn[2] + cy * b[2],
        ];
        put(p, unit(sub(p, p1)));
      } else {
        put([(i / segU - 0.5) * 4.4, (v - 0.5) * 2.6, 0], [0, 0, 1]);
      }
    }
  }
  return { segU, segV, position, normal };
}

/** Grid resolution of the live mesh per shape. */
export const LIVE_GRID: Record<ShaderShape, [number, number]> = {
  sphere: [160, 112],
  torus: [200, 72],
  'torus-knot': [420, 48],
  plane: [176, 104],
};
/** Grid resolution of the poster per shape: enough facets to read as smooth at card size. */
export const POSTER_GRID: Record<ShaderShape, [number, number]> = {
  sphere: [64, 40],
  torus: [84, 28],
  'torus-knot': [224, 16],
  plane: [64, 36],
};

const NOISE_GLSL = /* glsl */ `
float noise3(vec3 p) {
  return sin(p.x + sin(p.y * 1.3 + p.z * 0.7)) * sin(p.y * 1.1 + sin(p.z * 1.7 + p.x * 0.5)) * sin(p.z * 0.9 + sin(p.x * 1.5 + p.y * 0.3));
}
float fbm(vec3 p) {
  return 0.55 * noise3(p) + 0.3 * noise3(p * 2.03 + vec3(1.7, 9.2, 4.1)) + 0.15 * noise3(p * 4.01 + vec3(3.1, 5.3, 7.7));
}
vec3 noiseDomain(vec3 p) {
  return p * uScale + uSeed + vec3(0.0, uTime * 0.21, uTime * 0.13);
}`;

const UNIFORMS_GLSL = /* glsl */ `
uniform float uTime;
uniform float uScale;
uniform float uProgress;
uniform float uIntensity;
uniform float uTilt;
uniform float uSpin;
uniform int uPreset;
uniform vec3 uSeed;`;

/** Vertex program: displacement with a recomputed normal, then the pose. */
export const SHADER_VERTEX = /* glsl */ `
${UNIFORMS_GLSL}
varying vec3 vObj;
varying vec3 vNormal;
varying vec3 vWorld;
${NOISE_GLSL}
vec3 displace(vec3 p, vec3 n) {
  float d = 0.0;
  if (uPreset == 0) d = fbm(noiseDomain(p)) * uProgress * 0.7;
  else if (uPreset == 3) {
    float wave = sin(p.x * 2.4 * uScale + uTime * 1.5) * cos(p.y * 2.1 * uScale + uTime * 1.1);
    d = (wave * 0.6 + fbm(noiseDomain(p)) * 0.5) * uProgress * 0.55;
  }
  return p + n * d;
}
vec3 pose(vec3 v) {
  float c = cos(uTilt);
  float s = sin(uTilt);
  v = vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c);
  c = cos(uSpin);
  s = sin(uSpin);
  return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}
void main() {
  vec3 n = normalize(normal);
  vec3 p = displace(position, n);
  if (uPreset == 0 || uPreset == 3) {
    vec3 t1 = normalize(cross(n, abs(n.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 t2 = cross(n, t1);
    vec3 a = displace(position + t1 * 0.01, n) - p;
    vec3 b = displace(position + t2 * 0.01, n) - p;
    n = normalize(cross(a, b));
  }
  vObj = position;
  vWorld = pose(p);
  vNormal = pose(n);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}`;

/** Fragment program: `shadeAt` in GLSL, then the two theme tones. */
export const SHADER_FRAGMENT = /* glsl */ `
${UNIFORMS_GLSL}
uniform vec3 uBody;
uniform vec3 uGlow;
varying vec3 vObj;
varying vec3 vNormal;
varying vec3 vWorld;
${NOISE_GLSL}
void main() {
  vec3 n = normalize(vNormal);
  vec3 view = normalize(cameraPosition - vWorld);
  float facing = dot(n, view);
  if (facing < 0.0) n = -n;
  float back = facing < 0.0 ? 1.0 : 0.0;
  vec3 L = normalize(vec3(0.45, 0.8, 0.55));
  float diff = max(dot(n, L), 0.0);
  float fres = 1.0 - clamp(dot(n, view), 0.0, 1.0);
  float spec = pow(max(dot(n, normalize(L + view)), 0.0), 48.0);
  float I = uIntensity;
  float P = uProgress;
  float lit = 0.1 + 0.72 * diff;
  vec3 q = noiseDomain(vObj);
  vec4 k;
  if (uPreset == 0) {
    float f = fbm(q);
    float m = smoothstep(-0.3, 0.35, f);
    k = vec4((1.0 - m) * lit, m * lit * 0.8 + pow(fres, 2.5) * I * 0.7 + smoothstep(0.22, 0.5, f) * I * 0.45, spec * 0.35, 1.0);
  } else if (uPreset == 1) {
    float fr = pow(fres, mix(4.5, 1.3, P));
    float inner = 0.5 + 0.5 * fbm(q);
    k = vec4(0.04 + 0.12 * diff + (1.0 - fr) * fr * I * 1.2, fr * fr * I * 2.6 + 0.05 * inner, spec * 0.5, 1.0);
  } else if (uPreset == 2) {
    float stripe = 0.55 + 0.45 * step(0.5, fract(vWorld.y * 7.0 * uScale - uTime * 0.6));
    float line = smoothstep(0.9, 1.0, fract(vWorld.y * 38.0 - uTime * 1.8));
    float flick = 0.93 + 0.07 * sin(uTime * 17.0) * sin(uTime * 2.3);
    float g = (0.22 + 1.5 * pow(fres, 1.6)) * stripe * I * flick;
    k = vec4(g * (1.0 - fres), g * fres + line * 0.4 * I, 0.0, clamp((0.1 + 0.45 * P + pow(fres, 1.4) * 0.8) * stripe, 0.0, 1.0));
  } else if (uPreset == 3) {
    float f = fbm(q);
    float irid = 0.5 + 0.5 * sin(6.0 * fres + f * 4.0 + uTime * 0.4);
    k = vec4((1.0 - irid) * lit, irid * lit + pow(fres, 3.0) * I * 0.9, spec * 0.55, 1.0);
  } else {
    float m = clamp(fbm(q) * ${DISSOLVE_GAIN.toFixed(2)} * 0.5 + 0.5, 0.0, 1.0);
    float d = m - (P * 1.08 - 0.04 + 0.06 * sin(uTime * 0.45));
    if (d < 0.0) discard;
    float e = 1.0 - smoothstep(0.0, 0.075, d);
    float body = lit * 0.8 * (1.0 - back * 0.6);
    k = vec4(body * (1.0 - e * 0.6), e * I * 2.6, e * e * I * 0.6 + spec * 0.3 * (1.0 - back), 1.0);
  }
  gl_FragColor = vec4(uBody * k.x + uGlow * k.y + vec3(k.z), k.w);
}`;

/**
 * Finishing pass: the stage's glow, then the closed post-processing toggles.
 * Bloom runs before it as its own pass.
 */
export const FINISH_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uResolution;
uniform vec3 uHalo;
uniform float uTime;
uniform float uChromatic;
uniform float uScanlines;
uniform float uGrain;
uniform float uVignette;
varying vec2 vUv;
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
void main() {
  vec2 uv = vUv;
  vec2 centered = uv - 0.5;
  vec4 base = texture2D(tDiffuse, uv);
  vec3 color = base.rgb;
  if (uChromatic > 0.0) {
    vec2 shift = centered * 0.012;
    color.r = texture2D(tDiffuse, uv + shift).r;
    color.b = texture2D(tDiffuse, uv - shift).b;
  }
  float r = length(centered * vec2(uResolution.x / uResolution.y, 1.0));
  color += uHalo * 0.16 * (1.0 - smoothstep(0.0, 0.75, r));
  if (uScanlines > 0.0) color *= 0.82 + 0.18 * step(0.5, fract(gl_FragCoord.y / 3.0));
  if (uGrain > 0.0) color += (hash(floor(gl_FragCoord.xy) + floor(uTime * 24.0)) - 0.5) * 0.06;
  if (uVignette > 0.0) color *= mix(1.0, 0.45, smoothstep(0.35, 0.95, r));
  gl_FragColor = vec4(color, 1.0);
}`;

export const FINISH_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
