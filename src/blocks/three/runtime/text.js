/**
 * The `text-3d` runtime: extruded, bevelled glyphs from the outlines the
 * compiler laid out (`text-layout.ts`). One geometry per distinct glyph is
 * shared by every copy of it; each unit (a character or a word) is a group
 * that moves by the closed-form pose in `text-motion.ts`.
 *
 * Reduced motion and a frozen export show the rest pose, which is the
 * poster's picture. Looping motion has a pause button and stops offscreen.
 */

import {
  ACESFilmicToneMapping,
  BackSide,
  BufferAttribute,
  Color,
  DirectionalLight,
  ExtrudeGeometry,
  Group,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  ShapePath,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { motionLoops, riseEnd, unitPose } from '../text-motion.ts';

/** Live GPU resources this module created and has not disposed; the disposal check reads it. */
let live = 0;
export const liveTextResources = () => live;
function track(resource) {
  live += 1;
  resource.addEventListener('dispose', () => {
    live -= 1;
  });
  return resource;
}

/** Bevel profile per edge style, in ems; a negative offset keeps each stroke its drawn weight. */
const BEVELS = {
  none: null,
  soft: { thickness: 0.018, size: 0.012, segments: 3 },
  round: { thickness: 0.04, size: 0.022, segments: 6 },
};
const MAX_STEP = 0.05;
const FOV = 30;

/** The compiler's compact path (`M x y`, `L x y`, `Q cx cy x y`, `Z`) in font units, scaled to ems. */
function glyphShapes(d, scale) {
  const path = new ShapePath();
  const tokens = d.match(/[MLQZ]|-?\d+(?:\.\d+)?/g) || [];
  let i = 0;
  const n = () => Number(tokens[i++]) * scale;
  while (i < tokens.length) {
    const command = tokens[i++];
    if (command === 'M') path.moveTo(n(), n());
    else if (command === 'L') path.lineTo(n(), n());
    else if (command === 'Q') {
      const cx = n();
      const cy = n();
      path.quadraticCurveTo(cx, cy, n(), n());
    } else if (command !== 'Z') break;
  }
  // TrueType outer contours run clockwise with y up, as three's font shapes expect.
  return path.toShapes(false);
}

/** Face and side materials for a finish; sides sit darker so the extrusion reads as depth. */
function finish(kind, tone, dark) {
  const side = tone.clone().multiplyScalar(dark ? 0.42 : 0.5);
  if (kind === 'metal') {
    return [
      new MeshStandardMaterial({ color: tone, metalness: 1, roughness: 0.3, envMapIntensity: 1.4 }),
      new MeshStandardMaterial({ color: side, metalness: 1, roughness: 0.42 }),
    ];
  }
  if (kind === 'chrome') {
    const silver = tone.clone().lerp(new Color(0xf2f4f8), 0.85);
    return [
      new MeshStandardMaterial({
        color: silver,
        metalness: 1,
        roughness: 0.07,
        envMapIntensity: 1.8,
      }),
      new MeshStandardMaterial({
        color: silver.clone().multiplyScalar(0.55),
        metalness: 1,
        roughness: 0.16,
      }),
    ];
  }
  if (kind === 'glass') {
    // Tinted and writing depth: overlapping back faces never show through as streaks.
    const glass = (color, opacity) =>
      new MeshPhysicalMaterial({
        color,
        metalness: 0,
        roughness: 0.1,
        transparent: true,
        opacity,
        envMapIntensity: 1.4,
      });
    const tint = tone.clone().offsetHSL(0, 0.15, dark ? 0.05 : -0.05);
    return [glass(tint, 0.9), glass(tint.clone().multiplyScalar(0.6), 0.85)];
  }
  if (kind === 'neon') {
    return [
      new MeshStandardMaterial({
        color: tone.clone().multiplyScalar(0.3),
        emissive: tone.clone().offsetHSL(0, 0.25, 0.08),
        emissiveIntensity: 1.9,
        roughness: 0.4,
      }),
      new MeshStandardMaterial({
        color: tone.clone().multiplyScalar(0.18),
        emissive: tone,
        emissiveIntensity: 0.22,
        roughness: 0.6,
      }),
    ];
  }
  return [
    new MeshPhysicalMaterial({
      color: tone,
      roughness: 0.38,
      metalness: 0.05,
      clearcoat: 0.7,
      clearcoatRoughness: 0.2,
    }),
    new MeshPhysicalMaterial({ color: side, roughness: 0.5, metalness: 0.05 }),
  ];
}

export function mountText(el, kit) {
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
  if (!stage || !Array.isArray(config.units) || !kit.webgl2Available(canvas)) {
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
  const label = (config.lines || []).join(' ');
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', label || '3D text');
  canvas.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight ArrowUp ArrowDown Home');
  stage.appendChild(canvas);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : 1.5));
  renderer.toneMapping = ACESFilmicToneMapping;
  const dark = kit.isDark(el);
  const neon = config.material === 'neon';
  renderer.toneMappingExposure = dark || neon ? 0.95 : 1.05;

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  const environment = track(pmrem.fromScene(new RoomEnvironment(), 0.04).texture);
  scene.environment = environment;
  scene.environmentIntensity = neon ? 0.25 : 0.9;

  const tone = kit.toneColor(el, config.tone || 'accent');
  const materials = finish(config.material, tone, dark).map(track);
  // Polished metal needs a horizon to reflect: a bright sky over a dark floor,
  // drawn here as a vertex-coloured dome, so chrome reads as chrome with no asset.
  let horizon = null;
  if (config.material === 'chrome' || config.material === 'metal') {
    const dome = new SphereGeometry(10, 8, 48);
    const position = dome.attributes.position;
    const colors = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i += 1) {
      // Height on the dome: 1 at the zenith, -1 at the nadir; a bright sky over a dark floor.
      const h = position.getY(i) / 10;
      const level = h > -0.08 ? 0.35 + 0.65 * Math.min(1, (h + 0.08) * 1.6) : 0.03 + 0.1 * -h;
      colors.set([level, level, level * 1.03], i * 3);
    }
    dome.setAttribute('color', new BufferAttribute(colors, 3));
    const domeMaterial = new MeshBasicMaterial({ vertexColors: true, side: BackSide });
    const sky = new Scene();
    sky.add(new Mesh(dome, domeMaterial));
    horizon = track(pmrem.fromScene(sky, 0.02).texture);
    dome.dispose();
    domeMaterial.dispose();
    for (const material of materials) material.envMap = horizon;
  }

  // One geometry per distinct glyph, built only as the text needs it.
  const depth = MathUtils.clamp(Number(config.depth) || 0.28, 0.05, 1);
  const bevel = BEVELS[config.bevel] === undefined ? BEVELS.soft : BEVELS[config.bevel];
  const scale = 1 / (config.unitsPerEm || 1000);
  const curveSegments = quality === 'high' ? 10 : 6;
  const geometries = (config.glyphs || []).map((d) => {
    const geometry = track(
      new ExtrudeGeometry(glyphShapes(String(d), scale), {
        depth,
        curveSegments,
        bevelEnabled: Boolean(bevel),
        bevelThickness: bevel ? bevel.thickness : 0,
        bevelSize: bevel ? bevel.size : 0,
        bevelOffset: bevel ? -bevel.size : 0,
        bevelSegments: bevel ? bevel.segments : 0,
      }),
    );
    // The face sits at z = depth / 2, so units turn about their middle.
    geometry.translate(0, 0, -depth / 2);
    return geometry;
  });

  const text = new Group();
  const units = config.units.map((unit) => {
    const group = new Group();
    group.position.set(unit.cx, unit.cy, 0);
    for (const [glyph, x, y] of unit.items) {
      const geometry = geometries[glyph];
      if (!geometry) continue;
      const mesh = new Mesh(geometry, materials);
      mesh.position.set(x, y, 0);
      group.add(mesh);
    }
    text.add(group);
    return { group, cy: unit.cy };
  });
  scene.add(text);

  // Lights: a warm key from above left, a cool fill, and a tone-tinted rim behind.
  const span = Math.max(config.width || 1, config.height || 1);
  scene.add(new HemisphereLight(0xffffff, kit.toneColor(el, 'neutral'), neon ? 0.15 : 0.55));
  const key = new DirectionalLight(0xfff4e8, neon ? 0.4 : 2.2);
  key.position.set(-span * 0.6, span * 1.1, span * 1.2);
  scene.add(key);
  const fill = new DirectionalLight(0xdfe8ff, neon ? 0.15 : 0.6);
  fill.position.set(span, span * 0.2, span);
  scene.add(fill);
  const rim = new DirectionalLight(tone.clone().lerp(new Color(0xffffff), 0.5), neon ? 0.6 : 1.6);
  rim.position.set(span * 0.4, span * 0.6, -span * 1.4);
  scene.add(rim);

  // A soft contact shadow under the lowest line, placed by projection on resize:
  // a floor plane would sit edge-on to the low camera and show as a hairline.
  const ground = document.createElement('div');
  ground.className = 'ak-tx-ground';
  ground.setAttribute('aria-hidden', 'true');
  stage.insertBefore(ground, canvas);
  const groundAt = new Vector3();
  function placeGround(width, height) {
    const y = -(config.height || 1) / 2 - 0.12;
    const half = (config.width || 1) * 0.46;
    const left = groundAt.set(-half, y, 0).project(camera).x;
    const right = groundAt.set(half, y, 0).project(camera).x;
    const top = groundAt.set(0, y, 0).project(camera).y;
    ground.style.left = `${((left + 1) / 2) * width}px`;
    ground.style.width = `${((right - left) / 2) * width}px`;
    ground.style.top = `${((1 - top) / 2) * height}px`;
  }
  // A low camera: the extrusion shows under each glyph, as the poster draws it.
  const camera = new PerspectiveCamera(FOV, 16 / 9, 0.05, 200);
  const target = new Vector3(0, 0, 0);
  const view = { theta: 0, phi: 0 };
  let distance = 4;
  function place() {
    const theta = view.theta;
    const phi = -0.16 + view.phi;
    camera.position.set(
      distance * Math.sin(theta) * Math.cos(phi),
      distance * Math.sin(phi),
      distance * Math.cos(theta) * Math.cos(phi),
    );
    camera.lookAt(target);
  }

  const motionAllowed = kit.motionAllowed();
  const motion = motionAllowed ? config.motion || 'none' : 'none';
  let paused = false;
  // The rise entrance starts at zero; reduced motion holds the rest pose.
  let clock = motion === 'rise' ? 0 : riseEnd(units.length);
  let last = 0;
  let settled = false;
  const pose = [0, 0, 0, 1];
  function applyPose() {
    const active = settled ? 'none' : motion;
    units.forEach((unit, i) => {
      unitPose(active, clock, i, units.length, pose);
      unit.group.position.y = unit.cy + pose[0];
      unit.group.rotation.set(pose[1], pose[2], 0);
      unit.group.scale.setScalar(pose[3]);
    });
  }

  const pause = document.createElement('button');
  pause.type = 'button';
  pause.className = 'ak-tx-pause';
  function labelPause() {
    pause.textContent = paused ? 'Play' : 'Pause';
    pause.setAttribute('aria-pressed', paused ? 'true' : 'false');
    pause.setAttribute('aria-label', paused ? 'Play text motion' : 'Pause text motion');
  }
  const onPause = () => {
    paused = !paused;
    labelPause();
    last = 0;
    record.animating = !paused;
    if (!paused) kit.schedule();
  };
  pause.addEventListener('click', onPause);
  const loops = motion !== 'none' && motionLoops(motion);
  if (loops) {
    labelPause();
    stage.appendChild(pause);
  }

  // Orbit within a small cone: the lettering stays legible from every allowed angle.
  const pointers = new Map();
  const onPointerDown = (event) => {
    canvas.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  };
  const onPointerMove = (event) => {
    const prev = pointers.get(event.pointerId);
    if (!prev) return;
    view.theta = MathUtils.clamp(view.theta - (event.clientX - prev.x) * 0.006, -0.7, 0.7);
    view.phi = MathUtils.clamp(view.phi + (event.clientY - prev.y) * 0.004, -0.3, 0.45);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    place();
    requestRender();
  };
  const onPointerUp = (event) => {
    pointers.delete(event.pointerId);
  };
  const onKey = (event) => {
    const key = event.key;
    if (key === 'ArrowLeft') view.theta = Math.max(-0.7, view.theta - 0.1);
    else if (key === 'ArrowRight') view.theta = Math.min(0.7, view.theta + 0.1);
    else if (key === 'ArrowUp') view.phi = Math.min(0.45, view.phi + 0.06);
    else if (key === 'ArrowDown') view.phi = Math.max(-0.3, view.phi - 0.06);
    else if (key === 'Home' || key === '0') {
      view.theta = 0;
      view.phi = 0;
    } else return;
    event.preventDefault();
    place();
    requestRender();
  };
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('keydown', onKey);

  function resize() {
    const width = stage.clientWidth || 640;
    const height = stage.clientHeight || 360;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.fov = FOV;
    camera.updateProjectionMatrix();
    // Fit the ink box with the poster's margins: 84% of the width, 62% of the height.
    const tanV = Math.tan(MathUtils.degToRad(FOV) / 2);
    const fitWidth = (config.width || 1) / 0.84 / (2 * tanV * camera.aspect);
    const fitHeight = (config.height || 1) / 0.62 / (2 * tanV);
    distance = Math.max(fitWidth, fitHeight) + depth / 2;
    place();
    placeGround(width, height);
    requestRender();
  }
  const resizeObserver = window.ResizeObserver ? new ResizeObserver(resize) : null;
  resizeObserver?.observe(stage);

  const record = {
    el,
    visible: true,
    lost: false,
    animating: motion !== 'none',
    frames: 0,
    renderMs: [],
    tick() {
      const at = performance.now();
      if (!paused && motion !== 'none') {
        if (last) clock += Math.min((at - last) / 1000, MAX_STEP);
        last = at;
      }
      applyPose();
      const begin = performance.now();
      renderer.render(scene, camera);
      record.renderMs.push(performance.now() - begin);
      if (record.renderMs.length > kit.RENDER_SAMPLES) record.renderMs.shift();
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
        motion,
        clock,
      };
    },
    /** Settle to the rest pose, the poster's picture, and pin it for print and export. */
    freeze() {
      if (record.lost || record.frames === 0) return null;
      if (stage.querySelector('.ak-3d-frame'))
        return { width: canvas.width, height: canvas.height };
      record.animating = false;
      settled = true;
      applyPose();
      renderer.render(scene, camera);
      const frame = document.createElement('img');
      frame.className = 'ak-3d-frame';
      frame.alt = '';
      frame.src = canvas.toDataURL('image/png');
      canvas.after(frame);
      el.setAttribute('data-ak-3d-state', 'frozen');
      return { width: canvas.width, height: canvas.height };
    },
    sync() {},
    unmount() {
      cancelVisibility();
      resizeObserver?.disconnect();
      pause.removeEventListener('click', onPause);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('keydown', onKey);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      environment.dispose();
      horizon?.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      stage.querySelector('.ak-3d-frame')?.remove();
      pause.remove();
      ground.remove();
      canvas.remove();
      kit.mounts.delete(record);
      el.setAttribute('data-ak-3d-state', 'static');
    },
  };
  function requestRender() {
    if (!record.visible || record.lost) return;
    if (record.animating) kit.schedule();
    else record.tick();
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

  // Offscreen the shared loop skips this scene; the clock resumes without a jump.
  let cancelVisibility = () => {};
  if (window.IntersectionObserver) {
    const observer = new IntersectionObserver((entries) => {
      record.visible = entries[entries.length - 1].isIntersecting;
      last = 0;
      if (record.visible) kit.schedule();
    });
    observer.observe(stage);
    cancelVisibility = () => observer.disconnect();
  }

  kit.mounts.add(record);
  resize();
  record.tick();
  if (record.animating) kit.schedule();
  return record;
}
