/**
 * The `globe-3d` runtime: a dotted Natural Earth globe with an ocean that
 * takes the sun, a night side and an atmosphere, plus the markers, arcs and
 * clusters the compiler resolved. Land dots are one point batch, markers one
 * instanced mesh, clusters another and every arc one merged tube mesh, so 500
 * markers and 200 arcs cost a handful of draw calls. Picking writes page
 * state through the shared `set-value` path and flies the camera; layers and
 * the time step filter everything, and the bound state is read back in `sync`.
 *
 * Coordinates follow the compiler: y is north, longitude 0 faces +z.
 */

import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  InstancedMesh,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  PerspectiveCamera,
  Points,
  Quaternion,
  Raycaster,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TubeGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const FLIGHT_MS = 900;
const DEG = Math.PI / 180;
const NEAR_DISTANCE = 2.1;
const MIN_DISTANCE = 1.45;
const MAX_DISTANCE = 7;
const MARKER_SIZE = 0.013;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** Stage height (px) the clustering distances are tuned for; smaller stages cluster coarser. */
const CLUSTER_STAGE = 480;
const TIME = /^\d{4}(-\d{2}(-\d{2})?)?$/;
const ORIGIN = new Vector3();

function toVec(lat, lon, radius = 1) {
  const phi = lat * DEG;
  const lambda = lon * DEG;
  return new Vector3(
    radius * Math.cos(phi) * Math.sin(lambda),
    radius * Math.sin(phi),
    radius * Math.cos(phi) * Math.cos(lambda),
  );
}

/** The compiler's arc: a great circle lifted by a sine bump that grows with distance. */
function arcPoints(a, b, segments) {
  const p = toVec(a[0], a[1]);
  const q = toVec(b[0], b[1]);
  const omega = Math.acos(Math.max(-1, Math.min(1, p.dot(q))));
  const lift = 0.03 + 0.3 * (omega / Math.PI);
  const out = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const v =
      omega < 1e-6
        ? p.clone()
        : p
            .clone()
            .multiplyScalar(Math.sin((1 - t) * omega) / Math.sin(omega))
            .add(q.clone().multiplyScalar(Math.sin(t * omega) / Math.sin(omega)));
    out.push(v.multiplyScalar(1 + lift * Math.sin(Math.PI * t)));
  }
  return out;
}

/** The land outline painted on an equirectangular canvas: a lookup for land dots. */
function landMask(encoded) {
  const width = 1024;
  const height = 512;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g || !encoded) return () => false;
  g.fillStyle = '#fff';
  g.beginPath();
  for (const ring of encoded.split(';')) {
    const values = ring.split(',').map(Number);
    let x = 0;
    let y = 0;
    for (let i = 0; i + 1 < values.length; i += 2) {
      x += values[i];
      y += values[i + 1];
      const px = ((x / 10 + 180) / 360) * width;
      const py = ((90 - y / 10) / 180) * height;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
  }
  g.fill('evenodd');
  const data = g.getImageData(0, 0, width, height).data;
  return (lat, lon) => {
    const px = Math.min(width - 1, Math.max(0, Math.floor(((lon + 180) / 360) * width)));
    const py = Math.min(height - 1, Math.max(0, Math.floor(((90 - lat) / 180) * height)));
    return data[(py * width + px) * 4] > 127;
  };
}

const SURFACE_VERTEX = `
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
  vNormalW = normalize(normal);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const OCEAN_FRAGMENT = `
