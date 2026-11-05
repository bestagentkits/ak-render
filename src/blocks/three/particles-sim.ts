/**
 * The `particles-3d` simulation, shared by the compiler (the poster frame) and
 * the bundled runtime (the CPU path and the GPU shader's inputs).
 *
 * Every particle is a closed-form function of its seeded spawn and the clock,
 * so any frame can be computed directly: the poster, the first live frame and
 * the reduced-motion frame are the same picture, and the same seed always
 * yields the same cloud. Nothing here reads the DOM or the network.
 */

export const PARTICLE_PRESETS = [
  'galaxy',
  'nebula',
  'fountain',
  'snow',
  'fireflies',
  'vortex',
] as const;
export const EMITTER_SHAPES = ['point', 'sphere', 'ring', 'disc', 'box'] as const;
export const FORCE_FIELDS = ['swirl', 'noise', 'gravity', 'wind', 'attract'] as const;
export const SIZE_CURVES = ['constant', 'grow', 'shrink', 'pulse'] as const;

export type ParticlePreset = (typeof PARTICLE_PRESETS)[number];
export type EmitterShape = (typeof EMITTER_SHAPES)[number];
export type ForceField = (typeof FORCE_FIELDS)[number];
export type SizeCurve = (typeof SIZE_CURVES)[number];

export const MIN_PARTICLES = 64;
export const MAX_PARTICLES = 20000;
/** The CPU path recomputes every particle each frame, so it draws at most this many. */
export const CPU_PARTICLE_CAP = 4000;
/** Seconds of simulated time shown by the poster, the first live frame and reduced motion. */
export const POSTER_TIME = 7.5;

/** Everything the runtime needs to rebuild the cloud; the compiler emits exactly this. */
export interface ParticleParams {
  preset: ParticlePreset;
  shape: EmitterShape;
  fields: ForceField[];
  count: number;
  seed: number;
  /** Theme tones the color runs through over a particle's life (or core to rim when orbiting). */
  colors: string[];
  size: SizeCurve;
  speed: number;
  /** Seconds one particle lives before it respawns. */
  life: number;
  /** Flow particles travel from their spawn and respawn; orbiting ones stay in the cloud. */
  flow: boolean;
  /** Spawn velocity: outward speed, upward speed and random jitter, in units per second. */
  velocity: [number, number, number];
  /** Emitter radius in scene units. */
  radius: number;
  /** World size of an average particle. */
  grain: number;
  camera: { position: [number, number, number]; target: [number, number, number]; fov: number };
}

type PresetDefaults = Omit<ParticleParams, 'preset' | 'seed' | 'speed'>;

export const PRESET_DEFAULTS: Record<ParticlePreset, PresetDefaults> = {
  galaxy: {
    shape: 'disc',
    fields: ['swirl'],
    count: 9000,
    colors: ['warning', 'accent', 'info'],
    size: 'constant',
    life: 6,
    flow: false,
    velocity: [0, 0, 0],
    radius: 3,
    grain: 0.05,
    camera: { position: [0, 5.2, 6.8], target: [0, -0.3, 0], fov: 34 },
  },
  nebula: {
    shape: 'sphere',
    fields: ['noise', 'swirl'],
    count: 6000,
    colors: ['danger', 'accent', 'info'],
    size: 'pulse',
    life: 9,
    flow: false,
    velocity: [0, 0, 0],
    radius: 2.4,
    grain: 0.05,
    camera: { position: [0, 1.4, 7.2], target: [0, 0, 0], fov: 34 },
  },
  fountain: {
    shape: 'point',
    fields: ['gravity'],
    count: 5000,
    colors: ['info', 'accent', 'neutral'],
    size: 'shrink',
    life: 2.3,
    flow: true,
    velocity: [2, 4.4, 0.08],
    radius: 0.15,
    grain: 0.06,
    camera: { position: [0, 4.6, 8.6], target: [0, 1.4, 0], fov: 34 },
  },
  snow: {
    shape: 'box',
    fields: ['wind', 'noise'],
    count: 4000,
    colors: ['neutral', 'info'],
    size: 'constant',
    life: 8,
    flow: true,
    velocity: [0, -0.55, 0.08],
    radius: 3,
    grain: 0.06,
    camera: { position: [0, 0.6, 7.6], target: [0, 0, 0], fov: 38 },
  },
  fireflies: {
    shape: 'box',
    fields: ['noise'],
    count: 900,
    colors: ['warning', 'success'],
    size: 'pulse',
    life: 4,
    flow: false,
    velocity: [0, 0, 0],
    radius: 2.6,
    grain: 0.11,
    camera: { position: [0, 1, 7.4], target: [0, 0, 0], fov: 36 },
  },
  vortex: {
    shape: 'ring',
    fields: ['swirl', 'attract'],
    count: 7000,
    colors: ['danger', 'warning', 'accent'],
    size: 'shrink',
    life: 3.5,
    flow: true,
    velocity: [0, 0.95, 0.1],
    radius: 2.2,
    grain: 0.055,
    camera: { position: [0, 3.2, 7.8], target: [0, 1.3, 0], fov: 34 },
  },
};

