/**
 * The `shader-3d` runtime: one mesh, one compiler-written program, and a
 * closed post chain (bloom, then a finishing pass for chromatic split,
 * scanlines, grain and vignette).
 *
 * The program and every pass come from `shader-fx.ts`; the spec only picks a
 * preset and numbers, which arrive as uniforms. The clock starts at the
 * poster's time, so the first frame is the poster's picture; reduced motion
 * keeps that frame. Controls and bound state change uniforms, never code.
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  MathUtils,
  Mesh,
  NeutralToneMapping,
  NormalBlending,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import {
  compatiblePost,
  FINISH_FRAGMENT,
  FINISH_VERTEX,
  LIVE_GRID,
  PARAM_RANGES,
  POSTER_TIME,
  poseAt,
  presetIndex,
  SHADER_FRAGMENT,
  SHADER_PARAMS,
  SHADER_PRESETS,
  SHADER_VERTEX,
  seedOffset,
  surfaceGrid,
} from '../shader-fx.ts';

/** Live GPU resources this module created and has not disposed; the disposal check reads it. */
let live = 0;
export const liveShaderResources = () => live;
function track(resource) {
  live += 1;
  resource.addEventListener('dispose', () => {
    live -= 1;
  });
  return resource;
}

/** The longest step the clock takes, so a stalled tab resumes where it left off. */
const MAX_STEP = 0.05;

function gridGeometry(shape) {
  const [segU, segV] = LIVE_GRID[shape] || LIVE_GRID.sphere;
  const grid = surfaceGrid(shape, segU, segV);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(grid.position, 3));
  geometry.setAttribute('normal', new BufferAttribute(grid.normal, 3));
  const index = new Uint32Array(segU * segV * 6);
  let at = 0;
  for (let j = 0; j < segV; j += 1) {
    for (let i = 0; i < segU; i += 1) {
      const a = j * (segU + 1) + i;
      const b = a + 1;
      const c = a + segU + 2;
      const d = a + segU + 1;
      index.set([a, b, c, a, c, d], at);
      at += 6;
    }
  }
  geometry.setIndex(new BufferAttribute(index, 1));
  return geometry;
}

const clampParam = (param, value) =>
  Math.min(PARAM_RANGES[param].max, Math.max(PARAM_RANGES[param].min, value));
const shown = (value) => String(Number(value.toFixed(2)));

