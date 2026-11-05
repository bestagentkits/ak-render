/**
 * Bars 3D runtime: the scene runtime builds one box per bar from the compiled
 * config; this adds the zero plane, axes and labels, and eases bars between
 * the precomputed layouts when the series filter changes. Under reduced
 * motion every change is immediate.
 */

import {
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
} from 'three';

const GROW_MS = 900;
const FILTER_MS = 520;
/** Most labels drawn along one axis; denser axes label every nth entry. */
const MAX_LABELS = 16;

function readColor(el, name, fallback) {
  const color = new Color(fallback);
  const raw = getComputedStyle(el).getPropertyValue(name).trim();
  try {
    if (raw) color.setStyle(raw);
  } catch (_error) {
    // Keep the fallback.
  }
  return color;
}

/** A text label as a camera-facing sprite, sized in scene units by its height. */
function label(text, color, height, owned, align = 'center') {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const px = 48;
  const font = `600 ${px}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  context.font = font;
  const width = Math.ceil(context.measureText(text).width) + 16;
  canvas.width = width;
  canvas.height = px + 16;
  context.font = font;
  context.fillStyle = `#${color.getHexString()}`;
  context.textBaseline = 'middle';
  context.textAlign = align === 'right' ? 'right' : align === 'left' ? 'left' : 'center';
  const x = align === 'right' ? width - 8 : align === 'left' ? 8 : width / 2;
  context.fillText(text, x, canvas.height / 2);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  owned.push(texture, material);
  const sprite = new Sprite(material);
  sprite.scale.set((height * canvas.width) / canvas.height, height, 1);
  // Anchor the text edge, not its centre, on right or left aligned labels.
  sprite.center.set(align === 'right' ? 1 : align === 'left' ? 0 : 0.5, 0.5);
  sprite.renderOrder = 2;
  // Axis text sits on the chart's open edges; it never hides behind a bar or the floor.
  material.depthTest = false;
  return sprite;
}

const ease = (k) => 1 - (1 - k) ** 3;

