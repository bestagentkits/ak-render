/**
 * Diagram motion: the four semantic diagram recipes and the one governor that
 * decides when any of them plays.
 *
 * The recipes only name what moves (`recipes.ts` owns their CSS); this module
 * owns the timing. One governor per page arbitrates:
 *
 * - ambient playback, which runs once when a diagram scrolls into view, one
 *   diagram at a time, the rest waiting their turn;
 * - focused playback, which follows the viewer's selection or route and
 *   pre-empts any ambient run;
 * - visibility, a theme or motion-policy switch and print, each of which stops
 *   what is playing at once and leaves the drawing as authored.
 *
 * Every run is time-bounded: it ends with its last animation, and a timer
 * clears it if `animationend` never arrives. Sequence playback never starts by
 * itself; the reader steps or plays it. Nothing here runs under reduced motion,
 * the `reduced` or `none` motion policy, in print or without script, and the
 * drawing never depends on it: every edge, node and label is in place before
 * and after a run.
 */

import { escapeAttribute } from '../render/escape.js';

/** Recipe ids the governor drives. */
export const DIAGRAM_MOTION_RECIPES = [
  'edge-trace',
  'signal-relay',
  'node-activation',
  'sequence-playback',
] as const;

/**
 * Registers `part` with the page's diagram freeze hook, creating it on first
 * use. `window.akRenderDiagram.freeze()` settles every diagram for a static
 * capture (export, screenshot, print preview): runs stop, selections clear and
 * nothing starts again until reload. Both the viewer and the governor register,
 * whichever of them the page ships.
 */
export function diagramFreezeHook(part: string): string {
  return `(window.akRenderDiagram = window.akRenderDiagram || { parts: [], freeze: function () { this.parts.forEach(function (fn) { fn(); }); return true; } }).parts.push(${part});`;
}

/** The marker of a contract 2 drawing: the only thing diagram recipes animate. */
export const DIAGRAM_CANVAS_V2 = 'data-ak-diagram-contract="2"';

/** The reader's controls for `sequence-playback`, revealed by the runtime. */
export function diagramSequenceBar(title: string): string {
  return `<div class="ak-dm-bar" data-ak-dm-bar role="group" aria-label="Sequence: ${escapeAttribute(
    title,
  )}" hidden><button type="button" class="ak-dv-btn" data-ak-dm-play aria-pressed="false">Play sequence</button><button type="button" class="ak-dv-btn" data-ak-dm-next>Next step</button><button type="button" class="ak-dv-btn" data-ak-dm-reset>Reset</button><span class="ak-dm-status" role="status" data-ak-dm-status></span></div>`;
}

