/**
 * The `scatter-3d` runtime: one `Points` draw for every point, a lit sphere
 * impostor per point in the shader, HTML tick labels projected each frame, and
 * screen-space pick and brush over the visible points.
 *
 * It reads only the validated config the compiler emitted: normalized cube
 * positions, size factors, color indices, ticks and ids. The values a reader
 * sees in the tooltip come from the data table the compiler already rendered.
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

const VERTEX = `
attribute float aSize;
attribute float aState;
attribute vec3 aColor;
uniform float uScale;
varying vec3 vColor;
varying float vState;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float s = aSize * uScale / -mv.z;
  if (aState > 1.5 && aState < 2.5) s = s * 1.8 + 6.0;
  if (aState > 2.5) { s = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }
  gl_PointSize = max(s, 2.0);
  vColor = aColor;
  vState = aState;
}`;

/** A lit sphere per point: diffuse plus a soft highlight, a darker rim, a ring when selected. */
const FRAGMENT = `
uniform vec3 uBg;
uniform vec3 uInk;
varying vec3 vColor;
varying float vState;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  vec3 n = vec3(p.x, -p.y, sqrt(1.0 - r2));
  float diffuse = max(dot(n, normalize(vec3(-0.45, 0.6, 0.65))), 0.0);
  float spec = pow(max(dot(n, normalize(vec3(-0.25, 0.45, 1.0))), 0.0), 24.0);
  vec3 c = vColor * (0.5 + 0.62 * diffuse) + vec3(spec * 0.32);
  c = mix(c * 0.7, c, smoothstep(1.0, 0.55, r2));
  if (vState > 1.5 && vState < 2.5 && r2 > 0.6) c = r2 > 0.78 ? uInk : uBg;
  if (vState > 0.5 && vState < 1.5) c = mix(uBg, c, 0.18);
  gl_FragColor = vec4(c, smoothstep(1.0, 0.86, r2));
  #include <colorspace_fragment>
}`;

const NORMAL = 0;
const DIM = 1;
const PICKED = 2;
const HIDDEN = 3;

