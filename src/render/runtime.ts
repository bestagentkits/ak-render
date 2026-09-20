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

import type { RuntimeFeature } from '../registry/roster.js';

/** Features that produce user-facing feedback and therefore need a live region. */
const ANNOUNCING_FEATURES: readonly RuntimeFeature[] = ['copy', 'filter', 'theme'];

export interface RuntimeOptions {
  features: ReadonlySet<RuntimeFeature>;
  state: Record<string, unknown>;
  /** True when at least one block declares an action binding. */
  hasBindings: boolean;
}

const HELPERS = `
function q(sel, ctx) { return (ctx || doc).querySelector(sel); }
function qa(sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); }
function byId(id) { return qa('[data-ak-id="' + id + '"]'); }
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
      else if (node.hasAttribute('data-ak-theme-toggle')) toggleTheme();
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
    copyText(text, action);
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
    setPath(action.path, action.value);
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
  qa('[data-ak-theme-toggle]').forEach(function (button) {
    button.setAttribute('aria-pressed', String(next === 'dark'));
    button.textContent = next === 'dark' ? 'Light' : 'Dark';
  });
  announce('Theme set to ' + next);
}
function toggleTheme() { applyTheme('toggle'); }
function restoreTheme() {
  var stored = null;
  try { stored = window.localStorage.getItem('ak-render-theme'); } catch (error) {}
  if (!stored) return;
  if (stored === 'system') applyTheme('system');
  else applyTheme(stored);
}`;

