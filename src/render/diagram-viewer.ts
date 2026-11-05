/**
 * The diagram viewer: focus, route trace, reachability, pan/zoom, search and a
 * details panel for diagrams drawn through adapter contract 2.
 *
 * It reads only the hooks the compiler wrote while binding the manifest
 * (`data-ak-node`, `data-ak-edge`, `data-ak-from`, `data-ak-to`,
 * `data-ak-label`), so it never trusts adapter-authored selectors, and it is
 * the single owner of each diagram's focus and camera state. Diagram motion
 * (the governor) subscribes to it instead of keeping a second copy.
 *
 * The controls ship hidden and the runtime reveals them, so without script and
 * in print the drawing and its text description read as before. Nothing here
 * animates by itself; the only transition (dimming) sits behind the motion guard.
 */

import { diagramFreezeHook } from '../motion/diagram-motion.js';
import { escapeAttribute } from './escape.js';
import { MOTION_ALLOWED } from './motion.js';

/** The attribute that marks a page as needing the viewer. */
export const DIAGRAM_VIEWER_MARKUP = 'data-ak-dv-bar';

/** Controls the compiler emits around a contract 2 canvas, by declared capability. */
export function diagramViewerBar(capabilities: readonly string[], title: string): string {
  const has = (name: string): boolean => capabilities.includes(name);
  if (capabilities.length === 0) return '';
  const label = escapeAttribute(title);
  const parts: string[] = [];
  if (has('search')) {
    parts.push(
      `<input type="search" class="ak-dv-search" data-ak-dv-search placeholder="Find a node" aria-label="Find a node in ${label}" autocomplete="off" spellcheck="false">`,
    );
  }
  if (has('zoom')) {
    parts.push(
      '<span class="ak-dv-zoom">' +
        '<button type="button" class="ak-dv-btn" data-ak-dv-zoom="out" aria-label="Zoom out">−</button>' +
        '<button type="button" class="ak-dv-btn" data-ak-dv-zoom="in" aria-label="Zoom in">+</button>' +
        '<button type="button" class="ak-dv-btn" data-ak-dv-zoom="fit">Fit</button>' +
        '<button type="button" class="ak-dv-btn" data-ak-dv-zoom="reset" aria-label="Actual size">1:1</button>' +
        '</span>',
    );
  }
  if (has('focus') || has('trace') || has('search')) {
    parts.push('<button type="button" class="ak-dv-btn" data-ak-dv-clear>Clear</button>');
  }
  const hint = has('trace')
    ? 'Select a node. Shift+select a second node to trace a route.'
    : has('focus')
      ? 'Select a node to see its connections.'
      : '';
  parts.push(`<span class="ak-dv-status" role="status" data-ak-dv-status>${hint}</span>`);
  return `<div class="ak-dv-bar" data-ak-dv-bar role="group" aria-label="Diagram controls: ${label}" hidden>${parts.join('')}</div>`;
}

/** The details panel, filled by the runtime when a node, relationship or route is selected. */
export const DIAGRAM_VIEWER_DETAILS = '<div class="ak-dv-details" data-ak-dv-details hidden></div>';

const DIM =
  '[data-ak-dv-active] :is([data-ak-node],[data-ak-edge],[data-ak-group]):not([data-ak-dv-state])';