/** Mix two linear-sRGB colours in oklab, matching the CSS `color-mix(in oklab, ...)` legend swatches. */
export function mixOklab(a, b, t) {
  const lab = (c) => {
    const l = Math.cbrt(0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b);
    const m = Math.cbrt(0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b);
    const s = Math.cbrt(0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  };
  const p = lab(a);
  const q = lab(b);
  const [L, A, B] = p.map((v, i) => v + (q[i] - v) * t);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return a
    .clone()
    .setRGB(
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    );
}

export function mountScatter(el, kit) {
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
    el.querySelector('.ak-3d-caption')?.textContent || '3D scatter',
  );
  canvas.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight ArrowUp ArrowDown + - N P Escape');
  stage.appendChild(canvas);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : 1));

  const count = config.count || 0;
  const ids = config.ids || [];
  const indexOf = new Map(ids.map((id, i) => [id, i]));
  const clipped = new Set(config.clipped || []);
  const groupOf = config.groups ? config.colors || [] : null;

  // Colors from the theme: group tones, or the sequential ramp info -> accent -> danger.
  const dark = kit.isDark(el);
  const background = kit.cssColor(el, '--ak-color-background', '#ffffff');
  const ink = kit.cssColor(el, '--ak-color-text', '#222222');
  let palette;
  if (Array.isArray(config.palette))
    palette = config.palette.map((tone) =>
      tone.endsWith('-deep')
        ? mixOklab(kit.toneColor(el, tone.slice(0, -5)), ink, 0.6)
        : kit.toneColor(el, tone),
    );
  else if (config.palette === 'sequential') {
    const low = kit.toneColor(el, 'info');
    const mid = kit.toneColor(el, 'accent');
    const high = kit.toneColor(el, 'danger');
    palette = Array.from({ length: 8 }, (_, i) => {
      const t = i / 7;
      return t <= 0.5 ? mixOklab(low, mid, t / 0.5) : mixOklab(mid, high, (t - 0.5) / 0.5);
    });
  } else palette = [kit.toneColor(el, 'accent')];

  const positions = new Float32Array(config.positions || []);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const states = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const color = palette[config.colors?.[i] || 0] || palette[0];
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
    sizes[i] = config.sizes ? config.sizes[i] : 1;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new BufferAttribute(sizes, 1));
  const stateAttribute = new BufferAttribute(states, 1);
  geometry.setAttribute('aState', stateAttribute);
  // Points of a dense cloud are smaller so density reads; a sparse plot gets marks.
  const base = count > 2000 ? 0.024 : count > 300 ? 0.044 : 0.08;
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uScale: { value: 1 },
      uBg: { value: background },
      uInk: { value: ink },
    },
    alphaToCoverage: quality === 'high',
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;

  const scene = new Scene();
  scene.add(points);

  // Axes: a grid on each wall, shown only on the three walls behind the data.
  const gridMaterial = new LineBasicMaterial({
    color: kit.cssColor(el, '--ak-color-border', '#d0d0d0'),
    transparent: true,
    opacity: dark ? 0.55 : 0.8,
  });
  const edgeMaterial = new LineBasicMaterial({
    color: ink.clone().lerp(background, dark ? 0.55 : 0.6),
  });
  const axes = config.axes || {};
  const tickAt = (axis) => (axes[axis]?.ticks || []).map((t) => t[0]);
  const walls = [];
  function wall(axis, side) {
    const vertices = [];
    const [u, v] = axis === 'x' ? ['y', 'z'] : axis === 'y' ? ['x', 'z'] : ['x', 'y'];
    const put = (a, b) => {
      const p = { [axis]: side, [u]: a, [v]: b };
      vertices.push(p.x, p.y, p.z);
    };
    for (const t of tickAt(u)) {
      put(t, -1);
      put(t, 1);
    }
    for (const t of tickAt(v)) {
      put(-1, t);
      put(1, t);
    }
    // The wall's border, drawn stronger.
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3));
    const lines = new LineSegments(g, gridMaterial);
    const border = [];
    for (const [a, b, c, d] of [
      [-1, -1, 1, -1],
      [1, -1, 1, 1],
      [1, 1, -1, 1],
      [-1, 1, -1, -1],
    ]) {
      const p = { [axis]: side, [u]: a, [v]: b };
      const q = { [axis]: side, [u]: c, [v]: d };
      border.push(p.x, p.y, p.z, q.x, q.y, q.z);
    }
    const eg = new BufferGeometry();
    eg.setAttribute('position', new BufferAttribute(new Float32Array(border), 3));
    const edges = new LineSegments(eg, edgeMaterial);
    lines.add(edges);
    lines.userData = { axis, side };
    scene.add(lines);
    walls.push(lines);
  }
  for (const axis of ['x', 'y', 'z']) {
    wall(axis, -1);
    wall(axis, 1);
  }

  // HTML overlay: tick labels and axis titles stay crisp text, projected each frame.
  const overlay = document.createElement('div');
  overlay.className = 'ak-sc-labels';
  overlay.setAttribute('aria-hidden', 'true');
  const labels = [];
  for (const axis of ['x', 'y', 'z']) {
    for (const [at, text] of axes[axis]?.ticks || []) {
      const span = document.createElement('span');
      span.textContent = text;
      overlay.appendChild(span);
      labels.push({ axis, at, span, title: false });
    }
    const title = document.createElement('span');
    title.className = 't';
    title.textContent = axes[axis]?.title || axis;
    overlay.appendChild(title);
    // The vertical axis is titled at its top; the floor axes beside their middle.
    labels.push({ axis, at: axis === 'y' ? 1.2 : 0, span: title, title: axis !== 'y' });
  }
  const titlesFirst = [...labels].sort(
    (a, b) => Number(b.span.className === 't') - Number(a.span.className === 't'),
  );
  const tip = document.createElement('div');
  tip.className = 'ak-sc-tip';
  tip.hidden = true;
  const brushBox = document.createElement('div');
  brushBox.className = 'ak-sc-brush';
  brushBox.hidden = true;
  stage.append(overlay, tip, brushBox);

  // Tools only make sense with the live plot: brush mode for touch, and a view reset.
  const tools = document.createElement('div');
  tools.className = 'ak-sc-tools';
  const brushButton = document.createElement('button');
  brushButton.type = 'button';
  brushButton.textContent = 'Brush';
  brushButton.setAttribute('aria-pressed', 'false');
  brushButton.title = 'Drag on the plot to select a region (or hold Shift)';
  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.textContent = 'Reset view';
  tools.append(brushButton, resetButton);
  const status = el.querySelector('.ak-sc-status');
  const initialStatus = status?.textContent || '';
  stage.appendChild(tools);

  const cfgCamera = config.camera || {};
  const camera = new PerspectiveCamera(cfgCamera.fov || 30, 16 / 9, 0.05, 100);
  const home = new Vector3(...(cfgCamera.position || [4, 3, 6]));
  const target = new Vector3(...(cfgCamera.target || [0, 0, 0]));
  camera.position.copy(home);
  camera.lookAt(target);

  // Selection, filter and brush state, folded into one per-point attribute.
  let selected = -1;
  let filter = '';
  let brushed = null;
  function paint() {
    let shown = 0;
    for (let i = 0; i < count; i += 1) {
      let s = NORMAL;
      if (clipped.has(i) || (filter && groupOf && config.groups[groupOf[i]] !== filter)) s = HIDDEN;
      else if (i === selected) s = PICKED;
      else if (brushed && !brushed.has(i)) s = DIM;
      if (s !== HIDDEN) shown += 1;
      states[i] = s;
    }
    stateAttribute.needsUpdate = true;
    if (status) {
      if (brushed) {
        status.textContent = `${brushed.size.toLocaleString('en-US')} of ${shown.toLocaleString(
          'en-US',
        )} visible points brushed. Press Escape or click an empty spot to clear.`;
      } else if (filter) {
        const label =
          groupButtons
            .find((button) => button.getAttribute('data-ak-sc-group') === filter)
            ?.childNodes[1]?.textContent?.trim() || filter;
        status.textContent = `${shown.toLocaleString('en-US')} ${label} points shown of ${(count - clipped.size).toLocaleString('en-US')} plotted.`;
      } else status.textContent = initialStatus;
    }
    for (const button of groupButtons) {
      const value = button.getAttribute('data-ak-sc-group');
      button.setAttribute('aria-pressed', !filter || filter === value ? 'true' : 'false');
    }
    requestRender();
  }

  const table = el.querySelector('.ak-sc-table');
  const head = [...el.querySelectorAll('.ak-sc-table thead th')].map((th) => th.textContent);
  let selectedRow = null;
  function rowOf(i) {
    if (i < 0) return null;
    return table?.querySelector(`tr[data-ak-sc-point="${CSS.escape(ids[i])}"]`) || null;
  }
  function describe(i) {
    const row = rowOf(i);
    tip.textContent = '';
    const name = document.createElement('b');
    name.textContent = ids[i];
    tip.appendChild(name);
    if (row) {
      [...row.cells].slice(1).forEach((cell, k) => {
        if (!cell.textContent) return;
        const line = document.createElement('div');
        line.textContent = `${head[k + 1]}: ${cell.textContent}`;
        tip.appendChild(line);
      });
    }
  }
  let hovered = -1;
  let tipArmed = false;
  function placeTip() {
    const i = hovered >= 0 ? hovered : tipArmed ? selected : -1;
    if (i < 0 || states[i] === HIDDEN) {
      tip.hidden = true;
      return;
    }
    const at = toScreen(i);
    if (!at) {
      tip.hidden = true;
      return;
    }
    if (tip.dataset.for !== String(i)) {
      describe(i);
      tip.dataset.for = String(i);
    }
    tip.hidden = false;
    tip.style.transform = `translate(${at.x}px, ${at.y}px) translate(-50%, calc(-100% - 12px))`;
  }

  function highlight(i) {
    selected = i;
    selectedRow?.removeAttribute('aria-selected');
    selectedRow = rowOf(i);
    if (selectedRow && table) {
      selectedRow.setAttribute('aria-selected', 'true');
      table.scrollTop = selectedRow.offsetTop - table.clientHeight / 2;
    }
    canvas.setAttribute('aria-description', i >= 0 ? `Selected: ${ids[i]}` : '');
    paint();
  }
  function select(i) {
    if (i === selected) return;
    tipArmed = true;
    highlight(i);
    if (i < 0) return;
    api.fire(el, 'select', { value: ids[i] });
    if (config.bind) api.setPath(config.bind, ids[i]);
  }
  function setFilter(value) {
    filter = value;
    if (selected >= 0 && filter && groupOf && config.groups[groupOf[selected]] !== filter)
      selected = -1;
    paint();
  }

  const groupButtons = [...el.querySelectorAll('[data-ak-sc-group]')];
  const onGroup = (event) => {
    const value = event.currentTarget.getAttribute('data-ak-sc-group');
    const next = filter === value ? '' : value;
    setFilter(next);
    if (config.filterBind) api.setPath(config.filterBind, next);
  };
  for (const button of groupButtons) {
    button.disabled = false;
    button.addEventListener('click', onGroup);
  }

  // Screen-space projection of one point and the nearest visible point to a pixel.
  const matrix = new Matrix4();
  function viewProjection() {
    camera.updateMatrixWorld();
    return matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements;
  }
  function toScreen(i) {
    const m = viewProjection();
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (w <= 0) return null;
    return {
      x: (((m[0] * x + m[4] * y + m[8] * z + m[12]) / w + 1) / 2) * stage.clientWidth,
      y: ((1 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w) / 2) * stage.clientHeight,
      w,
    };
  }
  function eachOnScreen(visit) {
    const m = viewProjection();
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    for (let i = 0; i < count; i += 1) {
      if (states[i] === HIDDEN) continue;
      const x = positions[i * 3];
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (w <= 0) continue;
      visit(
        i,
        (((m[0] * x + m[4] * y + m[8] * z + m[12]) / w + 1) / 2) * width,
        ((1 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w) / 2) * height,
        w,
      );
    }
  }
  function nearest(px, py) {
    let best = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    const pixelScale = material.uniforms.uScale.value / renderer.getPixelRatio();
    eachOnScreen((i, x, y, w) => {
      const radius = Math.max(8, (sizes[i] * pixelScale) / w / 2 + 3);
      const d = Math.hypot(x - px, y - py);
      // Nearer to the cursor wins; at equal distance the point in front.
      const score = d + w * 0.01;
      if (d <= radius && score < bestScore) {
        best = i;
        bestScore = score;
      }
    });
    return best;
  }
  function brushRect(a, b) {
    const x0 = Math.min(a.x, b.x);
    const x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const y1 = Math.max(a.y, b.y);
    const inside = new Set();
    eachOnScreen((i, x, y) => {
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) inside.add(i);
    });
    return inside;
  }
  function clearBrush() {
    if (!brushed) return;
    brushed = null;
    paint();
  }

  // Orbit, zoom, pick and brush.
  const spherical = { r: 0, theta: 0, phi: 0 };
  function readSpherical() {
    const offset = camera.position.clone().sub(target);
    spherical.r = offset.length();
    spherical.theta = Math.atan2(offset.x, offset.z);
    spherical.phi = Math.acos(MathUtils.clamp(offset.y / spherical.r, -1, 1));
  }
  function applySpherical() {
    moved = true;
    spherical.phi = MathUtils.clamp(spherical.phi, 0.12, Math.PI - 0.12);
    spherical.r = MathUtils.clamp(spherical.r, 2.2, 20);
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
  let brushFrom = null;
  let pinch = 0;
  let brushMode = false;
  const onPointerDown = (event) => {
    canvas.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    downAt = { x: event.clientX, y: event.clientY };
    if ((brushMode || event.shiftKey) && pointers.size === 1) brushFrom = local(event);
    if (pointers.size === 2) {
      brushFrom = null;
      const [a, b] = [...pointers.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };
  const onPointerMove = (event) => {
    const last = pointers.get(event.pointerId);
    if (!last) {
      if (event.pointerType === 'mouse') {
        const at = local(event);
        const i = nearest(at.x, at.y);
        if (i !== hovered) {
          hovered = i;
          canvas.style.cursor = i >= 0 ? 'pointer' : '';
          placeTip();
        }
      }
      return;
    }
    if (brushFrom) {
      const at = local(event);
      brushBox.hidden = false;
      brushBox.style.left = `${Math.min(at.x, brushFrom.x)}px`;
      brushBox.style.top = `${Math.min(at.y, brushFrom.y)}px`;
      brushBox.style.width = `${Math.abs(at.x - brushFrom.x)}px`;
      brushBox.style.height = `${Math.abs(at.y - brushFrom.y)}px`;
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
    applySpherical();
  };
  const onPointerUp = (event) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = 0;
    const moved = downAt ? Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) : 99;
    if (brushFrom && moved >= 6) {
      brushed = brushRect(brushFrom, local(event));
      brushBox.hidden = true;
      brushFrom = null;
      downAt = null;
      paint();
      api.fire(el, 'brush', { value: brushed.size });
      return;
    }
    brushFrom = null;
    brushBox.hidden = true;
    if (downAt && moved < 6) {
      const at = local(event);
      const i = nearest(at.x, at.y);
      if (i >= 0) select(i);
      else clearBrush();
    }
    downAt = null;
  };
  const onLeave = () => {
    if (hovered < 0) return;
    hovered = -1;
    placeTip();
  };
  const onWheel = (event) => {
    event.preventDefault();
    spherical.r *= event.deltaY > 0 ? 1.1 : 0.9;
    applySpherical();
  };
  function step(direction) {
    for (let k = 1; k <= count; k += 1) {
      const i =
        ((((selected < 0 ? (direction > 0 ? -1 : 0) : selected) + direction * k) % count) + count) %
        count;
      if (states[i] !== HIDDEN) {
        select(i);
        return;
      }
    }
  }
  const onKey = (event) => {
    const key = event.key;
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
    } else if (key === 'Escape') {
      clearBrush();
      return;
    } else return;
    event.preventDefault();
    applySpherical();
  };
  const onBrushButton = () => {
    brushMode = !brushMode;
    brushButton.setAttribute('aria-pressed', brushMode ? 'true' : 'false');
    canvas.style.cursor = brushMode ? 'crosshair' : '';
  };
  const onReset = () => {
    moved = false;
    fitHome();
    clearBrush();
    requestRender();
  };
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('keydown', onKey);
  brushButton.addEventListener('click', onBrushButton);
  resetButton.addEventListener('click', onReset);

  /** Back walls face away from the camera; labels ride the front edges. */
  function layoutAxes() {
    const c = camera.position;
    const sx = c.x >= 0 ? 1 : -1;
    const sy = c.y >= 0 ? 1 : -1;
    const sz = c.z >= 0 ? 1 : -1;
    const side = { x: sx, y: sy, z: sz };
    for (const lines of walls) lines.visible = lines.userData.side === -side[lines.userData.axis];
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    const v = new Vector3();
    const edge = {
      x: (t, k) => v.set(t, -sy * (1 + 0.12 * k), sz * (1 + 0.12 * k)),
      y: (t, k) => v.set(sx * (1 + 0.12 * k), t, -sz * (1 + 0.12 * k)),
      z: (t, k) => v.set(sx * (1 + 0.12 * k), -sy * (1 + 0.12 * k), t),
    };
    // Titles claim space first, then ticks in order; a label that would overlap one already placed is hidden.
    const placed = [];
    for (const label of titlesFirst) {
      edge[label.axis](label.at, label.title ? 2.2 : 1).project(camera);
      label.w = label.w || label.span.offsetWidth;
      label.h = label.h || label.span.offsetHeight;
      let x = ((v.x + 1) / 2) * width;
      let y = ((1 - v.y) / 2) * height;
      // Titles are pulled inside the stage; ticks that fall outside it are dropped.
      const inset = 4;
      const outside =
        x - label.w / 2 < inset ||
        x + label.w / 2 > width - inset ||
        y - label.h / 2 < inset ||
        y + label.h / 2 > height - inset;
      if (label.span.className === 't') {
        x = MathUtils.clamp(x, label.w / 2 + inset, width - label.w / 2 - inset);
        y = MathUtils.clamp(y, label.h / 2 + inset, height - label.h / 2 - inset);
      }
      const box = {
        x0: x - label.w / 2 - 2,
        x1: x + label.w / 2 + 2,
        y0: y - label.h / 2,
        y1: y + label.h / 2,
      };
      const clash = placed.some(
        (b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0,
      );
      const hidden = v.z > 1 || clash || (outside && label.span.className !== 't');
      if (!hidden) placed.push(box);
      label.span.style.visibility = hidden ? 'hidden' : '';
      label.span.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    }
  }

  // Until the reader orbits, a narrower stage than 16:9 backs the camera off so the cube still fits.
  let moved = false;
  function fitHome() {
    const offset = home
      .clone()
      .sub(target)
      .multiplyScalar(Math.max(1, 1.62 / camera.aspect));
    camera.position.copy(target).add(offset);
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
    // Point diameter in device pixels = world size * focal length / depth.
    material.uniforms.uScale.value =
      (base * height * renderer.getPixelRatio()) /
      (2 * Math.tan(MathUtils.degToRad(camera.fov) / 2));
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
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        points: renderer.info.render.points,
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
      if (config.bind) {
        const value = api.readPath(config.bind);
        const i = typeof value === 'string' && indexOf.has(value) ? indexOf.get(value) : -1;
        if (i >= 0 && i !== selected) {
          tipArmed = record.frames > 0;
          highlight(i);
        }
      }
      if (config.filterBind) {
        const value = api.readPath(config.filterBind);
        const next = typeof value === 'string' && config.groups?.includes(value) ? value : '';
        if (next !== filter) setFilter(next);
      }
    },
    unmount() {
      cancelVisibility();
      resizeObserver?.disconnect();
      for (const button of groupButtons) {
        button.removeEventListener('click', onGroup);
        button.disabled = true;
      }
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('keydown', onKey);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      geometry.dispose();
      material.dispose();
      gridMaterial.dispose();
      edgeMaterial.dispose();
      for (const lines of walls) {
        lines.geometry.dispose();
        lines.children[0]?.geometry.dispose();
      }
      renderer.dispose();
      renderer.forceContextLoss();
      stage.querySelector('.ak-3d-frame')?.remove();
      overlay.remove();
      tip.remove();
      brushBox.remove();
      tools.remove();
      canvas.remove();
      if (status) status.textContent = initialStatus;
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
  paint();
  record.sync();
  record.tick(performance.now());
  return record;
}
