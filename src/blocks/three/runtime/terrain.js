/**
 * Terrain 3D runtime: the scene runtime lights and stages an empty scene; this
 * builds the block from the compiled 16-bit heightmap: lit ground coloured by
 * the ramp, soil walls, contour lines at the compiled interval, and numbered
 * pins on stems. A flyover tours the places (or circles the block) until the
 * reader takes the camera or presses Pause; choosing a place flies to it and
 * writes its id to page state. Under reduced motion nothing moves on its own
 * and every flight lands at once.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three';
import {
  blockCorners,
  contourLevels,
  contourSegments,
  decodeHeights,
  fitCamera,
  HOME_BEARING,
  isIndexLevel,
  MAX_SIDE,
  MIN_SIDE,
  rampColor,
  sample,
} from '../terrain-field.ts';

/** Milliseconds per flyover leg and per hold over a place. */
const FLY_MS = 3400;
const HOLD_MS = 2600;
/** Milliseconds for a reader's flight to a place. */
const PICK_MS = 1300;
const RISE_MS = 1400;
/** Radians per millisecond the camera drifts round a place while it holds. */
const DRIFT = 0.00005;
/** Height of a pin's head above its ground point; matches the compiler's drawing. */
const PIN_LIFT = 0.36;
const PIN_RADIUS = 14;
/** A close-up sits this share of the home distance from its place. */
const CLOSE = 0.46;

const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const easeOut = (k) => 1 - (1 - k) ** 3;

/** Live terrain geometries and materials not yet disposed; the disposal check reads it. */
let live = 0;
export const liveTerrainResources = () => live;
function track(resource) {
  live += 1;
  resource.addEventListener('dispose', () => {
    live -= 1;
  });
  return resource;
}

/** True when the compiled config carries a heightmap this runtime can build. */
export function terrainValid(config) {
  const t = config?.terrain;
  return Boolean(
    t &&
      Number.isInteger(t.cols) &&
      Number.isInteger(t.rows) &&
      t.cols >= MIN_SIDE &&
      t.rows >= MIN_SIDE &&
      t.cols <= MAX_SIDE &&
      t.rows <= MAX_SIDE &&
      typeof t.heights === 'string' &&
      t.heights.length === Math.ceil((t.cols * t.rows * 2) / 3) * 4 &&
      Number.isFinite(t.min) &&
      Number.isFinite(t.max) &&
      Array.isArray(t.extent) &&
      Number.isFinite(t.vscale),
  );
}

const linear = (rgb) => new Color().setRGB(rgb[0], rgb[1], rgb[2], SRGBColorSpace);

