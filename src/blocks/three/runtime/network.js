/**
 * The `network-3d` runtime: draws the positions the compiler laid out. Nodes
 * are one instanced mesh and links one line batch, so a thousand nodes and two
 * thousand links cost two draw calls (plus the highlight layer). Picking writes
 * the page's state through the shared `set-value` path; a group filter and an
 * outside selection are read back from state in `sync`.
 */

import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PMREMGenerator,
  Quaternion,
  Raycaster,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const FOCUS_MS = 700;

export function mountNetwork(el, kit) {
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
  const pos = config.position || [];
  const edgeList = config.edges || [];
  const radius = config.radius || [];
  const groupOf = config.group || [];
  const groups = config.groups || [];

  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', el.querySelector('.ak-3d-caption')?.textContent || 'Network');
  stage.appendChild(canvas);
  const tag = document.createElement('div');
  tag.className = 'ak-net-tag';
  tag.hidden = true;
  tag.setAttribute('aria-hidden', 'true');
  stage.appendChild(tag);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : 1));
  renderer.toneMapping = ACESFilmicToneMapping;
  const dark = kit.isDark(el);
  renderer.toneMappingExposure = dark ? 0.9 : 1.05;

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = environment;
  scene.environmentIntensity = 0.7;
  const background = kit.cssColor(el, '--ak-color-background', '#ffffff');
  const cam = config.camera || {};
  const camera = new PerspectiveCamera(cam.fov || 30, 16 / 9, 0.05, 2000);
  const home = {
    position: new Vector3(...(cam.position || [14, 10, 15])),
    target: new Vector3(...(cam.target || [0, 0, 0])),
  };
  camera.position.copy(home.position);
  const target = home.target.clone();
  camera.lookAt(target);
  const reach = home.position.distanceTo(home.target);
  // Depth cue: far nodes sink into the page background.
  scene.fog = new Fog(background, reach * 0.7, reach * 1.6);

  scene.add(new HemisphereLight(0xffffff, kit.toneColor(el, 'neutral'), dark ? 0.8 : 1.1));
  const key = new DirectionalLight(0xffffff, 2.2);
  key.position.set(5, 9, 7);
  scene.add(key);
  const rim = new DirectionalLight(0xffffff, 1.4);
  rim.position.set(-6, 4, -9);
  scene.add(rim);

  // Nodes: one instanced icosphere, colored per group.
  const toneColors = groups.map((g) => kit.toneColor(el, g.tone || 'accent'));
  const baseColor = ids.map((_, i) => toneColors[groupOf[i]] || toneColors[0] || new Color());
  const mutedTone = kit.cssColor(el, '--ak-color-text-muted', '#888888');
  const dimColor = baseColor.map((c) =>
    c
      .clone()
      .lerp(mutedTone, 0.25)
      .lerp(background, dark ? 0.5 : 0.42),
  );
  const nodeGeometry = new IcosahedronGeometry(1, quality === 'high' ? 3 : 2);
  const nodeMaterial = new MeshStandardMaterial({
    roughness: 0.32,
    metalness: 0.08,
    envMapIntensity: 1.1,
  });
  const nodes = new InstancedMesh(nodeGeometry, nodeMaterial, Math.max(1, count));
  nodes.count = count;
  const matrix = new Matrix4();
  const quat = new Quaternion();
  const scaleV = new Vector3();
  const point = (i) => new Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
  function place(i, scale) {
    scaleV.setScalar(scale);
    matrix.compose(point(i), quat, scaleV);
    nodes.setMatrixAt(i, matrix);
  }

  // Links: a shared position buffer, drawn twice — every visible link faint,
  // the selection's links bright — by swapping index lists, never vertices.
  const positionAttr = new BufferAttribute(new Float32Array(pos), 3);
  const muted = kit.cssColor(el, '--ak-color-text-muted', '#888888');
  const accent = kit.toneColor(el, 'accent');
  const dense = edgeList.length > 600;
  const baseLinks = new BufferGeometry();
  baseLinks.setAttribute('position', positionAttr);
  const linkMaterial = new LineBasicMaterial({
    color: muted,
    transparent: true,
    opacity: dense ? (dark ? 0.2 : 0.16) : dark ? 0.42 : 0.36,
    depthWrite: false,
  });
  const links = new LineSegments(baseLinks, linkMaterial);
  const hotLinks = new BufferGeometry();
  hotLinks.setAttribute('position', positionAttr);
  const hotMaterial = new LineBasicMaterial({
    color: accent,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });
  const hot = new LineSegments(hotLinks, hotMaterial);
  hot.renderOrder = 2;
  scene.add(links, hot, nodes);

  // A soft additive halo marks the selection beyond color alone.
  const haloGeometry = new SphereGeometry(1, 32, 16);
  const haloMaterial = new MeshBasicMaterial({
    color: accent,
    transparent: true,
    opacity: dark ? 0.28 : 0.2,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const halo = new Mesh(haloGeometry, haloMaterial);
  halo.visible = false;
  scene.add(halo);

  const neighbours = ids.map(() => []);
  for (let e = 0; e + 1 < edgeList.length; e += 2) {
    neighbours[edgeList[e]].push(edgeList[e + 1]);
    neighbours[edgeList[e + 1]].push(edgeList[e]);
  }

  let selected = -1;
  let filter = '';
  let hovered = -1;
  const visible = (i) => filter === '' || groups[groupOf[i]]?.id === filter;

  const pickButtons = new Map();
  for (const button of el.querySelectorAll('[data-ak-3d-pick]')) {
    pickButtons.set(button.getAttribute('data-ak-3d-pick'), button);
    button.disabled = false;
  }
  const filterButtons = [...el.querySelectorAll('[data-ak-net-filter]')];
  for (const button of filterButtons) button.disabled = false;
  const rows = new Map(
    [...el.querySelectorAll('[data-ak-net-row]')].map((row) => [
      row.getAttribute('data-ak-net-row'),
      row,
    ]),
  );
  const tableWrap = el.querySelector('.ak-net-table');

  /** Recolor, resize and re-index everything from `selected` and `filter`. */
  function paint() {
    const near = new Set(selected >= 0 ? neighbours[selected] : []);
    for (let i = 0; i < count; i += 1) {
      const shown = visible(i);
      const lit = selected < 0 || i === selected || near.has(i);
      nodes.setColorAt(i, lit ? baseColor[i] : dimColor[i]);
      const r = radius[i] || 0.1;
      place(i, shown ? (i === selected ? r * 1.45 : near.has(i) ? r * 1.15 : r) : 0);
    }
    nodes.instanceMatrix.needsUpdate = true;
    if (nodes.instanceColor) nodes.instanceColor.needsUpdate = true;
    nodes.computeBoundingSphere();
    const base = [];
    const lit = [];
    for (let e = 0; e + 1 < edgeList.length; e += 2) {
      const a = edgeList[e];
      const b = edgeList[e + 1];
      if (!visible(a) || !visible(b)) continue;
      (selected >= 0 && (a === selected || b === selected) ? lit : base).push(a, b);
    }
    baseLinks.setIndex(base);
    hotLinks.setIndex(lit);
    // With a selection, the rest of the graph steps back.
    linkMaterial.opacity =
      (dense ? (dark ? 0.2 : 0.16) : dark ? 0.42 : 0.36) * (selected >= 0 ? 0.55 : 1);
    if (selected >= 0 && visible(selected)) {
      halo.visible = true;
      halo.position.copy(point(selected));
      halo.scale.setScalar((radius[selected] || 0.1) * 2.6);
    } else halo.visible = false;
    for (const [id, button] of pickButtons)
      button.setAttribute('aria-pressed', index.get(id) === selected ? 'true' : 'false');
    for (const [id, row] of rows) {
      const i = index.get(id);
      if (near.has(i)) row.setAttribute('data-ak-net-near', '');
      else row.removeAttribute('data-ak-net-near');
      if (visible(i)) row.removeAttribute('data-ak-net-out');
      else row.setAttribute('data-ak-net-out', '');
    }
    for (const button of filterButtons)
      button.setAttribute(
        'aria-pressed',
        button.getAttribute('data-ak-net-filter') === filter ? 'true' : 'false',
      );
    el.setAttribute('data-ak-net-selected', selected >= 0 ? ids[selected] : '');
    canvas.setAttribute(
      'aria-description',
      selected >= 0 ? `Selected: ${labels[selected]}, ${neighbours[selected].length} links` : '',
    );
    requestRender();
  }

  // Camera: orbit around `target`; a focus flies target and distance to a node.
  const spherical = { r: 0, theta: 0, phi: 0 };
  function readSpherical() {
    const offset = camera.position.clone().sub(target);
    spherical.r = offset.length();
    spherical.theta = Math.atan2(offset.x, offset.z);
    spherical.phi = Math.acos(MathUtils.clamp(offset.y / spherical.r, -1, 1));
  }
  function applySpherical() {
    spherical.phi = MathUtils.clamp(spherical.phi, 0.1, Math.PI - 0.1);
    spherical.r = MathUtils.clamp(spherical.r, 0.5, reach * 3);
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
  let flight = null;
  function flyTo(aim, distance) {
    if (!kit.motionAllowed()) {
      target.copy(aim);
      spherical.r = distance;
      applySpherical();
      return;
    }
    flight = {
      start: 0,
      fromTarget: target.clone(),
      toTarget: aim.clone(),
      fromR: spherical.r,
      toR: distance,
    };
    record.animating = true;
    kit.schedule();
  }
  function focus(i) {
    // Close enough to read the neighbourhood, never closer than the node itself.
    flyTo(point(i), Math.max(reach * 0.45, (radius[i] || 0.1) * 30));
  }

  function select(i, fromState) {
    if (i < 0 || i >= count || i === selected) return;
    selected = i;
    paint();
    focus(i);
    const row = rows.get(ids[i]);
    if (row && tableWrap) {
      const top = row.offsetTop - tableWrap.clientHeight / 2;
      if (
        row.offsetTop < tableWrap.scrollTop ||
        row.offsetTop > tableWrap.scrollTop + tableWrap.clientHeight - 40
      )
        tableWrap.scrollTop = Math.max(0, top);
    }
    if (fromState) return;
    api.fire(el, 'select', { value: ids[i] });
    if (config.bind) api.setPath(config.bind, ids[i]);
  }

  const onClick = (event) => {
    const pick = event.target.closest?.('[data-ak-3d-pick]');
    if (pick && el.contains(pick)) {
      select(index.get(pick.getAttribute('data-ak-3d-pick')) ?? -1, false);
      return;
    }
    const chip = event.target.closest?.('[data-ak-net-filter]');
    if (chip && el.contains(chip)) {
      const value = chip.getAttribute('data-ak-net-filter') || '';
      if (config.filterBind) api.setPath(config.filterBind, value);
      else applyFilter(value);
    }
  };
  el.addEventListener('click', onClick);

  function applyFilter(value) {
    const next = groups.some((g) => g.id === value) ? value : '';
    if (next === filter) return;
    filter = next;
    paint();
  }

  // Pointer: drag orbits, wheel and pinch zoom, a tap picks, hover names the node.
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  function hit(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const found = raycaster.intersectObject(nodes, false)[0];
    return found ? found.instanceId : -1;
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
        const next = hit(event);
        if (next !== hovered) {
          hovered = next;
          canvas.style.cursor = next >= 0 ? 'pointer' : '';
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
        spherical.r *= pinch / distance;
        applySpherical();
      }
      pinch = distance;
      return;
    }
    spherical.theta -= (event.clientX - last.x) * 0.008;
    spherical.phi -= (event.clientY - last.y) * 0.008;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    applySpherical();
  };
  const onPointerUp = (event) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = 0;
    if (downAt && Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) < 6) {
      const i = hit(event);
      if (i >= 0) select(i, false);
    }
    downAt = null;
  };
  const onLeave = () => {
    if (hovered < 0) return;
    hovered = -1;
    canvas.style.cursor = '';
    requestRender();
  };
  const onWheel = (event) => {
    event.preventDefault();
    flight = null;
    spherical.r *= event.deltaY > 0 ? 1.1 : 0.9;
    applySpherical();
  };
  // Keys: arrows orbit, +/- zoom, n/p walk the nodes, Escape returns home.
  const onKey = (event) => {
    const k = event.key;
    if (k === 'ArrowLeft') spherical.theta -= 0.15;
    else if (k === 'ArrowRight') spherical.theta += 0.15;
    else if (k === 'ArrowUp') spherical.phi -= 0.15;
    else if (k === 'ArrowDown') spherical.phi += 0.15;
    else if (k === '+' || k === '=') spherical.r *= 0.9;
    else if (k === '-') spherical.r *= 1.1;
    else if (k === 'Escape') {
      flyTo(home.target, home.position.distanceTo(home.target));
      event.preventDefault();
      return;
    } else if ((k === 'n' || k === 'p' || k === 'Enter') && count > 0) {
      const step = k === 'p' ? -1 : 1;
      let i = selected;
      for (let tries = 0; tries < count; tries += 1) {
        i = (i + step + count) % count;
        if (visible(i)) break;
      }
      select(i, false);
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
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('keydown', onKey);

  function resize() {
    const width = stage.clientWidth || 640;
    const height = stage.clientHeight || 360;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    requestRender();
  }
  const resizeObserver = window.ResizeObserver ? new ResizeObserver(resize) : null;
  resizeObserver?.observe(stage);

  /** The name tag follows the hovered node, else the selection. */
  const projected = new Vector3();
  function placeTag() {
    const i = hovered >= 0 ? hovered : selected;
    if (i < 0 || !visible(i)) {
      tag.hidden = true;
      return;
    }
    projected.copy(point(i)).project(camera);
    if (projected.z > 1) {
      tag.hidden = true;
      return;
    }
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    tag.hidden = false;
    tag.textContent = labels[i];
    const small = document.createElement('small');
    small.textContent = `${groups[groupOf[i]]?.label || ''} · ${neighbours[i].length} links`;
    tag.appendChild(small);
    tag.style.left = `${((projected.x + 1) / 2) * width}px`;
    tag.style.top = `${((1 - projected.y) / 2) * height}px`;
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
        const k = Math.min(1, (now - flight.start) / FOCUS_MS);
        const eased = k * k * (3 - 2 * k);
        target.lerpVectors(flight.fromTarget, flight.toTarget, eased);
        spherical.r = flight.fromR + (flight.toR - flight.fromR) * eased;
        spherical.phi = MathUtils.clamp(spherical.phi, 0.1, Math.PI - 0.1);
        const sinPhi = Math.sin(spherical.phi);
        camera.position.set(
          target.x + spherical.r * sinPhi * Math.sin(spherical.theta),
          target.y + spherical.r * Math.cos(spherical.phi),
          target.z + spherical.r * sinPhi * Math.cos(spherical.theta),
        );
        camera.lookAt(target);
        if (k >= 1) flight = null;
      }
      record.animating = flight !== null;
      const begin = performance.now();
      renderer.render(scene, camera);
      record.renderMs.push(performance.now() - begin);
      if (record.renderMs.length > kit.RENDER_SAMPLES) record.renderMs.shift();
      placeTag();
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
    freeze() {
      if (record.lost || record.frames === 0) return null;
      if (stage.querySelector('.ak-3d-frame'))
        return { width: canvas.width, height: canvas.height };
      if (flight) {
        target.copy(flight.toTarget);
        spherical.r = flight.toR;
        flight = null;
        applySpherical();
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
      }
      if (config.filterBind) {
        const value = api.readPath(config.filterBind);
        applyFilter(typeof value === 'string' ? value : '');
      }
    },
    unmount() {
      cancelVisibility();
      resizeObserver?.disconnect();
      el.removeEventListener('click', onClick);
      for (const button of pickButtons.values()) button.disabled = true;
      for (const button of filterButtons) button.disabled = true;
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
        nodeGeometry,
        nodeMaterial,
        baseLinks,
        hotLinks,
        linkMaterial,
        hotMaterial,
        haloGeometry,
        haloMaterial,
        environment,
        pmrem,
      ])
        disposable.dispose();
      nodes.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      stage.querySelector('.ak-3d-frame')?.remove();
      tag.remove();
      canvas.remove();
      kit.mounts.delete(record);
      el.removeAttribute('data-ak-net-selected');
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
  paint();
  resize();
  // An initial selection from state shows its neighbourhood without flying: the page opens framed.
  const initial = config.bind && api.readPath(config.bind);
  if (typeof initial === 'string' && index.has(initial)) {
    selected = index.get(initial);
    paint();
  }
  if (config.filterBind) {
    const value = api.readPath(config.filterBind);
    if (typeof value === 'string') applyFilter(value);
  }
  record.tick(performance.now());
  return record;
}
