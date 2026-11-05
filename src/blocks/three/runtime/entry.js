/**
 * The shared 3D runtime, bundled with a pinned Three.js into
 * `three-runtime.generated.ts` by `scripts/generate-three-runtime.mjs`.
 *
 * One renderer loop, one geometry cache, one resource lifecycle for every 3D
 * block on the page. A scene is built only from the validated config the
 * compiler emitted; nothing here evaluates author input as code.
 *
 * The page runtime passes its own helpers (state, setPath, fire, motion) to
 * `boot`, so 3D selection takes the same closed `set-value` path as any control.
 */

import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  BoxGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  MathUtils,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  PointLight,
  Raycaster,
  Scene,
  ShadowMaterial,
  Sphere,
  SphereGeometry,
  TorusGeometry,
  TorusKnotGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { barsWidget } from './bars.js';
import { mountGlobe } from './globe.js';
import { mountModel } from './model.js';
import { liveMorphResources, morphValid, morphWidget } from './morph.js';
import { mountNetwork } from './network.js';
import { liveParticleResources, mountParticles } from './particles.js';
import { productWidget } from './product.js';
import { mountScatter } from './scatter.js';
import { liveShaderResources, mountShader } from './shader.js';
import { liveTextResources, mountText } from './text.js';
import { liveTimelineResources, timelineWidget } from './timeline.js';

/** Data widgets that add marks and transitions on top of the shared scene, by `data-ak-3d` kind. */
const SCENE_WIDGETS = {
  bars: barsWidget,
  product: productWidget,
  morph: morphWidget,
  timeline: timelineWidget,
};

const TONE_VARS = {
  accent: '--ak-color-accent',
  neutral: '--ak-color-text-muted',
  success: '--ak-color-success',
  warning: '--ak-color-warning',
  danger: '--ak-color-danger',
  info: '--ak-color-info',
};

/** Light rig presets: the compiler owns lighting, a spec only names the mood. */
const RIGS = {
  studio: [
    { kind: 'hemisphere', intensity: 0.5 },
    { kind: 'directional', intensity: 2.4, position: [5, 8, 6] },
    { kind: 'directional', intensity: 0.5, position: [-6, 3, 4] },
    { kind: 'rim', intensity: 1.6, position: [-3, 5, -8] },
  ],
  soft: [
    { kind: 'hemisphere', intensity: 0.9 },
    { kind: 'rim', intensity: 0.8, position: [-3, 5, -8] },
    { kind: 'directional', intensity: 0.9, position: [3, 10, 4] },
  ],
  dramatic: [
    { kind: 'ambient', intensity: 0.15 },
    { kind: 'directional', intensity: 3.2, position: [-6, 7, 3] },
    { kind: 'point', intensity: 1.2, position: [4, 2, -4], color: 0xffb070 },
    { kind: 'rim', intensity: 2.2, position: [2, 4, -8], color: 0xffd0a0 },
  ],
  night: [
    { kind: 'ambient', intensity: 0.25, color: 0x8090ff },
    { kind: 'directional', intensity: 1.0, position: [2, 9, 5], color: 0xb0c0ff },
    { kind: 'point', intensity: 1.6, position: [0, 3, 0], color: 0x80a0ff },
  ],
};