const COPY = `
function copyText(text, action) {
  var done = function () { announce('Copied to clipboard'); };
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

const TABS = `
function selectTab(container, action, fireFn) {
  var tabs = qa('[role="tab"]', container);
  if (!tabs.length) return;
  var index = tabs.length - 1;
  if (typeof action.index === 'number') index = Math.min(Math.max(action.index, 0), tabs.length - 1);
  else if (action.tabId) {
    for (var i = 0; i < tabs.length; i += 1) if (tabs[i].getAttribute('data-ak-tab-id') === action.tabId) index = i;
  } else {
    var active = tabs.findIndex(function (tab) { return tab.getAttribute('aria-selected') === 'true'; });
    if (active >= 0 && typeof action.index !== 'number' && !action.tabId) index = active;
  }
  activateTab(container, index, true, fireFn, true);
}
function activateTab(container, index, moveFocus, fireFn, announceChange) {
  var tabs = qa('[role="tab"]', container);
  qa('[role="tabpanel"]', container).forEach(function (panel, panelIndex) {
    var selected = panelIndex === index;
    panel.hidden = !selected;
    panel.setAttribute('tabindex', selected ? '0' : '-1');
  });
  tabs.forEach(function (tab, tabIndex) {
    var selected = tabIndex === index;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  if (moveFocus && tabs[index]) tabs[index].focus();
  // Only a user-driven change is worth announcing. Announcing the initial
  // selection would make every page with tabs talk on load.
  if (announceChange) announce('Tab ' + (index + 1) + ' of ' + tabs.length);
  if (fireFn) fireFn(container, 'select', { index: index });
}
function wireTabs() {
  qa('[data-ak-tabs]').forEach(function (container) {
    activateTab(container, 0, false, fire, false);
    qa('[role="tab"]', container).forEach(function (tab, index) {
      tab.addEventListener('click', function () { selectTab(container, { index: index }, fire); }, false);
      tab.addEventListener('keydown', function (event) {
        var keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
        if (keys.indexOf(event.key) === -1) return;
        event.preventDefault();
        var total = qa('[role="tab"]', container).length;
        var current = index;
        if (event.key === 'ArrowRight') current = (index + 1) % total;
        else if (event.key === 'ArrowLeft') current = (index - 1 + total) % total;
        else if (event.key === 'Home') current = 0;
        else current = total - 1;
        activateTab(container, current, true, fire, true);
      }, false);
    });
  });
}`;

const CAROUSEL = `
function shiftSlide(carousel, delta, fireFn) {
  var slides = qa('[data-ak-slide]', carousel);
  if (!slides.length) return;
  var current = slides.findIndex(function (slide) { return !slide.hidden; });
  if (current < 0) current = 0;
  var next = (current + delta + slides.length) % slides.length;
  showSlide(carousel, next, fireFn, false);
}
function showSlide(carousel, index, fireFn, focus) {
  var slides = qa('[data-ak-slide]', carousel);
  if (!slides.length) return;
  var bounded = Math.min(Math.max(index, 0), slides.length - 1);
  slides.forEach(function (slide, slideIndex) {
    var active = slideIndex === bounded;
    slide.hidden = !active;
    slide.setAttribute('aria-hidden', String(!active));
  });
  var buttons = qa('[data-ak-carousel]', carousel);
  buttons.forEach(function (button) {
    var isPrev = button.getAttribute('data-ak-carousel') === 'prev';
    button.disabled = !carousel.hasAttribute('data-ak-loop') && ((isPrev && bounded === 0) || (!isPrev && bounded === slides.length - 1));
  });
  var status = q('[data-ak-carousel-status]', carousel);
  if (status) status.textContent = (bounded + 1) + ' / ' + slides.length;
  if (focus && slides[bounded]) slides[bounded].focus();
  if (fireFn) fireFn(carousel, 'change', { index: bounded });
}
function wireCarousels() {
  qa('[data-ak-carousel-root]').forEach(function (carousel) {
    showSlide(carousel, 0, fire, false);
    qa('[data-ak-carousel]', carousel).forEach(function (button) {
      button.addEventListener('click', function () {
        shiftSlide(carousel, button.getAttribute('data-ak-carousel') === 'next' ? 1 : -1, fire);
      }, false);
    });
    carousel.addEventListener('keydown', function (event) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      var delta = event.key === 'ArrowRight' ? 1 : -1;
      var slides = qa('[data-ak-slide]', carousel);
      var current = slides.findIndex(function (slide) { return !slide.hidden; });
      showSlide(carousel, current + delta, fire, true);
    }, false);
    var startX = null;
    carousel.addEventListener('touchstart', function (event) {
      if (event.touches.length === 1) startX = event.touches[0].clientX;
    }, { passive: true });
    carousel.addEventListener('touchend', function (event) {
      if (startX === null) return;
      var endX = event.changedTouches.length ? event.changedTouches[0].clientX : startX;
      var delta = endX - startX;
      startX = null;
      if (Math.abs(delta) < 40) return;
      shiftSlide(carousel, delta < 0 ? 1 : -1, fire);
    }, false);
  });
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
      toggleTheme();
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
  const needsLiveRegion = ANNOUNCING_FEATURES.some((feature) => features.has(feature));
  const parts: string[] = [];

  if (features.has('theme')) parts.push(THEME);
  if (features.has('copy')) parts.push(COPY);
  if (features.has('dialog')) parts.push(DIALOG);
  if (features.has('filter')) parts.push(FILTER);
  if (features.has('carousel')) parts.push(CAROUSEL);
  if (features.has('slider')) parts.push(SLIDER);
  if (features.has('tabs')) parts.push(TABS);

  const wiring: string[] = [];
  if (features.has('tabs')) wiring.push('wireTabs();');
  if (features.has('carousel')) wiring.push('wireCarousels();');
  if (features.has('slider')) wiring.push('wireSliders();');
  if (features.has('filter')) wiring.push('wireFilters();');

  return [
    '(function () {',
    '"use strict";',
    'var doc = document;',
    'var root = doc.documentElement;',
    `var state = ${JSON.stringify(options.state)};`,
    HELPERS,
    RUN,
    FIRE,
    ...parts,
    DELEGATION,
    BOOT,
    ...wiring,
    needsLiveRegion ? '' : '',
    '})();',
  ]
    .filter((part) => part !== '')
    .join('\n');
}

/** Features whose presence requires the live region in the document. */
export function needsLiveRegion(features: ReadonlySet<RuntimeFeature>): boolean {
  return ANNOUNCING_FEATURES.some((feature) => features.has(feature));
}
