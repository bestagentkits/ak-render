/**
 * Timeline 3D runtime: the scene runtime lights, stages and picks the milestone
 * markers; this refinishes them, threads a glowing path through them in order,
 * stands each on a stem over its shadow, and flies the camera from one
 * milestone to the next. Prev, Next, the scrubber, the milestone list, a click
 * on a marker, the canvas keys and page state all choose a milestone; the
 * narrative card follows. Under reduced motion the camera moves at once.
 */

import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { centerOf, floorY, MARKER, overviewCamera } from '../timeline-layout.ts';
import { resolvedColor } from './product.js';

/** Path segments per milestone gap, and the path's radius. */
const SEGMENTS = 12;
const TUBE = 0.045;
/** How much bigger the current marker draws. */
const LIFTED = 1.45;
/** How far a path or marker after the current one fades toward the page. */
const FADE = 0.45;
/** Pixels between a tag's bottom edge and the top of its marker; the CSS offset matches it. */
const TAG_GAP = 8;

/** Live timeline geometries and materials not yet disposed; the disposal check reads it. */
let live = 0;
export const liveTimelineResources = () => live;
function track(resource) {
  live += 1;
  resource.addEventListener('dispose', () => {
    live -= 1;
  });
  return resource;
}

const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);

export function timelineWidget(ctx) {
  const { el, config, nodes, camera, motion, api, scene } = ctx;
  const spec = config.track;
  if (!spec || !Array.isArray(spec.milestones) || spec.milestones.length < 2) return null;
  const milestones = spec.milestones;
  const markers = milestones.map((m) => nodes.get(m.id)?.object);
  if (markers.some((marker) => !marker?.isMesh)) return null;
  const count = milestones.length;
  const points = markers.map((marker) => marker.position.toArray());
  const stage = el.querySelector('.ak-3d-stage') || el;
  const owned = [];
  const listeners = [];
  const on = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    listeners.push([target, type, handler, options]);
  };

  // ---- Colour -----------------------------------------------------------------------------
  // Tones resolve through the same CSS the drawing uses, oklch and color-mix included.
  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  /** A CSS colour expression read back as a three.js colour, through the page's own styles. */
  function cssColor(expression, tone, fallback) {
    const swatch = document.createElement('span');
    swatch.className = 'ak-3d-mark';
    if (tone) swatch.setAttribute('data-tone', tone);
    swatch.setAttribute('aria-hidden', 'true');
    swatch.style.color = expression;
    stage.appendChild(swatch);
    const color =
      (probe && resolvedColor(getComputedStyle(swatch).color, probe)) || new Color(fallback);
    swatch.remove();
    return color;
  }
  const swatches = new Map();
  function toneOf(tone) {
    if (swatches.has(tone)) return swatches.get(tone);
    const color = cssColor('var(--ak-3d-tone,var(--ak-color-accent))', tone || 'accent', 0x6b7cff);
    // Keep a pale theme tone vivid under the studio light: hold its chroma, cap its lightness.
    const hsl = { h: 0, s: 0, l: 0 };
    color.getHSL(hsl, SRGBColorSpace);
    color.setHSL(hsl.h, Math.min(1, hsl.s * 1.15), Math.min(hsl.l, 0.6), SRGBColorSpace);
    swatches.set(tone, color);
    return color;
  }
  // Faded milestones lean toward the page but keep some ink, so they still read on a pale stage.
  const page = cssColor('var(--ak-color-background)', '', 0xffffff).lerp(
    cssColor('var(--ak-color-text-muted)', '', 0x777777),
    0.35,
  );
  const tones = milestones.map((m) => toneOf(m.tone));
  const faded = tones.map((tone) => tone.clone().lerp(page, FADE));

  // ---- Markers ----------------------------------------------------------------------------
  const materials = markers.map((marker, i) => {
    const material = track(
      new MeshPhysicalMaterial({
        color: tones[i].clone(),
        roughness: 0.24,
        metalness: 0.06,
        clearcoat: 1,
        clearcoatRoughness: 0.08,
        emissive: tones[i].clone(),
        emissiveIntensity: 0,
        envMapIntensity: 1.3,
      }),
    );
    marker.material = material;
    return material;
  });
  scene.environmentIntensity = 0.85;

  // ---- Path, stems, halo ------------------------------------------------------------------
  const curve = new CatmullRomCurve3(
    points.map((p) => new Vector3(...p)),
    false,
    'centripetal',
  );
  const tubular = (count - 1) * SEGMENTS;
  const radial = 8;
  const tube = track(new TubeGeometry(curve, tubular, TUBE, radial, false));
  // Each ring of the tube sits at a fraction of the way along the milestone order.
  const ringAt = Array.from({ length: tubular + 1 }, (_, j) => {
    return curve.getUtoTmapping(j / tubular) * (count - 1);
  });
  const ringColors = new Float32Array(tube.attributes.position.count * 3);
  tube.setAttribute('color', new BufferAttribute(ringColors, 3));
  const pathMaterial = track(new MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
  const path = new Mesh(tube, pathMaterial);
  path.castShadow = true;
  scene.add(path);
  owned.push(path);

  const ground = floorY(points);
  const stemPoints = new Float32Array(count * 6);
  points.forEach(([x, y, z], i) => {
    stemPoints.set([x, y, z, x, ground, z], i * 6);
  });
  const stemGeometry = track(new BufferGeometry());
  stemGeometry.setAttribute('position', new BufferAttribute(stemPoints, 3));
  const ink = cssColor('var(--ak-color-text)', '', 0x333333);
  const stemMaterial = track(
    new LineBasicMaterial({ color: ink, transparent: true, opacity: 0.22 }),
  );
  const stems = new LineSegments(stemGeometry, stemMaterial);
  scene.add(stems);
  owned.push(stems);

  const accent = toneOf('accent');
  const haloGeometry = track(new TorusGeometry(0.4, 0.016, 8, 72));
  const haloMaterial = track(
    new MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.9, toneMapped: false }),
  );
  const halo = new Mesh(haloGeometry, haloMaterial);
  halo.rotation.x = -Math.PI / 2;
  scene.add(halo);
  owned.push(halo);

  // ---- Progress ---------------------------------------------------------------------------
  let current = Math.min(count - 1, Math.max(0, spec.initial || 0));
  /** How far along the path is lit, in milestones; eases with the camera. */
  let progress = current;
  const mixed = new Color();
  function paint() {
    let v = 0;
    for (let j = 0; j <= tubular; j += 1) {
      const at = ringAt[j];
      const lo = Math.floor(at);
      const hi = Math.min(count - 1, lo + 1);
      const k = at - lo;
      mixed.copy(tones[lo]).lerp(tones[hi], k);
      // A soft edge where the lit path meets the faded rest.
      const lit = Math.min(1, Math.max(0, (progress - at) * 4 + 1));
      mixed.lerp(page, FADE * (1 - lit));
      for (let r = 0; r <= radial; r += 1) {
        ringColors[v] = mixed.r;
        ringColors[v + 1] = mixed.g;
        ringColors[v + 2] = mixed.b;
        v += 3;
      }
    }
    tube.attributes.color.needsUpdate = true;
    markers.forEach((marker, i) => {
      const lit = i <= progress + 1e-6;
      const material = materials[i];
      material.color.copy(lit ? tones[i] : faded[i]);
      const nearness = Math.max(0, 1 - Math.abs(i - progress));
      material.emissiveIntensity = i === current ? 0.5 * nearness + 0.12 : 0;
      marker.scale.setScalar(1 + (LIFTED - 1) * (i === current ? nearness : 0));
    });
    halo.position.copy(markers[current].position);
    halo.scale.setScalar(0.85 + 0.15 * Math.max(0, 1 - Math.abs(current - progress)));
  }

  // ---- Camera -----------------------------------------------------------------------------
  const center = centerOf(points);
  const spread = Math.max(
    2,
    ...points.map((p) => Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2])),
  );
  function overview(aspect) {
    const view = overviewCamera(points, spec.layout, aspect);
    return { position: view.position, target: view.target };
  }
  // The fog falls off behind what the camera looks at, never across it.
  function fitFog(distance) {
    if (!scene.fog) return;
    scene.fog.near = distance + 1.5;
    scene.fog.far = distance + Math.max(12, spread * 3);
  }

  let flight = null;
  let inOverview = true;
  function place(position, target) {
    camera.position.set(...position);
    ctx.target.set(...target);
    camera.lookAt(ctx.target);
    fitFog(camera.position.distanceTo(ctx.target));
  }
  function flyTo(view, toProgress) {
    const from = {
      position: camera.position.toArray(),
      target: ctx.target.toArray(),
      progress,
    };
    if (!motion) {
      flight = null;
      progress = toProgress;
      place(view.position, view.target);
      ctx.oriented();
      paint();
      ctx.requestRender();
      return;
    }
    const travel = Math.hypot(...view.position.map((p, i) => p - from.position[i]));
    flight = {
      from,
      to: view,
      toProgress,
      start: 0,
      duration: Math.min(1700, 650 + travel * 55),
      // A long flight lifts over the path instead of skimming through it.
      lift: Math.min(6, travel * 0.18),
    };
    ctx.animate();
  }
  function finishFlight() {
    if (!flight) return;
    progress = flight.toProgress;
    place(flight.to.position, flight.to.target);
    flight = null;
    ctx.oriented();
    paint();
  }

  // ---- Controls ---------------------------------------------------------------------------
  const listButtons = [...el.querySelectorAll('[data-ak-tl-milestone]')];
  const rail = el.querySelector('.ak-tl-list');
  const steps = [...el.querySelectorAll('[data-ak-tl-step]')];
  const scrub = el.querySelector('[data-ak-tl-scrub]');
  const overviewButton = el.querySelector('[data-ak-tl-overview]');
  const card = el.querySelector('.ak-tl-card');
  const canvas = el.querySelector('.ak-3d-canvas');
  for (const control of [...listButtons, ...steps, scrub, overviewButton])
    if (control) control.disabled = false;
  const width = String(count).length;

  function span(className, text) {
    const node = document.createElement('span');
    node.className = className;
    node.textContent = text;
    return node;
  }
  function annotate() {
    const m = milestones[current];
    if (card) {
      const parts = [span('ak-tl-step', `${String(current + 1).padStart(width, '0')} / ${count}`)];
      if (m.date) parts.push(span('ak-tl-date', m.date));
      parts.push(span('ak-tl-title', m.label));
      if (m.description) parts.push(span('ak-tl-text', m.description));
      card.replaceChildren(...parts);
    }
    listButtons.forEach((button, i) => {
      button.setAttribute('aria-pressed', i === current ? 'true' : 'false');
      // One tab stop in the list: arrow keys move within it.
      button.tabIndex = i === current ? 0 : -1;
    });
    if (scrub) {
      scrub.value = String(current + 1);
      scrub.setAttribute('aria-valuetext', `${current + 1} of ${count}: ${m.label}`);
    }
    overviewButton?.setAttribute('aria-pressed', inOverview ? 'true' : 'false');
    el.setAttribute('data-ak-tl-current', m.id);
    canvas?.setAttribute(
      'aria-description',
      `Milestone ${current + 1} of ${count}: ${m.label}${m.date ? `, ${m.date}` : ''}`,
    );
    // Bring the chosen item into the rail's view without scrolling the page.
    const item = listButtons[current]?.parentElement;
    if (rail && item && rail.scrollWidth > rail.clientWidth) {
      rail.scrollTo({
        left: item.offsetLeft - (rail.clientWidth - item.offsetWidth) / 2,
        behavior: motion ? 'smooth' : 'auto',
      });
    }
  }

  let bound = spec.bind ? api.readPath(spec.bind) : undefined;
  /** Fly to milestone `index`; a reader's choice writes `bind` and fires `select`. */
  function goTo(index, user) {
    if (!(index >= 0 && index < count)) return;
    if (index === current && !inOverview && !flight) return;
    current = index;
    inOverview = false;
    const m = milestones[index];
    if (user) {
      bound = m.id;
      api.fire(el, 'select', { value: m.id });
      if (spec.bind) api.setPath(spec.bind, m.id);
    }
    annotate();
    flyTo(m.view, index);
  }
  function showOverview() {
    inOverview = true;
    annotate();
    flyTo(overview(camera.aspect), current);
  }
  const indexOf = (id) => milestones.findIndex((m) => m.id === id);

  listButtons.forEach((button, i) => {
    on(button, 'click', () => goTo(i, true));
  });
  if (rail)
    on(rail, 'keydown', (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key;
      let next = -1;
      if (key === 'ArrowRight' || key === 'ArrowDown') next = Math.min(count - 1, current + 1);
      else if (key === 'ArrowLeft' || key === 'ArrowUp') next = Math.max(0, current - 1);
      else if (key === 'Home') next = 0;
      else if (key === 'End') next = count - 1;
      else return;
      event.preventDefault();
      goTo(next, true);
      listButtons[current]?.focus({ preventScroll: true });
    });
  /** Step along the path; at either end a step from the overview flies in to the end milestone. */
  function step(by) {
    goTo(Math.min(count - 1, Math.max(0, current + by)), true);
  }
  for (const button of steps)
    on(button, 'click', () => step(Number(button.getAttribute('data-ak-tl-step'))));
  if (scrub) {
    // While scrubbing the card stays quiet; it is announced once when the scrubber settles.
    on(scrub, 'input', () => {
      card?.setAttribute('aria-live', 'off');
      goTo(Number(scrub.value) - 1, true);
    });
    on(scrub, 'change', () => {
      card?.setAttribute('aria-live', 'polite');
      annotate();
    });
  }
  if (overviewButton) on(overviewButton, 'click', showOverview);

  annotate();
  paint();

  // ---- Tags: the first, last and current milestones named on the live view, as on the drawing.
  const tagLayer = document.createElement('div');
  tagLayer.className = 'ak-tl-tags';
  tagLayer.setAttribute('aria-hidden', 'true');
  stage.appendChild(tagLayer);
  const tags = new Map();
  const projected = new Vector3();
  function tagFor(i) {
    let tag = tags.get(i);
    if (!tag) {
      tag = document.createElement('span');
      tag.className = 'ak-tl-tag-live';
      tagLayer.appendChild(tag);
      tags.set(i, tag);
    }
    return tag;
  }
  function placeTags() {
    const wanted = new Set([0, count - 1, current]);
    for (const [i, tag] of tags)
      if (!wanted.has(i)) {
        tag.remove();
        tags.delete(i);
      }
    // The camera may have moved since the last render; project with its current matrices.
    camera.updateMatrixWorld();
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    // The current tag goes first, so an end tag that would collide with it is the one dropped.
    const placed = [];
    for (const i of [current, ...[...wanted].filter((k) => k !== current)]) {
      const m = milestones[i];
      const tag = tagFor(i);
      const isCurrent = i === current;
      tag.toggleAttribute('data-ak-current', isCurrent);
      const text = isCurrent && m.date ? `${m.date} · ${m.label}` : m.date || m.label;
      if (tag.textContent !== text) tag.textContent = text;
      // The tag stands on the top of its marker, whatever the marker's size on screen.
      projected.copy(markers[i].position);
      projected.y += (MARKER / 2) * markers[i].scale.y;
      projected.project(camera);
      const visible =
        projected.z < 1 && Math.abs(projected.x) < 1.05 && Math.abs(projected.y) < 1.05;
      tag.hidden = !visible;
      if (!visible) continue;
      // Keep the whole pill inside the stage.
      const half = tag.offsetWidth / 2 + 6;
      const x = Math.min(width - half, Math.max(half, ((projected.x + 1) / 2) * width));
      const y = ((1 - projected.y) / 2) * height;
      const top = y - TAG_GAP - tag.offsetHeight;
      const box = { left: x - half, right: x + half, top, bottom: top + tag.offsetHeight };
      const collides = placed.some(
        (other) =>
          box.left < other.right &&
          other.left < box.right &&
          box.top < other.bottom + 4 &&
          other.top < box.bottom + 4,
      );
      tag.hidden = collides;
      if (collides) continue;
      placed.push(box);
      tag.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
    }
  }

  return {
    tick(now) {
      placeTags();
      if (!flight) return false;
      if (!flight.start) flight.start = now;
      const k = Math.min(1, (now - flight.start) / flight.duration);
      if (k >= 1) {
        finishFlight();
        placeTags();
        return false;
      }
      const e = ease(k);
      const { from, to } = flight;
      const arc = Math.sin(Math.PI * e) * flight.lift;
      place(
        from.position.map((p, i) => p + (to.position[i] - p) * e + (i === 1 ? arc : 0)),
        from.target.map((p, i) => p + (to.target[i] - p) * e),
      );
      progress = from.progress + (flight.toProgress - from.progress) * e;
      paint();
      placeTags();
      return true;
    },
    settle() {
      finishFlight();
    },
    /** The overview at this stage aspect, until the reader moves the camera. */
    frame(aspect) {
      const view = overview(aspect);
      fitFog(Math.hypot(...view.position.map((p, i) => p - view.target[i])));
      return view;
    },
    sync() {
      if (!spec.bind) return;
      const value = api.readPath(spec.bind);
      if (value === bound) return;
      bound = value;
      const index = indexOf(value);
      if (index !== -1) goTo(index, false);
    },
    pick(id) {
      goTo(indexOf(id), true);
    },
    /**
     * Canvas keys: Right, n, Enter, space and Page Down step forward; Left, p and
     * Page Up step back; Home and End jump to the ends; Escape and o show the overview.
     */
    key(event) {
      if (event.ctrlKey || event.metaKey || event.altKey) return false;
      const key = event.key;
      if (['ArrowRight', 'n', 'Enter', ' ', 'PageDown'].includes(key)) step(1);
      else if (['ArrowLeft', 'p', 'PageUp'].includes(key)) step(-1);
      else if (key === 'Home') goTo(0, true);
      else if (key === 'End') goTo(count - 1, true);
      else if (key === 'Escape' || key === 'o') {
        if (inOverview) return false;
        showOverview();
      } else return false;
      return true;
    },
    /** A drag takes the camera: the flight stops where it is and the path finishes lighting. */
    interrupt() {
      if (!flight) return;
      progress = flight.toProgress;
      flight = null;
      ctx.oriented();
      paint();
    },
    dispose() {
      for (const [target, type, handler, options] of listeners)
        target.removeEventListener(type, handler, options);
      for (const control of [...listButtons, ...steps, scrub, overviewButton])
        if (control) control.disabled = true;
      for (const object of owned) scene.remove(object);
      tagLayer.remove();
      tube.dispose();
      pathMaterial.dispose();
      stemGeometry.dispose();
      stemMaterial.dispose();
      haloGeometry.dispose();
      haloMaterial.dispose();
      for (const material of materials) material.dispose();
    },
  };
}
