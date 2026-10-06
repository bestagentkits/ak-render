/**
 * The trusted interaction runtime.
 *
 * This is the only JavaScript the compiler emits, and it is a fixed program: a
 * spec can bind actions, but it cannot author a handler, an expression, or a
 * selector. Feature blocks are concatenated in a fixed order and only the
 * features a page uses are included, so a page without a carousel ships no
 * carousel code.
 *
 * Written in a conservative, dependency-free style (no arrow functions, no
 * template literals) so the emitted artifact does not depend on a build step or
 * a modern-browser-only syntax tier.
 */

import { CAROUSEL, TABS } from '../blocks/composition/composition-runtime.js';
import type { FeatureModule } from '../registry/block-module.js';
import type { RuntimeFeature } from '../registry/roster.js';
import { serializeJsonForScript } from './escape.js';

/** Features that produce user-facing feedback and therefore need a live region. */
const ANNOUNCING_FEATURES: readonly RuntimeFeature[] = ['copy', 'filter', 'theme'];

export interface RuntimeOptions {
  features: ReadonlySet<RuntimeFeature>;
  state: Record<string, unknown>;
  /** True when at least one block declares an action binding. */
  hasBindings: boolean;
  /** Registry features the page uses, in registry order. */
  moduleFeatures?: readonly FeatureModule[];
}

const helpers = (conditions: boolean): string => `
function q(sel, ctx) { return (ctx || doc).querySelector(sel); }
function qa(sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); }
function byId(id) { return qa('[data-ak-id="' + id + '"]'); }
function motionAllowed() {
  if (root.getAttribute('data-motion') === 'none') return false;
  return !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}
function announce(message) {
  var region = q('[data-ak-live]');
  if (region) region.textContent = message;
}
function readJson(el, attribute) {
  var raw = el.getAttribute(attribute);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch (error) { return []; }
}
function setPath(path, value) {
  var parts = String(path).split('.');
  if (parts[0] !== 'state' || parts.length < 2) return;
  var cursor = state;
  for (var i = 1; i < parts.length - 1; i += 1) {
    if (typeof cursor[parts[i]] !== 'object' || cursor[parts[i]] === null) cursor[parts[i]] = {};
    cursor = cursor[parts[i]];
  }
  cursor[parts[parts.length - 1]] = value;
  syncBindings();
}
function readPath(path) {
  var parts = String(path).split('.');
  var cursor = state;
  for (var i = 1; i < parts.length; i += 1) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = cursor[parts[i]];
  }
  return cursor;
}
function syncBindings() {
  qa('[data-ak-bind]').forEach(function (el) {
    var value = readPath(el.getAttribute('data-ak-bind'));
    if (value === undefined || value === null) return;
    var target = el.getAttribute('data-ak-bind-target');
    if (target === 'value') { el.value = String(value); return; }
    if (target === 'state') { el.setAttribute('data-ak-state', String(value)); return; }
    if (el.tagName === 'INPUT' || el.tagName === 'OUTPUT' || el.tagName === 'SELECT') {
      el.value = String(value);
    } else {
      el.textContent = String(value);
    }
  });${conditions ? '\n  syncConditions();' : ''}
}`;

/**
 * `visibleWhen`: re-evaluate every condition after a state change. The rules
 * match `evaluateCondition` in the compiler exactly, which already emitted the
 * initial view; own keys only, so \`state.constructor\` reads as unset.
 */
const STATE = `
function readOwnPath(path) {
  var parts = String(path).split('.');
  var cursor = state;
  for (var i = 1; i < parts.length; i += 1) {
    if (cursor === null || typeof cursor !== 'object' || Array.isArray(cursor)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(cursor, parts[i])) return undefined;
    cursor = cursor[parts[i]];
  }
  return cursor;
}
function evalCondition(condition) {
  var value = readOwnPath(condition.path);
  var op = condition.op;
  if (op === 'equals') return value === condition.value;
  if (op === 'notEquals') return value !== condition.value;
  if (op === 'in' || op === 'notIn') {
    var found = false;
    for (var i = 0; i < condition.value.length; i += 1) {
      if (condition.value[i] === value) found = true;
    }
    return op === 'in' ? found : !found;
  }
  if (op === 'truthy') return Boolean(value);
  if (op === 'falsy') return !value;
  return true;
}
function syncConditions() {
  qa('[data-ak-when]').forEach(function (el) {
    var condition = readJson(el, 'data-ak-when');
    if (!condition || typeof condition.path !== 'string') return;
    if (evalCondition(condition)) el.removeAttribute('hidden');
    else el.setAttribute('hidden', '');
  });
}`;