export function mountShader(el, kit) {
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
    el.querySelector('.ak-3d-caption')?.firstChild?.textContent || 'Shader effect',
  );
  canvas.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight ArrowUp ArrowDown + -');
  stage.appendChild(canvas);
  const dpr = Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : 1);
  renderer.setPixelRatio(dpr);
  renderer.toneMapping = NeutralToneMapping;
  // A software rasterizer (SwiftShader, llvmpipe) cannot afford a bloom pyramid
  // per effect: it skips bloom and runs the post chain at half resolution.
  const software = isSoftwareGl(renderer.getContext());
  // A program the driver rejects leaves the poster up and says so, instead of claiming a frame.
  let failed = false;
  renderer.debug.onShaderError = () => {
    failed = true;
  };

  const dark = kit.isDark(el);
  // The stage is night in either scheme, matching the poster's sky.
  const night = dark
    ? kit.cssColor(el, '--ak-color-background', '#101018').lerp(kit.toneColor(el, 'accent'), 0.03)
    : kit.cssColor(el, '--ak-color-text', '#1b1d24').lerp(kit.toneColor(el, 'info'), 0.03);
  const scene = new Scene();
  scene.background = night;

  const white = night.clone().setRGB(1, 1, 1);
  const lift = (color, k) => (dark ? color : color.lerp(white, k));
  const seed = seedOffset(params.seed || 0);
  const colors = params.colors || ['accent', 'info'];
  const geometry = track(gridGeometry(params.shape));
  const material = track(
    new ShaderMaterial({
      vertexShader: SHADER_VERTEX,
      fragmentShader: SHADER_FRAGMENT,
      uniforms: {
        uTime: { value: POSTER_TIME },
        uScale: { value: params.scale },
        uProgress: { value: params.progress },
        uIntensity: { value: params.intensity },
        uTilt: { value: 0 },
        uSpin: { value: 0 },
        uPreset: { value: 0 },
        uSeed: { value: new Vector3(seed[0], seed[1], seed[2]) },
        // A light theme's tones are dark ink; on the night stage they are lifted so the glow still glows.
        uBody: { value: lift(kit.toneColor(el, colors[0]), 0.15) },
        uGlow: { value: lift(kit.toneColor(el, colors[1] || colors[0]), 0.4) },
      },
      side: DoubleSide,
    }),
  );
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  scene.add(mesh);

  const cam = params.camera || {};
  const camera = new PerspectiveCamera(cam.fov || 34, 16 / 9, 0.05, 100);
  const target = new Vector3(...(cam.target || [0, 0, 0]));
  camera.position.set(...(cam.position || [0, 0, 5.2]));
  camera.lookAt(target);

  // Post chain: render, bloom, finishing pass, then tone mapping and sRGB output.
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new Vector2(640, 360), 0.5, 0.4, 0.82);
  composer.addPass(bloom);
  const finish = new ShaderPass(
    new ShaderMaterial({
      vertexShader: FINISH_VERTEX,
      fragmentShader: FINISH_FRAGMENT,
      uniforms: {
        tDiffuse: { value: null },
        uResolution: { value: new Vector2(640, 360) },
        uHalo: { value: kit.toneColor(el, colors[0]).multiplyScalar(0.35) },
        uTime: { value: POSTER_TIME },
        uChromatic: { value: 0 },
        uScanlines: { value: 0 },
        uGrain: { value: 0 },
        uVignette: { value: 0 },
      },
    }),
  );
  composer.addPass(finish);
  composer.addPass(new OutputPass());

  let preset = params.preset;
  let grain = false;
  // Grain is film texture, so a small stage gets finer, lighter grain rather than the same specks.
  const grainAmount = () =>
    grain ? (0.06 * Math.min(1, Math.max(0.4, (stage.clientWidth || 640) / 1100))) / dpr : 0;
  // A paused or still effect redraws only when something it shows has changed.
  let dirty = true;
  function applyPreset(next) {
    preset = next;
    material.uniforms.uPreset.value = presetIndex(next);
    // The hologram is light, not matter: it adds onto the stage and writes no depth.
    const additive = next === 'hologram';
    material.blending = additive ? AdditiveBlending : NormalBlending;
    material.transparent = additive;
    material.depthWrite = !additive;
    material.needsUpdate = true;
    const post = compatiblePost(next, params.chain || params.post || []);
    bloom.enabled = !software && post.includes('bloom');
    finish.uniforms.uChromatic.value = post.includes('chromatic') ? 1 : 0;
    finish.uniforms.uScanlines.value = post.includes('scanlines') ? 1 : 0;
    grain = post.includes('grain');
    finish.uniforms.uGrain.value = grainAmount();
    finish.uniforms.uVignette.value = post.includes('vignette') ? 1 : 0;
    el.setAttribute('data-ak-sh-preset', next);
    el.setAttribute('data-ak-sh-post', post.join(' '));
    for (const button of presetButtons)
      button.setAttribute(
        'aria-pressed',
        button.getAttribute('data-ak-sh-preset') === next ? 'true' : 'false',
      );
  }
  const values = {
    intensity: params.intensity,
    scale: params.scale,
    progress: params.progress,
    speed: params.speed ?? 1,
  };
  function applyParam(param, value) {
    values[param] = clampParam(param, value);
    const uniform = material.uniforms[`u${param.charAt(0).toUpperCase()}${param.slice(1)}`];
    if (uniform) uniform.value = values[param];
    for (const input of sliders) {
      if (input.getAttribute('data-ak-sh-param') !== param) continue;
      if (Number(input.value) !== values[param]) input.value = String(values[param]);
      const output = input.closest('.ak-sh-control')?.querySelector('output');
      if (output) output.textContent = shown(values[param]);
    }
  }

  // Built-in controls: enabled only now that there is a live effect to drive.
  const presetButtons = Array.prototype.slice.call(el.querySelectorAll('[data-ak-sh-preset]'));
  const sliders = Array.prototype.slice.call(el.querySelectorAll('[data-ak-sh-param]'));
  const bind = params.bind || {};
  const onPresetButton = (event) => {
    const next = event.currentTarget.getAttribute('data-ak-sh-preset');
    if (!SHADER_PRESETS.includes(next) || next === preset) return;
    applyPreset(next);
    requestRender();
    kit.api().fire(el, 'change', { value: next, param: 'preset' });
    if (bind.preset) kit.api().setPath(bind.preset, next);
  };
  const onSlider = (event) => {
    const param = event.currentTarget.getAttribute('data-ak-sh-param');
    const value = Number(event.currentTarget.value);
    if (!SHADER_PARAMS.includes(param) || !Number.isFinite(value)) return;
    applyParam(param, value);
    requestRender();
    kit.api().fire(el, 'change', { value: values[param], param });
    if (bind[param]) kit.api().setPath(bind[param], values[param]);
  };
  for (const button of presetButtons) {
    button.disabled = false;
    button.addEventListener('click', onPresetButton);
  }
  const motion = kit.motionAllowed();
  for (const input of sliders) {
    // Without motion the clock never runs, so a speed dial would do nothing.
    if (!motion && input.getAttribute('data-ak-sh-param') === 'speed') {
      input.title = 'Speed has no effect while reduced motion is on';
      continue;
    }
    input.disabled = false;
    input.addEventListener('input', onSlider);
  }
  let paused = !motion;
  let clock = POSTER_TIME;
  let last = 0;

  // Pause: WCAG 2.2.2 asks for a way to stop motion that runs on its own.
  const pause = document.createElement('button');
  pause.type = 'button';
  pause.className = 'ak-sh-pause';
  function labelPause() {
    pause.textContent = paused ? 'Play' : 'Pause';
    pause.setAttribute('aria-pressed', paused ? 'true' : 'false');
    pause.setAttribute('aria-label', paused ? 'Play effect motion' : 'Pause effect motion');
  }
  const onPause = () => {
    paused = !paused;
    labelPause();
    last = 0;
    record.animating = !paused;
    dirty = true;
    if (!paused) kit.schedule();
  };
  pause.addEventListener('click', onPause);
  if (motion) {
    labelPause();
    stage.appendChild(pause);
  }

  // Orbit and zoom around the surface; the effect carries no information to pick.
  const spherical = { r: 0, theta: 0, phi: 0 };
  function readSpherical() {
    const offset = camera.position.clone().sub(target);
    spherical.r = offset.length();
    spherical.theta = Math.atan2(offset.x, offset.z);
    spherical.phi = Math.acos(MathUtils.clamp(offset.y / spherical.r, -1, 1));
  }
  function applySpherical() {
    spherical.phi = MathUtils.clamp(spherical.phi, 0.15, Math.PI - 0.15);
    spherical.r = MathUtils.clamp(spherical.r, 2.5, 14);
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
    composer.setPixelRatio(software ? renderer.getPixelRatio() / 2 : renderer.getPixelRatio());
    composer.setSize(width, height);
    finish.uniforms.uResolution.value.set(width, height);
    finish.uniforms.uGrain.value = grainAmount();
    camera.aspect = width / height;
    // A narrow stage widens the vertical field so the surface keeps its width, as the poster does.
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
      // The shared loop ticks every visible scene while any animates; a paused, unchanged one skips.
      if (paused && !dirty && record.frames > 0) return;
      dirty = false;
      const at = performance.now();
      if (!paused) {
        if (last) clock += Math.min((at - last) / 1000, MAX_STEP) * values.speed;
        last = at;
      }
      const pose = poseAt(params.shape, clock);
      material.uniforms.uTime.value = clock;
      material.uniforms.uTilt.value = pose.tilt;
      material.uniforms.uSpin.value = pose.spin;
      finish.uniforms.uTime.value = clock;
      const begin = performance.now();
      composer.render();
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
        quality,
        dpr: renderer.getPixelRatio(),
        preset,
        clock,
        ...values,
      };
    },
    freeze() {
      if (record.lost || record.frames === 0) return null;
      if (stage.querySelector('.ak-3d-frame'))
        return { width: canvas.width, height: canvas.height };
      record.animating = false;
      composer.render();
      const frame = document.createElement('img');
      frame.className = 'ak-3d-frame';
      frame.alt = '';
      frame.src = canvas.toDataURL('image/png');
      canvas.after(frame);
      el.setAttribute('data-ak-3d-state', 'frozen');
      return { width: canvas.width, height: canvas.height };
    },
    /** Bound state drives the effect: a preset name or a number in range. */
    sync() {
      let changed = false;
      if (bind.preset) {
        const value = kit.api().readPath(bind.preset);
        if (SHADER_PRESETS.includes(value) && value !== preset) {
          applyPreset(value);
          changed = true;
        }
      }
      for (const param of SHADER_PARAMS) {
        if (!bind[param]) continue;
        const raw = kit.api().readPath(bind[param]);
        const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
        if (typeof value !== 'number' || !Number.isFinite(value)) continue;
        if (clampParam(param, value) === values[param]) continue;
        applyParam(param, value);
        changed = true;
      }
      if (changed) requestRender();
    },
    unmount() {
      cancelVisibility();
      resizeObserver?.disconnect();
      pause.removeEventListener('click', onPause);
      for (const button of presetButtons) {
        button.removeEventListener('click', onPresetButton);
        button.disabled = true;
      }
      for (const input of sliders) {
        input.removeEventListener('input', onSlider);
        input.disabled = true;
      }
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
      finish.material.dispose();
      bloom.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      stage.querySelector('.ak-3d-frame')?.remove();
      pause.remove();
      canvas.remove();
      kit.mounts.delete(record);
      el.removeAttribute('data-ak-sh-preset');
      el.removeAttribute('data-ak-sh-post');
      el.setAttribute('data-ak-3d-state', 'static');
    },
  };
  function requestRender() {
    dirty = true;
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

  applyPreset(preset);
  kit.mounts.add(record);
  resize();
  record.sync();
  record.tick();
  if (record.animating) kit.schedule();
  return record;
}

/** True when WebGL runs on a CPU rasterizer rather than a GPU. */
function isSoftwareGl(gl) {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  return /swiftshader|llvmpipe|software/i.test(String(name));
}