/** A small, fast, well-mixed 32-bit generator; identical in every JS engine. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded spawn state: position, velocity and [phase, variance, color key] per particle. */
export interface ParticleSpawn {
  count: number;
  position: Float32Array;
  velocity: Float32Array;
  extra: Float32Array;
}

const TAU = Math.PI * 2;

export function spawnParticles(params: ParticleParams, count = params.count): ParticleSpawn {
  const random = mulberry32(params.seed);
  const position = new Float32Array(count * 3);
  const velocity = new Float32Array(count * 3);
  const extra = new Float32Array(count * 3);
  const R = params.radius;
  const [outward, up, jitter] = params.velocity;
  for (let i = 0; i < count; i += 1) {
    const u = [random(), random(), random(), random(), random(), random(), random(), random()] as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    let x = 0;
    let y = 0;
    let z = 0;
    let key = u[7];
    if (params.shape === 'sphere') {
      // Uniform inside the ball, denser toward the core for a glowing heart.
      const r = R * u[0] ** 0.45;
      const theta = TAU * u[1];
      const phi = Math.acos(2 * u[2] - 1);
      x = r * Math.sin(phi) * Math.cos(theta);
      y = r * Math.cos(phi) * 0.8;
      z = r * Math.sin(phi) * Math.sin(theta);
      key = r / R;
    } else if (params.shape === 'ring') {
      const a = TAU * u[0];
      const r = R * (0.88 + 0.24 * u[1]);
      x = r * Math.cos(a);
      z = r * Math.sin(a);
      y = (u[2] - 0.5) * 0.12;
      key = u[1];
    } else if (params.shape === 'disc') {
      // Three spiral arms, faint dust between them and a dense bulge at the core.
      let r: number;
      let a: number;
      let spread: number;
      if (u[0] < 0.12) {
        r = R * 0.22 * u[1] ** 1.4;
        a = TAU * u[2];
        spread = 0.05;
      } else if (u[0] < 0.32) {
        r = R * Math.sqrt(u[1]);
        a = TAU * u[2];
        spread = 0.1;
      } else {
        const arm = Math.floor(((u[0] - 0.32) / 0.68) * 3);
        r = R * (0.08 + 0.92 * u[1] ** 1.3);
        spread = 0.5 * (1 - r / R) + 0.1;
        a = (arm * TAU) / 3 + (r / R) * 4.2 + (u[2] - 0.5) * spread * 1.6;
      }
      x = r * Math.cos(a) + (u[3] - 0.5) * spread * 0.5;
      z = r * Math.sin(a) + (u[4] - 0.5) * spread * 0.5;
      y = (u[5] - 0.5) * 0.32 * (1 - r / R) ** 2;
      key = r / R;
    } else if (params.shape === 'box') {
      x = (u[0] * 2 - 1) * R;
      y = (u[1] * 2 - 1) * R * 0.6;
      z = (u[2] * 2 - 1) * R * 0.7;
      key = u[1];
    } else {
      const a = TAU * u[0];
      const r = R * Math.sqrt(u[1]);
      x = r * Math.cos(a);
      z = r * Math.sin(a);
    }
    const len = Math.hypot(x, z) || 1;
    // Outward is radial on the floor plane; a point emitter fans out by its random angle.
    const ox = params.shape === 'point' ? Math.cos(TAU * u[3]) : x / len;
    const oz = params.shape === 'point' ? Math.sin(TAU * u[3]) : z / len;
    // A point jet keeps a minimum lean, so its crest opens into a crown instead of piling on the axis.
    const spreadOut = params.shape === 'point' ? 0.35 + 0.65 * Math.sqrt(u[4]) : 1;
    const vy = up * (0.8 + 0.4 * u[6]) + (u[4] - 0.5) * 2 * jitter;
    // A box emitter fills its volume over a life: start each particle half its travel upstream.
    if (params.flow && params.shape === 'box') y -= (vy * params.life) / 2;
    position[i * 3] = x;
    position[i * 3 + 1] = y;
    position[i * 3 + 2] = z;
    velocity[i * 3] = ox * outward * spreadOut + (u[5] - 0.5) * 2 * jitter;
    velocity[i * 3 + 1] = vy;
    velocity[i * 3 + 2] = oz * outward * spreadOut + (u[2] - 0.5) * 2 * jitter;
    extra[i * 3] = u[6];
    extra[i * 3 + 1] = u[3];
    extra[i * 3 + 2] = key;
  }
  return { count, position, velocity, extra };
}

