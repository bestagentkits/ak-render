/**
 * Product 3D runtime: the scene runtime builds the parts from the compiled
 * config; this refinishes them with studio materials, eases between finish
 * variants, pins numbered hotspots that fly the camera to them, and moves parts
 * apart for the exploded view. Variant, hotspot and explode state each read from
 * and write to page state. Under reduced motion every change is immediate.
 */

import { Color, MeshPhysicalMaterial, Vector3 } from 'three';

const FLY_MS = 950;
const EXPLODE_MS = 900;
const FINISH_MS = 480;
const INTRO_MS = 1300;
/** How far apart the parts start before they assemble on load, as a share of the exploded offset. */
const INTRO_SPREAD = 0.45;

/** Surface presets per material name; the compiler's closed vocabulary. */
const SURFACES = {
  standard: { metalness: 0.05, roughness: 0.32, clearcoat: 0.7, transmission: 0, emissive: 0 },
  matte: { metalness: 0, roughness: 0.82, clearcoat: 0, transmission: 0, emissive: 0 },
  metal: { metalness: 0.95, roughness: 0.24, clearcoat: 0.2, transmission: 0, emissive: 0 },
  glass: { metalness: 0, roughness: 0.06, clearcoat: 1, transmission: 0.92, emissive: 0 },
  wireframe: { metalness: 0, roughness: 0.6, clearcoat: 0, transmission: 0, emissive: 0 },
  emissive: { metalness: 0, roughness: 0.4, clearcoat: 0.3, transmission: 0, emissive: 0.9 },
};
const KEYS = ['metalness', 'roughness', 'clearcoat', 'transmission', 'emissive'];

const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const easeOut = (k) => 1 - (1 - k) ** 3;

/** Any CSS colour (oklch and color-mix included), read back as one painted pixel. */
function resolvedColor(css, probe) {
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = '#000';
  probe.fillStyle = css;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  if (!a) return null;
  return new Color().setRGB(r / 255, g / 255, b / 255, 'srgb');
}