export const DIAGRAM_VIEWER_CSS = `.ak-dv-bar{display:flex;flex-wrap:wrap;align-items:center;gap:var(--ak-space-unit);margin-bottom:calc(var(--ak-space-unit) * 1.5)}
.ak-dv-bar[hidden],.ak-dv-details[hidden]{display:none}
.ak-dv-zoom{display:inline-flex;gap:calc(var(--ak-space-unit) * .5)}
.ak-dv-search{flex:1 1 12rem;min-width:0;min-height:36px;padding:0 calc(var(--ak-space-unit) * 1.5);font:inherit;font-size:.875rem;color:var(--ak-color-text);background:var(--ak-color-surface);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium)}
.ak-dv-btn{min-width:36px;min-height:36px;padding:0 calc(var(--ak-space-unit) * 1.25);font:inherit;font-size:.8125rem;font-weight:600;color:var(--ak-color-text);background:var(--ak-color-surface);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);cursor:pointer}
.ak-dv-btn:hover{border-color:var(--ak-color-accent)}
.ak-dv-search:focus-visible,.ak-dv-btn:focus-visible{outline:2px solid var(--ak-color-accent);outline-offset:2px}
.ak-dv-status{flex:1 1 100%;font-size:.75rem;color:var(--ak-color-text-muted)}
.ak-diagram-canvas [data-ak-node]{cursor:pointer}
.ak-diagram-canvas [data-ak-node]:focus{outline:none}
.ak-diagram-canvas [data-ak-node]:focus-visible{outline:2px solid var(--ak-color-accent);outline-offset:3px}
.ak-diagram-canvas [data-ak-edge]{cursor:pointer}
${DIM}{opacity:.22}
.ak-diagram-canvas [data-ak-dv-state="focus"],.ak-diagram-canvas [data-ak-dv-state="route"]{filter:drop-shadow(0 0 .3rem var(--ak-color-accent))}
.ak-diagram-canvas [data-ak-dv-state="match"]{filter:drop-shadow(0 0 .3rem var(--ak-color-text-muted))}
.ak-diagram-rendered[data-ak-dv-pan]{cursor:grab}
.ak-diagram-rendered[data-ak-dv-panning]{cursor:grabbing;user-select:none}
.ak-dv-details{margin-top:calc(var(--ak-space-unit) * 1.5);padding:calc(var(--ak-space-unit) * 1.5) calc(var(--ak-space-unit) * 2);background:var(--ak-color-surface);border:var(--ak-border-width) solid var(--ak-color-border);border-left:3px solid var(--ak-color-accent);border-radius:var(--ak-radius-medium);font-size:.875rem}
.ak-dv-details h3{margin:0 0 calc(var(--ak-space-unit) * .75);font-size:.9375rem}
.ak-dv-details p{margin:calc(var(--ak-space-unit) * .5) 0;color:var(--ak-color-text-muted)}
.ak-dv-details ul{display:flex;flex-wrap:wrap;gap:calc(var(--ak-space-unit) * .75);margin:calc(var(--ak-space-unit) * .5) 0 0;padding:0;list-style:none}
.ak-dv-details li button{min-height:32px;padding:0 var(--ak-space-unit);font:inherit;font-size:.8125rem;color:var(--ak-color-text);background:var(--ak-fill);border:var(--ak-border-width) solid var(--ak-color-border);border-radius:var(--ak-radius-medium);cursor:pointer}
.ak-dv-details li button:focus-visible{outline:2px solid var(--ak-color-accent);outline-offset:2px}
@media (max-width:768px){.ak-dv-btn,.ak-dv-search{min-height:44px}.ak-dv-btn{min-width:44px}.ak-dv-details li button{min-height:44px}}
@media ${MOTION_ALLOWED}{:root:not([data-motion]) .ak-diagram-canvas :is([data-ak-node],[data-ak-edge],[data-ak-group]){transition:opacity var(--ak-motion-duration) var(--ak-motion-easing)}}
@media print{.ak-dv-bar,.ak-dv-details{display:none!important}${DIM}{opacity:1}.ak-diagram-canvas [data-ak-dv-state]{filter:none}}`;

/**
 * The runtime part, ES5 like the rest of the runtime. `diagramViewers` is the
 * shared registry diagram motion subscribes to.
 */