const FIRE = `
function fire(source, eventName, detail) {
  var target = source;
  while (target && target !== doc.documentElement) {
    var bindings = readJson(target, 'data-ak-on-' + eventName);
    if (bindings.length) {
      for (var i = 0; i < bindings.length; i += 1) run(bindings[i], source, detail);
      return;
    }
    // A block's event belongs to that block: it never reaches an enclosing
    // block's bindings.
    if (target.hasAttribute('data-ak-id')) return;
    target = target.parentElement;
  }
}`;

const RUN = `
function run(action, source, detail) {
  var type = action.action;
  var targetId = action.target;
  if (type === 'toggle') {
    var nodes = byId(targetId);
    nodes.forEach(function (node) {
      if (node.tagName === 'DIALOG') openDialog(node);
      else if (node.tagName === 'DETAILS') node.open = !node.open;
      else if (node.hasAttribute('data-ak-theme-toggle')) toggleTheme(node);
      else {
        var collapsed = node.getAttribute('aria-expanded') === 'false' || node.hasAttribute('hidden');
        if (collapsed) { node.removeAttribute('hidden'); node.setAttribute('aria-expanded', 'true'); }
        else { node.setAttribute('hidden', ''); node.setAttribute('aria-expanded', 'false'); }
      }
    });
    return;
  }
  if (type === 'expand' || type === 'collapse') {
    byId(targetId).forEach(function (node) {
      var open = type === 'expand';
      if (node.tagName === 'DETAILS') node.open = open;
      else node.setAttribute('aria-expanded', String(open));
    });
    return;
  }
  if (type === 'copy') {
    var text = '';
    byId(targetId).forEach(function (node) { text += node.textContent || ''; });
    copyText(text, source);
    return;
  }
  if (type === 'download') {
    var payload = '';
    byId(targetId).forEach(function (node) { payload += node.textContent || ''; });
    downloadText(payload, action.filename, source);
    return;
  }
  if (type === 'open-url') {
    var opened = window.open(action.url, '_blank', 'noopener,noreferrer');
    if (opened) opened.opener = null;
    return;
  }
  if (type === 'set-value') {
    // An action without its own value takes the event's, such as a slider's.
    var next = Object.prototype.hasOwnProperty.call(action, 'value') ? action.value : (detail ? detail.value : undefined);
    if (next !== undefined) setPath(action.path, next);
    return;
  }
  if (type === 'next' || type === 'previous') {
    byId(targetId).forEach(function (node) { shiftSlide(node, type === 'next' ? 1 : -1, fire); });
    return;
  }
  if (type === 'filter') {
    var query = detail && typeof detail.query === 'string' ? detail.query : String(action.query || '');
    applyFilter(byId(targetId), query, action.match || 'text');
    return;
  }
  if (type === 'select-tab') {
    byId(targetId).forEach(function (node) { selectTab(node, action, fire); });
    return;
  }
  if (type === 'theme') {
    applyTheme(action.value || 'toggle');
  }
}`;