/** Shared geometry: one instance per shape and size across all scenes. */
const geometries = new Map();
function geometryFor(shape, size) {
  const key = `${shape}:${size}`;
  let geometry = geometries.get(key);
  if (geometry) {
    geometry.userData.refs += 1;
    return geometry;
  }
  const s = size;
  if (shape === 'sphere') geometry = new SphereGeometry(s / 2, 48, 24);
  else if (shape === 'cylinder') geometry = new CylinderGeometry(s / 2, s / 2, s, 48);
  else if (shape === 'cone') geometry = new ConeGeometry(s / 2, s, 48);
  else if (shape === 'torus') geometry = new TorusGeometry(s / 2, s / 6, 24, 64);
  else if (shape === 'torus-knot') geometry = new TorusKnotGeometry(s / 3, s / 10, 128, 16);
  else if (shape === 'plane') geometry = new PlaneGeometry(s, s);
  else if (shape === 'icosahedron') geometry = new IcosahedronGeometry(s / 2, 0);
  else if (shape === 'rounded-box') geometry = new RoundedBoxGeometry(s, s, s, 6, s * 0.14);
  // A capsule is as tall as its size and half as wide.
  else if (shape === 'capsule') geometry = new CapsuleGeometry(s / 4, s / 2, 12, 32);
  else geometry = new BoxGeometry(s, s, s);
  geometry.userData.refs = 1;
  geometry.userData.key = key;
  geometries.set(key, geometry);
  return geometry;
}
function releaseGeometry(geometry) {
  geometry.userData.refs -= 1;
  if (geometry.userData.refs <= 0) {
    geometries.delete(geometry.userData.key);
    geometry.dispose();
  }
}

function toneColor(el, tone) {
  const raw = getComputedStyle(el)
    .getPropertyValue(TONE_VARS[tone] || TONE_VARS.accent)
    .trim();
  const color = new Color();
  try {
    color.setStyle(raw || '#6b7cff');
  } catch (_error) {
    color.set('#6b7cff');
  }
  return color;
}

function cssColor(el, name, fallback) {
  const color = new Color(fallback);
  const raw = getComputedStyle(el).getPropertyValue(name).trim();
  try {
    if (raw) color.setStyle(raw);
  } catch (_error) {
    // Keep the fallback.
  }
  return color;
}

function isDark(el) {
  const hsl = cssColor(el, '--ak-color-background', '#ffffff').getHSL({ h: 0, s: 0, l: 0 });
  return hsl.l < 0.4;
}

/** Shadow tinted with the theme's ink, so it takes the page's warmth instead of neutral grey. */
function shadowMaterial(el) {
  const dark = isDark(el);
  const ink = cssColor(el, '--ak-color-text', '#222222');
  const tint = dark
    ? new Color(0x000000)
    : ink.clone().lerp(cssColor(el, '--ak-color-accent', '#886622'), 0.25);
  return new ShadowMaterial({ color: tint, opacity: dark ? 0.5 : 0.2 });
}

function materialFor(kind, color) {
  if (kind === 'glass') {
    return new MeshPhysicalMaterial({
      color,
      roughness: 0.05,
      transmission: 0.9,
      thickness: 0.5,
      transparent: true,
      opacity: 0.6,
    });
  }
  if (kind === 'metal')
    return new MeshStandardMaterial({
      color,
      metalness: 0.85,
      roughness: 0.32,
      envMapIntensity: 1.6,
    });
  if (kind === 'matte') return new MeshStandardMaterial({ color, metalness: 0, roughness: 0.95 });
  if (kind === 'wireframe') return new MeshStandardMaterial({ color, wireframe: true });
  if (kind === 'emissive')
    return new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8 });
  return new MeshStandardMaterial({ color, metalness: 0.1, roughness: 0.55 });
}

/** Render durations each scene keeps for the benchmark; a fixed ring. */
const RENDER_SAMPLES = 240;

/** Low on coarse-pointer or few-core devices: lower pixel ratio, no shadows. */
function qualityProfile() {
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency || 4;
  const forced = document.documentElement.getAttribute('data-ak-3d-quality');
  if (forced === 'low' || forced === 'high') return forced;
  return coarse || cores <= 4 ? 'low' : 'high';
}

/** A validated [x, y, z], or null: an omitted vector normalizes to an empty list. */
function trio(value) {
  return Array.isArray(value) && value.length === 3 ? value : null;
}
function v3(value, fallback) {
  const t = trio(value);
  return t ? new Vector3(t[0], t[1], t[2]) : fallback.clone();
}

const mounts = new Set();
let frameRequest = 0;
let api = null;

function loop(now) {
  frameRequest = 0;
  let active = false;
  for (const mount of mounts) {
    if (mount.visible && !mount.lost) {
      mount.tick(now);
      if (mount.animating) active = true;
    }
  }
  if (active) frameRequest = requestAnimationFrame(loop);
}
function schedule() {
  if (!frameRequest) frameRequest = requestAnimationFrame(loop);
}

