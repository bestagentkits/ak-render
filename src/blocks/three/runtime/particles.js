/**
 * The `particles-3d` runtime: one `Points` draw for the whole cloud.
 *
 * Two bounded paths share one closed-form simulation (`particles-sim.ts`):
 * the GPU path evaluates it in the vertex shader for up to `MAX_PARTICLES`;
 * the CPU path (low quality profile, or no highp vertex floats) evaluates it
 * in JS for at most `CPU_PARTICLE_CAP`. Either path steps down by halves when
 * frames run over budget, never up, so a slow device settles instead of thrashing.
 *
 * The clock starts at the poster's time, so the first frame is the poster's
 * picture; reduced motion keeps that frame, and the clock pauses offscreen.
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  MathUtils,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderer,
} from 'three';
import {
  CPU_PARTICLE_CAP,
  densityGain,
  drawnAt,
  FRAME_WINDOW,
  frameBaseline,
  MAX_PARTICLES,
  nextLevel,
  PARTICLE_FRAGMENT,
  POSTER_TIME,
  particleAt,
  particleVertexShader,
  spawnParticles,
} from '../particles-sim.ts';

/** Live GPU resources this module created and has not disposed; the disposal check reads it. */
let live = 0;
export const liveParticleResources = () => live;
function track(resource) {
  live += 1;
  resource.addEventListener('dispose', () => {
    live -= 1;
  });
  return resource;
}

/** The longest step the clock takes, so a stalled tab resumes where it left off. */
const MAX_STEP = 0.05;