export function terrainWidget(ctx) {
  const { el, config, scene, camera, motion, api } = ctx;
  const t = config.terrain;
  if (!terrainValid(config)) return null;
  const field = decodeHeights(t.heights, t.cols, t.rows, t.min, t.max);
  if (!field) return null;
  const stage = el.querySelector('.ak-3d-stage') || el;
  const [W, D] = t.extent;
  const base = t.base;
  const span = field.max - field.min || 1;
  const top = base + (field.max - field.min) * t.vscale;
  const listeners = [];
  const on = (target, type, handler) => {
    target.addEventListener(type, handler);
    listeners.push([target, type, handler]);
  };
  const owned = [];
  const own = (resource) => {
    owned.push(track(resource));
    return resource;
  };
  const yOf = (h) => base + (h - field.min) * t.vscale;

  // ---- Ground ---------------------------------------------------------------------------------
  const { cols, rows } = field;
  const positions = new Float32Array(cols * rows * 3);
  const colors = new Float32Array(cols * rows * 3);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const i = r * cols + c;
      const h = field.data[i];
      positions[i * 3] = (c / (cols - 1) - 0.5) * W;
      positions[i * 3 + 1] = yOf(h);
      positions[i * 3 + 2] = (r / (rows - 1) - 0.5) * D;
      const color = linear(rampColor(t.ramp, (h - field.min) / span));
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
  }
  const index = new Uint32Array((cols - 1) * (rows - 1) * 6);
  let k = 0;
  for (let r = 0; r < rows - 1; r += 1) {
    for (let c = 0; c < cols - 1; c += 1) {
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      index.set([a, d, b, b, d, e], k);
      k += 6;
    }
  }
  const groundGeometry = own(new BufferGeometry());
  groundGeometry.setIndex(new BufferAttribute(index, 1));
  groundGeometry.setAttribute('position', new BufferAttribute(positions, 3));
  groundGeometry.setAttribute('color', new BufferAttribute(colors, 3));
  groundGeometry.computeVertexNormals();
  groundGeometry.computeBoundingSphere();
  const groundMaterial = own(
    new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0,
      envMapIntensity: 0.6,
      // Contour lines sit exactly on the ground; the ground gives way so they never flicker.
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
  );
  const ground = new Mesh(groundGeometry, groundMaterial);
  ground.castShadow = true;
  ground.receiveShadow = true;

  // ---- Walls ----------------------------------------------------------------------------------
  // Soil that follows the ground's edge down to the floor, lit at the top and shaded at the foot.
  const low = rampColor(t.ramp, 0.02);
  const soil = [(low[0] + 0.45) / 2, (low[1] + 0.36) / 2, (low[2] + 0.28) / 2];
  const wallTop = linear(soil.map((v) => Math.min(1, v * 1.05)));
  const wallFoot = linear(soil.map((v) => v * 0.55));
  const wallPositions = [];
  const wallColors = [];
  const edge = (points) => {
    for (let i = 0; i < points.length - 1; i += 1) {
      const [x0, y0, z0] = points[i];
      const [x1, y1, z1] = points[i + 1];
      const quad = [
        [x0, y0, z0, wallTop],
        [x0, 0, z0, wallFoot],
        [x1, y1, z1, wallTop],
        [x1, y1, z1, wallTop],
        [x0, 0, z0, wallFoot],
        [x1, 0, z1, wallFoot],
      ];
      for (const [x, y, z, color] of quad) {
        wallPositions.push(x, y, z);
        wallColors.push(color.r, color.g, color.b);
      }
    }
  };
  const vertex = (c, r) => {
    const i = r * cols + c;
    return [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
  };
  // Each side runs so its face points outward.
  edge(Array.from({ length: cols }, (_, c) => vertex(c, rows - 1)));
  edge(Array.from({ length: rows }, (_, r) => vertex(cols - 1, rows - 1 - r)));
  edge(Array.from({ length: cols }, (_, c) => vertex(cols - 1 - c, 0)));
  edge(Array.from({ length: rows }, (_, r) => vertex(0, r)));
  const wallGeometry = own(new BufferGeometry());
  wallGeometry.setAttribute('position', new BufferAttribute(Float32Array.from(wallPositions), 3));
  wallGeometry.setAttribute('color', new BufferAttribute(Float32Array.from(wallColors), 3));
  wallGeometry.computeVertexNormals();
  const wallMaterial = own(
    new MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 }),
  );
  const walls = new Mesh(wallGeometry, wallMaterial);
  walls.castShadow = true;
  walls.receiveShadow = true;

  // ---- Contours -------------------------------------------------------------------------------
  const block = new Group();
  block.add(ground, walls);
  if (t.interval > 0) {
    const levels = contourLevels(field.min, field.max, t.interval);
    const segments = contourSegments(field, levels);
    const minor = [];
    const major = [];
    for (let i = 0; i < segments.length; i += 5) {
      const level = levels[segments[i + 4]];
      const y = yOf(level);
      const list = isIndexLevel(level, t.interval) ? major : minor;
      list.push(
        (segments[i] - 0.5) * W,
        y,
        (segments[i + 1] - 0.5) * D,
        (segments[i + 2] - 0.5) * W,
        y,
        (segments[i + 3] - 0.5) * D,
      );
    }
    for (const [list, opacity] of [
      [minor, 0.26],
      [major, 0.55],
    ]) {
      if (list.length === 0) continue;
      const geometry = own(new BufferGeometry());
      geometry.setAttribute('position', new BufferAttribute(Float32Array.from(list), 3));
      const material = own(
        new LineBasicMaterial({
          color: 0x1b1712,
          transparent: true,
          opacity,
          depthWrite: false,
        }),
      );
      block.add(new LineSegments(geometry, material));
    }
  }

  // ---- Places ---------------------------------------------------------------------------------
  const marks = (t.marks || []).map((spec, i) => {
    const [u, v] = spec.at;
    const h = sample(field, u, v);
    return {
      spec,
      index: i,
      ground: new Vector3((u - 0.5) * W, yOf(h), (v - 0.5) * D),
    };
  });
  const ink = getComputedStyle(el).getPropertyValue('--ak-color-text').trim();
  if (marks.length > 0) {
    const stems = [];
    for (const m of marks)
      stems.push(m.ground.x, m.ground.y, m.ground.z, m.ground.x, m.ground.y + PIN_LIFT, m.ground.z);
    const geometry = own(new BufferGeometry());
    geometry.setAttribute('position', new BufferAttribute(Float32Array.from(stems), 3));
    const color = new Color(0x222222);
    try {
      if (ink) color.setStyle(ink);
    } catch (_error) {
      // Keep the fallback ink.
    }
    const material = own(new LineBasicMaterial({ color, transparent: true, opacity: 0.85 }));
    block.add(new LineSegments(geometry, material));
  }
  scene.add(block);
  scene.environmentIntensity = 0.7;

  // Pins over the canvas track their places; the place list is the keyboard path.
  const pinLayer = document.createElement('div');
  pinLayer.className = 'ak-3d-pins';
  stage.appendChild(pinLayer);
  for (const mark of marks) {
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.tabIndex = -1;
    pin.className = 'ak-3d-pin';
    pin.textContent = String(mark.index + 1);
    pin.setAttribute('data-tone', mark.spec.tone || 'accent');
    pin.setAttribute('aria-label', `${mark.spec.label}, ${mark.spec.elevation}`);
    pin.setAttribute('data-ak-terrain-pin', mark.spec.id);
    pinLayer.appendChild(pin);
    mark.pin = pin;
    on(pin, 'click', () => choose(mark.spec.id, true));
  }
  const tag = document.createElement('div');
  tag.className = 'ak-tr-tag';
  tag.hidden = true;
  tag.setAttribute('aria-hidden', 'true');
  stage.appendChild(tag);
  const listButtons = [...el.querySelectorAll('[data-ak-terrain-mark]')];
  for (const button of listButtons) {
    button.disabled = false;
    on(button, 'click', () => choose(button.getAttribute('data-ak-terrain-mark'), true));
  }

  // ---- Camera ---------------------------------------------------------------------------------
  const corners = blockCorners({ extent: t.extent }, top);
  const home = {
    position: new Vector3(...config.camera.position),
    target: new Vector3(...config.camera.target),
  };
  const homeDistance = () => home.position.distanceTo(home.target);
  const reach = Math.hypot(W, D) / 2;
  function fitFog(distance) {
    if (!scene.fog) return;
    scene.fog.near = distance + reach * 0.6;
    scene.fog.far = distance + reach * 5;
  }
  /** A close-up of a place, swung round from the home bearing by `turn` radians and lowered. */
  function viewOf(mark, turn = 0) {
    const target = mark.ground.clone();
    target.y += PIN_LIFT * 0.4;
    const dir = new Vector3(...HOME_BEARING);
    dir.applyAxisAngle(new Vector3(0, 1, 0), turn);
    dir.y *= 0.72;
    dir.normalize();
    return { position: target.clone().addScaledVector(dir, homeDistance() * CLOSE), target };
  }
  /** Flyover stops: each place in order, else four bearings round the block; then home. */
  const stops =
    marks.length > 0
      ? marks.map((m, i) => () => viewOf(m, (i % 2 === 0 ? 1 : -1) * 0.35))
      : [0.9, 1.8, 2.7, 3.6].map((turn) => () => {
          const dir = new Vector3(...HOME_BEARING).applyAxisAngle(new Vector3(0, 1, 0), turn);
          dir.y *= 0.85;
          dir.normalize();
          return {
            position: home.target.clone().addScaledVector(dir, homeDistance() * 0.82),
            target: home.target.clone(),
          };
        });

  let flight = null;
  function flyTo(view, duration) {
    if (!view) return;
    if (!motion) {
      camera.position.copy(view.position);
      ctx.target.copy(view.target);
      camera.lookAt(ctx.target);
      ctx.oriented();
      ctx.requestRender();
      return;
    }
    flight = {
      fromTarget: ctx.target.clone(),
      fromOffset: camera.position.clone().sub(ctx.target),
      toTarget: view.target,
      toOffset: view.position.clone().sub(view.target),
      elapsed: 0,
      duration,
    };
    ctx.animate();
  }
  function stepFlight(dt) {
    if (!flight) return false;
    flight.elapsed += dt;
    const p = Math.min(1, flight.elapsed / flight.duration);
    const e = ease(p);
    ctx.target.copy(flight.fromTarget).lerp(flight.toTarget, e);
    // Swing the bearing and the distance separately, so the camera arcs instead of cutting through.
    const fromLength = flight.fromOffset.length();
    const toLength = flight.toOffset.length();
    const dir = flight.fromOffset
      .clone()
      .normalize()
      .lerp(flight.toOffset.clone().normalize(), e)
      .normalize();
    // A long leg lifts a little mid-way, so the camera clears the ground it crosses.
    const lift = 1 + 0.18 * Math.sin(Math.PI * p) * (flight.duration >= FLY_MS ? 1 : 0.4);
    camera.position
      .copy(ctx.target)
      .addScaledVector(dir, (fromLength + (toLength - fromLength) * e) * lift);
    camera.lookAt(ctx.target);
    ctx.oriented();
    if (p >= 1) flight = null;
    return p < 1;
  }

  // ---- Flyover --------------------------------------------------------------------------------
  const flyover = motion && t.flyover !== false;
  let paused = !flyover;
  /** Where the tour is: the stop it holds or flies to; `stops.length` is home. */
  let leg = stops.length;
  let holding = 0;
  const pause = document.createElement('button');
  pause.type = 'button';
  pause.className = 'ak-tr-pause';
  function labelPause() {
    pause.textContent = paused ? 'Play' : 'Pause';
    pause.setAttribute('aria-pressed', paused ? 'true' : 'false');
    pause.setAttribute('aria-label', paused ? 'Play the flyover' : 'Pause the flyover');
  }
  if (flyover) {
    labelPause();
    stage.appendChild(pause);
    on(pause, 'click', () => setPaused(!paused));
  }
  function setPaused(value) {
    if (!flyover) return;
    paused = value;
    if (paused) flight = null;
    else {
      // Resume from where the camera stands: on to the next stop.
      leg = (leg + 1) % (stops.length + 1);
      flyTo(
        leg === stops.length
          ? { position: home.position.clone(), target: home.target.clone() }
          : stops[leg](),
        FLY_MS,
      );
      holding = 0;
    }
    labelPause();
    if (!paused) ctx.animate();
    else ctx.requestRender();
  }
  function stepTour(dt) {
    if (paused || flight) return !paused;
    holding += dt;
    // While holding, drift slowly round the place.
    const offset = camera.position.clone().sub(ctx.target);
    offset.applyAxisAngle(new Vector3(0, 1, 0), Math.min(dt, 50) * DRIFT);
    camera.position.copy(ctx.target).add(offset);
    camera.lookAt(ctx.target);
    ctx.oriented();
    if (holding >= HOLD_MS) {
      holding = 0;
      leg = (leg + 1) % (stops.length + 1);
      flyTo(
        leg === stops.length
          ? { position: home.position.clone(), target: home.target.clone() }
          : stops[leg](),
        FLY_MS,
      );
    }
    return true;
  }
  /** The reader took over: the tour stops where it is. */
  function stopTour() {
    if (!flyover || paused) return;
    paused = true;
    labelPause();
  }

  // ---- Selection ------------------------------------------------------------------------------
  let selected = null;
  let bound = t.bind ? api.readPath(t.bind) : undefined;
  const byId = new Map(marks.map((m) => [m.spec.id, m]));
  function mark(id) {
    selected = id;
    for (const button of listButtons)
      button.setAttribute(
        'aria-pressed',
        button.getAttribute('data-ak-terrain-mark') === id ? 'true' : 'false',
      );
    for (const m of marks) m.pin.setAttribute('aria-pressed', m.spec.id === id ? 'true' : 'false');
    const chosen = id ? byId.get(id) : null;
    tag.textContent = '';
    if (chosen) {
      const name = document.createElement('b');
      name.textContent = chosen.spec.label;
      const height = document.createElement('span');
      height.textContent = chosen.spec.elevation;
      tag.append(name, height);
    }
    el.querySelector('.ak-3d-canvas')?.setAttribute(
      'aria-description',
      chosen ? `Selected: ${chosen.spec.label}, ${chosen.spec.elevation}` : '',
    );
  }
  function choose(id, user) {
    const m = byId.get(id);
    if (!m) return;
    stopTour();
    mark(id);
    if (user) {
      bound = id;
      api.fire(el, 'select', { value: id });
      if (t.bind) api.setPath(t.bind, id);
    }
    flyTo(viewOf(m), PICK_MS);
    ctx.requestRender();
  }
  function reset() {
    stopTour();
    mark(null);
    if (t.bind && bound !== '') {
      bound = '';
      api.setPath(t.bind, '');
    }
    flyTo({ position: home.position.clone(), target: home.target.clone() }, PICK_MS);
    ctx.requestRender();
  }
  mark(null);

  // ---- Rise -----------------------------------------------------------------------------------
  let rise = motion ? 0 : 1;
  function applyRise() {
    block.scale.y = 0.04 + 0.96 * easeOut(rise);
  }
  applyRise();

  // ---- Pins -----------------------------------------------------------------------------------
  const projected = new Vector3();
  const head = new Vector3();
  const probe = new Vector3();
  /** True when ground lies between the camera and this point: a march over the heightfield. */
  function hidden(point) {
    const toEye = camera.position.clone().sub(point);
    const length = toEye.length();
    toEye.divideScalar(length);
    const steps = 40;
    const scaleY = block.scale.y;
    for (let i = 1; i <= steps; i += 1) {
      probe.copy(point).addScaledVector(toEye, (length * i) / steps);
      const u = probe.x / W + 0.5;
      const v = probe.z / D + 0.5;
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      if (probe.y < yOf(sample(field, u, v)) * scaleY - 0.004) return true;
      if (probe.y > top * scaleY) break;
    }
    return false;
  }
  function placePins() {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (!width || !height) return;
    camera.updateMatrixWorld();
    const scaleY = block.scale.y;
    for (const m of marks) {
      head.copy(m.ground);
      head.y = (head.y + PIN_LIFT) * scaleY;
      projected.copy(head).project(camera);
      m.x = ((projected.x + 1) / 2) * width;
      m.y = ((1 - projected.y) / 2) * height;
      m.shown =
        projected.z < 1 &&
        m.x >= PIN_RADIUS &&
        m.x <= width - PIN_RADIUS &&
        m.y >= PIN_RADIUS &&
        m.y <= height - PIN_RADIUS;
      m.back = m.shown && hidden(head);
      m.pin.hidden = !m.shown;
      if (m.back) m.pin.setAttribute('data-ak-back', '');
      else m.pin.removeAttribute('data-ak-back');
      if (m.shown) m.pin.style.transform = `translate(${m.x.toFixed(1)}px,${m.y.toFixed(1)}px)`;
    }
    const chosen = selected ? byId.get(selected) : null;
    tag.hidden = !chosen?.shown;
    if (chosen?.shown) {
      // The tag sits right of its pin, or left of it near the stage's right edge.
      const right = chosen.x + 20 + tag.offsetWidth < width - 8;
      const x = right ? chosen.x + 20 : chosen.x - 20 - tag.offsetWidth;
      tag.style.transform = `translate(${x.toFixed(1)}px,${(chosen.y - tag.offsetHeight / 2).toFixed(1)}px)`;
    }
  }

  /** The frozen frame with the numbered pins painted in, so print and export keep them. */
  function annotate(canvas) {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (!width || !height || marks.length === 0) return null;
    placePins();
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const g = copy.getContext('2d');
    if (!g) return null;
    g.drawImage(canvas, 0, 0);
    g.scale(canvas.width / width, canvas.height / height);
    for (const m of marks) {
      if (!m.shown) continue;
      const style = getComputedStyle(m.pin);
      g.globalAlpha = m.back ? 0.45 : 1;
      g.beginPath();
      g.arc(m.x, m.y, 13, 0, Math.PI * 2);
      g.fillStyle = style.backgroundColor;
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = style.borderTopColor;
      g.stroke();
      g.fillStyle = style.color;
      g.font = `700 12px ${style.fontFamily}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(m.index + 1), m.x, m.y + 0.5);
    }
    g.globalAlpha = 1;
    return copy;
  }

  // ---- Lifecycle ------------------------------------------------------------------------------
  let last = 0;
  let initial = typeof t.selected === 'string' ? t.selected : null;
  if (initial) stopTour();
  return {
    /** Advance the rise, any flight and the tour; true while anything still moves. */
    tick(now) {
      const dt = last ? Math.min(now - last, 50) : 0;
      let moving = false;
      if (rise < 1) {
        rise = Math.min(1, rise + dt / RISE_MS);
        applyRise();
        moving = true;
      }
      if (stepFlight(dt)) moving = true;
      if (stepTour(dt)) moving = true;
      placePins();
      last = moving ? now : 0;
      return moving;
    },
    settle() {
      rise = 1;
      applyRise();
      if (flight) {
        ctx.target.copy(flight.toTarget);
        camera.position.copy(flight.toTarget).add(flight.toOffset);
        camera.lookAt(ctx.target);
        ctx.oriented();
        flight = null;
      }
      paused = true;
      if (flyover) labelPause();
      placePins();
    },
    annotate,
    /** Home framing at this stage aspect: the block fills the frame along the compiled bearing. */
    frame(aspect) {
      const fit = fitCamera(corners, HOME_BEARING, aspect);
      home.position.set(...fit.position);
      home.target.set(...fit.target);
      fitFog(homeDistance());
      if (initial) {
        const id = initial;
        initial = null;
        queueMicrotask(() => choose(id, false));
      }
      return fit;
    },
    sync() {
      if (!t.bind) return;
      const value = api.readPath(t.bind);
      if (value === bound) return;
      bound = value;
      if (typeof value === 'string' && byId.has(value)) choose(value, false);
      // A value that names no place (empty, or an overview option) flies home.
      else if (selected) {
        mark(null);
        flyTo({ position: home.position.clone(), target: home.target.clone() }, PICK_MS);
      }
    },
    /** Canvas keys: Enter, space and n/p cycle places; Home, 0 and Escape fly home. */
    key(event) {
      if (event.ctrlKey || event.metaKey || event.altKey) return false;
      const key = event.key;
      if ((key === 'Enter' || key === ' ' || key === 'n' || key === 'p') && marks.length > 0) {
        const order = marks.map((m) => m.spec.id);
        const at = order.indexOf(selected);
        const step = key === 'p' ? -1 : 1;
        choose(order[(at + step + order.length) % order.length], true);
        return true;
      }
      if (key === 'Home' || key === '0' || key === 'Escape') {
        reset();
        return true;
      }
      return false;
    },
    /** The reader took the camera: stop any flight and the tour where they are. */
    interrupt() {
      flight = null;
      stopTour();
    },
    dispose() {
      for (const [target, type, handler] of listeners) target.removeEventListener(type, handler);
      for (const button of listButtons) button.disabled = true;
      scene.remove(block);
      for (const resource of owned) resource.dispose();
      pinLayer.remove();
      tag.remove();
      pause.remove();
    },
  };
}