export function barsWidget(ctx) {
  const { el, config, scene, nodes, motion } = ctx;
  const bars = config.bars;
  if (!bars) return null;
  const owned = [];
  const ink = readColor(el, '--ak-color-text', '#222222');
  const muted = readColor(el, '--ak-color-text-muted', '#666666');
  const border = readColor(el, '--ak-color-border', '#cccccc');
  const [x0, x1, z0, z1] = bars.extent;
  const ticks = bars.ticks;
  const yLo = ticks.length ? ticks[0][0] : 0;
  const yHi = ticks.length ? ticks[ticks.length - 1][0] : 1;
  const span = Math.max(yHi - yLo, 1);
  const text = Math.min(1.1, Math.max(0.26, Math.max(x1 - x0, span) * 0.022));
  // The lowest bar bottom: category labels hang just under it.
  const floor = Math.min(0, ...bars.layouts[''].map((pair) => pair[0]));

  // The zero plane: a faint floor at value 0, so above and below read at a glance.
  const plane = new Mesh(
    new PlaneGeometry(x1 - x0 + 0.6, z1 - z0 + 0.6),
    new MeshBasicMaterial({
      color: ink,
      transparent: true,
      opacity: 0.06,
      side: DoubleSide,
      depthWrite: false,
    }),
  );
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = 0.001;
  owned.push(plane.geometry, plane.material);
  scene.add(plane);

  // Gridlines on the back wall and the left wall at each tick; the zero line in full ink.
  const back = z0 - 0.3;
  const left = x0 - 0.3;
  const grid = [];
  const zero = [];
  for (const [y] of ticks) {
    const target = Math.abs(y) < 1e-6 ? zero : grid;
    target.push(left, y, back, x1 + 0.3, y, back, left, y, back, left, y, z1 + 0.3);
  }
  zero.push(left, 0, z1 + 0.3, x1 + 0.3, 0, z1 + 0.3, x1 + 0.3, 0, back, x1 + 0.3, 0, z1 + 0.3);
  grid.push(left, yLo, back, left, yHi, back);
  for (const [points, color, opacity] of [
    [grid, border, 0.9],
    [zero, ink, 0.85],
  ]) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
    const material = new LineBasicMaterial({ color, transparent: true, opacity });
    owned.push(geometry, material);
    scene.add(new LineSegments(geometry, material));
  }

  for (const [y, value] of ticks) {
    const sprite = label(value, Math.abs(y) < 1e-6 ? ink : muted, text, owned, 'right');
    sprite.position.set(left - 0.15, y, z1 + 0.3);
    scene.add(sprite);
  }
  const every = (count) => Math.max(1, Math.ceil(count / MAX_LABELS));
  const step = every(bars.categories.length);
  bars.categories.forEach(([x, name], i) => {
    if (i % step) return;
    const sprite = label(name, muted, text, owned);
    sprite.position.set(x, floor - text * 0.45, z1 + 0.45);
    scene.add(sprite);
  });
  // Deep rows crowd at this angle; past six the legend names them instead.
  const rows = bars.rows.length <= 6 ? bars.rows : [];
  rows.forEach(([z, name]) => {
    const sprite = label(name, muted, text, owned, 'left');
    sprite.position.set(x1 + 0.45, 0, z);
    scene.add(sprite);
  });

  // The scene's fog starts at the chart's near edge, not inside it.
  if (scene.fog) {
    const radius = Math.hypot(x1 - x0, z1 - z0, span) / 2;
    const distance = ctx.camera.position.distanceTo(ctx.target);
    scene.fog.near = distance + radius;
    scene.fog.far = distance + radius * 4;
  }

  // Bars in config order, matching the flat layout lists.
  const meshes = config.objects.map((spec) => nodes.get(spec.id)?.object).filter(Boolean);
  // A series past the sixth reuses a tone, one shade deeper, as the legend shows.
  meshes.forEach((mesh, i) => {
    const shade = bars.shades?.[i % bars.series.length] || 0;
    if (shade) mesh.material.color.multiplyScalar(0.68 ** shade);
  });
  const layouts = bars.layouts;
  const columns = bars.series.length;
  const set = (mesh, bottom, top) => {
    const h = Math.max(top - bottom, 0.001);
    mesh.scale.y = h;
    mesh.position.y = bottom + h / 2;
    mesh.visible = top - bottom > 0.0005;
  };
  const current = layouts[''].map((pair) => pair.slice());
  let filter = '';
  let tween = null;

  function to(key, duration, stagger) {
    const target = layouts[key] || layouts[''];
    if (!motion) {
      meshes.forEach((mesh, i) => {
        set(mesh, target[i][0], target[i][1]);
      });
      target.forEach((pair, i) => {
        current[i] = pair.slice();
      });
      tween = null;
      ctx.requestRender();
      return;
    }
    tween = { from: current.map((pair) => pair.slice()), target, start: 0, duration, stagger };
    ctx.animate();
  }

  function applyFilter(value) {
    const key = typeof value === 'string' && layouts[value] ? value : '';
    if (key === filter) return;
    filter = key;
    for (const button of filterButtons)
      button.setAttribute(
        'aria-pressed',
        button.getAttribute('data-ak-bars-filter') === key ? 'true' : 'false',
      );
    to(key, FILTER_MS, 0);
  }

  const filterButtons = Array.prototype.slice.call(el.querySelectorAll('[data-ak-bars-filter]'));
  const onFilter = (event) => {
    const value = event.currentTarget.getAttribute('data-ak-bars-filter');
    if (bars.filterBind) ctx.api.setPath(bars.filterBind, value);
    applyFilter(value);
  };
  for (const button of filterButtons) {
    button.disabled = false;
    button.addEventListener('click', onFilter);
  }

  // Bars rise from the baseline once, category by category, when motion is allowed.
  if (motion) {
    for (const pair of current) pair.splice(0, 2, 0, 0);
    for (const mesh of meshes) set(mesh, 0, 0);
    tween = {
      from: current.map((pair) => pair.slice()),
      target: layouts[''],
      start: 0,
      duration: GROW_MS,
      stagger: Math.min(420, 18 * (meshes.length / columns)),
    };
  }

  const settle = () => {
    if (!tween) return;
    tween.target.forEach((pair, i) => {
      current[i] = pair.slice();
      set(meshes[i], pair[0], pair[1]);
    });
    tween = null;
  };

  return {
    /** Advance the transition; true while bars are still moving. */
    tick(now) {
      if (!tween) return false;
      if (!tween.start) tween.start = now;
      const elapsed = now - tween.start;
      const rows = meshes.length / columns;
      let moving = false;
      meshes.forEach((mesh, i) => {
        const delay = tween.stagger * (Math.floor(i / columns) / Math.max(rows - 1, 1));
        const k = Math.min(1, Math.max(0, (elapsed - delay) / tween.duration));
        if (k < 1) moving = true;
        const e = ease(k);
        const [fb, ft] = tween.from[i];
        const [tb, tt] = tween.target[i];
        current[i][0] = fb + (tb - fb) * e;
        current[i][1] = ft + (tt - ft) * e;
        set(mesh, current[i][0], current[i][1]);
      });
      if (!moving) tween = null;
      return moving;
    },
    settle,
    sync() {
      if (bars.filterBind) applyFilter(ctx.api.readPath(bars.filterBind));
    },
    dispose() {
      for (const button of filterButtons) {
        button.removeEventListener('click', onFilter);
        button.disabled = true;
      }
      for (const item of owned) item.dispose();
    },
  };
}
