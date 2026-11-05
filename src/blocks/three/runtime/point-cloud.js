/**
 * The `point-cloud-3d` runtime: one `Points` draw in the compiler's
 * level-of-detail order, a draw range bounded by the point budget, a section
 * cut on the up axis, and screen-space picking over the drawn points.
 *
 * It reads only the validated config the compiler emitted: the authored
 * coordinates (so a pick reports the exact values), the uniform scale, the
 * order and the budget. The status line always says how many points are
 * drawn, so a bounded draw never reads as the whole cloud.
 */

import {
  BufferAttribute,
  BufferGeometry,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Matrix4,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderer,
} from 'three';

/** Most points a low quality profile draws; the status line says so when it applies. */
const LOW_PROFILE_POINTS = 50000;
const RAMP_STEPS = 64;

const VERTEX = `
attribute vec3 aColor;
uniform float uScale;
uniform float uCut;
uniform vec2 uDepth;
varying vec3 vColor;
varying float vFade;
varying float vCut;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(uScale / -mv.z, 1.5);
  vColor = aColor;
  vFade = clamp((-mv.z - uDepth.x) / (uDepth.y - uDepth.x), 0.0, 1.0);
  vCut = position.y - uCut;
}`;

/** Round, softly domed points; far points sink toward the background for depth. */
const FRAGMENT = `
uniform vec3 uBg;
varying vec3 vColor;
varying float vFade;
varying float vCut;
void main() {
  if (vCut > 0.0) discard;
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  vec3 c = vColor * (0.96 + 0.06 * (1.0 - r2));
  c = mix(c, uBg, vFade * 0.42);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

const MARK_VERTEX = `
uniform float uSize;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uSize;
}`;

/** The selected point: a dot in its own colour inside a ring, drawn over the cloud. */
const MARK_FRAGMENT = `
uniform vec3 uInk;
uniform vec3 uBg;
uniform vec3 uColor;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  vec3 c = r < 0.3 ? uColor : r < 0.42 ? uBg : r < 0.62 ? vec3(0.0) : r < 0.8 ? uInk : uBg;
  float a = r < 0.42 ? 1.0 : r < 0.62 ? 0.0 : r < 0.8 ? 1.0 : 0.55 * smoothstep(1.0, 0.8, r);
  if (a <= 0.0) discard;
  gl_FragColor = vec4(c, a);
  #include <colorspace_fragment>
}`;

const fmt = (n) => n.toLocaleString('en-US');

/** Linear sRGB to oklab, for mixing theme tones in oklch like the CSS legend does. */
function toLab(c) {
  const l = Math.cbrt(0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b);
  const m = Math.cbrt(0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b);
  const s = Math.cbrt(0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Mix two colours in oklch along the shorter hue arc, as `color-mix(in oklch, ...)` does. */
function mixOklch(a, b, t) {
  const [la, aa, ba] = toLab(a);
  const [lb, ab, bb] = toLab(b);
  const ca = Math.hypot(aa, ba);
  const cb = Math.hypot(ab, bb);
  let ha = Math.atan2(ba, aa);
  let hb = Math.atan2(bb, ab);
  // An achromatic end takes the other end's hue, so the mix never swings through an arbitrary one.
  if (ca < 1e-4) ha = hb;
  if (cb < 1e-4) hb = ha;
  let dh = hb - ha;
  if (dh > Math.PI) dh -= 2 * Math.PI;
  if (dh < -Math.PI) dh += 2 * Math.PI;
  const L = la + (lb - la) * t;
  const C = ca + (cb - ca) * t;
  const H = ha + dh * t;
  const A = C * Math.cos(H);
  const B = C * Math.sin(H);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const clamp = (v) => Math.min(1, Math.max(0, v));
  return a
    .clone()
    .setRGB(
      clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    );
}

export function mountPointCloud(el, kit) {
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
      antialias: quality === 'high',
      preserveDrawingBuffer: true,
      alpha: true,
    });
  } catch (_error) {
    el.setAttribute('data-ak-3d-state', 'unsupported');
    return null;
  }
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute(
    'aria-label',
    el.querySelector('.ak-3d-caption')?.textContent || '3D point cloud',
  );
  canvas.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight ArrowUp ArrowDown + - N P Home');
  stage.appendChild(canvas);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : 1));

  const count = config.count || 0;
  const xs = config.x || [];
  const ys = config.y || [];
  const zs = config.z || [];
  const intensity = config.intensity || null;
  const ids = config.ids || null;
  const idOf = (i) => (ids ? ids[i] : `p${i + 1}`);
  function indexOfId(value) {
    if (typeof value !== 'string') return -1;
    if (ids) return ids.indexOf(value);
    const match = /^p([1-9]\d*)$/u.exec(value);
    const i = match ? Number(match[1]) - 1 : -1;
    return i < count ? i : -1;
  }
  const [cx, cy, cz] = config.center || [0, 0, 0];
  const s = config.scale || 1;
  const zUp = config.up !== 'y';
  /** Data point i in the world cube: x right, up, toward the viewer. */
  function world(i, out) {
    const a = (xs[i] - cx) * s;
    const b = (ys[i] - cy) * s;
    const c = (zs[i] - cz) * s;
    if (zUp) out.set(a, c, -b);
    else out.set(a, b, c);
    return out;
  }
  const [hx, hy, hz] = config.half || [1, 1, 1];

  // Color ramp from the theme: info -> accent -> danger, by intensity or height.
  const background = kit.cssColor(el, '--ak-color-background', '#ffffff');
  const ink = kit.cssColor(el, '--ak-color-text', '#222222');
  const dark = kit.isDark(el);
  const low = kit.toneColor(el, 'info');
  const mid = kit.toneColor(el, 'accent');
  const high = kit.toneColor(el, 'danger');
  const ramp = Array.from({ length: RAMP_STEPS }, (_, k) => {
    const t = k / (RAMP_STEPS - 1);
    return t <= 0.5 ? mixOklch(low, mid, t / 0.5) : mixOklch(mid, high, (t - 0.5) / 0.5);
  });
  const [lo, hi] = config.color?.domain || [0, 1];
  const colorValue = (i) => (intensity ? intensity[i] : zUp ? zs[i] : ys[i]);
  const colorOf = (i) =>
    ramp[
      Math.round(MathUtils.clamp((colorValue(i) - lo) / (hi - lo || 1), 0, 1) * (RAMP_STEPS - 1))
    ];

  // The draw: every in-box point in level-of-detail order, the first `drawn` of them shown.
  const order = config.order || [];
  const limit = quality === 'low' ? LOW_PROFILE_POINTS : Number.POSITIVE_INFINITY;
  const budget = Math.min(order.length, config.budget || order.length);
  const drawn = Math.min(budget, limit);
  const positions = new Float32Array(order.length * 3);
  const colors = new Float32Array(order.length * 3);
  const v = new Vector3();
  for (let k = 0; k < order.length; k += 1) {
    const i = order[k];
    world(i, v);
    positions[k * 3] = v.x;
    positions[k * 3 + 1] = v.y;
    positions[k * 3 + 2] = v.z;
    const color = colorOf(i);
    colors[k * 3] = color.r;
    colors[k * 3 + 1] = color.g;
    colors[k * 3 + 2] = color.b;
  }
  /** Rank of each point in the draw order, -1 when the clip box hides it. */
  const rank = new Int32Array(count).fill(-1);
  for (let k = 0; k < order.length; k += 1) rank[order[k]] = k;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new BufferAttribute(colors, 3));
  geometry.setDrawRange(0, drawn);
  // About one point spacing wide: a sparse cloud gets marks, a dense one reads as surfaces.
  const base = MathUtils.clamp(4 / Math.sqrt(Math.max(drawn, 1)), 0.009, 0.09);
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uScale: { value: 1 },
      uCut: { value: hy + 1 },
      uDepth: { value: [1, 10] },
      uBg: { value: background },
    },
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  const scene = new Scene();
  scene.add(points);

  const markGeometry = new BufferGeometry();
  markGeometry.setAttribute('position', new BufferAttribute(new Float32Array(3), 3));
  const markMaterial = new ShaderMaterial({
    vertexShader: MARK_VERTEX,
    fragmentShader: MARK_FRAGMENT,
    uniforms: {
      uSize: { value: 22 },
      uInk: { value: ink },
      uBg: { value: background },
      uColor: { value: mid.clone() },
    },
    transparent: true,
    depthTest: false,
  });
  const mark = new Points(markGeometry, markMaterial);
  mark.frustumCulled = false;
  mark.renderOrder = 2;
  mark.visible = false;
  scene.add(mark);

  // The clip box: its edges, and a floor grid on the horizontal ticks.
  const axes = config.axes || {};
  const gridMaterial = new LineBasicMaterial({
    color: kit.cssColor(el, '--ak-color-border', '#d0d0d0'),
    transparent: true,
    opacity: dark ? 0.5 : 0.75,
  });
  const edgeMaterial = new LineBasicMaterial({
    color: ink.clone().lerp(background, dark ? 0.55 : 0.62),
  });
  const grid = [];
  for (const axis of ['x', 'y', 'z']) {
    const w = axes[axis]?.w;
    if (w === 1) continue;
    for (const [t] of axes[axis]?.ticks || []) {
      if (w === 0) grid.push(t, -hy, -hz, t, -hy, hz);
      else grid.push(-hx, -hy, t, hx, -hy, t);
    }
  }
  const gridGeometry = new BufferGeometry();
  gridGeometry.setAttribute('position', new BufferAttribute(new Float32Array(grid), 3));
  const gridLines = new LineSegments(gridGeometry, gridMaterial);
  const box = [];
  for (const [a, b] of [
    [
      [-1, -1, -1],
      [1, -1, -1],
    ],
    [
      [-1, -1, 1],
      [1, -1, 1],
    ],
    [
      [-1, 1, -1],
      [1, 1, -1],
    ],
    [
      [-1, 1, 1],
      [1, 1, 1],
    ],
    [
      [-1, -1, -1],
      [-1, 1, -1],
    ],
    [
      [1, -1, -1],
      [1, 1, -1],
    ],
    [
      [-1, -1, 1],
      [-1, 1, 1],
    ],
    [
      [1, -1, 1],
      [1, 1, 1],
    ],
    [
      [-1, -1, -1],
      [-1, -1, 1],
    ],
    [
      [1, -1, -1],
      [1, -1, 1],
    ],
    [
      [-1, 1, -1],
      [-1, 1, 1],
    ],
    [
      [1, 1, -1],
      [1, 1, 1],
    ],
  ])
    box.push(a[0] * hx, a[1] * hy, a[2] * hz, b[0] * hx, b[1] * hy, b[2] * hz);
  const boxGeometry = new BufferGeometry();
  boxGeometry.setAttribute('position', new BufferAttribute(new Float32Array(box), 3));
  const boxLines = new LineSegments(boxGeometry, edgeMaterial);
  scene.add(gridLines, boxLines);

  // HTML overlay: tick labels and axis titles stay crisp text, projected each frame.
  const overlay = document.createElement('div');
  overlay.className = 'ak-pc-labels';
  overlay.setAttribute('aria-hidden', 'true');
  const labels = [];
  for (const axis of ['x', 'y', 'z']) {
    const w = axes[axis]?.w ?? 0;
    for (const [at, text] of axes[axis]?.ticks || []) {
      const span = document.createElement('span');
      span.textContent = text;
      overlay.appendChild(span);
      labels.push({ w, at, span, title: false });
    }
    const title = document.createElement('span');
    title.className = 't';
    title.textContent = axes[axis]?.title || axis;
    overlay.appendChild(title);
    labels.push({ w, at: w === 1 ? hy + 0.14 : 0, span: title, title: true });
  }
  const titlesFirst = [...labels].sort((a, b) => Number(b.title) - Number(a.title));
  const tip = document.createElement('div');
  tip.className = 'ak-pc-tip';
  tip.hidden = true;
  stage.append(overlay, tip);

  // Tools: a section cut on the up axis and a view reset.
  const tools = document.createElement('div');
  tools.className = 'ak-pc-tools';
  const upAxis = zUp ? 'z' : 'y';
  const upCenter = zUp ? cz : cy;
  const upTicks = axes[upAxis]?.ticks || [];
  const digits = Math.min(
    4,
    Math.max(0, ...upTicks.map(([, text]) => (String(text).split('.')[1] || '').length)),
  );
  const cutLabel = document.createElement('label');
  const cutName = document.createElement('span');
  cutName.textContent = 'Cut above';
  const cutInput = document.createElement('input');
  cutInput.type = 'range';
  cutInput.min = String(-hy);
  cutInput.max = String(hy);
  cutInput.step = String((2 * hy) / 200 || 0.01);
  cutInput.value = String(hy);
  const cutOutput = document.createElement('output');
  const unitText = axes[upAxis]?.unit ? ` ${axes[upAxis].unit}` : '';
  const cutValue = (t) => `${(upCenter + t / s).toFixed(digits)}${unitText}`;
  cutOutput.textContent = cutValue(hy);
  cutInput.setAttribute('aria-label', `Hide points above this ${axes[upAxis]?.title || upAxis}`);
  cutInput.setAttribute('aria-valuetext', cutOutput.textContent);
  cutLabel.append(cutName, cutInput, cutOutput);
  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.textContent = 'Reset view';
  tools.append(cutLabel, resetButton);
  stage.appendChild(tools);

  const status = el.querySelector('.ak-pc-status');
  const initialStatus = status?.textContent || '';
  const inBox = order.length;
  const clippedCount = config.clipped || 0;
  let cut = hy;
  let cutHidden = 0;
  function writeStatus() {
    if (!status) return;
    const parts = [];
    if (drawn === inBox) parts.push(`All ${fmt(drawn)} points in the clip box drawn`);
    else
      parts.push(
        `Drawing an even ${fmt(drawn)} of the ${fmt(inBox)} points in the clip box (level of detail${
          limit < budget ? ' for this device' : ''
        })`,
      );
    if (clippedCount > 0) parts.push(`${fmt(clippedCount)} outside the box are hidden`);
    if (cutHidden > 0) parts.push(`the section hides ${fmt(cutHidden)} above ${cutValue(cut)}`);
    status.textContent = `${parts.join('; ')}.`;
  }
  function setCut(t) {
    cut = MathUtils.clamp(t, -hy, hy);
    material.uniforms.uCut.value = cut >= hy ? hy + 1 : cut;
    cutHidden = 0;
    if (cut < hy) for (let k = 0; k < drawn; k += 1) if (positions[k * 3 + 1] > cut) cutHidden += 1;
    cutOutput.textContent = cutValue(cut);
    cutInput.setAttribute('aria-valuetext', cutOutput.textContent);
    writeStatus();
    placeTip();
    requestRender();
  }

  const camConfig = config.camera || {};
  const camera = new PerspectiveCamera(camConfig.fov || 30, 16 / 9, 0.05, 100);
  const home = new Vector3(...(camConfig.position || [4, 3, 6]));
  const target = new Vector3(...(camConfig.target || [0, 0, 0]));
  camera.position.copy(home);
  camera.lookAt(target);

  // Selection: any point of the cloud, drawn or not, through the marker.
  const pick = el.querySelector('.ak-pc-pick');
  const table = el.querySelector('.ak-pc-table');
  const titles = ['x', 'y', 'z'].map((axis) => axes[axis]?.title || axis);
  if (intensity) titles.push(config.color?.title || 'Intensity');
  const initialPick = pick?.innerHTML ?? '';
  const initialRow = table?.querySelector('tr[aria-selected="true"]') || null;
  const valuesOf = (i) => [xs[i], ys[i], zs[i], ...(intensity ? [intensity[i]] : [])];
  let selected = -1;
  let selectedRow = null;
  function describe(i) {
    if (!pick) return;
    pick.textContent = '';
    const list = document.createElement('dl');
    const add = (term, value) => {
      const row = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = term;
      const dd = document.createElement('dd');
      dd.textContent = String(value);
      row.append(dt, dd);
      list.appendChild(row);
    };
    add('Selected', idOf(i));
    valuesOf(i).forEach((value, k) => {
      add(titles[k], value);
    });
    pick.appendChild(list);
    if (rank[i] < 0) {
      const note = document.createElement('p');
      note.className = 'ak-pc-clip';
      note.textContent = 'Outside the clip box';
      pick.appendChild(note);
    }
  }
  function highlight(i) {
    selected = i;
    selectedRow?.removeAttribute('aria-selected');
    selectedRow =
      i >= 0 ? table?.querySelector(`tr[data-ak-pc-point="${CSS.escape(idOf(i))}"]`) || null : null;
    if (selectedRow && table) {
      selectedRow.setAttribute('aria-selected', 'true');
      table.scrollTop = selectedRow.offsetTop - table.clientHeight / 2;
    }
    if (i >= 0) {
      world(i, v);
      markGeometry.attributes.position.setXYZ(0, v.x, v.y, v.z);
      markGeometry.attributes.position.needsUpdate = true;
      markMaterial.uniforms.uColor.value.copy(colorOf(i));
      describe(i);
    }
    mark.visible = i >= 0;
    canvas.setAttribute('aria-description', i >= 0 ? `Selected: ${idOf(i)}` : '');
    requestRender();
  }
  function select(i) {
    if (i === selected || i < 0) return;
    highlight(i);
    api.fire(el, 'select', { value: idOf(i) });
    if (config.bind) api.setPath(config.bind, idOf(i));
  }

  // Screen-space projection and the nearest drawn, uncut point to a pixel.
  const matrix = new Matrix4();
  function viewProjection() {
    camera.updateMatrixWorld();
    return matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements;
  }
  function screenOf(x, y, z, m, width, height) {
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (w <= 0) return null;
    return {
      x: (((m[0] * x + m[4] * y + m[8] * z + m[12]) / w + 1) / 2) * width,
      y: ((1 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w) / 2) * height,
      w,
    };
  }
  function nearest(px, py) {
    const m = viewProjection();
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    const radius = 10;
    const near = [];
    let closest = Number.POSITIVE_INFINITY;
    for (let k = 0; k < drawn; k += 1) {
      const y = positions[k * 3 + 1];
      if (y > cut) continue;
      const w = m[3] * positions[k * 3] + m[7] * y + m[11] * positions[k * 3 + 2] + m[15];
      if (w <= 0) continue;
      const sx =
        (((m[0] * positions[k * 3] + m[4] * y + m[8] * positions[k * 3 + 2] + m[12]) / w + 1) / 2) *
        width;
      const dx = sx - px;
      if (dx > radius || dx < -radius) continue;
      const sy =
        ((1 - (m[1] * positions[k * 3] + m[5] * y + m[9] * positions[k * 3 + 2] + m[13]) / w) / 2) *
        height;
      const d = Math.hypot(dx, sy - py);
      if (d > radius) continue;
      near.push(k, d, w);
      if (d < closest) closest = d;
    }
    // Of the points within 2 px of the closest one under the cursor, the front one wins:
    // a click on a surface never selects a point hidden behind it.
    let best = -1;
    let front = Number.POSITIVE_INFINITY;
    for (let n = 0; n < near.length; n += 3) {
      if (near[n + 1] <= closest + 2 && near[n + 2] < front) {
        front = near[n + 2];
        best = order[near[n]];
      }
    }
    return best;
  }

  let hovered = -1;
  function placeTip() {
    const i = hovered;
    if (i < 0) {
      tip.hidden = true;
      return;
    }
    world(i, v);
    const at = screenOf(v.x, v.y, v.z, viewProjection(), stage.clientWidth, stage.clientHeight);
    if (!at || v.y > cut) {
      tip.hidden = true;
      return;
    }
    if (tip.dataset.for !== String(i)) {
      tip.textContent = '';
      const name = document.createElement('b');
      name.textContent = idOf(i);
      tip.appendChild(name);
      valuesOf(i).forEach((value, k) => {
        const line = document.createElement('div');
        line.textContent = `${titles[k]}: ${value}`;
        tip.appendChild(line);
      });
      tip.dataset.for = String(i);
    }
    tip.hidden = false;
    tip.style.transform = `translate(${at.x}px, ${at.y}px) translate(-50%, calc(-100% - 12px))`;
  }

  // Orbit, zoom and pick. Hover picking runs at most once a frame.
  const spherical = { r: 0, theta: 0, phi: 0 };
  function readSpherical() {
    const offset = camera.position.clone().sub(target);
    spherical.r = offset.length();
    spherical.theta = Math.atan2(offset.x, offset.z);
    spherical.phi = Math.acos(MathUtils.clamp(offset.y / spherical.r, -1, 1));
  }
  let moved = false;
  function applySpherical() {
    moved = true;
    spherical.phi = MathUtils.clamp(spherical.phi, 0.12, Math.PI - 0.12);
    spherical.r = MathUtils.clamp(spherical.r, 0.6, 20);
    const sinPhi = Math.sin(spherical.phi);
    camera.position.set(
      target.x + spherical.r * sinPhi * Math.sin(spherical.theta),
      target.y + spherical.r * Math.cos(spherical.phi),
      target.z + spherical.r * sinPhi * Math.cos(spherical.theta),
    );
    camera.lookAt(target);
    requestRender();
  }
  readSpherical();
  const local = (event) => {
    const rect = stage.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const pointers = new Map();
  let downAt = null;
  let pinch = 0;
  let hoverAt = null;
  let hoverFrame = 0;
  function hoverPick() {
    hoverFrame = 0;
    if (!hoverAt) return;
    const i = nearest(hoverAt.x, hoverAt.y);
    if (i !== hovered) {
      hovered = i;
      canvas.style.cursor = i >= 0 ? 'pointer' : '';
      placeTip();
    }
  }
  const onPointerDown = (event) => {
    canvas.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    downAt = { x: event.clientX, y: event.clientY };
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };
  const onPointerMove = (event) => {
    const last = pointers.get(event.pointerId);
    if (!last) {
      if (event.pointerType === 'mouse') {
        hoverAt = local(event);
        if (!hoverFrame) hoverFrame = requestAnimationFrame(hoverPick);
      }
      return;
    }
    if (pointers.size === 2) {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0) {
        spherical.r *= pinch / distance;
        applySpherical();
      }
      pinch = distance;
      return;
    }
    spherical.theta -= (event.clientX - last.x) * 0.01;
    spherical.phi -= (event.clientY - last.y) * 0.01;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (hovered >= 0) {
      hovered = -1;
      placeTip();
    }
    applySpherical();
  };
  const onPointerUp = (event) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = 0;
    const distance = downAt ? Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) : 99;
    if (downAt && distance < 6) {
      const at = local(event);
      const i = nearest(at.x, at.y);
      if (i >= 0) select(i);
    }
    downAt = null;
  };
  const onLeave = () => {
    hoverAt = null;
    if (hovered < 0) return;
    hovered = -1;
    placeTip();
  };
  const onWheel = (event) => {
    event.preventDefault();
    spherical.r *= event.deltaY > 0 ? 1.1 : 0.9;
    applySpherical();
  };
  /** N and P walk the drawn points in level-of-detail order: each step lands somewhere new. */
  function step(direction) {
    if (drawn === 0) return;
    let k = selected >= 0 && rank[selected] < drawn ? rank[selected] : -1;
    for (let n = 0; n < drawn; n += 1) {
      k = k < 0 ? (direction > 0 ? 0 : drawn - 1) : (k + direction + drawn) % drawn;
      if (positions[k * 3 + 1] <= cut) {
        select(order[k]);
        return;
      }
    }
  }
  const onKey = (event) => {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (key === 'ArrowLeft') spherical.theta -= 0.15;
    else if (key === 'ArrowRight') spherical.theta += 0.15;
    else if (key === 'ArrowUp') spherical.phi -= 0.15;
    else if (key === 'ArrowDown') spherical.phi += 0.15;
    else if (key === '+' || key === '=') spherical.r *= 0.9;
    else if (key === '-') spherical.r *= 1.1;
    else if (key === 'n' || key === 'p') {
      step(key === 'p' ? -1 : 1);
      event.preventDefault();
      return;
    } else if (key === 'Home') {
      event.preventDefault();
      onReset();
      return;
    } else return;
    event.preventDefault();
    applySpherical();
  };
  const onCut = () => setCut(Number(cutInput.value));
  function onReset() {
    moved = false;
    fitHome();
    cutInput.value = String(hy);
    setCut(hy);
  }
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('keydown', onKey);
  cutInput.addEventListener('input', onCut);
  resetButton.addEventListener('click', onReset);

  /** Ticks ride the box edges nearest the reader; a label that would collide is hidden. */
  function layoutAxes() {
    const c = camera.position;
    const sx = c.x >= 0 ? 1 : -1;
    const sz = c.z >= 0 ? 1 : -1;
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    const edge = [
      (t, o) => v.set(t, -hy - o, sz * (hz + o)),
      (t, o) => v.set(sx * (hx + o), t, -sz * (hz + o)),
      (t, o) => v.set(sx * (hx + o), -hy - o, t),
    ];
    const placed = [];
    const inset = 4;
    for (const label of titlesFirst) {
      edge[label.w](label.at, label.title && label.w !== 1 ? 0.2 : 0.07).project(camera);
      label.width = label.width || label.span.offsetWidth;
      label.height = label.height || label.span.offsetHeight;
      let x = ((v.x + 1) / 2) * width;
      let y = ((1 - v.y) / 2) * height;
      const outside =
        x - label.width / 2 < inset ||
        x + label.width / 2 > width - inset ||
        y - label.height / 2 < inset ||
        y + label.height / 2 > height - inset;
      if (label.title) {
        x = MathUtils.clamp(x, label.width / 2 + inset, width - label.width / 2 - inset);
        y = MathUtils.clamp(y, label.height / 2 + inset, height - label.height / 2 - inset);
      }
      const boxed = {
        x0: x - label.width / 2 - 3,
        x1: x + label.width / 2 + 3,
        y0: y - label.height / 2 - 3,
        y1: y + label.height / 2 + 3,
      };
      const clash = placed.some(
        (b) => boxed.x0 < b.x1 && boxed.x1 > b.x0 && boxed.y0 < b.y1 && boxed.y1 > b.y0,
      );
      const hidden = v.z > 1 || clash || (outside && !label.title);
      if (!hidden) placed.push(boxed);
      label.span.style.visibility = hidden ? 'hidden' : '';
      label.span.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    }
  }

  // Until the reader orbits, a stage narrower than 16:9 backs the camera off so the box still fits.
  const fit = camConfig.fit || [0.8, 0.66];
  const corners = [];
  for (const a of [-1, 1])
    for (const b of [-1, 1])
      for (const c of [-1, 1]) corners.push(new Vector3(a * hx, b * hy, c * hz));
  /** At 16:9 the compiler's camera, so the poster and the live view agree; otherwise refit the box. */
  function fitHome() {
    const direction = home.clone().sub(target);
    let distance = direction.length();
    direction.normalize();
    if (Math.abs(camera.aspect - 16 / 9) > 0.01) {
      const fits = (r) => {
        camera.position.copy(target).addScaledVector(direction, r);
        camera.lookAt(target);
        camera.updateMatrixWorld();
        return corners.every((corner) => {
          v.copy(corner).project(camera);
          return v.z < 1 && Math.abs(v.x) <= fit[0] && Math.abs(v.y) <= fit[1];
        });
      };
      let lo = 0.2;
      let hi = 40;
      for (let k = 0; k < 32; k += 1) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) hi = mid;
        else lo = mid;
      }
      distance = hi;
    }
    camera.position.copy(target).addScaledVector(direction, distance);
    camera.lookAt(target);
    readSpherical();
  }
  function resize() {
    const width = stage.clientWidth || 640;
    const height = stage.clientHeight || 360;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (!moved) fitHome();
    const focal =
      (height * renderer.getPixelRatio()) / (2 * Math.tan(MathUtils.degToRad(camera.fov) / 2));
    material.uniforms.uScale.value = base * focal;
    markMaterial.uniforms.uSize.value = 22 * renderer.getPixelRatio();
    requestRender();
  }
  const resizeObserver = window.ResizeObserver ? new ResizeObserver(resize) : null;
  resizeObserver?.observe(stage);

  const record = {
    el,
    visible: true,
    lost: false,
    animating: false,
    frames: 0,
    renderMs: [],
    tick() {
      layoutAxes();
      // Depth fade spans the box as seen from the camera now.
      const reach = Math.hypot(hx, hy, hz);
      const distance = camera.position.distanceTo(target);
      material.uniforms.uDepth.value = [Math.max(0.01, distance - reach), distance + reach];
      const begin = performance.now();
      renderer.render(scene, camera);
      record.renderMs.push(performance.now() - begin);
      if (record.renderMs.length > kit.RENDER_SAMPLES) record.renderMs.shift();
      placeTip();
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
        points: renderer.info.render.points,
        drawn,
        quality,
        dpr: renderer.getPixelRatio(),
      };
    },
    freeze() {
      if (record.lost || record.frames === 0) return null;
      if (stage.querySelector('.ak-3d-frame'))
        return { width: canvas.width, height: canvas.height };
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
      if (!config.bind) return;
      const i = indexOfId(api.readPath(config.bind));
      if (i >= 0 && i !== selected) highlight(i);
    },
    unmount() {
      cancelVisibility();
      resizeObserver?.disconnect();
      if (hoverFrame) cancelAnimationFrame(hoverFrame);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('keydown', onKey);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      cutInput.removeEventListener('input', onCut);
      resetButton.removeEventListener('click', onReset);
      for (const disposable of [
        geometry,
        material,
        markGeometry,
        markMaterial,
        gridGeometry,
        gridMaterial,
        boxGeometry,
        edgeMaterial,
      ])
        disposable.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      stage.querySelector('.ak-3d-frame')?.remove();
      overlay.remove();
      tip.remove();
      tools.remove();
      canvas.remove();
      if (status) status.textContent = initialStatus;
      if (pick) pick.innerHTML = initialPick;
      selectedRow?.removeAttribute('aria-selected');
      initialRow?.setAttribute('aria-selected', 'true');
      kit.mounts.delete(record);
      el.setAttribute('data-ak-3d-state', 'static');
    },
  };
  function requestRender() {
    if (record.visible && !record.lost) kit.schedule();
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
  resize();
  writeStatus();
  record.sync();
  record.tick(performance.now());
  return record;
}