const THEME = `
function applyTheme(mode) {
  var next = mode;
  if (mode === 'toggle') {
    var current = root.getAttribute('data-theme');
    if (!current) current = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    next = current === 'dark' ? 'light' : 'dark';
  }
  if (mode === 'system') {
    root.removeAttribute('data-theme');
    next = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } else {
    root.setAttribute('data-theme', next);
  }
  try { window.localStorage.setItem('ak-render-theme', mode === 'system' ? 'system' : next); } catch (error) {}
  syncThemeToggles(next);
  announce('Theme set to ' + next);
}
// The toggle names the scheme it switches to, so it must follow the scheme in
// effect, including one the system chose before anything was stored.
function syncThemeToggles(scheme) {
  qa('[data-ak-theme-toggle]').forEach(function (button) {
    button.setAttribute('aria-pressed', String(scheme === 'dark'));
    button.textContent = scheme === 'dark' ? 'Light' : 'Dark';
  });
}
/*
 * Where supported, the new scheme is revealed as a circle growing from the
 * toggle. The origin is written to two custom properties; the stylesheet owns
 * the animation, and reduced motion or an older engine switches instantly.
 */
function toggleTheme(source) {
  if (!motionAllowed() || typeof doc.startViewTransition !== 'function') { applyTheme('toggle'); return; }
  if (source && source.getBoundingClientRect) {
    var box = source.getBoundingClientRect();
    root.style.setProperty('--ak-vt-x', Math.round(box.left + box.width / 2) + 'px');
    root.style.setProperty('--ak-vt-y', Math.round(box.top + box.height / 2) + 'px');
  }
  doc.startViewTransition(function () { applyTheme('toggle'); });
}
function restoreTheme() {
  // While the system owns the scheme, a change in system settings must relabel
  // the toggle too, not only the first paint.
  var system = window.matchMedia('(prefers-color-scheme: dark)');
  if (typeof system.addEventListener === 'function') {
    system.addEventListener('change', function () {
      if (!root.getAttribute('data-theme')) syncThemeToggles(system.matches ? 'dark' : 'light');
    });
  }
  var stored = null;
  try { stored = window.localStorage.getItem('ak-render-theme'); } catch (error) {}
  if (!stored) {
    syncThemeToggles(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    return;
  }
  if (stored === 'system') applyTheme('system');
  else applyTheme(stored);
}`;

const COPY = `
function copyText(text, source) {
  var done = function () {
    announce('Copied to clipboard');
    // A visible confirmation on the control itself, cleared after a moment.
    if (source && source.setAttribute) {
      source.setAttribute('data-ak-copied', '');
      window.setTimeout(function () { source.removeAttribute('data-ak-copied'); }, 1600);
    }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
  } else {
    fallbackCopy(text, done);
  }
}
function fallbackCopy(text, done) {
  var area = doc.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  doc.body.appendChild(area);
  area.select();
  try { doc.execCommand('copy'); done(); } catch (error) { announce('Copy failed'); }
  doc.body.removeChild(area);
}
function downloadText(text, filename, source) {
  var safeName = String(filename || 'artifact.txt').replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 96);
  var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var link = doc.createElement('a');
  link.href = url;
  link.download = safeName;
  doc.body.appendChild(link);
  link.click();
  doc.body.removeChild(link);
  window.setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  announce('Downloaded ' + safeName);
}`;

const OUTLINE = `
function wireOutline() {
  var links = qa('[data-ak-outline-link]');
  if (!links.length || typeof window.IntersectionObserver !== 'function') return;
  var byAnchor = {};
  links.forEach(function (link) { byAnchor[link.getAttribute('href').slice(1)] = link; });
  var mark = function (id) {
    links.forEach(function (link) {
      if (link === byAnchor[id]) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  };
  // The current section is the last one whose top has crossed the upper third
  // of the viewport, which matches where a reader's eye rests.
  var observer = new window.IntersectionObserver(function (entries) {
    entries.forEach(function (entry) { if (entry.isIntersecting) mark(entry.target.id); });
  }, { rootMargin: '0px 0px -66% 0px' });
  Object.keys(byAnchor).forEach(function (id) {
    var section = doc.getElementById(id);
    if (section) observer.observe(section);
  });
}`;

const BEFORE_AFTER = `
function wireBeforeAfter() {
  qa('[data-ak-before-after]').forEach(function (figure) {
    var stage = q('.ak-ba-stage', figure);
    var input = q('.ak-ba-range', figure);
    if (!stage || !input) return;
    var apply = function () { stage.style.setProperty('--ak-split', input.value + '%'); };
    // Dragging anywhere on the stage moves the divider, which a bare range input
    // only does from its thumb on some touch browsers.
    var dragging = false;
    var follow = function (event) {
      var box = stage.getBoundingClientRect();
      if (!box.width) return;
      var ratio = Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1);
      input.value = String(Math.round(ratio * 100));
      apply();
    };
    input.addEventListener('input', apply, false);
    input.addEventListener('pointerdown', function (event) {
      dragging = true;
      if (input.setPointerCapture) input.setPointerCapture(event.pointerId);
      follow(event);
    }, false);
    input.addEventListener('pointermove', function (event) { if (dragging) follow(event); }, false);
    input.addEventListener('pointerup', function () { dragging = false; }, false);
    input.addEventListener('pointercancel', function () { dragging = false; }, false);
    apply();
    figure.setAttribute('data-ak-ready', '');
  });
}`;

