/**
 * Geography for `globe-3d`: latitude/longitude on the unit sphere, great-circle
 * distance and arcs, the Natural Earth land outline, seeded land dots and
 * marker clustering. Pure and deterministic; the compiler, the poster and the
 * tests share it, and the runtime mirrors the same conventions.
 *
 * Convention: y is north, longitude 0 faces +z and longitude 90 E faces +x.
 */

import type { Vec3 } from './scene-fallback.js';
import { WORLD_LAND } from './world-land.generated.js';

export const EARTH_RADIUS_KM = 6371;
const DEG = Math.PI / 180;

export function toVec(lat: number, lon: number, radius = 1): Vec3 {
  const phi = lat * DEG;
  const lambda = lon * DEG;
  return [
    radius * Math.cos(phi) * Math.sin(lambda),
    radius * Math.sin(phi),
    radius * Math.cos(phi) * Math.cos(lambda),
  ];
}

export function toLatLon(v: Vec3): [number, number] {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [Math.asin(Math.max(-1, Math.min(1, v[1] / length))) / DEG, Math.atan2(v[0], v[2]) / DEG];
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Central angle between two points, in radians. */
export function centralAngle(a: [number, number], b: [number, number]): number {
  const [lat1, lon1] = [a[0] * DEG, a[1] * DEG];
  const [lat2, lon2] = [b[0] * DEG, b[1] * DEG];
  const h =
    Math.sin((lat2 - lat1) / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Great-circle distance in kilometres (haversine on a mean-radius sphere). */
export function greatCircleKm(a: [number, number], b: [number, number]): number {
  return centralAngle(a, b) * EARTH_RADIUS_KM;
}

/**
 * Points along the great circle from `a` to `b`, lifted off the surface by a
 * sine bump that grows with the distance, so long routes arc higher.
 */
export function arcPoints(a: [number, number], b: [number, number], segments: number): Vec3[] {
  const p = toVec(a[0], a[1]);
  const q = toVec(b[0], b[1]);
  const omega = Math.acos(Math.max(-1, Math.min(1, dot(p, q))));
  const lift = arcLift(omega);
  const out: Vec3[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    let v: Vec3;
    if (omega < 1e-6) v = p;
    else {
      const s = Math.sin(omega);
      const wa = Math.sin((1 - t) * omega) / s;
      const wb = Math.sin(t * omega) / s;
      v = [wa * p[0] + wb * q[0], wa * p[1] + wb * q[1], wa * p[2] + wb * q[2]];
    }
    const r = 1 + lift * Math.sin(Math.PI * t);
    out.push([v[0] * r, v[1] * r, v[2] * r]);
  }
  return out;
}

/** Peak height of an arc above the surface, in globe radii. */
export function arcLift(omega: number): number {
  return 0.03 + 0.3 * (omega / Math.PI);
}

let landRings: [number, number][][] | null = null;

/** The land rings in degrees, `[lon, lat]` pairs, decoded once. */
export function worldLand(): [number, number][][] {
  if (landRings) return landRings;
  landRings = WORLD_LAND.split(';').map((ring) => {
    const values = ring.split(',').map(Number);
    const points: [number, number][] = [];
    let x = 0;
    let y = 0;
    for (let i = 0; i + 1 < values.length; i += 2) {
      x += values[i] as number;
      y += values[i + 1] as number;
      points.push([x / 10, y / 10]);
    }
    return points;
  });
  return landRings;
}

/** Even-odd point-in-polygon over every land ring, in the lon/lat plane. */
export function isLand(lat: number, lon: number): boolean {
  let inside = false;
  for (const ring of worldLand()) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i] as [number, number];
      const [xj, yj] = ring[j] as [number, number];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)
        inside = !inside;
    }
  }
  return inside;
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** `count` evenly spread points on the sphere (a Fibonacci lattice), as unit vectors. */
export function fibonacciPoint(i: number, count: number): Vec3 {
  const y = 1 - (2 * (i + 0.5)) / count;
  const r = Math.sqrt(1 - y * y);
  const theta = i * GOLDEN;
  return [r * Math.sin(theta), y, r * Math.cos(theta)];
}

const dotCache = new Map<number, Vec3[]>();

/** The lattice points that fall on land; the dotted continents. */
export function landDots(count: number): Vec3[] {
  const hit = dotCache.get(count);
  if (hit) return hit;
  const out: Vec3[] = [];
  for (let i = 0; i < count; i += 1) {
    const v = fibonacciPoint(i, count);
    const [lat, lon] = toLatLon(v);
    if (isLand(lat, lon)) out.push(v);
  }
  dotCache.set(count, out);
  return out;
}

/** One clustering level: the cluster each marker belongs to, and each cluster's centre. */
export interface ClusterLevel {
  /** Angular radius in degrees within which markers merge. */
  radius: number;
  of: number[];
  centers: [number, number][];
  sizes: number[];
}

/**
 * Greedy clustering: markers taken heaviest first seed a cluster and absorb
 * every unassigned marker within `radius` degrees. Deterministic: ties keep
 * the spec order.
 */
export function clusterMarkers(
  points: [number, number][],
  weights: number[],
  radius: number,
): ClusterLevel {
  const order = points
    .map((_, i) => i)
    .sort((a, b) => (weights[b] ?? 0) - (weights[a] ?? 0) || a - b);
  const vecs = points.map(([lat, lon]) => toVec(lat, lon));
  const limit = Math.cos(radius * DEG);
  const of = points.map(() => -1);
  const centers: [number, number][] = [];
  const sizes: number[] = [];
  for (const seed of order) {
    if ((of[seed] ?? -1) >= 0) continue;
    const id = centers.length;
    const sum: Vec3 = [0, 0, 0];
    let size = 0;
    for (const i of order) {
      if ((of[i] ?? -1) >= 0) continue;
      if (dot(vecs[seed] as Vec3, vecs[i] as Vec3) < limit) continue;
      of[i] = id;
      const v = vecs[i] as Vec3;
      sum[0] += v[0];
      sum[1] += v[1];
      sum[2] += v[2];
      size += 1;
    }
    const [lat, lon] = toLatLon(sum);
    centers.push([round2(lat), round2(lon)]);
    sizes.push(size);
  }
  return { radius, of, centers, sizes };
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** The spherical mean of the points as a latitude/longitude, or null when they cancel out. */
export function meanCenter(points: [number, number][]): [number, number] | null {
  const sum: Vec3 = [0, 0, 0];
  for (const [lat, lon] of points) {
    const v = toVec(lat, lon);
    sum[0] += v[0];
    sum[1] += v[1];
    sum[2] += v[2];
  }
  if (points.length === 0 || Math.hypot(...sum) / points.length < 0.2) return null;
  return toLatLon(sum);
}

/** `51.51° N` / `0.13° W`: a coordinate as read in a table. */
export function formatCoordinate(value: number, axis: 'lat' | 'lon'): string {
  const hemisphere =
    axis === 'lat' ? (value >= 0 ? 'N' : 'S') : value >= 0 ? (value === 0 ? '' : 'E') : 'W';
  return `${Math.abs(value).toFixed(2)}°${hemisphere ? ` ${hemisphere}` : ''}`;
}