const fract = (v: number) => v - Math.floor(v);
const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Size factor over a particle's life. */
export function sizeAt(curve: SizeCurve, age: number): number {
  if (curve === 'grow') return 0.45 + 0.9 * age;
  if (curve === 'shrink') return 1.35 - 0.95 * age;
  if (curve === 'pulse') return 0.65 + 0.7 * Math.sin(Math.PI * age) ** 2;
  return 1;
}

/** Opacity over life: flow particles fade in and out so a respawn never pops. */
export function alphaAt(flow: boolean, age: number): number {
  if (flow) return smoothstep(0, 0.22, age) * (1 - smoothstep(0.72, 1, age));
  return 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(TAU * age));
}

/** One particle at time `t` seconds: [x, y, z, age, colorKey, size, alpha]. */
export function particleAt(
  params: ParticleParams,
  spawn: ParticleSpawn,
  i: number,
  t: number,
  out: number[],
): void {
  const tau = t * params.speed;
  const phase = spawn.extra[i * 3] ?? 0;
  const variance = spawn.extra[i * 3 + 1] ?? 0;
  const key = spawn.extra[i * 3 + 2] ?? 0;
  const age = fract(tau / params.life + phase);
  const local = age * params.life;
  const a = params.flow ? local : tau;
  let x = spawn.position[i * 3] ?? 0;
  let y = spawn.position[i * 3 + 1] ?? 0;
  let z = spawn.position[i * 3 + 2] ?? 0;
  if (params.flow) {
    x += (spawn.velocity[i * 3] ?? 0) * local;
    y += (spawn.velocity[i * 3 + 1] ?? 0) * local;
    z += (spawn.velocity[i * 3 + 2] ?? 0) * local;
  }
  const fields = params.fields;
  if (fields.includes('gravity')) y -= 2 * local * local;
  if (fields.includes('wind')) {
    // A steady drift, centred on the emitter over a life, with a sway across it.
    x += 0.35 * (local - params.life / 2);
    z += 0.18 * Math.sin(local * 1.3 + variance * TAU);
  }
  if (fields.includes('attract')) {
    const k = 1 - 0.7 * smoothstep(0, 1, age);
    x *= k;
    z *= k;
  }
  if (fields.includes('swirl')) {
    const r = Math.hypot(x, z);
    // Orbiting clouds turn as one body with a bounded inner wobble, so spiral arms never wind away.
    const angle = params.flow
      ? (1.4 * a) / (0.35 + r)
      : 0.16 * a + (0.35 * Math.sin(0.4 * a)) / (0.5 + r);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const nx = x * c - z * s;
    z = x * s + z * c;
    x = nx;
  }
  if (fields.includes('noise')) {
    const ph = variance * TAU;
    const amp = 0.28;
    const px = x;
    const py = y;
    const pz = z;
    // A fine per-particle jitter on a broad shared fold, so neighbours drift together into wisps.
    x = px + amp * Math.sin(1.7 * py + 0.9 * a + ph) + 0.6 * Math.sin(0.8 * py + 0.3 * a);
    y = py + amp * Math.sin(1.3 * pz + 1.1 * a + ph * 1.3) + 0.6 * Math.sin(0.8 * pz + 0.25 * a);
    z = pz + amp * Math.sin(1.5 * px + 0.7 * a + ph * 0.7) + 0.6 * Math.sin(0.8 * px + 0.35 * a);
  }
  out[0] = x;
  out[1] = y;
  out[2] = z;
  out[3] = age;
  out[4] = params.flow ? age : key;
  out[5] = (0.6 + 0.8 * variance) * sizeAt(params.size, age);
  out[6] = alphaAt(params.flow, age);
}