const EFFECTS = `
function countUp(el) {
  if (el.children.length) return;
  var text = el.textContent;
  var match = /^([^\\dA-Za-z]*)(\\d{1,3}(?:,\\d{3})+|\\d+)(\\.\\d+)?([^\\d]*)$/.exec(text.trim());
  if (!match) return;
  var grouped = match[2].indexOf(',') !== -1;
  var places = match[3] ? match[3].length - 1 : 0;
  var target = parseFloat(match[2].replace(/,/g, '') + (match[3] || ''));
  if (!isFinite(target) || target === 0) return;
  var format = function (value) {
    var fixed = value.toFixed(places);
    if (grouped) {
      var parts = fixed.split('.');
      parts[0] = parts[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
      fixed = parts.join('.');
    }
    return match[1] + fixed + match[4];
  };
  // The authored value stays in the DOM for assistive technology, copy and
  // print; the rolling figure is a hidden layer drawn over it while it runs.
  var real = doc.createElement('span');
  real.className = 'ak-sr';
  real.textContent = text;
  var shown = doc.createElement('span');
  shown.setAttribute('aria-hidden', 'true');
  shown.textContent = format(0);
  el.textContent = '';
  el.appendChild(real);
  el.appendChild(shown);
  var settled = false;
  var settle = function () {
    if (settled) return;
    settled = true;
    el.textContent = text;
    window.removeEventListener('beforeprint', settle);
  };
  window.addEventListener('beforeprint', settle);
  var began = null;
  var step = function (now) {
    if (settled) return;
    if (began === null) began = now;
    var progress = Math.min((now - began) / 1400, 1);
    if (progress >= 1) { settle(); return; }
    shown.textContent = format(target * (1 - Math.pow(1 - progress, 4)));
    window.requestAnimationFrame(step);
  };
  window.requestAnimationFrame(step);
}
function wireEffects() {
  if (!motionAllowed()) return;
  // A soft light follows the pointer across cards and tiles.
  doc.addEventListener('pointermove', function (event) {
    var surface = event.target && event.target.closest ? event.target.closest('.ak-card, .ak-tile, .ak-kpi-card') : null;
    if (!surface) return;
    var box = surface.getBoundingClientRect();
    surface.style.setProperty('--ak-mx', Math.round(event.clientX - box.left) + 'px');
    surface.style.setProperty('--ak-my', Math.round(event.clientY - box.top) + 'px');
  }, { passive: true });
  if (typeof window.IntersectionObserver !== 'function') return;
  // Blocks play their entrance as they arrive. Until then they show their final
  // state, so a capture, a print or a disabled script never sees them blank.
  var observer = new window.IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      observer.unobserve(entry.target);
      if (entry.target.hasAttribute('data-ak-animate')) entry.target.setAttribute('data-ak-inview', '');
      else countUp(entry.target);
    });
  }, { rootMargin: '0px 0px 12% 0px' });
  qa('[data-ak-animate], [data-ak-count], .ak-stat dd').forEach(function (el) { observer.observe(el); });
}`;

const DIALOG = `
var lastFocus = null;
function openDialog(dialog) {
  lastFocus = doc.activeElement;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  var focusable = q('button, [href], input', dialog);
  if (focusable) focusable.focus();
  fire(dialog, 'open');
}
function closeDialog(dialog) {
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
  if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  fire(dialog, 'close');
}`;

const SLIDER = `
function wireSliders() {
  qa('[data-ak-slider]').forEach(function (input) {
    var output = q('[data-ak-slider-output]', input.closest('.ak-slider') || doc);
    var sync = function () { if (output) output.textContent = input.value; };
    sync();
    input.addEventListener('input', function () {
      sync();
      fire(input, 'change', { value: input.value });
    }, false);
  });
}`;