export function productWidget(ctx) {
  const { el, config, nodes, camera, motion, api } = ctx;
  const product = config.product;
  if (!product) return null;
  const stage = el.querySelector('.ak-3d-stage') || el;
  const owned = [];
  const listeners = [];
  const on = (target, type, handler) => {
    target.addEventListener(type, handler);
    listeners.push([target, type, handler]);
  };

  // Tones resolve through the same CSS the plan uses, so the plan and the live parts agree.
  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const swatches = new Map();
  function toneOf(tone) {
    const key = tone || 'accent';
    if (swatches.has(key)) return swatches.get(key);
    const swatch = document.createElement('span');
    swatch.className = 'ak-3d-mark ak-product-swatch';
    swatch.setAttribute('data-tone', key);
    swatch.setAttribute('aria-hidden', 'true');
    stage.appendChild(swatch);
    const color =
      (probe && resolvedColor(getComputedStyle(swatch).backgroundColor, probe)) ||
      new Color(0x6b7cff);
    swatch.remove();
    swatches.set(key, color);
    return color;
  }
  const accent = toneOf('accent');
  /** Set once construction ends: the scene's render loop exists only after this widget returns. */
  let live = false;
  /** True inside tick: a repaint there rides the current frame instead of starting another. */
  let ticking = false;

  // Every drawn part takes a studio material this widget owns; the scene keeps and frees its own.
  const parts = new Map();
  for (const spec of config.objects) {
    const object = nodes.get(spec.id)?.object;
    if (!object?.isMesh) continue;
    const surface = SURFACES[spec.material] || SURFACES.standard;
    const material = new MeshPhysicalMaterial({
      color: toneOf(spec.tone),
      clearcoatRoughness: 0.18,
      thickness: 0.6,
      ior: 1.45,
      envMapIntensity: 1.25,
      wireframe: spec.material === 'wireframe',
    });
    owned.push(material);
    object.material = material;
    const finish = { color: toneOf(spec.tone).clone(), ...surface };
    parts.set(spec.id, {
      object,
      material,
      base: object.position.clone(),
      offset: new Vector3(...(product.explode[spec.id] || [0, 0, 0])),
      from: finish,
      to: finish,
      now: { ...finish, color: finish.color.clone() },
    });
  }
  ctx.scene.environmentIntensity = 0.9;

  const hotspots = product.hotspots.map((spec, index) => ({ spec, index }));
  const byId = new Map(hotspots.map((h) => [h.spec.id, h]));

  // Pins over the canvas track their part; the hotspot list is the keyboard path.
  const pinLayer = document.createElement('div');
  pinLayer.className = 'ak-3d-pins';
  stage.appendChild(pinLayer);
  for (const hotspot of hotspots) {
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.tabIndex = -1;
    pin.className = 'ak-3d-pin';
    pin.textContent = String(hotspot.index + 1);
    pin.setAttribute('aria-label', hotspot.spec.label);
    pin.setAttribute('data-ak-3d-pin', hotspot.spec.id);
    pinLayer.appendChild(pin);
    hotspot.pin = pin;
    on(pin, 'click', () => choose(hotspot.spec.id));
  }
  const card = document.createElement('p');
  card.className = 'ak-product-detail';
  card.setAttribute('role', 'status');
  card.setAttribute('aria-live', 'polite');
  card.hidden = true;
  stage.appendChild(card);

  const listButtons = [...el.querySelectorAll('[data-ak-product-hotspot]')];
  const select = el.querySelector('[data-ak-product-variant]');
  const explodeButton = el.querySelector('[data-ak-product-explode]');
  const resetButton = el.querySelector('[data-ak-product-reset]');
  for (const button of listButtons) {
    button.disabled = false;
    on(button, 'click', () => choose(button.getAttribute('data-ak-product-hotspot')));
  }
  if (select) {
    select.disabled = false;
    on(select, 'change', () => chooseVariant(select.value));
  }
  if (explodeButton) {
    explodeButton.disabled = false;
    on(explodeButton, 'click', () => setExplode(!exploded, true));
  }
  if (resetButton) {
    resetButton.disabled = false;
    on(resetButton, 'click', reset);
  }

  // ---- Explode -------------------------------------------------------------------------------
  let explodeK = 0;
  let exploded = false;
  let explodeTween = null;
  function placeParts() {
    for (const part of parts.values())
      part.object.position.copy(part.base).addScaledVector(part.offset, explodeK);
  }
  function setExplode(value, user) {
    const next = Boolean(value);
    if (next === exploded) return;
    exploded = next;
    explodeButton?.setAttribute('aria-pressed', String(exploded));
    el.setAttribute('data-ak-product-exploded', String(exploded));
    if (user && product.explodeBind)
      api.setPath(product.explodeBind, exploded ? 'exploded' : 'assembled');
    const to = exploded ? 1 : 0;
    if (motion) {
      explodeTween = { from: explodeK, to, start: 0, duration: EXPLODE_MS };
      ctx.animate();
    } else {
      explodeK = to;
      placeParts();
    }
    // Keep the chosen hotspot in view, or keep the whole product in frame.
    if (selected) flyTo(viewOf(selected));
    else flyTo(homeView());
  }

  // ---- Camera --------------------------------------------------------------------------------
  const home = { position: camera.position.clone(), target: ctx.target.clone() };
  const center = new Vector3(...product.center);
  const [lo, hi] = product.bounds;
  let flight = null;
  /** Home, stood back by the product's spread when exploded, along the reader's current bearing. */
  function homeView() {
    const distance = home.position.distanceTo(home.target) * (exploded ? product.spread : 1);
    const dir = camera.position.clone().sub(ctx.target).normalize();
    const target = home.target.clone();
    return { position: target.clone().addScaledVector(dir, distance), target };
  }
  function viewOf(id) {
    const spec = byId.get(id)?.spec;
    if (!spec) return null;
    const k = exploded ? 1 : 0;
    const target = new Vector3(...spec.at).addScaledVector(new Vector3(...spec.shift), k);
    const dir = new Vector3(...spec.dir);
    return {
      position: target.clone().addScaledVector(dir, product.closeUp * (exploded ? 1.15 : 1)),
      target,
    };
  }
  function flyTo(view) {
    if (!view) return;
    if (!motion) {
      camera.position.copy(view.position);
      ctx.target.copy(view.target);
      camera.lookAt(ctx.target);
      ctx.oriented();
      ctx.requestRender();
      return;
    }
    flight = {
      fromTarget: ctx.target.clone(),
      fromOffset: camera.position.clone().sub(ctx.target),
      toTarget: view.target,
      toOffset: view.position.clone().sub(view.target),
      start: 0,
    };
    ctx.animate();
  }
  function stepFlight(now) {
    if (!flight) return false;
    if (!flight.start) flight.start = now;
    const k = Math.min(1, (now - flight.start) / FLY_MS);
    const e = ease(k);
    ctx.target.copy(flight.fromTarget).lerp(flight.toTarget, e);
    // Swing the bearing and the distance separately, so the camera arcs instead of cutting through.
    const fromLength = flight.fromOffset.length();
    const toLength = flight.toOffset.length();
    const dir = flight.fromOffset
      .clone()
      .normalize()
      .lerp(flight.toOffset.clone().normalize(), e)
      .normalize();
    camera.position.copy(ctx.target).addScaledVector(dir, fromLength + (toLength - fromLength) * e);
    camera.lookAt(ctx.target);
    ctx.oriented();
    if (k >= 1) flight = null;
    return k < 1;
  }

  // ---- Hotspots ------------------------------------------------------------------------------
  let selected = null;
  function render(id) {
    selected = id;
    for (const button of listButtons)
      button.setAttribute(
        'aria-pressed',
        button.getAttribute('data-ak-product-hotspot') === id ? 'true' : 'false',
      );
    for (const { spec, pin } of hotspots)
      pin.setAttribute('aria-pressed', spec.id === id ? 'true' : 'false');
    const hotspot = id ? byId.get(id) : null;
    card.hidden = !hotspot;
    card.replaceChildren();
    if (hotspot) {
      const title = document.createElement('strong');
      const num = document.createElement('span');
      num.className = 'ak-3d-num';
      num.setAttribute('aria-hidden', 'true');
      num.textContent = String(hotspot.index + 1);
      title.append(num, hotspot.spec.label);
      card.append(title);
      if (hotspot.spec.description) {
        const note = document.createElement('span');
        note.textContent = hotspot.spec.description;
        card.append(note);
      }
    }
    el.setAttribute('data-ak-3d-selected', id || '');
    for (const [partId, part] of parts) part.glow = hotspot && hotspot.spec.part === partId ? 1 : 0;
    paint();
  }
  function choose(id) {
    if (!byId.has(id)) return;
    if (id !== selected) {
      render(id);
      api.fire(el, 'select', { value: id });
      if (product.bind) api.setPath(product.bind, id);
    }
    flyTo(viewOf(id));
  }
  function reset() {
    if (selected) {
      render(null);
      if (product.bind) api.setPath(product.bind, '');
    }
    const view = homeView();
    const distance = view.position.distanceTo(view.target);
    const dir = home.position.clone().sub(home.target).normalize();
    flyTo({
      position: home.target.clone().addScaledVector(dir, distance),
      target: home.target.clone(),
    });
  }

  // ---- Variants ------------------------------------------------------------------------------
  let variant = null;
  let finishTween = null;
  function paint() {
    for (const part of parts.values()) {
      const { material, now } = part;
      material.color.copy(now.color);
      material.metalness = now.metalness;
      material.roughness = now.roughness;
      material.clearcoat = now.clearcoat;
      material.transmission = now.transmission;
      // Emissive finishes glow in their own colour; the chosen part glows faintly in the accent.
      if (part.glow) material.emissive.copy(accent);
      else material.emissive.copy(now.color).multiplyScalar(now.emissive);
      material.emissiveIntensity = part.glow ? 0.32 : 1;
    }
    if (live && !ticking) ctx.requestRender();
  }
  function setVariant(id) {
    const entry = product.variants.find((v) => v.id === id);
    if (!entry || id === variant) return;
    const first = variant === null;
    variant = id;
    if (select) select.value = id;
    el.setAttribute('data-ak-product-finish', id);
    const finishes = new Map(entry.finishes.map((f) => [f.part, f]));
    for (const [partId, part] of parts) {
      const spec = config.objects.find((o) => o.id === partId);
      const finish = finishes.get(partId) || {};
      const material = finish.material || spec.material;
      part.from = { ...part.now, color: part.now.color.clone() };
      part.to = {
        color: toneOf(finish.tone || spec.tone).clone(),
        ...(SURFACES[material] || SURFACES.standard),
      };
    }
    if (motion && !first) {
      finishTween = { start: 0 };
      ctx.animate();
    } else {
      for (const part of parts.values()) part.now = { ...part.to, color: part.to.color.clone() };
      paint();
    }
  }
  function chooseVariant(id) {
    if (product.variantBind) api.setPath(product.variantBind, id);
    setVariant(id);
  }
  function stepFinish(now) {
    if (!finishTween) return false;
    if (!finishTween.start) finishTween.start = now;
    const k = Math.min(1, (now - finishTween.start) / FINISH_MS);
    const e = easeOut(k);
    for (const part of parts.values()) {
      part.now.color.copy(part.from.color).lerp(part.to.color, e);
      for (const key of KEYS) part.now[key] = part.from[key] + (part.to[key] - part.from[key]) * e;
    }
    paint();
    if (k >= 1) finishTween = null;
    return k < 1;
  }

  // ---- Pins ----------------------------------------------------------------------------------
  const projected = new Vector3();
  const world = new Vector3();
  const toCamera = new Vector3();
  function placePins() {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (!width || !height) return;
    camera.updateMatrixWorld();
    for (const hotspot of hotspots) {
      const { spec, pin } = hotspot;
      world.set(...spec.at).addScaledVector(projected.set(...spec.shift), explodeK);
      // A pin on the far side of the product dims, so the near ones read first.
      toCamera.copy(camera.position).sub(world);
      const facing = toCamera.dot(projected.set(...spec.normal)) >= 0;
      projected.copy(world).project(camera);
      const inside =
        projected.z < 1 && Math.abs(projected.x) <= 1.02 && Math.abs(projected.y) <= 1.02;
      pin.hidden = !inside;
      if (facing) pin.removeAttribute('data-ak-back');
      else pin.setAttribute('data-ak-back', '');
      hotspot.x = ((projected.x + 1) / 2) * width;
      hotspot.y = ((1 - projected.y) / 2) * height;
      hotspot.shown = inside;
      hotspot.facing = facing;
      if (inside)
        pin.style.transform = `translate(${hotspot.x.toFixed(1)}px,${hotspot.y.toFixed(1)}px)`;
    }
  }

  /** The frozen frame with the numbered pins painted in, so print and export keep them. */
  function annotate(canvas) {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (!width || !height) return null;
    placePins();
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const g = copy.getContext('2d');
    if (!g) return null;
    g.drawImage(canvas, 0, 0);
    g.scale(canvas.width / width, canvas.height / height);
    const style = getComputedStyle(hotspots[0]?.pin || stage);
    for (const hotspot of hotspots) {
      if (!hotspot.shown) continue;
      g.globalAlpha = hotspot.facing ? 1 : 0.45;
      g.beginPath();
      g.arc(hotspot.x, hotspot.y, 13, 0, Math.PI * 2);
      g.fillStyle = hotspot.spec.id === selected ? style.color : style.backgroundColor;
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = style.borderTopColor;
      g.stroke();
      g.fillStyle = hotspot.spec.id === selected ? style.backgroundColor : style.color;
      g.font = `700 12px ${style.fontFamily}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(hotspot.index + 1), hotspot.x, hotspot.y + 0.5);
    }
    g.globalAlpha = 1;
    return copy;
  }

  // The fog falls off behind the product, never across it, in either view.
  const reach = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) * product.spread;
  function fitFog() {
    if (!ctx.scene.fog) return;
    const distance = home.position.distanceTo(home.target) * product.spread;
    ctx.scene.fog.near = distance + reach;
    ctx.scene.fog.far = distance + reach * 5;
  }
  fitFog();

  // Initial state: the bound or compiled variant, explode state and hotspot, applied at once.
  setVariant(product.variant || product.variants[0]?.id);
  const initialExplode = product.explodeBind ? api.readPath(product.explodeBind) : product.exploded;
  if (initialExplode === true || initialExplode === 'exploded') {
    exploded = true;
    explodeK = 1;
    explodeButton?.setAttribute('aria-pressed', 'true');
    el.setAttribute('data-ak-product-exploded', 'true');
  }
  // With motion, the parts drift together once on load, then the scene holds still.
  let intro = null;
  if (motion && !exploded && parts.size > 1) intro = { start: 0 };
  explodeK = intro ? INTRO_SPREAD : explodeK;
  placeParts();
  let pendingView = null;
  const initialHotspot = product.bind ? api.readPath(product.bind) : null;
  if (typeof initialHotspot === 'string' && byId.has(initialHotspot)) {
    render(initialHotspot);
    pendingView = initialHotspot;
  }

  function settleAll() {
    if (intro || explodeTween) {
      explodeK = exploded ? 1 : 0;
      placeParts();
    }
    intro = null;
    explodeTween = null;
    if (finishTween) {
      for (const part of parts.values()) part.now = { ...part.to, color: part.to.color.clone() };
      finishTween = null;
      paint();
    }
    if (flight) {
      ctx.target.copy(flight.toTarget);
      camera.position.copy(flight.toTarget).add(flight.toOffset);
      camera.lookAt(ctx.target);
      ctx.oriented();
      flight = null;
    }
  }

  function advance(now) {
    let moving = false;
    if (intro) {
      if (!intro.start) intro.start = now;
      const k = Math.min(1, (now - intro.start) / INTRO_MS);
      explodeK = INTRO_SPREAD * (1 - easeOut(k));
      placeParts();
      if (k >= 1) intro = null;
      else moving = true;
    }
    if (explodeTween) {
      if (!explodeTween.start) explodeTween.start = now;
      const k = Math.min(1, (now - explodeTween.start) / explodeTween.duration);
      explodeK = explodeTween.from + (explodeTween.to - explodeTween.from) * ease(k);
      placeParts();
      if (k >= 1) explodeTween = null;
      else moving = true;
    }
    if (stepFinish(now)) moving = true;
    if (stepFlight(now)) moving = true;
    placePins();
    return moving;
  }

  live = true;
  return {
    /** Advance intro, explode, finish and camera moves; true while anything still moves. */
    tick(now) {
      ticking = true;
      try {
        return advance(now);
      } finally {
        ticking = false;
      }
    },
    settle: settleAll,
    annotate,
    /** Home framing at this stage aspect: the product's box fills the frame along the compiled bearing. */
    frame(aspect) {
      const probeCamera = camera.clone();
      probeCamera.aspect = aspect;
      probeCamera.updateProjectionMatrix();
      const dir = home.position.clone().sub(home.target).normalize();
      const corners = [];
      for (const x of [lo[0], hi[0]])
        for (const y of [lo[1], hi[1]])
          for (const z of [lo[2], hi[2]]) corners.push(new Vector3(x, y, z));
      for (const h of product.hotspots) corners.push(new Vector3(...h.at));
      const aim = center.clone();
      const point = new Vector3();
      const extent = (distance) => {
        probeCamera.position.copy(aim).addScaledVector(dir, distance);
        probeCamera.lookAt(aim);
        probeCamera.updateMatrixWorld();
        let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
        for (const corner of corners) {
          point.copy(corner).project(probeCamera);
          x0 = Math.min(x0, point.x);
          x1 = Math.max(x1, point.x);
          y0 = Math.min(y0, point.y);
          y1 = Math.max(y1, point.y);
        }
        return [x0, y0, x1, y1];
      };
      let distance = home.position.distanceTo(home.target);
      for (let pass = 0; pass < 3; pass += 1) {
        let near = distance * 0.2;
        let far = distance * 5;
        for (let i = 0; i < 32; i += 1) {
          const mid = (near + far) / 2;
          const [x0, y0, x1, y1] = extent(mid);
          if (x0 < -0.8 || x1 > 0.8 || y0 < -0.78 || y1 > 0.74) near = mid;
          else far = mid;
        }
        distance = far;
        const [x0, y0, x1, y1] = extent(distance);
        const halfH = Math.tan((probeCamera.fov * Math.PI) / 360) * distance;
        const right = new Vector3().setFromMatrixColumn(probeCamera.matrixWorld, 0);
        const up = new Vector3().setFromMatrixColumn(probeCamera.matrixWorld, 1);
        aim.addScaledVector(right, ((x0 + x1) / 2) * halfH * aspect);
        // Sit the product a touch low, leaving the card room under it and air above.
        aim.addScaledVector(up, ((y0 + y1) / 2 + 0.02) * halfH);
      }
      home.target.copy(aim);
      home.position.copy(aim).addScaledVector(dir, distance);
      fitFog();
      // A bound hotspot or exploded state shows once the scene has taken its home framing.
      if (pendingView || exploded) {
        const id = pendingView;
        pendingView = null;
        queueMicrotask(() => flyTo(id ? viewOf(id) : homeView()));
      }
      return { position: home.position.toArray(), target: home.target.toArray() };
    },
    sync() {
      if (product.variantBind) {
        const value = api.readPath(product.variantBind);
        if (typeof value === 'string') setVariant(value);
      }
      if (product.explodeBind) {
        const value = api.readPath(product.explodeBind);
        if (value !== undefined) setExplode(value === true || value === 'exploded', false);
      }
      if (product.bind) {
        const value = api.readPath(product.bind);
        if (typeof value === 'string' && value !== selected && byId.has(value)) choose(value);
        else if (value === '' && selected) {
          render(null);
          flyTo(homeView());
        }
      }
    },
    /** A pick on the canvas chooses the first hotspot on that part. */
    pick(partId) {
      const hotspot = hotspots.find((h) => h.spec.part === partId);
      if (hotspot) choose(hotspot.spec.id);
    },
    /** Canvas keys: Enter, space and n/p cycle hotspots; Home, 0 and Escape reset; e explodes. */
    key(event) {
      const key = event.key;
      if (key === 'Enter' || key === ' ' || key === 'n' || key === 'p') {
        if (!hotspots.length) return false;
        const order = hotspots.map((h) => h.spec.id);
        const at = order.indexOf(selected);
        const step = key === 'p' ? -1 : 1;
        choose(order[(at + step + order.length) % order.length]);
        return true;
      }
      if (key === 'Home' || key === '0' || key === 'Escape') {
        reset();
        return true;
      }
      if (key === 'e') {
        setExplode(!exploded, true);
        return true;
      }
      return false;
    },
    /** The reader took the camera: stop any flight where it is. */
    interrupt() {
      flight = null;
    },
    dispose() {
      for (const [target, type, handler] of listeners) target.removeEventListener(type, handler);
      for (const button of listButtons) button.disabled = true;
      if (select) select.disabled = true;
      if (explodeButton) explodeButton.disabled = true;
      if (resetButton) resetButton.disabled = true;
      for (const item of owned) item.dispose();
      pinLayer.remove();
      card.remove();
    },
  };
}
