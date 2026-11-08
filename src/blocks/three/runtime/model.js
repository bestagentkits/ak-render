/**
 * The `model-3d` mount: a glTF 2.0 model on the shared renderer loop.
 *
 * The compiler inlined the model as a `data:` URI (or named an allowed remote
 * URL), read its clip and variant names, framed the camera and drew the static
 * plan. This module loads the model with the pinned GLTFLoader, then adds
 * orbit, pan and zoom, animation clips, KHR_materials_variants and hotspots,
 * each readable from and written to page state. Nothing here evaluates author
 * input as code; no decoder for Draco, Meshopt or KTX2 is registered.
 */

import {
  ACESFilmicToneMapping,
  AmbientLight,
  AnimationMixer,
  Box3,
  Color,
  DirectionalLight,
  HemisphereLight,
  LoopRepeat,
  MathUtils,
  Mesh,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  PointLight,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Short, reader-facing reason for a failed load; never the raw stack. */
function loadFailure(error) {
  const text = String(error?.message || error || '');
  if (/draco|meshopt|ktx2|basisu|extension/iu.test(text))
    return 'This model needs a decoder the page does not include.';
  return 'The model could not be loaded.';
}

export function mountModel(el, kit) {
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
  if (!stage || typeof config.src !== 'string' || !kit.webgl2Available(canvas)) {
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
  const api = kit.api();
  const motion = api.motionAllowed();
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', el.querySelector('.ak-3d-caption')?.textContent || '3D model');
  stage.appendChild(canvas);
  const pins = document.createElement('div');
  pins.className = 'ak-3d-pins';
  pins.setAttribute('aria-hidden', 'true');
  stage.appendChild(pins);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : 1));
  renderer.shadowMap.enabled = quality === 'high';
  renderer.shadowMap.type = PCFShadowMap;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = kit.isDark(el) ? 0.85 : 1;

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = environment;
  scene.environmentIntensity = 0.7;
  const cfgCamera = config.camera || {};
  const camera = new PerspectiveCamera(cfgCamera.fov || 30, 16 / 9, 0.01, 5000);
  const home = {
    position: kit.v3(cfgCamera.position, new Vector3(4, 3, 6)),
    target: kit.v3(cfgCamera.target, new Vector3()),
  };
  camera.position.copy(home.position);
  const target = home.target.clone();
  camera.lookAt(target);

  for (const spec of kit.RIGS[config.lighting] || kit.RIGS.studio) {
    const color = new Color(spec.color || 0xffffff);
    const intensity = typeof spec.intensity === 'number' ? spec.intensity : 1;
    let light;
    if (spec.kind === 'ambient') light = new AmbientLight(color, intensity);
    else if (spec.kind === 'hemisphere')
      light = new HemisphereLight(color, kit.toneColor(el, 'neutral'), intensity);
    else if (spec.kind === 'point') light = new PointLight(color, intensity * 20);
    else light = new DirectionalLight(color, intensity);
    if (kit.trio(spec.position)) light.position.set(...spec.position);
    if (spec.kind === 'directional' && renderer.shadowMap.enabled && !light.castShadow) {
      light.castShadow = !scene.children.some((child) => child.castShadow);
      light.shadow.mapSize.set(1024, 1024);
      light.shadow.radius = 4;
    }
    scene.add(light);
  }

  // Hotspots: numbered pins over the canvas that track their model-space point.
  const hotspots = (config.hotspots || []).map((spec, index) => {
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.tabIndex = -1;
    pin.className = 'ak-3d-pin';
    pin.textContent = String(index + 1);
    pin.setAttribute('data-ak-3d-pin', spec.id);
    pins.appendChild(pin);
    return { spec, pin, at: kit.v3(spec.position, new Vector3()) };
  });
  const buttons = Array.prototype.slice.call(el.querySelectorAll('[data-ak-3d-pick]'));
  const clipButtons = Array.prototype.slice.call(el.querySelectorAll('[data-ak-3d-clip]'));
  const variantButtons = Array.prototype.slice.call(el.querySelectorAll('[data-ak-3d-variant]'));

  let selected = null;
  function highlight(id) {
    selected = id;
    for (const button of buttons)
      button.setAttribute(
        'aria-pressed',
        button.getAttribute('data-ak-3d-pick') === id ? 'true' : 'false',
      );
    for (const { spec, pin } of hotspots)
      pin.setAttribute('aria-pressed', spec.id === id ? 'true' : 'false');
    const label = hotspots.find((h) => h.spec.id === id)?.spec.label;
    canvas.setAttribute('aria-description', id ? `Selected: ${label || id}` : '');
    el.setAttribute('data-ak-3d-selected', id || '');
  }
  function select(id) {
    if (!hotspots.some((h) => h.spec.id === id) || id === selected) return;
    highlight(id);
    api.fire(el, 'select', { value: id });
    if (config.bind) api.setPath(config.bind, id);
  }
  const onPick = (event) => select(event.currentTarget.getAttribute('data-ak-3d-pick'));
  const onPin = (event) => select(event.currentTarget.getAttribute('data-ak-3d-pin'));
  for (const { pin } of hotspots) pin.addEventListener('click', onPin);

  // Loaded state: filled in once GLTFLoader resolves.
  let gltf = null;
  let mixer = null;
  let action = null;
  let clip = null;
  let variant = null;
  const variantMeshes = [];
  const owned = [];
  let lastTick = 0;

  function setClip(name) {
    if (!gltf || name === clip) return;
    // Match by index: the compiler listed the clips in file order.
    const found = gltf.animations[(config.clips || []).indexOf(name)];
    if (!found) return;
    clip = name;
    action?.stop();
    action = mixer.clipAction(found);
    action.setLoop(LoopRepeat, Infinity);
    action.reset().play();
    // Reduced motion shows the clip's first pose and never advances it.
    mixer.update(0);
    record.animating = motion;
    el.setAttribute('data-ak-3d-playing', name);
    for (const button of clipButtons)
      button.setAttribute(
        'aria-pressed',
        button.getAttribute('data-ak-3d-clip') === name ? 'true' : 'false',
      );
    requestRender();
  }

  let variantRequest = 0;
  let applied = variant;
  async function setVariant(name) {
    if (!gltf || name === variant) return;
    const index = (config.variants || []).indexOf(name);
    if (index < 0) return;
    const previous = applied;
    variant = name;
    const request = ++variantRequest;
    const parser = gltf.parser;
    let materials;
    try {
      materials = await Promise.all(
        variantMeshes.map(({ mappings, base }) => {
          const mapping = mappings.find(
            (m) => Array.isArray(m.variants) && m.variants.includes(index),
          );
          return mapping ? parser.getDependency('material', mapping.material) : base;
        }),
      );
    } catch {
      if (request === variantRequest) variant = previous;
      return;
    }
    if (request !== variantRequest) return;
    applied = name;
    variantMeshes.forEach((entry, i) => {
      entry.mesh.material = materials[i];
    });
    el.setAttribute('data-ak-3d-finish', name);
    for (const button of variantButtons)
      button.setAttribute(
        'aria-pressed',
        button.getAttribute('data-ak-3d-variant') === name ? 'true' : 'false',
      );
    requestRender();
  }
  const onClip = (event) => {
    const name = event.currentTarget.getAttribute('data-ak-3d-clip');
    if (config.clipBind) api.setPath(config.clipBind, name);
    else setClip(name);
  };
  const onVariant = (event) => {
    const name = event.currentTarget.getAttribute('data-ak-3d-variant');
    if (config.variantBind) api.setPath(config.variantBind, name);
    else setVariant(name);
  };

  // Orbit, pan and zoom: drag orbits, right or shift drag pans, wheel and pinch zoom.
  const spherical = { r: 0, theta: 0, phi: 0 };
  function readSpherical() {
    const offset = camera.position.clone().sub(target);
    spherical.r = offset.length();
    spherical.theta = Math.atan2(offset.x, offset.z);
    spherical.phi = Math.acos(MathUtils.clamp(offset.y / spherical.r, -1, 1));
  }
  const reach = { min: 0.05, max: 2000 };
  function applySpherical() {
    spherical.phi = MathUtils.clamp(spherical.phi, 0.1, Math.PI - 0.1);
    spherical.r = MathUtils.clamp(spherical.r, reach.min, reach.max);
    const sinPhi = Math.sin(spherical.phi);
    camera.position.set(
      target.x + spherical.r * sinPhi * Math.sin(spherical.theta),
      target.y + spherical.r * Math.cos(spherical.phi),
      target.z + spherical.r * sinPhi * Math.cos(spherical.theta),
    );
    camera.lookAt(target);
    requestRender();
  }
  function pan(dx, dy) {
    const scale =
      (spherical.r * Math.tan(MathUtils.degToRad(camera.fov / 2)) * 2) /
      (stage.clientHeight || 360);
    const right = new Vector3().setFromMatrixColumn(camera.matrix, 0).multiplyScalar(-dx * scale);
    const up = new Vector3().setFromMatrixColumn(camera.matrix, 1).multiplyScalar(dy * scale);
    target.add(right).add(up);
    camera.position.add(right).add(up);
    requestRender();
  }
  readSpherical();
  const pointers = new Map();
  let pinch = 0;
  let panning = false;
  let engaged = false;
  canvas.addEventListener('focus', () => {
    engaged = true;
  });
  canvas.addEventListener('blur', () => {
    engaged = false;
  });
  const onPointerDown = (event) => {
    engaged = true;
    canvas.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    panning = event.button === 2 || event.shiftKey;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };
  const onPointerMove = (event) => {
    const last = pointers.get(event.pointerId);
    if (!last) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0) {
        spherical.r *= pinch / distance;
        applySpherical();
      }
      pinch = distance;
      return;
    }
    const dx = event.clientX - last.x;
    const dy = event.clientY - last.y;
    if (panning) pan(dx, dy);
    else {
      spherical.theta -= dx * 0.01;
      spherical.phi -= dy * 0.01;
      applySpherical();
    }
  };
  const onPointerUp = (event) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = 0;
    panning = false;
  };
  // The wheel zooms only once the reader has engaged the stage, so page scroll never sticks.
  const onWheel = (event) => {
    if (!engaged && !event.ctrlKey) return;
    event.preventDefault();
    spherical.r *= event.deltaY > 0 ? 1.1 : 0.9;
    applySpherical();
  };
  const onMenu = (event) => event.preventDefault();
  const order = hotspots.map((h) => h.spec.id);
  const onKey = (event) => {
    const key = event.key;
    const step = 24;
    if (event.shiftKey && key.startsWith('Arrow')) {
      if (key === 'ArrowLeft') pan(step, 0);
      else if (key === 'ArrowRight') pan(-step, 0);
      else if (key === 'ArrowUp') pan(0, step);
      else pan(0, -step);
      event.preventDefault();
      return;
    }
    if (key === 'ArrowLeft') spherical.theta -= 0.15;
    else if (key === 'ArrowRight') spherical.theta += 0.15;
    else if (key === 'ArrowUp') spherical.phi -= 0.15;
    else if (key === 'ArrowDown') spherical.phi += 0.15;
    else if (key === '+' || key === '=') spherical.r *= 0.9;
    else if (key === '-') spherical.r *= 1.1;
    else if (key === 'Home' || key === '0') {
      camera.position.copy(home.position);
      target.copy(home.target);
      camera.lookAt(target);
      readSpherical();
    } else if ((key === 'Enter' || key === ' ' || key === 'n' || key === 'p') && order.length) {
      const at = order.indexOf(selected);
      const dir = key === 'p' ? -1 : 1;
      select(order[(at + dir + order.length) % order.length]);
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
  canvas.addEventListener('contextmenu', onMenu);
  canvas.addEventListener('keydown', onKey);

  // Fit the real model with the stage's real aspect: the compiler only guessed both.
  let fitBox = null;
  const corner = new Vector3();
  /** The model's projected extent in NDC from this camera, or null when it is behind. */
  function extent(center, direction, distance) {
    camera.position.copy(center).addScaledVector(direction, distance);
    camera.lookAt(center);
    camera.updateMatrixWorld();
    const out = { x0: 1, x1: -1, y0: 1, y1: -1 };
    for (let i = 0; i < 8; i += 1) {
      corner.set(
        i & 1 ? fitBox.max.x : fitBox.min.x,
        i & 2 ? fitBox.max.y : fitBox.min.y,
        i & 4 ? fitBox.max.z : fitBox.min.z,
      );
      if (corner.applyMatrix4(camera.matrixWorldInverse).z >= 0) return null;
      corner.applyMatrix4(camera.projectionMatrix);
      out.x0 = Math.min(out.x0, corner.x);
      out.x1 = Math.max(out.x1, corner.x);
      out.y0 = Math.min(out.y0, corner.y);
      out.y1 = Math.max(out.y1, corner.y);
    }
    return out;
  }
  // Centre the projected model, then move in until it reaches the margin; twice, since each step moves the other.
  function fitHome() {
    if (!fitBox || config.cameraAuthored) return;
    const atHome =
      camera.position.distanceTo(home.position) < 1e-6 && target.distanceTo(home.target) < 1e-6;
    if (!atHome) return;
    const direction = home.position.clone().sub(home.target).normalize();
    const center = fitBox.getCenter(new Vector3());
    const right = new Vector3();
    const up = new Vector3();
    let distance = fitBox.getSize(new Vector3()).length() * 2;
    for (let pass = 0; pass < 3; pass += 1) {
      let near = 0;
      let far = distance * 20;
      for (let k = 0; k < 40; k += 1) {
        const mid = (near + far) / 2;
        const e = extent(center, direction, mid);
        if (e && e.x0 >= -0.9 && e.x1 <= 0.9 && e.y0 >= -0.86 && e.y1 <= 0.86) far = mid;
        else near = mid;
      }
      distance = far;
      const e = extent(center, direction, distance);
      if (!e) break;
      const halfH = distance * Math.tan(MathUtils.degToRad(camera.fov / 2));
      right.setFromMatrixColumn(camera.matrixWorld, 0);
      up.setFromMatrixColumn(camera.matrixWorld, 1);
      center
        .addScaledVector(right, ((e.x0 + e.x1) / 2) * halfH * camera.aspect)
        .addScaledVector(up, ((e.y0 + e.y1) / 2) * halfH);
    }
    home.target.copy(center);
    home.position.copy(center).addScaledVector(direction, distance);
    target.copy(home.target);
    camera.position.copy(home.position);
    camera.lookAt(target);
    readSpherical();
  }

  function resize() {
    const width = stage.clientWidth || 640;
    const height = stage.clientHeight || 360;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    fitHome();
    requestRender();
  }
  const resizeObserver = window.ResizeObserver ? new ResizeObserver(resize) : null;
  resizeObserver?.observe(stage);

  const projected = new Vector3();
  function placePins() {
    const width = stage.clientWidth || 640;
    const height = stage.clientHeight || 360;
    for (const { pin, at } of hotspots) {
      projected.copy(at).project(camera);
      const visible =
        projected.z < 1 && Math.abs(projected.x) <= 1.05 && Math.abs(projected.y) <= 1.05;
      pin.hidden = !visible;
      if (visible)
        pin.style.transform = `translate(${((projected.x + 1) / 2) * width}px,${((1 - projected.y) / 2) * height}px)`;
    }
  }

  const record = {
    el,
    visible: true,
    lost: false,
    animating: false,
    frames: 0,
    renderMs: [],
    tick(now) {
      const dt = lastTick ? Math.min(0.1, (now - lastTick) / 1000) : 0;
      lastTick = now;
      if (mixer && motion && record.animating) mixer.update(dt);
      const begin = performance.now();
      renderer.render(scene, camera);
      record.renderMs.push(performance.now() - begin);
      if (record.renderMs.length > kit.RENDER_SAMPLES) record.renderMs.shift();
      placePins();
      if (!gltf) return;
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
    sync() {
      if (config.bind) {
        const value = api.readPath(config.bind);
        if (typeof value === 'string' && value !== selected && order.includes(value))
          highlight(value);
      }
      if (config.clipBind) {
        const value = api.readPath(config.clipBind);
        if (typeof value === 'string') setClip(value);
      }
      if (config.variantBind) {
        const value = api.readPath(config.variantBind);
        if (typeof value === 'string') setVariant(value);
      }
    },
    unmount() {
      cancelVisibility();
      resizeObserver?.disconnect();
      for (const button of buttons) {
        button.removeEventListener('click', onPick);
        button.disabled = true;
      }
      for (const button of clipButtons) {
        button.removeEventListener('click', onClip);
        button.disabled = true;
      }
      for (const button of variantButtons) {
        button.removeEventListener('click', onVariant);
        button.disabled = true;
      }
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onMenu);
      canvas.removeEventListener('keydown', onKey);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      mixer?.stopAllAction();
      gltf?.scene.traverse((object) => {
        if (!object.isMesh) return;
        object.geometry?.dispose();
        const list = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of list) {
          for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
          material.dispose();
        }
      });
      for (const resource of owned) resource.dispose();
      environment.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      stage.querySelector('.ak-3d-frame')?.remove();
      stage.querySelector('.ak-3d-error')?.remove();
      pins.remove();
      canvas.remove();
      kit.mounts.delete(record);
      gltf = null;
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

  function onLoaded(result) {
    if (!kit.mounts.has(record)) return;
    gltf = result;
    const model = result.scene;
    model.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = renderer.shadowMap.enabled;
      object.receiveShadow = renderer.shadowMap.enabled;
      const association = result.parser.associations.get(object);
      const meshDef = association && result.parser.json.meshes?.[association.meshes];
      const primitive = meshDef?.primitives?.[association.primitives ?? 0];
      const mappings = primitive?.extensions?.KHR_materials_variants?.mappings;
      if (Array.isArray(mappings))
        variantMeshes.push({ mesh: object, mappings, base: object.material });
    });
    scene.add(model);
    // The floor catches the key light's shadow just under the model.
    const box = new Box3().setFromObject(model);
    if (!box.isEmpty()) {
      const size = box.getSize(new Vector3()).length();
      // Leave room under the model for its contact shadow.
      fitBox = box.clone();
      fitBox.min.y -= size * 0.03;
      for (const hotspot of hotspots) fitBox.expandByPoint(hotspot.at);
      // Clip planes follow the model's scale, so a large model never falls past far.
      camera.near = size * 1e-2;
      camera.far = size * 1e3;
      camera.updateProjectionMatrix();
      fitHome();
      reach.min = size * 0.15;
      reach.max = size * 20;
      if (renderer.shadowMap.enabled) {
        const floorGeometry = new PlaneGeometry(size * 4, size * 4);
        const floorMaterial = kit.shadowMaterial(el);
        owned.push(floorGeometry, floorMaterial);
        const floor = new Mesh(floorGeometry, floorMaterial);
        floor.rotation.x = -Math.PI / 2;
        floor.position.set(
          box.getCenter(new Vector3()).x,
          box.min.y,
          box.getCenter(new Vector3()).z,
        );
        floor.receiveShadow = true;
        scene.add(floor);
        const key = scene.children.find((child) => child.castShadow && child.isDirectionalLight);
        if (key) {
          const half = size;
          Object.assign(key.shadow.camera, {
            left: -half,
            right: half,
            top: half,
            bottom: -half,
            far: size * 40,
          });
          key.shadow.camera.updateProjectionMatrix();
          key.position.multiplyScalar(Math.max(1, size / 4));
        }
      }
    }
    mixer = new AnimationMixer(model);
    for (const button of buttons) {
      button.disabled = false;
      button.addEventListener('click', onPick);
    }
    for (const button of clipButtons) {
      button.disabled = false;
      button.addEventListener('click', onClip);
    }
    for (const button of variantButtons) {
      button.disabled = false;
      button.addEventListener('click', onVariant);
    }
    const initial = config.bind && api.readPath(config.bind);
    if (typeof initial === 'string' && order.includes(initial)) highlight(initial);
    record.sync();
    // Without a bound clip the first one plays, so an animated model moves on its own.
    if (!clip && typeof config.clip === 'string') setClip(config.clip);
    if (record.animating) kit.schedule();
    requestRender();
  }
  function onFailed(error) {
    if (!kit.mounts.has(record)) return;
    el.setAttribute('data-ak-3d-state', 'error');
    const note = document.createElement('p');
    note.className = 'ak-3d-error';
    note.setAttribute('role', 'status');
    note.textContent = loadFailure(error);
    stage.appendChild(note);
    canvas.hidden = true;
  }

  kit.mounts.add(record);
  el.setAttribute('data-ak-3d-state', 'loading');
  resize();
  new GLTFLoader().loadAsync(config.src).then(onLoaded, onFailed);
  return record;
}