const FILTER = `
function applyFilter(lists, query, match) {
  var needle = String(query || '').trim().toLowerCase();
  var visible = 0;
  var total = 0;
  lists.forEach(function (list) {
    qa('[data-ak-filter-item]', list).forEach(function (item) {
      total += 1;
      var haystack = item.textContent || '';
      if (match === 'label') haystack = item.getAttribute('data-ak-label') || haystack;
      if (match === 'value') haystack = item.getAttribute('data-ak-value') || '';
      var hit = needle === '' || haystack.toLowerCase().indexOf(needle) !== -1;
      item.hidden = !hit;
      if (hit) visible += 1;
    });
  });
  announce(visible + ' of ' + total + ' items shown');
}
function wireFilters() {
  qa('[data-ak-search]').forEach(function (input) {
    var listId = input.getAttribute('data-ak-search');
    input.addEventListener('input', function () {
      applyFilter(byId(listId), input.value, input.getAttribute('data-ak-match') || 'text');
      fire(input, 'filter', { query: input.value });
    }, false);
  });
}`;

const DELEGATION = `
doc.addEventListener('click', function (event) {
  var target = event.target;
  while (target && target !== doc.documentElement) {
    if (target.hasAttribute && target.hasAttribute('data-ak-on-click')) {
      var bindings = readJson(target, 'data-ak-on-click');
      for (var i = 0; i < bindings.length; i += 1) run(bindings[i], target, null);
      return;
    }
    if (target.hasAttribute && target.hasAttribute('data-ak-dialog-open')) {
      var dialog = q('[data-ak-id="' + target.getAttribute('data-ak-dialog-open') + '"]');
      if (dialog) openDialog(dialog);
      return;
    }
    if (target.hasAttribute && target.hasAttribute('data-ak-dialog-close')) {
      var panel = target.closest('dialog');
      if (panel) closeDialog(panel);
      return;
    }
    if (target.hasAttribute && target.hasAttribute('data-ak-theme-toggle')) {
      toggleTheme(target);
      return;
    }
    target = target.parentElement;
  }
}, false);
doc.addEventListener('keydown', function (event) {
  if (event.key !== 'Escape') return;
  var open = q('dialog[open]');
  if (open) closeDialog(open);
}, false);`;

const BOOT = `
syncBindings();
restoreTheme();`;

/** Build the emitted runtime for the features a page actually uses. */
export function buildRuntime(options: RuntimeOptions): string {
  const { features } = options;
  const modules = options.moduleFeatures ?? [];
  const conditions = features.has('state');
  const parts: string[] = [];

  if (conditions) parts.push(STATE);
  if (features.has('theme')) parts.push(THEME);
  if (features.has('copy')) parts.push(COPY);
  if (features.has('dialog')) parts.push(DIALOG);
  if (features.has('filter')) parts.push(FILTER);
  if (features.has('carousel')) parts.push(CAROUSEL);
  if (features.has('slider')) parts.push(SLIDER);
  if (features.has('tabs')) parts.push(TABS);
  if (features.has('outline')) parts.push(OUTLINE);
  if (features.has('before-after')) parts.push(BEFORE_AFTER);
  for (const feature of modules) {
    if (feature.script !== undefined) parts.push(feature.script.code);
  }
  parts.push(EFFECTS);

  const wiring: string[] = [];
  if (features.has('tabs')) wiring.push('wireTabs();');
  if (features.has('carousel')) wiring.push('wireCarousels();');
  if (features.has('slider')) wiring.push('wireSliders();');
  if (features.has('filter')) wiring.push('wireFilters();');
  if (features.has('outline')) wiring.push('wireOutline();');
  if (features.has('before-after')) wiring.push('wireBeforeAfter();');
  for (const feature of modules) {
    if (feature.script?.boot !== undefined) wiring.push(feature.script.boot);
  }
  wiring.push('wireEffects();');

  return [
    '(function () {',
    '"use strict";',
    'var doc = document;',
    'var root = doc.documentElement;',
    // The state is author data inside a script element: escaped so a value such
    // as `</script>` cannot close it.
    `var state = ${serializeJsonForScript(options.state)};`,
    helpers(conditions),
    RUN,
    FIRE,
    ...parts,
    DELEGATION,
    BOOT,
    ...wiring,
    '})();',
  ]
    .filter((part) => part !== '')
    .join('\n');
}

/** Features whose presence requires the live region in the document. */
export function needsLiveRegion(
  features: ReadonlySet<RuntimeFeature>,
  moduleFeatures: readonly FeatureModule[] = [],
): boolean {
  return (
    ANNOUNCING_FEATURES.some((feature) => features.has(feature)) ||
    moduleFeatures.some((feature) => feature.announces === true && features.has(feature.name))
  );
}