export const DIAGRAM_VIEWER_RUNTIME = `
var diagramViewers = [];
function dvFold(text) {
  return String(text || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/\\u0111/g, 'd').replace(/\\u0110/g, 'D').toLowerCase();
}
function wireDiagramViewers() {
  qa('[data-ak-diagram-contract="2"]').forEach(function (canvas) {
    var figure = canvas.closest('.ak-diagram');
    var scroller = canvas.parentNode;
    var svg = q('svg', canvas);
    if (!figure || !svg) return;
    var caps = (canvas.getAttribute('data-ak-diagram-capabilities') || '').split(' ');
    function has(name) { return caps.indexOf(name) !== -1; }
    var scope = canvas.getAttribute('data-ak-diagram-scope') || '';
    var bar = q('[data-ak-dv-bar]', figure);
    var panel = q('[data-ak-dv-details]', figure);
    var status = q('[data-ak-dv-status]', figure);
    var search = q('[data-ak-dv-search]', figure);
    var nodes = qa('[data-ak-node]', canvas);
    var edges = qa('[data-ak-edge]', canvas);
    // Null-prototype maps: an id from a link such as constructor finds nothing.
    var byId = Object.create(null);
    var out = Object.create(null);
    var inc = Object.create(null);
    var armed = null;
    nodes.forEach(function (node) {
      var id = node.getAttribute('data-ak-node');
      byId[id] = node;
      out[id] = [];
      inc[id] = [];
    });
    edges.forEach(function (edge) {
      var from = edge.getAttribute('data-ak-from');
      var to = edge.getAttribute('data-ak-to');
      if (out[from]) out[from].push(edge);
      if (inc[to]) inc[to].push(edge);
    });
    var viewer = { canvas: canvas, figure: figure, mode: 'idle', focus: null, route: [], edges: edges, nodes: nodes, listeners: [] };
    diagramViewers.push(viewer);
    if (bar) bar.hidden = false;
    var interactive = has('focus') || has('trace') || has('search');
    function label(id) {
      var node = byId[id];
      return (node && node.getAttribute('data-ak-label')) || id;
    }
    function emit() {
      viewer.listeners.forEach(function (listener) { listener(viewer); });
    }
    function say(text) { if (status) status.textContent = text; }
    function mark(el, state) { if (el && !el.hasAttribute('data-ak-dv-state')) el.setAttribute('data-ak-dv-state', state); }
    function reset() {
      qa('[data-ak-dv-state]', canvas).forEach(function (el) { el.removeAttribute('data-ak-dv-state'); });
      canvas.removeAttribute('data-ak-dv-active');
    }
    function setHash(value) {
      if (!window.history || !history.replaceState) return;
      try { history.replaceState(null, '', value ? '#' + value : location.pathname + location.search); } catch (error) {}
    }
    function heading(text) {
      var h = doc.createElement('h3');
      h.textContent = text;
      return h;
    }
    function line(text) {
      var p = doc.createElement('p');
      p.textContent = text;
      return p;
    }
    function goList(ids, prefix) {
      var list = doc.createElement('ul');
      ids.forEach(function (id) {
        var item = doc.createElement('li');
        var button = doc.createElement('button');
        button.type = 'button';
        button.textContent = prefix + label(id);
        button.addEventListener('click', function () { select(id, true); });
        item.appendChild(button);
        list.appendChild(item);
      });
      return list;
    }
    function show(children) {
      if (!panel) return;
      panel.textContent = '';
      children.forEach(function (child) { if (child) panel.appendChild(child); });
      panel.hidden = children.length === 0;
    }
    function clear() {
      armed = null;
      reset();
      viewer.mode = 'idle';
      viewer.focus = null;
      viewer.route = [];
      show([]);
      setHash('');
      say('');
      emit();
    }
    function reveal(node, moveFocus) {
      if (!node) return;
      if (moveFocus && node.focus) node.focus({ preventScroll: true });
      var box = node.getBoundingClientRect();
      var frame = scroller.getBoundingClientRect();
      if (box.left < frame.left || box.right > frame.right) {
        scroller.scrollLeft += box.left + box.width / 2 - (frame.left + frame.width / 2);
      }
    }
    function select(id, moveFocus) {
      armed = null;
      var node = byId[id];
      if (!node) return;
      reset();
      canvas.setAttribute('data-ak-dv-active', '');
      mark(node, 'focus');
      var after = [];
      var before = [];
      out[id].forEach(function (edge) { mark(edge, 'near'); mark(byId[edge.getAttribute('data-ak-to')], 'near'); after.push(edge.getAttribute('data-ak-to')); });
      inc[id].forEach(function (edge) { mark(edge, 'near'); mark(byId[edge.getAttribute('data-ak-from')], 'near'); before.push(edge.getAttribute('data-ak-from')); });
      viewer.mode = 'focus';
      viewer.focus = id;
      viewer.route = [];
      var parts = [heading(label(id)), line(after.length + ' outgoing, ' + before.length + ' incoming')];
      if (after.length) parts.push(goList(after, '\\u2192 '));
      if (before.length) parts.push(goList(before, '\\u2190 '));
      if (out[id].length || inc[id].length) {
        var links = doc.createElement('ul');
        out[id].concat(inc[id]).forEach(function (edge) {
          var item = doc.createElement('li');
          var button = doc.createElement('button');
          var text = edge.getAttribute('data-ak-label');
          button.type = 'button';
          button.textContent = label(edge.getAttribute('data-ak-from')) + ' \u2192 ' + label(edge.getAttribute('data-ak-to')) + (text ? ' (' + text + ')' : '');
          button.addEventListener('click', function () { inspect(edge); });
          item.appendChild(button);
          links.appendChild(item);
        });
        parts.push(line('Relationships'), links);
      }
      if (has('trace')) {
        var arm = doc.createElement('button');
        arm.type = 'button';
        arm.className = 'ak-dv-btn';
        arm.textContent = 'Trace a route from here';
        arm.addEventListener('click', function () { armed = id; say('Select the destination node to trace a route from ' + label(id) + '.'); });
        parts.push(arm);
      }
      if (out[id].length) {
        var downstream = doc.createElement('button');
        downstream.type = 'button';
        downstream.className = 'ak-dv-btn';
        downstream.textContent = 'Show everything downstream';
        downstream.addEventListener('click', function () { reach(id); });
        parts.push(downstream);
      }
      show(parts);
      setHash(scope + ':node:' + encodeURIComponent(id));
      say(label(id) + ' selected' + (has('trace') ? '. Choose Trace a route, or Shift+select another node.' : '.'));
      reveal(node, moveFocus);
      emit();
    }
    function reach(id) {
      reset();
      canvas.setAttribute('data-ak-dv-active', '');
      var seen = Object.create(null);
      seen[id] = true;
      var queue = [id];
      var count = 0;
      while (queue.length) {
        var at = queue.shift();
        (out[at] || []).forEach(function (edge) {
          var to = edge.getAttribute('data-ak-to');
          mark(edge, 'route');
          if (!seen[to]) { seen[to] = true; count += 1; queue.push(to); }
        });
      }
      Object.keys(seen).forEach(function (key) { mark(byId[key], key === id ? 'focus' : 'route'); });
      viewer.mode = 'reach';
      viewer.focus = id;
      show([heading('Downstream of ' + label(id)), line(count + ' node' + (count === 1 ? '' : 's') + ' reachable along the arrows.')]);
      say(count + ' nodes reachable from ' + label(id));
      emit();
    }
    function trace(from, to) {
      if (!byId[from] || !byId[to]) return;
      if (from === to) return select(to, true);
      armed = null;
      var prev = Object.create(null);
      prev[from] = null;
      var queue = [from];
      while (queue.length && !Object.prototype.hasOwnProperty.call(prev, to)) {
        var at = queue.shift();
        (out[at] || []).forEach(function (edge) {
          var next = edge.getAttribute('data-ak-to');
          if (!Object.prototype.hasOwnProperty.call(prev, next)) { prev[next] = edge; queue.push(next); }
        });
      }
      if (!Object.prototype.hasOwnProperty.call(prev, to)) {
        reset();
        viewer.mode = 'none';
        viewer.route = [];
        emit();
        say('No directed route from ' + label(from) + ' to ' + label(to) + '.');
        show([heading('No route'), line('Nothing leads from ' + label(from) + ' to ' + label(to) + ' along the arrows.')]);
        return;
      }
      var path = [];
      var cursor = to;
      while (prev[cursor]) { path.unshift(prev[cursor]); cursor = prev[cursor].getAttribute('data-ak-from'); }
      reset();
      canvas.setAttribute('data-ak-dv-active', '');
      var names = [label(from)];
      mark(byId[from], 'route');
      path.forEach(function (edge) {
        mark(edge, 'route');
        var next = edge.getAttribute('data-ak-to');
        mark(byId[next], 'route');
        names.push(label(next));
      });
      viewer.mode = 'route';
      viewer.focus = from;
      viewer.route = path;
      show([heading('Route, ' + path.length + ' step' + (path.length === 1 ? '' : 's')), line(names.join(' \\u2192 '))]);
      setHash(scope + ':route:' + encodeURIComponent(from) + ':' + encodeURIComponent(to));
      say('Route from ' + label(from) + ' to ' + label(to) + ': ' + path.length + ' steps.');
      reveal(byId[to], true);
      emit();
    }
    function inspect(edge) {
      armed = null;
      reset();
      canvas.setAttribute('data-ak-dv-active', '');
      var from = edge.getAttribute('data-ak-from');
      var to = edge.getAttribute('data-ak-to');
      mark(edge, 'focus');
      mark(byId[from], 'near');
      mark(byId[to], 'near');
      var text = edge.getAttribute('data-ak-label');
      viewer.mode = 'edge';
      viewer.focus = null;
      viewer.route = [edge];
      show([heading(label(from) + ' \\u2192 ' + label(to)), text ? line(text) : null, goList([from, to], '')]);
      say('Relationship from ' + label(from) + ' to ' + label(to) + '.');
      emit();
    }
    if (interactive) {
      // The drawing becomes a group of operable nodes; an img role would hide them.
      svg.setAttribute('role', 'group');
      nodes.forEach(function (node) {
        var id = node.getAttribute('data-ak-node');
        node.setAttribute('tabindex', '0');
        node.setAttribute('role', 'button');
        node.setAttribute('aria-label', label(id) + ', ' + out[id].length + ' outgoing, ' + inc[id].length + ' incoming');
      });
      canvas.addEventListener('click', function (event) {
        if (scroller.hasAttribute('data-ak-dv-dragged')) { scroller.removeAttribute('data-ak-dv-dragged'); return; }
        var node = event.target.closest && event.target.closest('[data-ak-node]');
        if (node && canvas.contains(node)) {
          var id = node.getAttribute('data-ak-node');
          if (armed && armed !== id) trace(armed, id);
          else if (event.shiftKey && has('trace') && viewer.focus && viewer.focus !== id) trace(viewer.focus, id);
          else select(id, false);
          return;
        }
        var edge = event.target.closest && event.target.closest('[data-ak-edge]');
        if (edge && canvas.contains(edge)) inspect(edge);
      });
      canvas.addEventListener('keydown', function (event) {
        var node = event.target.closest && event.target.closest('[data-ak-node]');
        if (!node || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        var id = node.getAttribute('data-ak-node');
        if (armed && armed !== id) trace(armed, id);
          else if (event.shiftKey && has('trace') && viewer.focus && viewer.focus !== id) trace(viewer.focus, id);
        else select(id, false);
      });
    }
    // Escape resets from anywhere in the figure, including the details panel.
    figure.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape' || event.target === search) return;
      clear();
    });
    var clearButton = q('[data-ak-dv-clear]', figure);
    if (clearButton) clearButton.addEventListener('click', function () { if (search) search.value = ''; clear(); });
    if (search) {
      search.addEventListener('input', function () {
        var term = dvFold(search.value).trim();
        reset();
        if (!term) { say(''); viewer.mode = 'idle'; emit(); return; }
        var hits = nodes.filter(function (node) {
          return dvFold(node.getAttribute('data-ak-label')).indexOf(term) !== -1 || dvFold(node.getAttribute('data-ak-node')).indexOf(term) !== -1;
        });
        if (hits.length) canvas.setAttribute('data-ak-dv-active', '');
        hits.forEach(function (node) { mark(node, 'match'); });
        viewer.mode = 'search';
        say(hits.length + ' match' + (hits.length === 1 ? '' : 'es') + (hits.length ? '. Press Enter to select the first.' : '.'));
        emit();
      });
      search.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') { search.value = ''; clear(); return; }
        if (event.key !== 'Enter') return;
        event.preventDefault();
        var hit = q('[data-ak-dv-state="match"]', canvas);
        if (hit) select(hit.getAttribute('data-ak-node'), true);
      });
    }
    if (has('zoom')) {
      var baseWidth = svg.getBoundingClientRect().width;
      var baseHeight = svg.getBoundingClientRect().height;
      var scale = 1;
      var zoomTo = function (next) {
        if (!baseWidth || !baseHeight) {
          // Measured late: a drawing set up inside a closed section reports 0.
          baseWidth = svg.getBoundingClientRect().width / scale;
          baseHeight = svg.getBoundingClientRect().height / scale;
          if (!baseWidth || !baseHeight) return;
        }
        next = Math.max(0.25, Math.min(4, next));
        var center = (scroller.scrollLeft + scroller.clientWidth / 2) / (baseWidth * scale);
        scale = next;
        svg.style.width = Math.round(baseWidth * scale) + 'px';
        svg.style.height = Math.round(baseHeight * scale) + 'px';
        scroller.scrollLeft = center * baseWidth * scale - scroller.clientWidth / 2;
        viewer.scale = scale;
        say('Zoom ' + Math.round(scale * 100) + '%');
        syncPan();
      };
      var fit = function () {
        var style = window.getComputedStyle(scroller);
        var room = scroller.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        zoomTo(room / baseWidth);
      };
      var syncPan = function () {
        if (scroller.scrollWidth > scroller.clientWidth + 1) scroller.setAttribute('data-ak-dv-pan', '');
        else scroller.removeAttribute('data-ak-dv-pan');
      };
      viewer.scale = 1;
      qa('[data-ak-dv-zoom]', figure).forEach(function (button) {
        button.addEventListener('click', function () {
          var kind = button.getAttribute('data-ak-dv-zoom');
          if (kind === 'in') zoomTo(scale * 1.25);
          else if (kind === 'out') zoomTo(scale / 1.25);
          else if (kind === 'fit') fit();
          else zoomTo(1);
        });
      });
      scroller.addEventListener('keydown', function (event) {
        if (event.target !== scroller) return;
        if (event.key === '+' || event.key === '=') zoomTo(scale * 1.25);
        else if (event.key === '-') zoomTo(scale / 1.25);
        else if (event.key === '0') zoomTo(1);
        else if (event.key === 'f') fit();
      });
      scroller.addEventListener('wheel', function (event) {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        zoomTo(event.deltaY < 0 ? scale * 1.1 : scale / 1.1);
      }, { passive: false });
      var drag = null;
      scroller.addEventListener('pointerdown', function (event) {
        if (event.pointerType !== 'mouse' || event.button !== 0 || !scroller.hasAttribute('data-ak-dv-pan')) return;
        drag = { x: event.clientX, y: event.clientY, left: scroller.scrollLeft, moved: false };
      });
      window.addEventListener('pointermove', function (event) {
        if (!drag) return;
        var dx = event.clientX - drag.x;
        if (!drag.moved && Math.abs(dx) < 4) return;
        drag.moved = true;
        scroller.setAttribute('data-ak-dv-panning', '');
        scroller.scrollLeft = drag.left - dx;
      });
      window.addEventListener('pointerup', function () {
        if (drag && drag.moved) scroller.setAttribute('data-ak-dv-dragged', '');
        scroller.removeAttribute('data-ak-dv-panning');
        drag = null;
      });
      syncPan();
    }
    viewer.select = select;
    viewer.trace = trace;
    viewer.clear = clear;
    var parts = (location.hash || '').slice(1).split(':');
    if (interactive && scope && parts[0] === scope) {
      // A malformed link must not stop this or any later diagram from wiring.
      try {
        if (parts[1] === 'node' && parts[2]) select(decodeURIComponent(parts[2]), false);
        else if (parts[1] === 'route' && parts[2] && parts[3]) trace(decodeURIComponent(parts[2]), decodeURIComponent(parts[3]));
      } catch (error) {}
    }
  });
  if (diagramViewers.length) ${diagramFreezeHook('function () { diagramViewers.forEach(function (viewer) { viewer.clear(); }); }')}
}`;