uniform vec3 uHigh;
uniform vec3 uLow;
uniform vec3 uRim;
uniform vec3 uSun;
uniform vec3 uTwilight;
uniform float uNight;
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
  vec3 n = normalize(vNormalW);
  vec3 v = normalize(cameraPosition - vWorld);
  float light = dot(n, uSun);
  float day = smoothstep(-0.2, 0.25, light);
  // Lambert falloff across the day side, a deep night beyond the terminator.
  vec3 base = mix(uLow, uHigh, smoothstep(-0.1, 1.0, light));
  base *= mix(uNight, 1.0, day);
  // A warm band where day turns to night.
  base += uTwilight * exp(-light * light * 160.0) * 0.2;
  float glint = pow(max(dot(reflect(-uSun, n), v), 0.0), 90.0) * 0.09 * day;
  float fresnel = pow(1.0 - max(dot(n, v), 0.0), 4.0);
  vec3 color = base + glint + uRim * fresnel * mix(0.25, 1.0, day);
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}`;

const ATMOSPHERE_VERTEX = `
varying vec3 vNormalV;
varying vec3 vNormalW;
void main() {
  vNormalV = normalize(normalMatrix * normal);
  vNormalW = normalize(normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const ATMOSPHERE_FRAGMENT = `
uniform vec3 uGlow;
uniform vec3 uSun;
uniform float uStrength;
uniform float uLimb;
varying vec3 vNormalV;
varying vec3 vNormalW;
void main() {
  // Back faces: brightest where the shell meets the globe's limb, gone at its own silhouette.
  float intensity = pow(clamp(-vNormalV.z / uLimb, 0.0, 1.0), 2.4);
  float day = mix(0.4, 1.0, smoothstep(-0.5, 0.5, dot(vNormalW, uSun)));
  gl_FragColor = vec4(uGlow, intensity * uStrength * day);
  #include <colorspace_fragment>
}`;

const STEM_VERTEX = `
attribute vec3 color;
varying vec3 vColor;
varying float vFacing;
void main() {
  vColor = color;
  vec3 n = normalize(position);
  vFacing = dot(n, normalize(cameraPosition - n));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const STEM_FRAGMENT = `
varying vec3 vColor;
varying float vFacing;
void main() {
  gl_FragColor = vec4(vColor, 0.9 * smoothstep(0.08, 0.4, vFacing));
  #include <colorspace_fragment>
}`;

const DOTS_VERTEX = `
uniform float uSize;
uniform vec3 uSun;
varying float vLight;
varying float vFacing;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(position);
  vLight = dot(n, uSun);
  vFacing = dot(n, normalize(cameraPosition - position));
  // Dots shrink toward the limb, where the lattice crowds together in projection.
  gl_PointSize = uSize / -mv.z * mix(0.45, 1.0, clamp(vFacing, 0.0, 1.0));
  gl_Position = projectionMatrix * mv;
}`;

const DOTS_FRAGMENT = `
uniform vec3 uDay;
uniform vec3 uNight;
uniform float uNightAlpha;
varying float vLight;
varying float vFacing;
void main() {
  if (vFacing < 0.0) discard;
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float edge = 1.0 - smoothstep(0.32, 0.5, d);
  float day = smoothstep(-0.18, 0.22, vLight);
  vec3 color = mix(uNight, uDay, day);
  float alpha = edge * mix(uNightAlpha, 1.0, day) * smoothstep(0.05, 0.45, vFacing);
  gl_FragColor = vec4(color, alpha);
  #include <colorspace_fragment>
}`;

const ARC_VERTEX = `
attribute float aLit;
varying vec3 vColor;
varying float vT;
varying float vLit;
void main() {
  vColor = color;
  vT = uv.x;
  vLit = aLit;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const ARC_FRAGMENT = `
uniform float uAlpha;
varying vec3 vColor;
varying float vT;
varying float vLit;
void main() {
  float body = mix(0.55, 1.0, sin(3.14159265 * vT));
  vec3 color = mix(vColor, vec3(1.0), 0.18 * body * vLit);
  gl_FragColor = vec4(color, uAlpha * body * mix(0.28, 1.0, vLit));
  #include <colorspace_fragment>
}`;

export function mountGlobe(el, kit) {
  const api = kit.api();
  let config;
  try {
    config = JSON.parse(el.getAttribute('data-ak-scene') || '{}');
  } catch (_error) {
    el.setAttribute('data-ak-3d-state', 'error');
    return null;
  }
  const stage = el.querySelector('.ak-3d-stage');
  const canvas = document.createElement('canvas');
  canvas.className = 'ak-3d-canvas';
  if (!stage || !kit.webgl2Available(canvas)) {
    el.setAttribute('data-ak-3d-state', 'unsupported');
    return null;
  }
  const quality = kit.qualityProfile();
  let renderer;
  try {
    renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
      alpha: true,
    });
  } catch (_error) {
    el.setAttribute('data-ak-3d-state', 'unsupported');
    return null;
  }
  const ids = config.ids || [];
  const labels = config.labels || ids;
  const count = ids.length;
  const index = new Map(ids.map((id, i) => [id, i]));
  const lat = config.lat || [];
  const lon = config.lon || [];
  const heights = config.height || [];
  const markerLayer = config.layer || [];
  const markerTime = config.time || [];
  const arcEnds = config.arcs || [];
  const arcCount = Math.floor(arcEnds.length / 2);
  const arcLayer = config.arcLayer || [];
  const arcTime = config.arcTime || [];
  const arcWidth = config.arcWidth || [];
  const layers = config.layers || [];
  const times = config.times || [];
  const levels = config.clusters || [];
  const home = {
    lat: config.center?.[0] ?? 20,
    lon: config.center?.[1] ?? 0,
    distance: config.distance || 4.6,
  };
  const sun = new Vector3(...(config.sun || [0.5, 0.4, 0.75])).normalize();

  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', el.querySelector('.ak-3d-caption')?.textContent || 'Globe');
  stage.appendChild(canvas);
  const overlay = document.createElement('div');
  overlay.className = 'ak-globe-labels-live';
  overlay.setAttribute('aria-hidden', 'true');
  stage.appendChild(overlay);
  const tag = document.createElement('div');
  tag.className = 'ak-net-tag';
  tag.hidden = true;
  tag.setAttribute('aria-hidden', 'true');
  stage.appendChild(tag);
  const ratio = Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : 1);
  renderer.setPixelRatio(ratio);
  const dark = kit.isDark(el);

  // Theme colors: the globe takes the page's ink, paper and accent.
  const background = kit.cssColor(el, '--ak-color-background', '#ffffff');
  const surface = kit.cssColor(el, '--ak-color-surface', '#ffffff');
  const ink = kit.cssColor(el, '--ak-color-text', '#222222');
  const accent = kit.toneColor(el, 'accent');
  const toneOf = (layer) => kit.toneColor(el, layers[layer]?.tone || 'accent');
  const layerColors = layers.map((_, i) => {
    const c = toneOf(i);
    if (dark) {
      const hsl = {};
      c.getHSL(hsl);
      c.setHSL(hsl.h, Math.min(1, hsl.s * 1.25), Math.min(0.72, hsl.l * 1.05));
    }
    return c;
  });
  const colorOf = (layer) => layerColors[layer] || accent;

  const scene = new Scene();
  const camera = new PerspectiveCamera(config.fov || 30, 16 / 9, 0.05, 100);
  const view = { lat: home.lat, lon: home.lon, distance: home.distance };

  // Ocean: lit by the sun, darker on the night side, a fresnel rim at the limb.
  const sphereGeometry = new SphereGeometry(
    1,
    quality === 'high' ? 128 : 72,
    quality === 'high' ? 96 : 48,
  );
  const oceanMaterial = new ShaderMaterial({
    vertexShader: SURFACE_VERTEX,
    fragmentShader: OCEAN_FRAGMENT,
    uniforms: {
      // Mixed in linear light, where a few percent of a bright tone already reads strongly.
      uHigh: {
        value: dark
          ? surface.clone().lerp(kit.toneColor(el, 'info'), 0.03).multiplyScalar(2.1)
          : surface.clone().lerp(accent, 0.03),
      },
      uLow: {
        value: dark
          ? background.clone().multiplyScalar(0.5)
          : background.clone().lerp(ink, 0.07).lerp(accent, 0.04),
      },
      uRim: {
        value: accent
          .clone()
          .lerp(new Color(1, 1, 1), 0.3)
          .multiplyScalar(dark ? 0.5 : 0.35),
      },
      uSun: { value: sun },
      uTwilight: {
        value: accent
          .clone()
          .lerp(new Color(1, 0.45, 0.2), 0.5)
          .multiplyScalar(dark ? 0.12 : 0.08),
      },
      uNight: { value: dark ? 0.35 : 0.72 },
    },
  });
  const globe = new Mesh(sphereGeometry, oceanMaterial);
  scene.add(globe);

  // Atmosphere: a back-faced shell that glows at the limb, brighter on the day side.
  const SHELL = 1.13;
  const atmosphereGeometry = new SphereGeometry(SHELL, 72, 48);
  const atmosphereMaterial = new ShaderMaterial({
    vertexShader: ATMOSPHERE_VERTEX,
    fragmentShader: ATMOSPHERE_FRAGMENT,
    uniforms: {
      uGlow: { value: accent.clone().lerp(new Color(1, 1, 1), dark ? 0.25 : 0.1) },
      uSun: { value: sun },
      uStrength: { value: dark ? 1.1 : 0.7 },
      uLimb: { value: Math.sqrt(1 - 1 / (SHELL * SHELL)) },
    },
    side: BackSide,
    transparent: true,
    depthWrite: false,
    blending: dark ? AdditiveBlending : NormalBlending,
  });
  const atmosphere = new Mesh(atmosphereGeometry, atmosphereMaterial);
  scene.add(atmosphere);

  // Land: a Fibonacci lattice kept where the Natural Earth outline is land.
  const isLand = landMask(config.land);
  const lattice = quality === 'high' ? 30000 : 16000;
  const dotPositions = [];
  for (let i = 0; i < lattice; i += 1) {
    const y = 1 - (2 * (i + 0.5)) / lattice;
    const r = Math.sqrt(1 - y * y);
    const theta = i * GOLDEN;
    const x = r * Math.sin(theta);
    const z = r * Math.cos(theta);
    if (isLand(Math.asin(y) / DEG, Math.atan2(x, z) / DEG))
      dotPositions.push(x * 1.002, y * 1.002, z * 1.002);
  }
  const dotGeometry = new BufferGeometry();
  dotGeometry.setAttribute('position', new BufferAttribute(new Float32Array(dotPositions), 3));
  const landInk = ink.clone().lerp(accent, dark ? 0.22 : 0.28);
  const dotMaterial = new ShaderMaterial({
    vertexShader: DOTS_VERTEX,
    fragmentShader: DOTS_FRAGMENT,
    uniforms: {
      uSize: { value: (quality === 'high' ? 0.0105 : 0.0145) * 1000 * ratio },
      uSun: { value: sun },
      uDay: { value: dark ? landInk.clone().lerp(new Color(1, 1, 1), 0.1) : landInk },
      // The night side keeps its land faintly, in a warm tone like city lights.
      uNight: {
        value: dark
          ? accent
              .clone()
              .lerp(new Color(1, 0.7, 0.4), 0.4)
              .multiplyScalar(0.8)
          : landInk.clone().lerp(background, 0.3),
      },
      uNightAlpha: { value: dark ? 0.3 : 0.38 },
    },
    transparent: true,
    depthWrite: false,
  });
  const dots = new Points(dotGeometry, dotMaterial);
  scene.add(dots);

  // Markers: one instanced sphere per place, at the tip of its value spike.
  const markerGeometry = new SphereGeometry(1, 16, 12);
  const markerMaterial = new MeshBasicMaterial({ toneMapped: false });
  const markers = new InstancedMesh(markerGeometry, markerMaterial, Math.max(1, count));
  markers.count = count;
  const tips = ids.map((_, i) => toVec(lat[i], lon[i], 1.004 + (heights[i] || 0)));
  const stemPositions = [];
  const stemColors = [];
  for (let i = 0; i < count; i += 1) {
    if (!(heights[i] > 0)) continue;
    const base = toVec(lat[i], lon[i], 1.001);
    const c = colorOf(markerLayer[i]);
    stemPositions.push(base.x, base.y, base.z, tips[i].x, tips[i].y, tips[i].z);
    stemColors.push(c.r, c.g, c.b, c.r, c.g, c.b);
  }
  const stemGeometry = new BufferGeometry();
  stemGeometry.setAttribute('position', new BufferAttribute(new Float32Array(stemPositions), 3));
  stemGeometry.setAttribute('color', new BufferAttribute(new Float32Array(stemColors), 3));
  const stemIndex = [];
  const stemOf = [];
  for (let i = 0, k = 0; i < count; i += 1) if (heights[i] > 0) stemOf[i] = k++;
  // Stems fade toward the limb, so spikes there do not bristle past the atmosphere.
  const stemMaterial = new ShaderMaterial({
    vertexShader: STEM_VERTEX,
    fragmentShader: STEM_FRAGMENT,
    transparent: true,
    depthWrite: false,
  });
  const stems = new LineSegments(stemGeometry, stemMaterial);
  scene.add(stems, markers);

  // Clusters: translucent bubbles sized by member count, a count label beside each.
  const clusterCapacity = Math.max(1, ...levels.map((level) => level.centers.length / 2));
  const clusterGeometry = new SphereGeometry(1, 24, 16);
  const clusterMaterial = new MeshBasicMaterial({
    transparent: true,
    opacity: dark ? 0.42 : 0.5,
    depthWrite: false,
    toneMapped: false,
  });
  const clusters = new InstancedMesh(clusterGeometry, clusterMaterial, clusterCapacity);
  clusters.count = 0;
  clusters.renderOrder = 3;
  scene.add(clusters);
  const bubbles = [];

  // Arcs: one tube per route, merged; filters swap index ranges, selection repaints a lit attribute.
  // Many routes draw thinner and fainter, so a dense web still shows the land beneath it.
  const crowd = Math.min(1, Math.max(0.4, Math.sqrt(40 / Math.max(1, arcCount))));
  const thickness = 0.6 + 0.4 * crowd;
  const tubeParts = [];
  const arcRanges = [];
  let vertexOffset = 0;
  for (let a = 0; a < arcCount; a += 1) {
    const from = arcEnds[a * 2];
    const to = arcEnds[a * 2 + 1];
    const curve = new CatmullRomCurve3(arcPoints([lat[from], lon[from]], [lat[to], lon[to]], 48));
    const tube = new TubeGeometry(
      curve,
      64,
      thickness * (0.0016 + 0.0036 * (arcWidth[a] ?? 0.6)),
      5,
      false,
    );
    const vertices = tube.attributes.position.count;
    const c = colorOf(arcLayer[a]);
    const colors = new Float32Array(vertices * 3);
    for (let v = 0; v < vertices; v += 1) colors.set([c.r, c.g, c.b], v * 3);
    tube.setAttribute('color', new BufferAttribute(colors, 3));
    tube.setAttribute('aLit', new BufferAttribute(new Float32Array(vertices).fill(1), 1));
    tube.deleteAttribute('normal');
    arcRanges.push({ start: vertexOffset, vertices, index: tube.index.array.length });
    vertexOffset += vertices;
    tubeParts.push(tube);
  }
  const arcGeometry =
    tubeParts.length > 0 ? mergeGeometries(tubeParts, false) : new BufferGeometry();
  for (const part of tubeParts) part.dispose();
  const fullIndex = arcGeometry.index ? Array.from(arcGeometry.index.array) : [];
  let indexStart = 0;
  for (const range of arcRanges) {
    range.from = indexStart;
    indexStart += range.index;
  }
  const arcMaterial = new ShaderMaterial({
    vertexShader: ARC_VERTEX,
    fragmentShader: ARC_FRAGMENT,
    uniforms: { uAlpha: { value: (dark ? 0.95 : 0.8) * crowd } },
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: dark ? AdditiveBlending : NormalBlending,
  });
  const arcs = new Mesh(arcGeometry, arcMaterial);
  arcs.renderOrder = 2;
  scene.add(arcs);

  // A soft halo marks the selection beyond color alone.
  const haloTexture = haloMap();
  const haloMaterial = new SpriteMaterial({
    map: haloTexture,
    color: accent,
    transparent: true,
    opacity: dark ? 0.8 : 0.6,
    blending: dark ? AdditiveBlending : NormalBlending,
    depthWrite: false,
    depthTest: false,
  });
  const halo = new Sprite(haloMaterial);
  halo.visible = false;
  halo.renderOrder = 4;
  scene.add(halo);

  let selected = -1;
  let hovered = -1;
  const hiddenLayers = new Set();
  let cut = '';
  let level = -1;
  /** Shown markers per cluster at the current level, and the instance each bubble draws. */
  let bubbleMembers = [];

  /** Items no later than the cutoff `cut`, compared at the cutoff's precision ('' shows all). */
  const timeShown = (t) => {
    if (cut === '' || t < 0) return true;
    return (times[t] || '').slice(0, cut.length) <= cut;
  };
  /** The last slider step the cutoff shows. */
  const stepOf = (value) => {
    let at = 0;
    for (let i = 0; i < times.length; i += 1) if (times[i].slice(0, value.length) <= value) at = i;
    return value === '' ? times.length - 1 : at;
  };
  const cutOf = (value) =>
    typeof value === 'string' && TIME.test(value) && value < (times[times.length - 1] || '')
      ? value
      : '';
  const layerShown = (layer) => !(layer >= 0 && hiddenLayers.has(layers[layer]?.id));
  const markerShown = (i) => layerShown(markerLayer[i]) && timeShown(markerTime[i]);
  const arcShown = (a) =>
    layerShown(arcLayer[a]) &&
    timeShown(arcTime[a]) &&
    markerShown(arcEnds[a * 2]) &&
    markerShown(arcEnds[a * 2 + 1]);

  const pickButtons = new Map();
  for (const button of el.querySelectorAll('[data-ak-3d-pick]')) {
    pickButtons.set(button.getAttribute('data-ak-3d-pick'), button);
    button.disabled = false;
  }
  const layerButtons = [...el.querySelectorAll('[data-ak-globe-layer]')];
  for (const button of layerButtons) button.disabled = false;
  const slider = el.querySelector('[data-ak-globe-time]');
  const sliderOutput = el.querySelector('.ak-globe-time output');
  if (slider) slider.disabled = false;
  const markerRows = new Map(
    [...el.querySelectorAll('[data-ak-globe-row]')].map((row) => [
      row.getAttribute('data-ak-globe-row'),
      row,
    ]),
  );
  const arcRows = [...el.querySelectorAll('[data-ak-globe-arc]')];
  const tableWrap = el.querySelector('.ak-globe-table');

  const matrix = new Matrix4();
  const quat = new Quaternion();
  const scaleV = new Vector3();
  const lit = new Set();

  /** Which markers stand alone and which merge into bubbles, from the level, filters and selection. */
  function layoutMarks() {
    const clustering = levels[level];
    const groups = new Map();
    for (let i = 0; i < count; i += 1) {
      const shown = markerShown(i);
      let alone = shown;
      if (shown && clustering && i !== selected) {
        const owner = clustering.of[i];
        if (!groups.has(owner)) groups.set(owner, []);
        groups.get(owner).push(i);
        alone = false;
      }
      const lift = i === selected ? 1.9 : i === hovered || lit.has(i) ? 1.35 : 1;
      scaleV.setScalar(alone ? MARKER_SIZE * lift : 0);
      matrix.compose(tips[i], quat, scaleV);
      markers.setMatrixAt(i, matrix);
      markers.setColorAt(i, colorOf(markerLayer[i]));
    }
    // A group of one is just its marker.
    bubbleMembers = [];
    for (const [owner, members] of groups) {
      if (members.length === 1) {
        const i = members[0];
        scaleV.setScalar(MARKER_SIZE * (i === hovered ? 1.35 : 1));
        matrix.compose(tips[i], quat, scaleV);
        markers.setMatrixAt(i, matrix);
        continue;
      }
      bubbleMembers.push({ owner, members });
    }
    clusters.count = bubbleMembers.length;
    bubbleMembers.forEach(({ owner, members }, b) => {
      const c = clustering.centers;
      const at = toVec(c[owner * 2], c[owner * 2 + 1], 1.012);
      scaleV.setScalar(0.022 + 0.0085 * Math.sqrt(members.length));
      matrix.compose(at, quat, scaleV);
      clusters.setMatrixAt(b, matrix);
      clusters.setColorAt(b, colorOf(markerLayer[members[0]]));
      bubbleMembers[b].at = at;
    });
    markers.instanceMatrix.needsUpdate = true;
    if (markers.instanceColor) markers.instanceColor.needsUpdate = true;
    markers.computeBoundingSphere();
    clusters.instanceMatrix.needsUpdate = true;
    if (clusters.instanceColor) clusters.instanceColor.needsUpdate = true;
    clusters.computeBoundingSphere();
    while (bubbles.length < bubbleMembers.length) {
      const bubble = document.createElement('span');
      bubble.className = 'ak-globe-bubble';
      overlay.appendChild(bubble);
      bubbles.push(bubble);
    }
    bubbles.forEach((bubble, b) => {
      bubble.textContent = b < bubbleMembers.length ? String(bubbleMembers[b].members.length) : '';
    });
  }

  /** Recolor and re-index everything from the selection, layers and time step. */
  function paint() {
    lit.clear();
    if (selected >= 0)
      for (let a = 0; a < arcCount; a += 1)
        if (arcEnds[a * 2] === selected || arcEnds[a * 2 + 1] === selected) {
          lit.add(arcEnds[a * 2]);
          lit.add(arcEnds[a * 2 + 1]);
        }
    layoutMarks();
    // Stems follow their markers' filters.
    stemIndex.length = 0;
    for (let i = 0; i < count; i += 1)
      if (stemOf[i] !== undefined && markerShown(i))
        stemIndex.push(stemOf[i] * 2, stemOf[i] * 2 + 1);
    stemGeometry.setIndex(stemIndex);
    if (arcGeometry.index) {
      const visibleIndex = [];
      const litAttr = arcGeometry.getAttribute('aLit');
      for (let a = 0; a < arcCount; a += 1) {
        const range = arcRanges[a];
        const touches =
          selected < 0 || arcEnds[a * 2] === selected || arcEnds[a * 2 + 1] === selected;
        litAttr.array.fill(touches ? 1 : 0, range.start, range.start + range.vertices);
        if (!arcShown(a)) continue;
        for (let k = range.from; k < range.from + range.index; k += 1)
          visibleIndex.push(fullIndex[k]);
      }
      litAttr.needsUpdate = true;
      arcGeometry.setIndex(visibleIndex);
    }
    if (selected >= 0 && markerShown(selected)) {
      halo.visible = true;
      halo.position.copy(tips[selected]);
      halo.scale.setScalar(MARKER_SIZE * 11);
    } else halo.visible = false;
    for (const [id, button] of pickButtons)
      button.setAttribute('aria-pressed', index.get(id) === selected ? 'true' : 'false');
    for (const [id, row] of markerRows) {
      if (markerShown(index.get(id))) row.removeAttribute('data-ak-globe-out');
      else row.setAttribute('data-ak-globe-out', '');
    }
    arcRows.forEach((row, a) => {
      if (arcShown(a)) row.removeAttribute('data-ak-globe-out');
      else row.setAttribute('data-ak-globe-out', '');
    });
    for (const button of layerButtons)
      button.setAttribute(
        'aria-pressed',
        hiddenLayers.has(button.getAttribute('data-ak-globe-layer')) ? 'false' : 'true',
      );
    if (slider) {
      const at = stepOf(cut);
      slider.value = String(at);
      slider.setAttribute('aria-valuetext', cut || times[at] || '');
      if (sliderOutput) sliderOutput.textContent = cut || times[at] || '';
    }
    el.setAttribute('data-ak-globe-selected', selected >= 0 ? ids[selected] : '');
    el.setAttribute('data-ak-globe-shown', String(ids.filter((_, i) => markerShown(i)).length));
    canvas.setAttribute('aria-description', selected >= 0 ? `Selected: ${labels[selected]}` : '');
    requestRender();
  }

  // Camera: it orbits the globe at a latitude, longitude and distance; flights ease all three.
  function applyView() {
    view.lat = Math.max(-80, Math.min(80, view.lat));
    view.distance = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, view.distance));
    camera.position.copy(toVec(view.lat, view.lon, view.distance));
    camera.lookAt(0, 0, 0);
    // A small stage shows a small globe: cluster as if the camera stood further out.
    const scale = Math.max(1, CLUSTER_STAGE / (stage.clientHeight || CLUSTER_STAGE));
    const next = levels.findIndex((l) => view.distance * scale >= l.from);
    if (next !== level) {
      level = next;
      layoutMarks();
    }
    requestRender();
  }
  let flight = null;
  function flyTo(toLat, toLon, distance) {
    // Take the short way round in longitude.
    const dLon = ((((toLon - view.lon) % 360) + 540) % 360) - 180;
    if (!kit.motionAllowed()) {
      view.lat = toLat;
      view.lon += dLon;
      view.distance = distance;
      applyView();
      return;
    }
    flight = {
      start: 0,
      from: { ...view },
      dLat: toLat - view.lat,
      dLon,
      dDistance: distance - view.distance,
    };
    record.animating = true;
    kit.schedule();
  }
  const goHome = () => flyTo(home.lat, home.lon, home.distance);

  function clear(fromState) {
    if (selected < 0) return;
    selected = -1;
    paint();
    if (fromState) return;
    api.fire(el, 'select', { value: '' });
    if (config.bind) api.setPath(config.bind, '');
  }

  function select(i, fromState, fly = true) {
    if (i < 0 || i >= count) return;
    if (i === selected) {
      if (!fromState) clear(false);
      return;
    }
    selected = i;
    paint();
    if (fly) flyTo(lat[i], lon[i], Math.min(view.distance, NEAR_DISTANCE));
    const row = markerRows.get(ids[i]);
    if (row && tableWrap && row.offsetParent) {
      if (
        row.offsetTop < tableWrap.scrollTop ||
        row.offsetTop > tableWrap.scrollTop + tableWrap.clientHeight - 40
      )
        tableWrap.scrollTop = Math.max(0, row.offsetTop - tableWrap.clientHeight / 2);
    }
    if (fromState) return;
    api.fire(el, 'select', { value: ids[i] });
    if (config.bind) api.setPath(config.bind, ids[i]);
  }

  function applyTime(value) {
    const resolved = cutOf(value);
    if (resolved === cut) return;
    cut = resolved;
    paint();
  }

  const onClick = (event) => {
    const pick = event.target.closest?.('[data-ak-3d-pick]');
    if (pick && el.contains(pick)) {
      select(index.get(pick.getAttribute('data-ak-3d-pick')) ?? -1, false);
      return;
    }
    const chip = event.target.closest?.('[data-ak-globe-layer]');
    if (chip && el.contains(chip)) {
      const id = chip.getAttribute('data-ak-globe-layer');
      if (hiddenLayers.has(id)) hiddenLayers.delete(id);
      else hiddenLayers.add(id);
      paint();
    }
  };
  el.addEventListener('click', onClick);
  const onSlide = () => {
    const value = times[Number(slider.value)] || '';
    if (config.timeBind) api.setPath(config.timeBind, value);
    else applyTime(value);
  };
  slider?.addEventListener('input', onSlide);

  // Pointer: drag turns the globe, wheel and pinch zoom, a tap picks, hover names the place.
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  function hit(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const found = raycaster.intersectObjects([globe, markers, clusters], false)[0];
    if (!found || found.object === globe) return null;
    if (found.object === markers) return { marker: found.instanceId };
    return { bubble: found.instanceId };
  }
  function openBubble(b) {
    const entry = bubbleMembers[b];
    if (!entry) return;
    const c = levels[level].centers;
    // Fly in just past this level, where its members separate.
    const deeper = levels[level + 1]?.from;
    flyTo(
      c[entry.owner * 2],
      c[entry.owner * 2 + 1],
      deeper ? Math.min(view.distance, deeper + 0.6) : NEAR_DISTANCE,
    );
  }
  const pointers = new Map();
  let downAt = null;
  let pinch = 0;
  const onPointerDown = (event) => {
    canvas.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    downAt = { x: event.clientX, y: event.clientY };
    flight = null;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };
  const onPointerMove = (event) => {
    const last = pointers.get(event.pointerId);
    if (!last) {
      if (event.pointerType === 'mouse') {
        const found = hit(event);
        const next = found?.marker ?? -1;
        canvas.style.cursor = found ? 'pointer' : '';
        if (next !== hovered) {
          hovered = next;
          layoutMarks();
          requestRender();
        }
      }
      return;
    }
    if (pointers.size === 2) {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0) {
        view.distance = 1 + (view.distance - 1) * (pinch / distance);
        applyView();
      }
      pinch = distance;
      return;
    }
    // Turn speed follows zoom, so a drag moves the surface under the pointer.
    const speed = 0.11 * (view.distance - 1) * (360 / (stage.clientHeight || 360));
    view.lon -= (event.clientX - last.x) * speed;
    view.lat += (event.clientY - last.y) * speed;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    applyView();
  };
  const onPointerUp = (event) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = 0;
    if (downAt && Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) < 6) {
      const found = hit(event);
      if (found?.marker !== undefined) select(found.marker, false);
      else if (found?.bubble !== undefined) openBubble(found.bubble);
    }
    downAt = null;
  };
  const onLeave = () => {
    if (hovered < 0) return;
    hovered = -1;
    canvas.style.cursor = '';
    layoutMarks();
    requestRender();
  };
  const onWheel = (event) => {
    event.preventDefault();
    flight = null;
    view.distance = 1 + (view.distance - 1) * (event.deltaY > 0 ? 1.12 : 0.89);
    applyView();
  };
  // Keys: arrows turn, +/- zoom, n/p/Enter walk the shown places, Escape/Home/0 return home.
  const onKey = (event) => {
    const k = event.key;
    const step = 6 * Math.min(1.5, view.distance - 1);
    if (k === 'ArrowLeft') view.lon -= step;
    else if (k === 'ArrowRight') view.lon += step;
    else if (k === 'ArrowUp') view.lat += step;
    else if (k === 'ArrowDown') view.lat -= step;
    else if (k === '+' || k === '=') view.distance = 1 + (view.distance - 1) * 0.85;
    else if (k === '-') view.distance = 1 + (view.distance - 1) * 1.18;
    else if (k === 'Escape' || k === 'Home' || k === '0') {
      if (k === 'Escape') clear(false);
      goHome();
      event.preventDefault();
      return;
    } else if ((k === 'n' || k === 'p' || k === 'Enter') && count > 0) {
      const dir = k === 'p' ? -1 : 1;
      let i = selected;
      for (let tries = 0; tries < count; tries += 1) {
        i = (i + dir + count) % count;
        if (markerShown(i)) break;
      }
      if (markerShown(i)) select(i, false);
      event.preventDefault();
      return;
    } else return;
    event.preventDefault();
    flight = null;
    applyView();
  };
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('keydown', onKey);

  function resize() {
    const width = stage.clientWidth || 640;
    const height = stage.clientHeight || 360;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // A stage narrower than square widens the vertical field, so the whole globe stays in frame.
    const base = config.fov || 30;
    camera.fov =
      camera.aspect < 1 ? (2 * Math.atan(Math.tan((base * DEG) / 2) / camera.aspect)) / DEG : base;
    camera.updateProjectionMatrix();
    applyView();
  }
  const resizeObserver = window.ResizeObserver ? new ResizeObserver(resize) : null;
  resizeObserver?.observe(stage);

  const projected = new Vector3();
  const toScreen = (point) => {
    projected.copy(point).project(camera);
    return {
      x: ((projected.x + 1) / 2) * stage.clientWidth,
      y: ((1 - projected.y) / 2) * stage.clientHeight,
    };
  };
  /** True when the globe does not hide `point` from the camera. */
  const facing = (point) => point.dot(camera.position) > point.lengthSq();
  function placeOverlay() {
    bubbles.forEach((bubble, b) => {
      const entry = bubbleMembers[b];
      if (!entry || !facing(entry.at)) {
        bubble.hidden = true;
        return;
      }
      const at = toScreen(entry.at);
      bubble.hidden = false;
      bubble.style.left = `${at.x}px`;
      bubble.style.top = `${at.y}px`;
    });
    const i = hovered >= 0 ? hovered : selected;
    if (i < 0 || !markerShown(i) || !facing(tips[i])) {
      tag.hidden = true;
      return;
    }
    const at = toScreen(tips[i]);
    tag.hidden = false;
    tag.textContent = labels[i];
    const small = document.createElement('small');
    small.textContent = `${Math.abs(lat[i]).toFixed(2)}° ${lat[i] >= 0 ? 'N' : 'S'}, ${Math.abs(lon[i]).toFixed(2)}° ${lon[i] >= 0 ? 'E' : 'W'}`;
    tag.appendChild(small);
    const half = tag.offsetWidth / 2;
    const side = at.x >= toScreen(ORIGIN).x ? 1 : -1;
    const x = at.x + side * (half + 10);
    tag.style.left = `${Math.min(stage.clientWidth - half - 4, Math.max(half + 4, x))}px`;
    tag.style.top = `${Math.max(tag.offsetHeight + 16, at.y - 6)}px`;
  }

  const record = {
    el,
    visible: true,
    lost: false,
    animating: false,
    started: 0,
    frames: 0,
    renderMs: [],
    tick(now) {
      if (flight) {
        if (!flight.start) flight.start = now;
        const k = Math.min(1, (now - flight.start) / FLIGHT_MS);
        const eased = k * k * (3 - 2 * k);
        // Pull back mid-flight on long hops, so the turn reads as travel over the globe.
        const hop = Math.min(1, Math.hypot(flight.dLat, flight.dLon) / 120);
        view.lat = flight.from.lat + flight.dLat * eased;
        view.lon = flight.from.lon + flight.dLon * eased;
        view.distance =
          flight.from.distance + flight.dDistance * eased + hop * 0.9 * Math.sin(Math.PI * eased);
        if (k >= 1) flight = null;
        applyView();
      }
      record.animating = flight !== null;
      const begin = performance.now();
      renderer.render(scene, camera);
      record.renderMs.push(performance.now() - begin);
      if (record.renderMs.length > kit.RENDER_SAMPLES) record.renderMs.shift();
      placeOverlay();
      record.frames += 1;
      if (record.frames === 1) {
        el.setAttribute('data-ak-3d-state', 'ready');
        el.dispatchEvent(new CustomEvent('ak-3d-ready', { bubbles: true }));
      }
    },
    info() {
      return {
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        quality,
        dpr: renderer.getPixelRatio(),
      };
    },
    /** Where the camera looks from, for tests and tooling. */
    view() {
      return { lat: view.lat, lon: view.lon, distance: view.distance, level };
    },
    freeze() {
      if (record.lost || record.frames === 0) return null;
      if (stage.querySelector('.ak-3d-frame'))
        return { width: canvas.width, height: canvas.height };
      if (flight) {
        view.lat = flight.from.lat + flight.dLat;
        view.lon = flight.from.lon + flight.dLon;
        view.distance = flight.from.distance + flight.dDistance;
        flight = null;
        applyView();
      }
      record.animating = false;
      renderer.render(scene, camera);
      const frame = document.createElement('img');
      frame.className = 'ak-3d-frame';
      frame.alt = '';
      frame.src = canvas.toDataURL('image/png');
      canvas.after(frame);
      el.setAttribute('data-ak-3d-state', 'frozen');
      return { width: canvas.width, height: canvas.height };
    },
    sync() {
      if (config.bind) {
        const value = api.readPath(config.bind);
        if (typeof value === 'string' && index.has(value)) select(index.get(value), true);
        else clear(true);
      }
      if (config.timeBind) {
        const value = api.readPath(config.timeBind);
        applyTime(typeof value === 'string' ? value : '');
      }
    },
    unmount() {
      cancelVisibility();
      resizeObserver?.disconnect();
      el.removeEventListener('click', onClick);
      slider?.removeEventListener('input', onSlide);
      if (slider) slider.disabled = true;
      for (const button of pickButtons.values()) button.disabled = true;
      for (const button of layerButtons) button.disabled = true;
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('keydown', onKey);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      for (const disposable of [
        sphereGeometry,
        oceanMaterial,
        atmosphereGeometry,
        atmosphereMaterial,
        dotGeometry,
        dotMaterial,
        markerGeometry,
        markerMaterial,
        stemGeometry,
        stemMaterial,
        clusterGeometry,
        clusterMaterial,
        arcGeometry,
        arcMaterial,
        haloTexture,
        haloMaterial,
      ])
        disposable.dispose();
      markers.dispose();
      clusters.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      stage.querySelector('.ak-3d-frame')?.remove();
      overlay.remove();
      tag.remove();
      canvas.remove();
      kit.mounts.delete(record);
      el.removeAttribute('data-ak-globe-selected');
      el.removeAttribute('data-ak-globe-shown');
      el.setAttribute('data-ak-3d-state', 'static');
    },
  };
  function requestRender() {
    if (!record.animating) {
      if (record.visible && !record.lost) record.tick(performance.now());
    } else kit.schedule();
  }

  const onLost = (event) => {
    event.preventDefault();
    record.lost = true;
    el.setAttribute('data-ak-3d-state', 'lost');
  };
  const onRestored = () => {
    record.lost = false;
    record.frames = 0;
    resize();
    kit.schedule();
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  let cancelVisibility = () => {};
  if (window.IntersectionObserver) {
    const observer = new IntersectionObserver((entries) => {
      record.visible = entries[entries.length - 1].isIntersecting;
      if (record.visible) kit.schedule();
    });
    observer.observe(el);
    cancelVisibility = () => observer.disconnect();
  }

  kit.mounts.add(record);
  // An initial selection or time step from state shows without flying: the page opens framed as its poster.
  const initial = config.bind && api.readPath(config.bind);
  if (typeof initial === 'string' && index.has(initial)) selected = index.get(initial);
  if (config.timeBind) {
    const value = api.readPath(config.timeBind);
    cut = cutOf(value);
  }
  applyView();
  paint();
  resize();
  record.tick(performance.now());
  return record;
}

/** A radial falloff that fades to zero at the edge, so the halo has no rim. */
function haloMap() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  const gradient = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(0.3, 'rgba(255,255,255,0.4)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gradient;
  g.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}
