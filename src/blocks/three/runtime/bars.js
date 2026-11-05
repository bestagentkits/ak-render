/**
 * Bars 3D runtime: the scene runtime builds one box per bar from the compiled
 * config; this adds the zero plane, gridlines and screen-space axis labels,
 * colours the series from the legend's resolved tokens, and eases bars between
 * the precomputed layouts when the series filter changes. Under reduced motion
 * every change is immediate.
 */

import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector3,
} from 'three';

const GROW_MS = 900;
const FILTER_MS = 520;
/** Room kept between two axis labels, in CSS pixels; a label that would crowd another is skipped. */
const LABEL_GAP = 6;
/** Share of the stage width the chart spans once framed, and the most of its height. */
const FILL_X = 0.84;
const FILL_Y = 0.78;
/** Least share of the stage height a framed chart should span before the view tilts down. */
const MIN_HEIGHT = 0.68;

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

/**
 * Any CSS colour (oklch included) as a three.js colour: paint one pixel and read it back,
 * so the bars take exactly the colour the legend swatch shows.
 */
function resolvedColor(css, probe) {
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = '#000';
  probe.fillStyle = css;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  if (!a) return null;
  return new Color().setRGB(r / 255, g / 255, b / 255, 'srgb');
}

const ease = (k) => 1 - (1 - k) ** 3;

/**
 * Frame the box from the camera's current direction for one aspect: search the distance at
 * which its projection fills the stage, then slide the target so it sits centred.
 */
function fitBox(camera, target, base, corners, aspect, pad) {
  // A shallow chart framed by its width leaves the stage half empty; look down more
  // steeply, a step at a time, until the depth axis fills the height.
  const flat = Math.hypot(base.x, base.z) || 1;
  const start = Math.atan2(base.y, flat);
  let fit = null;
  for (let tilt = 0; tilt <= 0.4 + 1e-9; tilt += 0.05) {
    const elevation = Math.min(1.05, start + tilt);
    const scale = Math.cos(elevation) / flat;
    const dir = new Vector3(base.x * scale, Math.sin(elevation), base.z * scale).normalize();
    fit = fitFrom(camera, target, dir, corners, aspect, pad);
    if (fit.height >= MIN_HEIGHT || elevation >= 1.05) break;
  }
  return { position: fit.position, target: fit.target };
}

function fitFrom(camera, target, dir, corners, aspect, pad) {
  const probe = camera.clone();
  probe.aspect = aspect;
  probe.updateProjectionMatrix();
  const aim = target.clone();
  const point = new Vector3();
  const bounds = (distance) => {
    probe.position.copy(aim).addScaledVector(dir, distance);
    probe.lookAt(aim);
    probe.updateMatrixWorld();
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const corner of corners) {
      point.copy(corner).project(probe);
      x0 = Math.min(x0, point.x);
      x1 = Math.max(x1, point.x);
      y0 = Math.min(y0, point.y);
      y1 = Math.max(y1, point.y);
    }
    return [x0, y0, x1, y1];
  };
  let distance = camera.position.distanceTo(target);
  for (let pass = 0; pass < 3; pass += 1) {
    let lo = distance * 0.2;
    let hi = distance * 5;
    for (let i = 0; i < 32; i += 1) {
      const mid = (lo + hi) / 2;
      const [x0, y0, x1, y1] = bounds(mid);
      if ((x1 - x0) / 2 > FILL_X - pad || (y1 - y0) / 2 > FILL_Y) lo = mid;
      else hi = mid;
    }
    distance = hi;
    const [x0, y0, x1, y1] = bounds(distance);
    // Slide the aim along the view plane by the projected offset of the box centre.
    const right = new Vector3().setFromMatrixColumn(probe.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(probe.matrixWorld, 1);
    const halfH = Math.tan((probe.fov * Math.PI) / 360) * distance;
    aim.addScaledVector(right, ((x0 + x1) / 2 - pad) * halfH * aspect);
    aim.addScaledVector(up, ((y0 + y1) / 2) * halfH);
  }
  const [, y0, , y1] = bounds(distance);
  const position = aim.clone().addScaledVector(dir, distance);
  return { position: position.toArray(), target: aim.toArray(), height: (y1 - y0) / 2 };
}