function webgl2Available(canvas) {
  try {
    return Boolean(canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: true }));
  } catch (_error) {
    return false;
  }
}

function mount(el) {
  let config;
  try {
    config = JSON.parse(el.getAttribute('data-ak-scene') || '{}');
  } catch (_error) {
    el.setAttribute('data-ak-3d-state', 'error');
    return null;
  }
  // A morph whose targets cannot share one surface keeps its drawing and says so.
  if (el.getAttribute('data-ak-3d') === 'morph' && !morphValid(config)) {
    el.setAttribute('data-ak-3d-state', 'error');
    return null;
  }
  const stage = el.querySelector('.ak-3d-stage');
  const canvas = document.createElement('canvas');
  canvas.className = 'ak-3d-canvas';
  if (!stage || !webgl2Available(canvas)) {
    el.setAttribute('data-ak-3d-state', 'unsupported');
    return null;
  }
  const quality = qualityProfile();
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
  canvas.setAttribute('aria-label', el.querySelector('.ak-3d-caption')?.textContent || '3D scene');
  stage.appendChild(canvas);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : 1));
  renderer.shadowMap.enabled = quality === 'high';
  renderer.shadowMap.type = PCFShadowMap;
  renderer.toneMapping = ACESFilmicToneMapping;
  // Dark themes carry pastel tones; less exposure keeps their faces apart instead of washing out.
  renderer.toneMappingExposure = isDark(el) ? 0.8 : 1;

  const scene = new Scene();
  // A generated studio environment: metal and glass reflect something, with no asset to load.
  const pmrem = new PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = environment;
  scene.environmentIntensity = 0.55;
  const cfgCamera = config.camera || {};
  const camera = new PerspectiveCamera(cfgCamera.fov || 30, 16 / 9, 0.05, 5000);
  const home = {
    position: v3(cfgCamera.position, new Vector3(4, 3, 6)),
    target: v3(cfgCamera.target, new Vector3()),
  };
  camera.position.copy(home.position);
  const target = home.target.clone();
  camera.lookAt(target);

  const rig = RIGS[config.lighting] || RIGS.studio;
  let keyLight = null;
  for (const spec of rig) {
    const color = new Color(spec.color || 0xffffff);
    const intensity = typeof spec.intensity === 'number' ? spec.intensity : 1;
    let light;
    if (spec.kind === 'ambient') light = new AmbientLight(color, intensity);
    else if (spec.kind === 'hemisphere')
      light = new HemisphereLight(color, toneColor(el, 'neutral'), intensity);
    else if (spec.kind === 'point') light = new PointLight(color, intensity * 20);
    // A rim light sits behind the subject and separates it from the stage.
    else light = new DirectionalLight(color, intensity);
    if (trio(spec.position)) light.position.set(...spec.position);
    // The first directional light is the key light and the only shadow caster.
    if (spec.kind === 'directional' && renderer.shadowMap.enabled && !keyLight) {
      keyLight = light;
      light.castShadow = true;
    }
    scene.add(light);
  }

  const nodes = new Map();
  const pickable = [];
  const owned = { materials: [], geometries: [] };
  let ground = false;
  for (const spec of config.objects || []) {
    let object;
    if (spec.shape === 'group') object = new Group();
    else {
      const geometry = geometryFor(spec.shape || 'box', spec.size || 1);
      // A neutral plane is the floor: it shows only the shadows cast on it, so the
      // subject sits on the stage's own light instead of a hard-edged slab.
      const isGround = spec.shape === 'plane' && (spec.tone || 'accent') === 'neutral';
      if (isGround) ground = true;
      const material = isGround
        ? shadowMaterial(el)
        : materialFor(spec.material || 'standard', toneColor(el, spec.tone || 'accent'));
      owned.geometries.push(geometry);
      owned.materials.push(material);
      object = new Mesh(geometry, material);
      object.castShadow = renderer.shadowMap.enabled;
      object.receiveShadow = renderer.shadowMap.enabled;
      // Matches the compiler's rule: a plane is ground or backdrop, never a pick target.
      if (spec.shape !== 'plane') pickable.push(object);
    }
    object.name = spec.id;
    object.userData.id = spec.id;
    if (trio(spec.position)) object.position.set(...spec.position);
    if (trio(spec.rotation)) {
      object.rotation.set(
        MathUtils.degToRad(spec.rotation[0]),
        MathUtils.degToRad(spec.rotation[1]),
        MathUtils.degToRad(spec.rotation[2]),
      );
    }
    if (trio(spec.scale)) object.scale.set(...spec.scale);
    nodes.set(spec.id, { object, spec });
  }
  for (const [, { object, spec }] of nodes) {
    const parent = spec.parent && nodes.get(spec.parent);
    (parent ? parent.object : scene).add(object);
  }

  // Stage the subject: a soft shadow catcher under it, fog toward the page
  // background, and the key light's shadow camera fitted to the scene.
  const bounds = new Box3().setFromObject(scene);
  const sphere = bounds.isEmpty()
    ? new Sphere(new Vector3(), 2)
    : bounds.getBoundingSphere(new Sphere());
  const radius = Math.max(sphere.radius, 0.5);
  const dark = isDark(el);
  const catcher = new Mesh(geometryFor('plane', 1), shadowMaterial(el));
  owned.geometries.push(catcher.geometry);
  owned.materials.push(catcher.material);
  catcher.rotation.x = -Math.PI / 2;
  catcher.scale.setScalar(radius * 10);
  catcher.position.set(
    sphere.center.x,
    bounds.isEmpty() ? 0 : bounds.min.y - 0.002,
    sphere.center.z,
  );
  catcher.receiveShadow = renderer.shadowMap.enabled;
  if (!ground) scene.add(catcher);
  scene.fog = new Fog(cssColor(el, '--ak-color-background', '#ffffff'), radius * 2.6, radius * 6);
  if (keyLight) {
    const direction = keyLight.position.clone().normalize();
    keyLight.position.copy(sphere.center).addScaledVector(direction, radius * 3);
    keyLight.target.position.copy(sphere.center);
    scene.add(keyLight.target);
    const shadow = keyLight.shadow;
    shadow.mapSize.set(2048, 2048);
    shadow.camera.left = -radius * 1.4;
    shadow.camera.right = radius * 1.4;
    shadow.camera.top = radius * 1.4;
    shadow.camera.bottom = -radius * 1.4;
    shadow.camera.near = radius * 0.5;
    shadow.camera.far = radius * 6;
    shadow.camera.updateProjectionMatrix();
    shadow.bias = -0.0004;
    shadow.normalBias = 0.02;
    // PCF honours radius: a wide penumbra so shadows settle into the stage, not stick to it.
    shadow.radius = 9;
    shadow.blurSamples = 16;
  }
  for (const light of scene.children) {
    if (light.isDirectionalLight && light !== keyLight) {
      light.position
        .copy(sphere.center)
        .addScaledVector(light.position.clone().normalize(), radius * 3);
    }
  }

  const motion = api.motionAllowed();
  const tweens = (config.timeline || [])
    .map((t) => {
      const node = nodes.get(t.target);
      if (!node) return null;
      const prop = node.object[t.property];
      const from = new Vector3(prop.x, prop.y, prop.z);
      const to = new Vector3(t.to[0], t.to[1], t.to[2]);
      if (t.property === 'rotation') to.multiplyScalar(Math.PI / 180);
      // Rotation spins on from where it started; position and scale ease back and forth.
      return {
        prop,
        from,
        to,
        duration: t.duration || 2000,
        loop: t.property === 'rotation' ? 'repeat' : 'alternate',
      };
    })
    .filter(Boolean);
  const widget =
    SCENE_WIDGETS[el.getAttribute('data-ak-3d')]?.({
      el,
      config,
      scene,
      nodes,
      camera,
      target,
      motion,
      api,
      requestRender: () => requestRender(),
      /** The widget moved the camera: orbit continues from where it now stands. */
      oriented: () => readSpherical(),
      animate() {
        record.animating = true;
        schedule();
      },
    }) || null;

  let selected = null;
  const buttons = Array.prototype.slice.call(el.querySelectorAll('[data-ak-3d-pick]'));
  function highlight(id) {
    selected = id;
    for (const [nodeId, { object }] of nodes) {
      const material = object.material;
      if (!material?.emissive) continue;
      if (!object.userData.base) {
        object.userData.base = {
          emissive: material.emissive.clone(),
          intensity: material.emissiveIntensity,
        };
      }
      if (nodeId === id) {
        material.emissive.copy(material.color);
        material.emissiveIntensity = 0.55;
      } else {
        material.emissive.copy(object.userData.base.emissive);
        material.emissiveIntensity = object.userData.base.intensity;
      }
    }
    for (const button of buttons)
      button.setAttribute(
        'aria-pressed',
        button.getAttribute('data-ak-3d-pick') === id ? 'true' : 'false',
      );
    canvas.setAttribute(
      'aria-description',
      id ? `Selected: ${nodes.get(id)?.spec.label || id}` : '',
    );
    requestRender();
  }
  function select(id) {
    // A widget with its own selection (hotspots, not parts) takes the pick.
    if (widget?.pick) {
      widget.pick(id);
      return;
    }
    if (!nodes.has(id) || id === selected) return;
    highlight(id);
    api.fire(el, 'select', { value: id });
    if (config.bind) api.setPath(config.bind, id);
  }

  const onButton = (event) => select(event.currentTarget.getAttribute('data-ak-3d-pick'));
  for (const button of buttons) {
    button.disabled = false;
    button.addEventListener('click', onButton);
  }

  // Orbit: drag rotates around the target, wheel and pinch zoom, keys orbit and cycle selection.
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const spherical = { r: 0, theta: 0, phi: 0 };
  function readSpherical() {
    const offset = camera.position.clone().sub(target);
    spherical.r = offset.length();
    spherical.theta = Math.atan2(offset.x, offset.z);
    spherical.phi = Math.acos(MathUtils.clamp(offset.y / spherical.r, -1, 1));
  }
  function applySpherical() {
    spherical.phi = MathUtils.clamp(spherical.phi, 0.1, Math.PI - 0.1);
    spherical.r = MathUtils.clamp(spherical.r, 0.5, 2000);
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
  const pointers = new Map();
  let downAt = null;
  let pinch = 0;
  const onPointerDown = (event) => {
    widget?.interrupt?.();
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
    if (!last) return;
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
    if (downAt && Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) < 6) {
      const rect = canvas.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(pickable, false).find((h) => h.object.visible);
      if (hit) select(hit.object.userData.id);
    }
    downAt = null;
  };
  const onWheel = (event) => {
    event.preventDefault();
    spherical.r *= event.deltaY > 0 ? 1.1 : 0.9;
    applySpherical();
  };
  const onKey = (event) => {
    if (widget?.key?.(event)) {
      event.preventDefault();
      return;
    }
    // Browser and system shortcuts pass through untouched.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key;
    if (key === 'ArrowLeft') spherical.theta -= 0.15;
    else if (key === 'ArrowRight') spherical.theta += 0.15;
    else if (key === 'ArrowUp') spherical.phi -= 0.15;
    else if (key === 'ArrowDown') spherical.phi += 0.15;
    else if (key === '+' || key === '=') spherical.r *= 0.9;
    else if (key === '-') spherical.r *= 1.1;
    else if (key === 'Enter' || key === ' ' || key === 'n' || key === 'p') {
      // Bars a filter hid are skipped, as they are for the pointer.
      const order = pickable.filter((object) => object.visible).map((object) => object.userData.id);
      if (!order.length) return;
      const at = order.indexOf(selected);
      const step = key === 'p' ? -1 : 1;
      select(order[(at + step + order.length) % order.length]);
      event.preventDefault();
      return;
    } else return;
    event.preventDefault();
    applySpherical();
  };
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('keydown', onKey);

  function resize() {
    const width = stage.clientWidth || 640;
    const height = stage.clientHeight || 360;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    frameWidget();
    requestRender();
  }
  // A data widget reframes for each stage aspect until the reader moves the camera.
  let framedAt = null;
  function frameWidget() {
    const fit = widget?.frame?.(camera.aspect);
    if (!fit || (framedAt && camera.position.distanceToSquared(framedAt) > 1e-6)) return;
    camera.position.set(...fit.position);
    target.set(...fit.target);
    camera.lookAt(target);
    home.position.copy(camera.position);
    home.target.copy(target);
    readSpherical();
    framedAt = camera.position.clone();
  }
  const resizeObserver = window.ResizeObserver ? new ResizeObserver(resize) : null;
  resizeObserver?.observe(stage);

  let view = null;
  function applyView(value) {
    const match = (config.views || []).find((v) => v.value === value);
    if (!match || match === view) return;
    view = match;
    if (trio(match.camera?.position)) camera.position.set(...match.camera.position);
    target.copy(v3(match.camera?.target, home.target));
    camera.lookAt(target);
    readSpherical();
    if (match.focus) highlight(match.focus);
    requestRender();
  }

  const record = {
    el,
    visible: true,
    lost: false,
    animating: motion && (tweens.length > 0 || widget !== null),
    started: 0,
    frames: 0,
    /** The most recent render durations, for the benchmark; a fixed ring. */
    renderMs: [],
    tick(now) {
      if (!record.started) record.started = now;
      const elapsed = now - record.started;
      if (motion) {
        for (const t of tweens) {
          let k = elapsed / t.duration;
          if (t.loop === 'none') k = Math.min(1, k);
          else if (t.loop === 'repeat') k %= 1;
          else k = 1 - Math.abs((k % 2) - 1);
          const eased = k * k * (3 - 2 * k);
          t.prop.set(
            t.from.x + (t.to.x - t.from.x) * eased,
            t.from.y + (t.to.y - t.from.y) * eased,
            t.from.z + (t.to.z - t.from.z) * eased,
          );
        }
      }
      if (widget && !widget.tick(now) && !(motion && tweens.length > 0)) record.animating = false;
      const begin = performance.now();
      renderer.render(scene, camera);
      record.renderMs.push(performance.now() - begin);
      if (record.renderMs.length > RENDER_SAMPLES) record.renderMs.shift();
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
    /** Stop motion and pin the current frame as an image, so print and export carry the live scene. */
    freeze() {
      if (record.lost || record.frames === 0) return null;
      const frozen = stage.querySelector('.ak-3d-frame');
      if (frozen) return { width: canvas.width, height: canvas.height };
      record.animating = false;
      widget?.settle();
      renderer.render(scene, camera);
      const frame = document.createElement('img');
      frame.className = 'ak-3d-frame';
      frame.alt = '';
      frame.src = (widget?.annotate?.(canvas) || canvas).toDataURL('image/png');
      canvas.after(frame);
      el.setAttribute('data-ak-3d-state', 'frozen');
      return { width: canvas.width, height: canvas.height };
    },
    sync() {
      widget?.sync();
      if (config.bind) {
        const value = api.readPath(config.bind);
        if (typeof value === 'string' && value !== selected && nodes.has(value)) highlight(value);
      }
      if (config.viewBind) {
        const value = api.readPath(config.viewBind);
        if (typeof value === 'string') applyView(value);
      }
    },
    unmount() {
      cancelVisibility();
      widget?.dispose();
      resizeObserver?.disconnect();
      for (const button of buttons) {
        button.removeEventListener('click', onButton);
        button.disabled = true;
      }
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('keydown', onKey);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      for (const material of owned.materials) material.dispose();
      for (const geometry of owned.geometries) releaseGeometry(geometry);
      environment.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      stage.querySelector('.ak-3d-frame')?.remove();
      canvas.remove();
      mounts.delete(record);
      el.setAttribute('data-ak-3d-state', 'static');
    },
  };
  function requestRender() {
    if (!record.animating) {
      if (record.visible && !record.lost) record.tick(performance.now());
    } else schedule();
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
    schedule();
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  let cancelVisibility = () => {};
  if (window.IntersectionObserver) {
    const observer = new IntersectionObserver((entries) => {
      record.visible = entries[entries.length - 1].isIntersecting;
      if (record.visible) schedule();
    });
    observer.observe(el);
    cancelVisibility = () => observer.disconnect();
  }

  mounts.add(record);
  resize();
  const initial = config.bind && api.readPath(config.bind);
  if (typeof initial === 'string' && nodes.has(initial)) highlight(initial);
  record.sync();
  record.tick(performance.now());
  if (record.animating) schedule();
  return record;
}

/** Widgets with their own runtime module, keyed by `data-ak-3d`; the rest mount as a scene. */
const WIDGETS = {
  model: mountModel,
  network: mountNetwork,
  scatter: mountScatter,
  particles: mountParticles,
  shader: mountShader,
  text: mountText,
  globe: mountGlobe,
};
/** What a widget module needs from the shared runtime. */
const kit = {
  api: () => api,
  motionAllowed: () => api.motionAllowed(),
  mounts,
  schedule,
  toneColor,
  cssColor,
  isDark,
  qualityProfile,
  webgl2Available,
  RENDER_SAMPLES,
  shadowMaterial,
  RIGS,
  trio,
  v3,
};

function mountAll() {
  for (const el of document.querySelectorAll('[data-ak-3d]')) {
    if ([...mounts].some((m) => m.el === el)) continue;
    try {
      const widget = WIDGETS[el.getAttribute('data-ak-3d')];
      if (widget) widget(el, kit);
      else mount(el);
    } catch (_error) {
      // A scene that cannot be built reports it; the page and its other scenes keep working.
      el.setAttribute('data-ak-3d-state', 'error');
    }
  }
}

function stats() {
  let calls = 0;
  let triangles = 0;
  let frames = 0;
  const renderMs = [];
  const profiles = new Set();
  for (const record of mounts) {
    const info = record.info();
    calls += info.calls;
    triangles += info.triangles;
    frames += record.frames;
    profiles.add(`${info.quality}@${info.dpr}`);
    renderMs.push(...record.renderMs);
  }
  return {
    mounts: mounts.size,
    geometries: geometries.size,
    calls,
    triangles,
    profile: [...profiles].join(','),
    renderMs,
    frames,
    /** Particle geometries and materials still alive; zero once every scene is unmounted. */
    particleResources: liveParticleResources(),
    /** Shader-effect geometries and materials still alive; zero once every scene is unmounted. */
    shaderResources: liveShaderResources(),
    /** Text geometries, materials and environment maps still alive; zero once every scene is unmounted. */
    textResources: liveTextResources(),
    /** Morph geometries and materials still alive; zero once every morph is unmounted. */
    morphResources: liveMorphResources(),
    /** Timeline paths, stems, halos and marker materials still alive; zero once every timeline is unmounted. */
    timelineResources: liveTimelineResources(),
  };
}

export function boot(pageApi) {
  api = pageApi;
  mountAll();
  window.akRender3d = {
    mountAll,
    unmountAll() {
      for (const record of [...mounts]) record.unmount();
    },
    stats,
    /** Forget recorded render times so a measurement starts after warm-up. */
    resetSamples() {
      for (const record of mounts) record.renderMs = [];
    },
    /** Pin every live scene's current frame; returns the pixel size of each frozen frame. */
    freeze() {
      return [...mounts].map((record) => record.freeze()).filter(Boolean);
    },
    sync() {
      for (const record of mounts) record.sync();
    },
    ready() {
      return [...document.querySelectorAll('[data-ak-3d]')].every(
        (el) =>
          !['static', 'loading'].includes(el.getAttribute('data-ak-3d-state')) || !el.isConnected,
      );
    },
  };
}