export function mountParticles(el, kit) {
  let params;
  try {
    params = JSON.parse(el.getAttribute('data-ak-scene') || '{}');
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
      antialias: false,
      preserveDrawingBuffer: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
  } catch (_error) {
    el.setAttribute('data-ak-3d-state', 'unsupported');
    return null;
  }
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute(
    'aria-label',
    el.querySelector('.ak-3d-caption')?.firstChild?.textContent || 'Particle effect',
  );
  canvas.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight ArrowUp ArrowDown + -');
  stage.appendChild(canvas);
  let dpr = Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : 1);
  renderer.setPixelRatio(dpr);
  // A shader the driver rejects leaves the poster up and says so, instead of claiming a frame.
  let failed = false;
  renderer.debug.onShaderError = () => {
    failed = true;
  };

  // The CPU path is the bounded fallback for GPUs without highp vertex math;
  // html[data-ak-3d-path="cpu"] forces it for tests and tooling.
  const forced = document.documentElement.getAttribute('data-ak-3d-path');
  const path =
    forced === 'cpu' || (forced !== 'gpu' && renderer.capabilities.precision !== 'highp')
      ? 'cpu'
      : 'gpu';
  const total = Math.min(
    Math.max(0, Math.floor(params.count || 0)),
    path === 'cpu' ? CPU_PARTICLE_CAP : MAX_PARTICLES,
  );
  const spawn = spawnParticles(params, total);
  const geometry = track(new BufferGeometry());
  const positions = new Float32Array(spawn.position);
  const positionAttribute = new BufferAttribute(positions, 3);
  geometry.setAttribute('position', positionAttribute);
  geometry.setAttribute('aVelocity', new BufferAttribute(spawn.velocity, 3));
  geometry.setAttribute('aExtra', new BufferAttribute(spawn.extra, 3));
  const liveState = path === 'cpu' ? new Float32Array(total * 4) : null;
  const liveAttribute = liveState ? new BufferAttribute(liveState, 4) : null;
  if (liveAttribute) geometry.setAttribute('aLive', liveAttribute);

  const dark = kit.isDark(el);
  const stops = (params.colors || ['accent']).slice(0, 4);
  const colors = [0, 1, 2, 3].map((i) =>
    kit.toneColor(el, stops[Math.min(i, stops.length - 1)] || 'accent'),
  );
  const material = track(
    new ShaderMaterial({
      vertexShader: particleVertexShader(params, path === 'cpu'),
      fragmentShader: PARTICLE_FRAGMENT,
      uniforms: {
        uTime: { value: POSTER_TIME },
        uSpeed: { value: params.speed || 1 },
        uLife: { value: params.life || 1 },
        uScale: { value: 1 },
        uColors: { value: colors },
        uStops: { value: stops.length },
        uGain: { value: dark ? 0 : 1 },
        uDensity: { value: densityGain(total, dark) },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      premultipliedAlpha: true,
    }),
  );
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  const scene = new Scene();
  scene.add(points);

  const cam = params.camera || {};
  const camera = new PerspectiveCamera(cam.fov || 34, 16 / 9, 0.05, 200);
  const home = new Vector3(...(cam.position || [0, 1, 7]));
  const target = new Vector3(...(cam.target || [0, 0, 0]));
  camera.position.copy(home);
  camera.lookAt(target);

  const motion = kit.motionAllowed();
  let paused = !motion;
  let clock = POSTER_TIME;
  let last = 0;
  // A low profile (touch or few cores) starts one step down; slow frames take it further.
  let level = quality === 'low' ? 1 : 0;
  let baseline = 0;
  const intervals = [];
  el.setAttribute('data-ak-3d-path', path);

  function applyLevel() {
    geometry.setDrawRange(0, drawnAt(total, level));
    // Fewer sprites each carry more light, so a downgraded cloud keeps its brightness.
    material.uniforms.uDensity.value = densityGain(drawnAt(total, level), dark);
    el.setAttribute('data-ak-3d-level', String(level));
    // Past the first step, drop to one device pixel per CSS pixel too.
    if (level >= 2 && dpr > 1) {
      dpr = 1;
      renderer.setPixelRatio(1);
      resize();
    }
  }

  const out = [0, 0, 0, 0, 0, 0, 0];
  function simulate() {
    material.uniforms.uTime.value = clock;
    if (!liveState) return;
    const drawn = geometry.drawRange.count === Infinity ? total : geometry.drawRange.count;
    for (let i = 0; i < drawn; i += 1) {
      particleAt(params, spawn, i, clock, out);
      positions[i * 3] = out[0];
      positions[i * 3 + 1] = out[1];
      positions[i * 3 + 2] = out[2];
      liveState[i * 4] = out[3];
      liveState[i * 4 + 1] = out[4];
      liveState[i * 4 + 2] = out[5];
      liveState[i * 4 + 3] = out[6];
    }
    positionAttribute.needsUpdate = true;
    liveAttribute.needsUpdate = true;
  }

  // Pause: WCAG 2.2.2 asks for a way to stop motion that runs on its own.
  const pause = document.createElement('button');
  pause.type = 'button';
  pause.className = 'ak-pt-pause';
  function labelPause() {
    pause.textContent = paused ? 'Play' : 'Pause';
    pause.setAttribute('aria-pressed', paused ? 'true' : 'false');
    pause.setAttribute('aria-label', paused ? 'Play particle motion' : 'Pause particle motion');
  }
  const onPause = () => {
    paused = !paused;
    labelPause();
    last = 0;
    record.animating = !paused;
    if (!paused) kit.schedule();
  };
  pause.addEventListener('click', onPause);
  if (motion) {
    labelPause();
    stage.appendChild(pause);
  }

  // Orbit and zoom around the effect; the effect itself carries no information to pick.
  const spherical = { r: 0, theta: 0, phi: 0 };
  function readSpherical() {
    const offset = camera.position.clone().sub(target);
    spherical.r = offset.length();
    spherical.theta = Math.atan2(offset.x, offset.z);
    spherical.phi = Math.acos(MathUtils.clamp(offset.y / spherical.r, -1, 1));
  }
  function applySpherical() {
    spherical.phi = MathUtils.clamp(spherical.phi, 0.15, Math.PI - 0.15);
    spherical.r = MathUtils.clamp(spherical.r, 2, 30);
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
  const onPointerDown = (event) => {
    canvas.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  };
  const onPointerMove = (event) => {
    const prev = pointers.get(event.pointerId);
    if (!prev) return;
    spherical.theta -= (event.clientX - prev.x) * 0.01;
    spherical.phi -= (event.clientY - prev.y) * 0.01;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    applySpherical();
  };
  const onPointerUp = (event) => {
    pointers.delete(event.pointerId);
  };
  const onWheel = (event) => {
    event.preventDefault();
    spherical.r *= event.deltaY > 0 ? 1.1 : 0.9;
    applySpherical();
  };
  const onKey = (event) => {
    const key = event.key;
    if (key === 'ArrowLeft') spherical.theta -= 0.15;
    else if (key === 'ArrowRight') spherical.theta += 0.15;
    else if (key === 'ArrowUp') spherical.phi -= 0.15;
    else if (key === 'ArrowDown') spherical.phi += 0.15;
    else if (key === '+' || key === '=') spherical.r *= 0.9;
    else if (key === '-') spherical.r *= 1.1;
    else return;
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
    // A narrow stage widens the vertical field so the effect keeps its width.
    camera.fov =
      camera.aspect < 16 / 9
        ? MathUtils.radToDeg(
            2 *
              Math.atan(
                (Math.tan(MathUtils.degToRad(cam.fov || 34) / 2) * (16 / 9)) / camera.aspect,
              ),
          )
        : cam.fov || 34;
    camera.updateProjectionMatrix();
    // Sprite diameter in device pixels = world size * focal length / depth, with room for the halo.
    material.uniforms.uScale.value =
      (2.2 * (params.grain || 0.05) * height * renderer.getPixelRatio()) /
      (2 * Math.tan(MathUtils.degToRad(camera.fov) / 2));
    requestRender();
  }
  const resizeObserver = window.ResizeObserver ? new ResizeObserver(resize) : null;
  resizeObserver?.observe(stage);

  const record = {
    el,
    visible: true,
    lost: false,
    animating: !paused,
    frames: 0,
    renderMs: [],
    tick() {
      const at = performance.now();
      if (!paused) {
        if (last) {
          const dt = at - last;
          clock += Math.min(dt / 1000, MAX_STEP);
          intervals.push(dt);
          if (intervals.length >= FRAME_WINDOW) {
            // The first window teaches the display's own pace; later windows are judged against it.
            if (!baseline) baseline = frameBaseline(intervals);
            const next = nextLevel(intervals, level, baseline);
            intervals.length = 0;
            if (next !== level) {
              level = next;
              applyLevel();
            }
          }
        }
        last = at;
      }
      simulate();
      const begin = performance.now();
      renderer.render(scene, camera);
      record.renderMs.push(performance.now() - begin);
      if (record.renderMs.length > kit.RENDER_SAMPLES) record.renderMs.shift();
      if (failed) {
        el.setAttribute('data-ak-3d-state', 'error');
        record.animating = false;
        pause.remove();
        return;
      }
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
        path,
        level,
        clock,
        drawn: drawnAt(total, level),
        density: material.uniforms.uDensity.value,
      };
    },
    freeze() {
      if (record.lost || record.frames === 0) return null;
      if (stage.querySelector('.ak-3d-frame'))
        return { width: canvas.width, height: canvas.height };
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
    sync() {},
    unmount() {
      cancelVisibility();
      resizeObserver?.disconnect();
      pause.removeEventListener('click', onPause);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('keydown', onKey);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      stage.querySelector('.ak-3d-frame')?.remove();
      pause.remove();
      canvas.remove();
      kit.mounts.delete(record);
      el.removeAttribute('data-ak-3d-path');
      el.removeAttribute('data-ak-3d-level');
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
    // The stage, not the figure: a caption still on screen does not keep the effect running.
    observer.observe(stage);
    cancelVisibility = () => observer.disconnect();
  }

  kit.mounts.add(record);
  applyLevel();
  resize();
  record.tick();
  if (record.animating) kit.schedule();
  return record;
}
