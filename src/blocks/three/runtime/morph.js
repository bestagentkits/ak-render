/**
 * Morph 3D runtime: the scene runtime lights and stages a stand-in; this swaps
 * in one surface carrying every target as a morph target on a shared grid
 * (`morph-sim.ts`), and blends between them on the GPU. A timeline plays the
 * targets in order; a target button, a canvas pick, the keyboard or page state
 * chooses one. Under reduced motion every change lands at once and nothing turns.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  MeshPhysicalMaterial,
} from "three";
import {
  buildMorph,
  LIVE_DETAIL,
  MorphTimeline,
  topologyBreak,
  triangles,
  vertexNormals,
} from "../morph-sim.ts";
import { resolvedColor } from "./product.js";

/** Radians per millisecond the surface turns while the timeline plays. */
const SPIN = 0.00016;
/** How much the surface swells mid-morph. */
const SWELL = 0.045;
/** Radius every target fits in; the camera frames it at any stage aspect. */
const FIT_RADIUS = 1.3;

/** Live morph geometries and materials not yet disposed; the disposal check reads it. */
let live = 0;
export const liveMorphResources = () => live;
function track(resource) {
  live += 1;
  resource.addEventListener("dispose", () => {
    live -= 1;
  });
  return resource;
}

/** True when the compiled config describes a morph this runtime can build. */
export function morphValid(config) {
  const targets = config?.morph?.targets;
  return (
    Array.isArray(targets) &&
    targets.length >= 2 &&
    topologyBreak(targets.map((t) => String(t.shape))) === -1
  );
}