/** Additive glow per sprite, so a dense cloud keeps its structure instead of burning to white. */
export function densityGain(count: number, dark = false): number {
  const gain = Math.min(0.6, Math.max(0.1, 0.45 * Math.sqrt(1200 / Math.max(count, 1))));
  // A dark stage shows additive light sooner, so it takes less per sprite to keep its color.
  return dark ? gain * 0.6 : gain;
}

/** Frames the adaptive path averages before it decides. */
export const FRAME_WINDOW = 30;
/** A frame slower than this (ms) on median, over a full window, steps quality down. */
export const FRAME_BUDGET_MS = 28;
/** The slowest display interval the baseline learns: a 30 Hz screen or a power-saving mode. */
export const MAX_DISPLAY_MS = 34;
/** Each level halves the drawn particles; level 3 draws an eighth. */
export const MAX_LEVEL = 3;

const sortedOf = (samples: readonly number[]) => [...samples].sort((p, q) => p - q);

/** Refresh intervals of real displays (144, 120, 90, 60 and 30 Hz), in ms. */
const DISPLAY_INTERVALS = [6.9, 8.3, 11.1, 16.7, 33.3];

/**
 * The display's own frame interval: the fast tail of a window, snapped to a
 * real refresh rate. A device that is slow from the first frame matches none
 * and is judged against 60 Hz, so it cannot teach itself a slow pace.
 */
export function frameBaseline(samples: readonly number[]): number {
  const fast = sortedOf(samples)[Math.floor(samples.length / 10)] ?? 16.7;
  let best = 16.7;
  let gap = Number.POSITIVE_INFINITY;
  for (const interval of DISPLAY_INTERVALS) {
    // Within 10% of a refresh interval counts as that display; the nearest one wins.
    const off = Math.abs(fast - interval) / interval;
    if (off <= 0.1 && off < gap) {
      best = interval;
      gap = off;
    }
  }
  return best;
}

/**
 * The next quality level for a window of frame intervals; it only ever steps
 * down. A frame is slow against the display it runs on, so a 30 Hz screen
 * running at its own pace is not a slow device.
 */
export function nextLevel(samples: readonly number[], level: number, baseline = 16.7): number {
  if (samples.length < FRAME_WINDOW || level >= MAX_LEVEL) return level;
  const median = sortedOf(samples)[Math.floor(samples.length / 2)] ?? 0;
  const budget = Math.max(FRAME_BUDGET_MS, 1.5 * Math.min(baseline, MAX_DISPLAY_MS));
  return median > budget ? level + 1 : level;
}

/** Particles drawn at a level: halves per level, never below the minimum. */
export function drawnAt(count: number, level: number): number {
  return Math.max(Math.min(count, MIN_PARTICLES), Math.floor(count / 2 ** level));
}

/**
 * The GPU path's vertex shader: the same closed-form motion as `particleAt`,
 * with the preset's fields switched on by fixed defines. No author text reaches it.
 */