export function barsWidget(ctx) {
  const { el, config, scene, nodes, motion, camera } = ctx;
  const bars = config.bars;
  if (!bars) return null;
  const owned = [];
  const ink = readColor(el, '--ak-color-text', '#222222');
  const muted = readColor(el, '--ak-color-text-muted', '#666666');
  const [x0, x1, z0, z1] = bars.extent;
  const ticks = bars.ticks;
  const yLo = ticks.length ? ticks[0][0] : 0;
  const yHi = ticks.length ? ticks[ticks.length - 1][0] : 1;
  const span = Math.max(yHi - yLo, 1);
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
  // Gridlines take the muted text colour, so they hold on dark stages as well as light ones.
  for (const [points, color, opacity] of [
    [grid, muted, 0.45],
    [zero, ink, 0.85],
  ]) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
    const material = new LineBasicMaterial({ color, transparent: true, opacity });
    owned.push(geometry, material);
    scene.add(new LineSegments(geometry, material));
  }

  // Axis labels are page text over the canvas: crisp, sized in CSS pixels at every width,
  // and thinned by their projected spacing so none overlaps another. Ticks win, then
  // categories, then series rows.
  const stage = el.querySelector('.ak-3d-stage') || el;
  const layer = document.createElement('div');
  layer.className = 'ak-bars-labels';
  layer.setAttribute('aria-hidden', 'true');
  stage.appendChild(layer);
  const labels = [];
  const addLabel = (text, at, kind) => {
    const node = document.createElement('span');
    node.className = `ak-bars-label ak-bars-label-${kind}`;
    node.textContent = text;
    layer.appendChild(node);
    labels.push({ node, at, kind, w: 0, h: 0 });
  };
  for (const [y, value] of ticks)
    addLabel(value, new Vector3(left, y, z1 + 0.3), Math.abs(y) < 1e-6 ? 'zero' : 'tick');
  // Each category label hangs just under its own column, not the chart's lowest bar.
  const per = bars.series.length;
  bars.categories.forEach(([x, name], c) => {
    const column = bars.layouts[''].slice(c * per, (c + 1) * per);
    const bottom = Math.min(0, ...column.map((pair) => pair[0]));
    addLabel(name, new Vector3(x, bottom, z1 + 0.35), 'cat');
  });
  for (const [z, name] of bars.rows) addLabel(name, new Vector3(x1 + 0.5, 0, z), 'row');
  const groups = ['tick', 'cat', 'row'].map((kind) =>
    labels.filter((label) =>
      kind === 'tick' ? label.kind !== 'cat' && label.kind !== 'row' : label.kind === kind,
    ),
  );
  // What framing fits: the bars and zero plane, the back wall's gridlines and the left wall's.
  // Labels use the margin left over.
  const top = Math.max(0, ...bars.layouts[''].map((pair) => pair[1]));
  // The compiled view direction; each aspect tilts from it, never from a previous fit.
  const baseDir = camera.position.clone().sub(ctx.target).normalize();
  const corners = [];
  for (const x of [left, x1 + 0.3])
    for (const y of [floor, top])
      for (const z of [back, z1 + 0.3]) corners.push(new Vector3(x, y, z));
  for (const y of [yLo, yHi])
    for (const [x, z] of [
      [left, back],
      [x1 + 0.3, back],
      [left, z1 + 0.3],
    ])
      corners.push(new Vector3(x, y, z));
  const projected = new Vector3();
  let measured = false;
  function measure() {
    if (measured || !stage.clientWidth) return;
    for (const label of labels) {
      label.w = label.node.offsetWidth;
      label.h = label.node.offsetHeight;
    }
    measured = true;
  }
  function placeLabels() {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (!width || !height) return;
    measure();
    // Each group keeps every nth label, with the smallest n at which none crowds another.
    const kept = [];
    const overlaps = (rect, other) =>
      !(
        rect[2] + LABEL_GAP <= other[0] ||
        other[2] + LABEL_GAP <= rect[0] ||
        rect[3] + LABEL_GAP / 2 <= other[1] ||
        other[3] + LABEL_GAP / 2 <= rect[1]
      );
    for (const group of groups) {
      const placed = group.map((label, index) => {
        projected.copy(label.at).project(camera);
        const px = ((projected.x + 1) / 2) * width;
        const py = ((1 - projected.y) / 2) * height;
        // Ticks end at their gridline, categories hang under the chart, rows start right of it.
        const x =
          label.kind === 'cat'
            ? px - label.w / 2
            : label.kind === 'row'
              ? px + 4
              : px - label.w - 6;
        const y = label.kind === 'cat' ? py + 4 : py - label.h / 2;
        label.x = Math.round(x);
        label.y = Math.round(y);
        const inset = label.kind === 'cat' ? 0 : label.h * 0.2;
        const rect = [x, y + inset, x + label.w, y + label.h - inset];
        const inside =
          projected.z < 1 && rect[0] >= 0 && rect[1] >= 0 && rect[2] <= width && rect[3] <= height;
        return { label, rect, inside, index };
      });
      // Only labels on stage and clear of earlier groups compete; ticks stride from zero.
      const open = placed.filter(
        (item) => item.inside && kept.every((other) => !overlaps(item.rect, other)),
      );
      const anchor = Math.max(
        0,
        placed.findIndex((item) => item.label.kind === 'zero'),
      );
      let chosen = [];
      for (let stride = 1; stride <= open.length; stride += 1) {
        chosen = open.filter((item) => (((item.index - anchor) % stride) + stride) % stride === 0);
        if (
          chosen.every((item, a) =>
            chosen.every((other, b) => a === b || !overlaps(item.rect, other.rect)),
          )
        )
          break;
      }
      // A lone series label names one row of many; show rows only in pairs or more.
      if (group[0]?.kind === 'row' && chosen.length < 2) chosen = [];
      for (const item of placed) {
        const show = chosen.includes(item);
        item.label.node.style.transform = `translate(${item.label.x}px, ${item.label.y}px)`;
        item.label.node.hidden = !show;
        item.label.shown = show;
      }
      for (const item of chosen) kept.push(item.rect);
    }
  }

  /** The frozen frame with the axis labels painted in, so print and export keep them. */
  function annotate(canvas) {
    const width = stage.clientWidth;
    if (!width) return null;
    placeLabels();
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const g = copy.getContext('2d');
    if (!g) return null;
    g.drawImage(canvas, 0, 0);
    g.scale(canvas.width / width, canvas.height / stage.clientHeight);
    g.textBaseline = 'top';
    g.lineJoin = 'round';
    for (const label of labels) {
      if (!label.shown) continue;
      const style = getComputedStyle(label.node);
      g.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      g.strokeStyle = getComputedStyle(stage).getPropertyValue('--ak-color-surface') || '#fff';
      g.lineWidth = 3;
      const top = label.y + (label.h - parseFloat(style.fontSize)) / 2;
      g.strokeText(label.node.textContent, label.x, top);
      g.fillStyle = style.color;
      g.fillText(label.node.textContent, label.x, top);
    }
    return copy;
  }

  // The scene's fog starts at the chart's near edge, not inside it.
  if (scene.fog) {
    const radius = Math.hypot(x1 - x0, z1 - z0, span) / 2;
    const distance = camera.position.distanceTo(ctx.target);
    scene.fog.near = distance + radius;
    scene.fog.far = distance + radius * 4;
  }

  // Bars in config order, matching the flat layout lists.
  const meshes = config.objects.map((spec) => nodes.get(spec.id)?.object).filter(Boolean);
  // Each series takes the colour its legend swatch resolves to, so 3D, legend and table agree.
  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const colors = [...el.querySelectorAll('.ak-bars-swatch')].map((swatch) =>
    probe ? resolvedColor(getComputedStyle(swatch).backgroundColor, probe) : null,
  );
  meshes.forEach((mesh, i) => {
    const color = colors[i % bars.series.length];
    if (color) mesh.material.color.copy(color);
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
      placeLabels();
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
    annotate,
    /** Camera position and target that frame the chart at this stage aspect. */
    frame(aspect) {
      // Room on the left for the widest tick label, as a share of the stage's half-width.
      const width = stage.clientWidth;
      measure();
      const widest = Math.max(
        0,
        ...labels.filter((l) => l.kind !== 'cat' && l.kind !== 'row').map((l) => l.w),
      );
      const pad = width ? Math.min(0.3, (widest + 12) / width) : 0;
      return fitBox(camera, ctx.target, baseDir, corners, aspect, pad);
    },
    sync() {
      if (bars.filterBind) applyFilter(ctx.api.readPath(bars.filterBind));
    },
    dispose() {
      for (const button of filterButtons) {
        button.removeEventListener('click', onFilter);
        button.disabled = true;
      }
      for (const item of owned) item.dispose();
      layer.remove();
    },
  };
}