export function morphWidget(ctx) {
  const { el, config, nodes, camera, motion, api } = ctx;
  const morph = config.morph;
  const mesh = nodes.get("morph")?.object;
  if (!morph || !mesh?.isMesh) return null;
  const stage = el.querySelector(".ak-3d-stage") || el;
  const targets = morph.targets;
  const listeners = [];
  const on = (target, type, handler) => {
    target.addEventListener(type, handler);
    listeners.push([target, type, handler]);
  };

  // One geometry, every target a morph target; base influence stays zero because weights sum to one.
  const built = buildMorph(
    targets.map((t) => t.shape),
    LIVE_DETAIL,
  );
  const geometry = track(new BufferGeometry());
  geometry.setIndex(new BufferAttribute(triangles(built.grid.quads), 1));
  const normals = built.targets.map((positions) =>
    vertexNormals(positions, built.grid.quads),
  );
  geometry.setAttribute("position", new BufferAttribute(built.targets[0], 3));
  geometry.setAttribute("normal", new BufferAttribute(normals[0], 3));
  geometry.morphAttributes.position = built.targets.map(
    (p) => new BufferAttribute(p, 3),
  );
  geometry.morphAttributes.normal = normals.map(
    (n) => new BufferAttribute(n, 3),
  );
  geometry.morphTargetsRelative = false;
  geometry.computeBoundingSphere();

  // Tones resolve through the same CSS the drawing uses, oklch and color-mix included.
  const probe = document
    .createElement("canvas")
    .getContext("2d", { willReadFrequently: true });
  const tones = targets.map((t) => {
    const swatch = document.createElement("span");
    swatch.className = "ak-3d-mark ak-product-swatch";
    swatch.setAttribute("data-tone", t.tone || "accent");
    swatch.setAttribute("aria-hidden", "true");
    stage.appendChild(swatch);
    const color =
      (probe &&
        resolvedColor(getComputedStyle(swatch).backgroundColor, probe)) ||
      new Color(0x6b7cff);
    swatch.remove();
    // Lit glossy surfaces wash pale tones out: keep the hue's chroma and cap the lightness.
    const hsl = { h: 0, s: 0, l: 0 };
    color.getHSL(hsl);
    color.setHSL(hsl.h, Math.min(1, hsl.s * 1.2), Math.min(hsl.l, 0.6));
    return color;
  });

  const material = track(
    new MeshPhysicalMaterial({
      color: tones[0].clone(),
      roughness: 0.26,
      metalness: 0.08,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      iridescence: 0.32,
      iridescenceIOR: 1.6,
      sheen: 0.35,
      sheenRoughness: 0.5,
      envMapIntensity: 1.35,
    }),
  );
  mesh.geometry = geometry;
  mesh.material = material;
  mesh.updateMorphTargets();
  ctx.scene.environmentIntensity = 0.95;

  const timeline = new MorphTimeline(targets.length, morph.initial || 0, {
    duration: morph.duration,
    hold: morph.hold,
    easing: morph.easing,
    mode: motion ? morph.mode : "manual",
  });
  let spin = 0;
  // The timeline runs on its own clock, so Pause freezes the blend on screen mid-morph.
  let clock = 0;
  let last = 0;
  let paused = !timeline.playing;
  let frozen = false;
  const blended = new Color();

  function paint() {
    const weights = timeline.weights;
    blended.setRGB(0, 0, 0);
    for (let i = 0; i < weights.length; i += 1) {
      mesh.morphTargetInfluences[i] = weights[i];
      blended.r += tones[i].r * weights[i];
      blended.g += tones[i].g * weights[i];
      blended.b += tones[i].b * weights[i];
    }
    // A spring's overshoot extrapolates the shape; the colour stays a real colour.
    material.color.setRGB(
      Math.min(1, Math.max(0, blended.r)),
      Math.min(1, Math.max(0, blended.g)),
      Math.min(1, Math.max(0, blended.b)),
    );
    const swell = timeline.morphing
      ? Math.sin(Math.PI * Math.min(1, timeline.progress))
      : 0;
    mesh.scale.setScalar(1 + SWELL * Math.max(0, swell));
    mesh.rotation.y = spin;
  }

  // ---- Controls ----------------------------------------------------------------------------
  const buttons = [...el.querySelectorAll("[data-ak-morph-target]")];
  for (const button of buttons) {
    button.disabled = false;
    on(button, "click", () =>
      choose(button.getAttribute("data-ak-morph-target")),
    );
  }
  // Pause: WCAG 2.2.2 asks for a way to stop motion that runs on its own.
  const pause = document.createElement("button");
  pause.type = "button";
  pause.className = "ak-mo-pause";
  function labelPause() {
    pause.textContent = paused ? "Play" : "Pause";
    pause.setAttribute("aria-pressed", paused ? "true" : "false");
    pause.setAttribute(
      "aria-label",
      paused ? "Play the morph timeline" : "Pause the morph timeline",
    );
  }
  if (motion && morph.mode !== "manual") {
    labelPause();
    stage.appendChild(pause);
    on(pause, "click", () => setPaused(!paused));
  }
  function setPaused(value) {
    paused = value;
    frozen = value;
    timeline.playing = !paused && morph.mode !== "manual";
    last = 0;
    labelPause();
    paint();
    if (!paused) ctx.animate();
    else ctx.requestRender();
  }

  // Page state: act only when the bound value changes, so a loop is not dragged back to it.
  let bound = morph.bind ? api.readPath(morph.bind) : undefined;
  let shown = -1;
  function mark() {
    if (shown === timeline.target) return;
    shown = timeline.target;
    const id = targets[shown].id;
    for (const button of buttons)
      button.setAttribute(
        "aria-pressed",
        button.getAttribute("data-ak-morph-target") === id ? "true" : "false",
      );
    el.setAttribute("data-ak-morph-current", id);
    el.querySelector(".ak-3d-canvas")?.setAttribute(
      "aria-description",
      `Shape: ${targets[shown].label || id}`,
    );
  }

  /** Morph to the target; a reader's choice stops the timeline playing on by itself. */
  function goTo(index, user) {
    if (index < 0 || index >= targets.length) return;
    if (timeline.playing && pause.isConnected) {
      paused = true;
      timeline.playing = false;
      labelPause();
    }
    frozen = false;
    if (!timeline.goTo(index)) return;
    if (user) {
      const id = targets[index].id;
      bound = id;
      api.fire(el, "select", { value: id });
      if (morph.bind) api.setPath(morph.bind, id);
    }
    if (!motion) timeline.settle();
    mark();
    paint();
    if (motion) ctx.animate();
    else ctx.requestRender();
  }
  function choose(id) {
    goTo(
      targets.findIndex((t) => t.id === id),
      true,
    );
  }
  const step = (by) =>
    goTo((timeline.target + by + targets.length) % targets.length, true);

  mark();
  paint();

  // The fog falls off behind the subject, never across it.
  function fitFog(distance) {
    if (!ctx.scene.fog) return;
    ctx.scene.fog.near = distance + FIT_RADIUS * 1.5;
    ctx.scene.fog.far = distance + FIT_RADIUS * 7;
  }

  return {
    /** Advance the timeline and the turntable; true while anything still moves. */
    tick(now) {
      if (frozen) {
        last = 0;
        return false;
      }
      const dt = last ? now - last : 0;
      clock += dt;
      const morphing = timeline.step(clock);
      const turning = motion && !paused && timeline.playing;
      if (turning) spin += Math.min(dt, 50) * SPIN;
      // A once timeline that has played through needs no pause control.
      if (!paused && !timeline.playing && pause.isConnected) pause.remove();
      last = morphing || turning ? now : 0;
      mark();
      paint();
      return morphing || turning;
    },
    settle() {
      timeline.settle();
      mark();
      paint();
    },
    /** Frames the fit sphere at this stage aspect, along the compiled bearing. */
    frame(aspect) {
      const position = config.camera.position;
      const target = config.camera.target;
      const dir = [0, 1, 2].map((i) => position[i] - target[i]);
      const length = Math.hypot(...dir) || 1;
      const half = (camera.fov * Math.PI) / 360;
      const fit = Math.min(half, Math.atan(Math.tan(half) * aspect));
      const distance = FIT_RADIUS / Math.sin(fit);
      fitFog(distance);
      return {
        position: dir.map((d, i) => target[i] + (d / length) * distance),
        target: [...target],
      };
    },
    sync() {
      if (!morph.bind) return;
      const value = api.readPath(morph.bind);
      if (value === bound) return;
      bound = value;
      const index = targets.findIndex((t) => t.id === value);
      if (index !== -1) goTo(index, false);
    },
    /** A click on the surface morphs on to the next target. */
    pick() {
      step(1);
    },
    /** Canvas keys: Enter, space and n morph to the next target, p to the previous one. */
    key(event) {
      if (event.ctrlKey || event.metaKey || event.altKey) return false;
      const key = event.key;
      if (key === "Enter" || key === " " || key === "n") {
        step(1);
        return true;
      }
      if (key === "p") {
        step(-1);
        return true;
      }
      return false;
    },
    interrupt() {},
    dispose() {
      for (const [target, type, handler] of listeners)
        target.removeEventListener(type, handler);
      for (const button of buttons) button.disabled = true;
      pause.remove();
      geometry.dispose();
      material.dispose();
    },
  };
}