export function particleVertexShader(params: ParticleParams, cpu: boolean): string {
  const defines = [
    cpu ? '#define AK_CPU' : '',
    params.flow ? '#define AK_FLOW' : '',
    ...params.fields.map((field) => `#define AK_${field.toUpperCase()}`),
    `#define AK_SIZE_${params.size.toUpperCase()}`,
  ]
    .filter(Boolean)
    .join('\n');
  return `${defines}
attribute vec3 aVelocity;
attribute vec3 aExtra;
attribute vec4 aLive;
uniform float uTime;
uniform float uSpeed;
uniform float uLife;
uniform float uScale;
varying float vKey;
varying float vAlpha;
const float TAU = 6.28318530718;
void main() {
#ifdef AK_CPU
  vec3 p = position;
  float age = aLive.x;
  vKey = aLive.y;
  float size = aLive.z;
  vAlpha = aLive.w;
#else
  float tau = uTime * uSpeed;
  float age = fract(tau / uLife + aExtra.x);
  float local = age * uLife;
  vec3 p = position;
#ifdef AK_FLOW
  float a = local;
  p += aVelocity * local;
  vKey = age;
  vAlpha = smoothstep(0.0, 0.22, age) * (1.0 - smoothstep(0.72, 1.0, age));
#else
  float a = tau;
  vKey = aExtra.z;
  vAlpha = 0.55 + 0.45 * (0.5 + 0.5 * sin(TAU * age));
#endif
#ifdef AK_GRAVITY
  p.y -= 2.0 * local * local;
#endif
#ifdef AK_WIND
  p.x += 0.35 * (local - uLife * 0.5);
  p.z += 0.18 * sin(local * 1.3 + aExtra.y * TAU);
#endif
#ifdef AK_ATTRACT
  p.xz *= 1.0 - 0.7 * smoothstep(0.0, 1.0, age);
#endif
#ifdef AK_SWIRL
  float r = length(p.xz);
#ifdef AK_FLOW
  float angle = 1.4 * a / (0.35 + r);
#else
  float angle = 0.16 * a + 0.35 * sin(0.4 * a) / (0.5 + r);
#endif
  float c = cos(angle);
  float s = sin(angle);
  p.xz = vec2(p.x * c - p.z * s, p.x * s + p.z * c);
#endif
#ifdef AK_NOISE
  float ph = aExtra.y * TAU;
  vec3 q = p;
  p.x = q.x + 0.28 * sin(1.7 * q.y + 0.9 * a + ph) + 0.6 * sin(0.8 * q.y + 0.3 * a);
  p.y = q.y + 0.28 * sin(1.3 * q.z + 1.1 * a + ph * 1.3) + 0.6 * sin(0.8 * q.z + 0.25 * a);
  p.z = q.z + 0.28 * sin(1.5 * q.x + 0.7 * a + ph * 0.7) + 0.6 * sin(0.8 * q.x + 0.35 * a);
#endif
  float curve = 1.0;
#ifdef AK_SIZE_GROW
  curve = 0.45 + 0.9 * age;
#endif
#ifdef AK_SIZE_SHRINK
  curve = 1.35 - 0.95 * age;
#endif
#ifdef AK_SIZE_PULSE
  float sp = sin(3.14159265359 * age);
  curve = 0.65 + 0.7 * sp * sp;
#endif
  float size = (0.6 + 0.8 * aExtra.y) * curve;
#endif
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(size * uScale / -mv.z, 1.0);
}`;
}

/**
 * A soft glowing sprite: a bright core and a wide falloff, colored along up to
 * four theme stops, blended additively on the always-dark stage. `uGain` sets
 * how far each core whitens; a dark theme keeps its color instead.
 */
export const PARTICLE_FRAGMENT = `
uniform vec3 uColors[4];
uniform float uStops;
uniform float uGain;
uniform float uDensity;
varying float vKey;
varying float vAlpha;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d2 = dot(p, p);
  if (d2 > 1.0) discard;
  float k = clamp(vKey, 0.0, 1.0) * (uStops - 1.0);
  vec3 c = uColors[0];
  if (k > 0.0) c = mix(uColors[0], uColors[1], clamp(k, 0.0, 1.0));
  if (k > 1.0) c = mix(uColors[1], uColors[2], clamp(k - 1.0, 0.0, 1.0));
  if (k > 2.0) c = mix(uColors[2], uColors[3], clamp(k - 2.0, 0.0, 1.0));
  float core = exp(-d2 * 9.0);
  float halo = (1.0 - d2) * (1.0 - d2) * 0.3;
  float glow = core + halo;
  c = mix(c, vec3(1.0), core * 0.35 * uGain);
  // Premultiplied, so the canvas stays valid to read back: export and print see the same glow.
  float alpha = min(glow * vAlpha * uDensity, 1.0);
  gl_FragColor = vec4(c * alpha, alpha);
  #include <colorspace_fragment>
}`;