/** The governor, ES5 like the rest of the runtime. */
export const DIAGRAM_MOTION_RUNTIME = `
var DIAGRAM_MOTION = ['edge-trace', 'signal-relay', 'node-activation', 'sequence-playback'];
function wireDiagramMotion() {
  var entries = [];
  var current = null;
  function paths(el) { return el.tagName.toLowerCase() === 'path' ? [el] : qa('path', el); }
  function edgeOrder(a, b) { return Number(a.getAttribute('data-ak-edge')) - Number(b.getAttribute('data-ak-edge')); }
  function clearRun(run) {
    window.clearTimeout(run.timer);
    run.marked.forEach(function (el) {
      if (el.hasAttribute('data-ak-dm-pulse')) { if (el.parentNode) el.parentNode.removeChild(el); return; }
      el.removeAttribute('data-ak-dm-on');
      el.style.removeProperty('--ak-dm-i');
      paths(el).forEach(function (path) {
        if (path.hasAttribute('data-ak-dm-len')) { path.removeAttribute('pathLength'); path.removeAttribute('data-ak-dm-len'); }
      });
    });
    run.entry.figure.removeAttribute('data-ak-dm-play');
  }
  function stop(resume) {
    if (current) { var run = current; current = null; clearRun(run); }
    if (resume) next();
  }
  var frozen = false;
  function play(entry, items, kind) {
    if (frozen) return;
    if (current && current.kind === 'focused' && kind === 'ambient') return;
    stop(false);
    if (!motionAllowed() || doc.hidden || !items.length) return;
    var run = { entry: entry, kind: kind, marked: [], timer: 0 };
    entry.figure.setAttribute('data-ak-dm-play', kind);
    items.slice(0, 40).forEach(function (el, index) {
      var step = String(Math.min(index, 12));
      if (entry.recipe === 'signal-relay') {
        var path = paths(el)[0];
        if (!path || !path.parentNode) return;
        // A copy of the line carries the pulse, so the line itself never changes.
        var pulse = path.cloneNode(false);
        ['id', 'class', 'style', 'marker-start', 'marker-mid', 'marker-end'].forEach(function (name) { pulse.removeAttribute(name); });
        pulse.setAttribute('pathLength', '1');
        pulse.setAttribute('data-ak-dm-pulse', '');
        pulse.setAttribute('aria-hidden', 'true');
        pulse.style.setProperty('--ak-dm-i', step);
        path.parentNode.insertBefore(pulse, path.nextSibling);
        run.marked.push(pulse);
        return;
      }
      el.setAttribute('data-ak-dm-on', '');
      el.style.setProperty('--ak-dm-i', step);
      if (entry.recipe === 'edge-trace') {
        paths(el).forEach(function (path) {
          if (!path.hasAttribute('pathLength')) { path.setAttribute('pathLength', '1'); path.setAttribute('data-ak-dm-len', ''); }
        });
      }
      run.marked.push(el);
    });
    var last = run.marked[run.marked.length - 1];
    var probe = last && (last.hasAttribute('data-ak-dm-pulse') || last.hasAttribute('data-ak-node') ? last : paths(last)[0] || last);
    var style = probe ? window.getComputedStyle(probe) : null;
    var ms = style ? motionMs(style.animationDuration) + motionMs(style.animationDelay) : 0;
    current = run;
    if (ms === 0) { stop(true); return; }
    run.timer = window.setTimeout(function () { if (current === run) stop(true); }, ms + 150);
  }
  function ambientItems(entry) {
    return entry.recipe === 'node-activation' ? entry.nodes : entry.edges;
  }
  function next() {
    if (current) return;
    for (var i = 0; i < entries.length; i += 1) {
      var entry = entries[i];
      if (entry.visible && !entry.played && entry.recipe !== 'sequence-playback') {
        entry.played = true;
        play(entry, ambientItems(entry), 'ambient');
        if (current) return;
      }
    }
  }
  function focused(entry, viewer) {
    if (viewer.mode === 'focus' || viewer.mode === 'route' || viewer.mode === 'reach' || viewer.mode === 'edge') {
      entry.played = true;
      var items;
      if (entry.recipe === 'node-activation') {
        items = qa('[data-ak-node][data-ak-dv-state]', entry.canvas).sort(function (a, b) {
          return (b.getAttribute('data-ak-dv-state') === 'focus') - (a.getAttribute('data-ak-dv-state') === 'focus');
        });
      } else {
        items = viewer.mode === 'route' && viewer.route.length ? viewer.route : qa('[data-ak-edge][data-ak-dv-state]', entry.canvas).sort(edgeOrder);
      }
      play(entry, items, 'focused');
    } else if (current && current.entry === entry) {
      stop(true);
    }
  }
  function wireSequence(entry) {
    var bar = q('[data-ak-dm-bar]', entry.figure);
    if (!bar || !entry.edges.length) return;
    var playButton = q('[data-ak-dm-play]', bar);
    var stepButton = q('[data-ak-dm-next]', bar);
    var resetButton = q('[data-ak-dm-reset]', bar);
    var status = q('[data-ak-dm-status]', bar);
    var canvas = entry.canvas;
    var edges = entry.edges;
    var at = -1;
    var timer = 0;
    function node(id) {
      for (var i = 0; i < entry.nodes.length; i += 1) if (entry.nodes[i].getAttribute('data-ak-node') === id) return entry.nodes[i];
      return null;
    }
    function name(id) { var el = node(id); return (el && el.getAttribute('data-ak-label')) || id; }
    function sync() {
      // Autoplay is motion: it is offered only where motion may play. Stepping always works.
      playButton.hidden = !motionAllowed();
      playButton.textContent = timer ? 'Pause' : at >= edges.length - 1 ? 'Replay' : 'Play sequence';
      playButton.setAttribute('aria-pressed', timer ? 'true' : 'false');
    }
    function show(index) {
      qa('[data-ak-dm-step]', canvas).forEach(function (el) { el.removeAttribute('data-ak-dm-step'); });
      at = index;
      if (index < 0) { canvas.removeAttribute('data-ak-dm-seq'); status.textContent = ''; sync(); return; }
      var edge = edges[index];
      var from = edge.getAttribute('data-ak-from');
      var to = edge.getAttribute('data-ak-to');
      var text = edge.getAttribute('data-ak-label');
      if (viewer && viewer.mode !== 'idle') viewer.clear();
      canvas.setAttribute('data-ak-dm-seq', '');
      edge.setAttribute('data-ak-dm-step', '');
      [node(from), node(to)].forEach(function (el) { if (el) el.setAttribute('data-ak-dm-step', ''); });
      status.textContent = 'Step ' + (index + 1) + ' of ' + edges.length + ': ' + name(from) + ' \\u2192 ' + name(to) + (text ? ', ' + text : '');
      sync();
    }
    function pause() { window.clearInterval(timer); timer = 0; sync(); }
    function advance() {
      if (frozen) { pause(); return; } if (at >= edges.length - 1) { pause(); return; } show(at + 1); }
    entry.pause = pause;
    // One dimming at a time: a step clears the viewer's selection, and a
    // viewer selection ends the walk-through.
    var viewer = null;
    if (typeof diagramViewers !== 'undefined') {
      diagramViewers.forEach(function (item) { if (item.canvas === canvas) viewer = item; });
    }
    if (viewer) viewer.listeners.push(function (state) { if (state.mode !== 'idle' && at >= 0) { pause(); show(-1); } });
    playButton.addEventListener('click', function () {
      if (timer) { pause(); return; }
      if (!motionAllowed()) return;
      if (at >= edges.length - 1) at = -1;
      advance();
      timer = window.setInterval(advance, 1600);
      sync();
    });
    stepButton.addEventListener('click', function () { pause(); show(at >= edges.length - 1 ? 0 : at + 1); });
    resetButton.addEventListener('click', function () { pause(); show(-1); });
    entry.figure.addEventListener('keydown', function (event) { if (event.key === 'Escape') { pause(); show(-1); } });
    bar.hidden = false;
    sync();
  }
  qa('[data-ak-motion]').forEach(function (figure) {
    var recipe = figure.getAttribute('data-ak-motion');
    if (DIAGRAM_MOTION.indexOf(recipe) === -1) return;
    var canvas = q('[data-ak-diagram-contract="2"]', figure);
    if (!canvas) return;
    var entry = {
      figure: figure,
      canvas: canvas,
      recipe: recipe,
      edges: qa('[data-ak-edge]', canvas).sort(edgeOrder),
      nodes: qa('[data-ak-node]', canvas),
      visible: false,
      played: false,
      pause: null
    };
    entries.push(entry);
    if (recipe === 'sequence-playback') { wireSequence(entry); return; }
    if (typeof diagramViewers !== 'undefined') {
      diagramViewers.forEach(function (viewer) {
        if (viewer.canvas === canvas) viewer.listeners.push(function (state) { focused(entry, state); });
      });
    }
  });
  if (!entries.length) return;
  if (typeof window.IntersectionObserver === 'function') {
    var seen = new window.IntersectionObserver(function (records) {
      records.forEach(function (record) {
        entries.forEach(function (entry) {
          if (entry.figure !== record.target) return;
          entry.visible = record.intersectionRatio >= 0.35;
          if (!entry.visible && current && current.entry === entry && current.kind === 'ambient') stop(true);
        });
      });
      next();
    }, { threshold: [0, 0.35, 0.7] });
    entries.forEach(function (entry) { seen.observe(entry.figure); });
  }
  function halt() {
    stop(false);
    entries.forEach(function (entry) { if (entry.pause) entry.pause(); });
  }
  ${diagramFreezeHook('function () { frozen = true; halt(); }')}
  doc.addEventListener('visibilitychange', function () { if (doc.hidden) halt(); }, false);
  window.addEventListener('beforeprint', halt, false);
  // A theme or motion-policy switch settles everything at once: a run never
  // carries colours or timings from the previous theme.
  if (typeof window.MutationObserver === 'function') {
    new window.MutationObserver(halt).observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-motion'] });
  }
  if (window.matchMedia) {
    var query = window.matchMedia('(prefers-reduced-motion: reduce)');
    var onChange = function () { if (query.matches) halt(); };
    if (query.addEventListener) query.addEventListener('change', onChange);
    else if (query.addListener) query.addListener(onChange);
  }
}`;
