/**
 * The Motion Studio browser UI: one page, one stylesheet, one script, served
 * from the studio's loopback origin under a strict CSP (no inline script or
 * style). It is development tooling only and never ships in a compiled page.
 *
 * The UI holds no motion data of its own: recipes, compatible lists, timings
 * and emitted CSS all come from the studio API, which reads the registry and
 * the real compiler output.
 */

export const STUDIO_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AK Motion Studio</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="studio.css">
<script src="studio.js" defer></script>
</head>
<body>
<header class="bar">
  <div class="title">
    <h1>Motion Studio</h1>
    <p><span id="file"></span> <span id="hash" class="muted"></span></p>
  </div>
  <div class="actions" role="toolbar" aria-label="Proposal">
    <button type="button" id="undo" disabled>Undo</button>
    <button type="button" id="reset" disabled>Reset</button>
    <button type="button" id="compare" aria-pressed="false">Compare</button>
    <button type="button" id="accept" class="primary" disabled>Accept</button>
    <button type="button" id="scheme" aria-label="Switch light or dark">Dark</button>
  </div>
</header>
<p id="message" role="status" aria-live="polite"></p>
<main class="layout">
  <nav class="panel" aria-labelledby="blocks-title">
    <h2 id="blocks-title">Blocks</h2>
    <ul id="blocks" class="list"></ul>
    <h2 id="recipes-title">Recipe gallery</h2>
    <ul id="recipes" class="list" aria-labelledby="recipes-title"></ul>
  </nav>
  <section class="panel preview" aria-labelledby="preview-title">
    <div class="row">
      <h2 id="preview-title">Preview</h2>
      <div class="actions" role="toolbar" aria-label="Playback">
        <button type="button" id="replay">Replay</button>
        <button type="button" id="pause" aria-pressed="false">Pause</button>
        <button type="button" id="stress">Rapid toggle</button>
      </div>
    </div>
    <p class="small"><label for="preview-mode">Preview as</label>
      <select id="preview-mode">
        <option value="">the spec's policy</option>
        <option value="full">full</option>
        <option value="reduced">reduced</option>
        <option value="none">none</option>
        <option value="os-reduce">OS reduced motion</option>
      </select>
      <span class="muted">Preview only; it never changes the diff. Your own OS reduced-motion setting still wins, as it does for readers.</span></p>
    <div id="frames" class="frames">
      <figure id="original-figure" hidden>
        <figcaption>Original</figcaption>
        <iframe id="original" title="Original page"></iframe>
      </figure>
      <figure>
        <figcaption id="proposed-caption">Proposed</figcaption>
        <iframe id="proposed" title="Proposed page"></iframe>
      </figure>
    </div>
  </section>
  <aside class="panel" aria-labelledby="inspector-title">
    <h2 id="inspector-title">Inspector</h2>
    <div id="inspector"><p class="muted">Select a block.</p></div>
    <h2>Theme motion tokens</h2>
    <form id="tokens" class="tokens">
      <label for="duration">motion-duration <output id="duration-out" for="duration"></output></label>
      <input type="range" id="duration" name="motion-duration">
      <label for="easing">motion-easing</label>
      <select id="easing" name="motion-easing"></select>
      <label for="policy">motion-policy</label>
      <select id="policy" name="motion-policy"></select>
    </form>
    <h2>Audit</h2>
    <ul id="findings" class="findings"></ul>
    <h2>Diff to accept</h2>
    <pre id="diff" class="code" tabindex="0" aria-label="Unified diff"></pre>
  </aside>
</main>
</body>
</html>
`;

export const STUDIO_CSS = `:root{color-scheme:light;--bg:#f7f7f5;--panel:#fff;--text:#1b1b1f;--muted:#5d5d66;--border:#d9d9de;--accent:#3157d5;--accent-text:#fff;--add:#e6f4ea;--del:#fdecea;--bar:#3157d5}
:root[data-theme="dark"]{color-scheme:dark;--bg:#111214;--panel:#1b1c20;--text:#ececf0;--muted:#a3a3ad;--border:#33343a;--accent:#8aa4ff;--accent-text:#0b0b10;--add:#183a24;--del:#43201d;--bar:#8aa4ff}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;--bg:#111214;--panel:#1b1c20;--text:#ececf0;--muted:#a3a3ad;--border:#33343a;--accent:#8aa4ff;--accent-text:#0b0b10;--add:#183a24;--del:#43201d;--bar:#8aa4ff}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
h1{font-size:1.15rem;margin:0}h2{font-size:.95rem;margin:1rem 0 .5rem}
p{margin:.25rem 0}.muted{color:var(--muted)}.small{font-size:.85rem}
.bar{display:flex;flex-wrap:wrap;gap:.75rem;justify-content:space-between;align-items:center;padding:.75rem 1rem;border-bottom:1px solid var(--border);background:var(--panel)}
.actions{display:flex;flex-wrap:wrap;gap:.4rem}
button,select,input{font:inherit;color:inherit}
button{border:1px solid var(--border);background:var(--panel);border-radius:6px;padding:.35rem .7rem;cursor:pointer}
button[aria-pressed="true"],button.primary{background:var(--accent);color:var(--accent-text);border-color:var(--accent)}
button:disabled{opacity:.5;cursor:not-allowed}
:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
#message{margin:0;padding:.4rem 1rem;min-height:1.9rem}
#message[data-kind="error"]{color:#c62828}:root[data-theme="dark"] #message[data-kind="error"]{color:#ff8a80}
.layout{display:grid;grid-template-columns:minmax(200px,1fr) minmax(0,2.4fr) minmax(260px,1.3fr);gap:1rem;padding:0 1rem 1rem}
.panel{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:.75rem;min-width:0}
.list{list-style:none;margin:0;padding:0;display:grid;gap:.25rem}
.list button{width:100%;text-align:left;display:flex;justify-content:space-between;gap:.5rem}
.list button[aria-current="true"]{border-color:var(--accent);box-shadow:inset 3px 0 0 var(--accent)}
.list .tag{color:var(--muted);font-size:.8rem;white-space:nowrap}
.row{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:.5rem}
.frames{display:grid;gap:.75rem}.frames.split{grid-template-columns:1fr 1fr}
figure{margin:0;min-width:0}figcaption{font-size:.85rem;color:var(--muted);margin-bottom:.25rem}
iframe{width:100%;height:68vh;border:1px solid var(--border);border-radius:6px;background:#fff}
.tokens{display:grid;gap:.35rem}.tokens input[type=range]{width:100%}
dl{display:grid;grid-template-columns:auto 1fr;gap:.2rem .6rem;margin:.5rem 0}dt{color:var(--muted)}dd{margin:0}
.lanes{display:grid;gap:.35rem;margin:.5rem 0}
.lane{display:grid;grid-template-columns:4.5rem 1fr;align-items:center;gap:.5rem;font-size:.85rem}
.track{background:var(--bg);border:1px solid var(--border);border-radius:4px;height:1.4rem;position:relative}
.fill{position:absolute;inset:0 auto 0 0;background:var(--bar);border-radius:3px;min-width:2px}
.fill-label{position:absolute;left:.3rem;top:50%;transform:translateY(-50%);background:var(--panel);color:var(--text);border-radius:3px;padding:0 .3rem;font-size:.8rem;white-space:nowrap}
#inspector label{display:block;margin:.5rem 0 .25rem}
#inspector select{width:100%}
.code{background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:.5rem;overflow:auto;max-height:16rem;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre}
.code .add{background:var(--add);display:block}.code .del{background:var(--del);display:block}
.findings{margin:0;padding-left:1.1rem;font-size:.88rem}.findings code{font-size:.8rem}
@media (max-width:1100px){.layout{grid-template-columns:minmax(0,1fr) minmax(0,1.6fr)}.layout aside{grid-column:1 / -1}}
@media (pointer:coarse),(max-width:720px){button,select,input[type="range"]{min-height:44px}}
@media (max-width:720px){.layout{grid-template-columns:minmax(0,1fr)}.frames.split{grid-template-columns:1fr}iframe{height:55vh}}
`;

export const STUDIO_JS = `(function () {
'use strict';
var base = location.pathname.replace(/[^/]*$/, '');
var session = base.split('/')[2] || '';
var $ = function (id) { return document.getElementById(id); };
var catalog = null;
var original = null;
var current = null;
var proposal = {};
var history = [];
var selected = null;
var paused = false;
var pending = 0;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function say(text, kind) { $('message').textContent = text; $('message').setAttribute('data-kind', kind || 'info'); }
function el(tag, attrs, children) {
  var node = document.createElement(tag);
  Object.keys(attrs || {}).forEach(function (key) {
    if (key === 'text') node.textContent = attrs[key];
    else node.setAttribute(key, attrs[key]);
  });
  (children || []).forEach(function (child) { if (child) node.appendChild(child); });
  return node;
}
function post(path, body) {
  return fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ak-studio': session },
    body: JSON.stringify(body)
  }).then(function (response) {
    return response.json().then(function (data) { return { status: response.status, data: data }; });
  });
}

function isEmpty(value) {
  return Object.keys(value.blocks || {}).length === 0 && Object.keys(value.tokens || {}).length === 0;
}

/** Drop edits that match the source, so Reset and Undo land on an empty diff. */
function tidy(next) {
  var out = {};
  Object.keys(next.blocks || {}).forEach(function (id) {
    var block = original.state.blocks.filter(function (b) { return b.id === id; })[0];
    if (!block || block.motion !== next.blocks[id]) { out.blocks = out.blocks || {}; out.blocks[id] = next.blocks[id]; }
  });
  Object.keys(next.tokens || {}).forEach(function (token) {
    if (original.state.tokens[token] !== next.tokens[token]) { out.tokens = out.tokens || {}; out.tokens[token] = next.tokens[token]; }
  });
  return out;
}

function propose(next, record) {
  next = tidy(next);
  if (JSON.stringify(next) === JSON.stringify(proposal)) return Promise.resolve();
  if (record !== false) history.push(proposal);
  proposal = next;
  return refresh();
}

function refresh() {
  var ticket = ++pending;
  // Accept stays off until the diff on screen is the proposal it would write.
  $('accept').disabled = true;
  return post('api/state', { proposal: proposal, preview: $('preview-mode').value }).then(function (reply) {
    if (ticket !== pending) return;
    if (reply.status !== 200) { say(reply.data.error || 'The studio could not apply that.', 'error'); return; }
    current = reply.data;
    render();
  }, function () {
    if (ticket === pending) say('The studio is not reachable. Is ak-render motion studio still running?', 'error');
  });
}

function render() {
  var state = current.state;
  $('file').textContent = state.source.path;
  $('hash').textContent = 'sha256 ' + state.source.hash.slice(0, 12);
  $('undo').disabled = history.length === 0;
  $('reset').disabled = isEmpty(proposal);
  $('accept').disabled = !state.ok || state.diff === '';
  if (!state.ok) say(state.error.message + (state.error.path ? ' (' + state.error.path + ')' : ''), 'error');
  else if (state.diff === '') say('No changes. Pick a block, change its recipe or a token, then Accept.');
  else say('Previewing the proposal. Accept writes it to ' + state.source.path + '.');
  renderBlocks(state);
  renderTokens(state);
  renderInspector();
  renderFindings(state);
  renderDiff(state.diff);
  if (current.preview) load($('proposed'), current.preview);
  if ($('compare').getAttribute('aria-pressed') === 'true' && current.original) load($('original'), current.original);
}

function load(frame, url) {
  paused = false;
  $('pause').setAttribute('aria-pressed', 'false');
  $('pause').textContent = 'Pause';
  if (frame.getAttribute('src') === url) frame.contentWindow.location.reload();
  else frame.setAttribute('src', url);
}

function listKeys(list) {
  list.addEventListener('keydown', function (event) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    var buttons = Array.prototype.slice.call(list.querySelectorAll('button'));
    var index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    var next = buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length];
    next.focus();
  });
}

function renderBlocks(state) {
  var list = $('blocks');
  var focused = document.activeElement && document.activeElement.getAttribute('data-id');
  list.textContent = '';
  state.blocks.forEach(function (block) {
    var button = el('button', {
      type: 'button',
      'data-id': block.id,
      'aria-current': String(block.id === selected)
    }, [
      el('span', { text: block.id }),
      el('span', { class: 'tag', text: block.type + (block.motion ? ' · ' + block.motion : '') })
    ]);
    button.addEventListener('click', function () { selected = block.id; render(); });
    list.appendChild(el('li', {}, [button]));
  });
  if (focused) { var again = list.querySelector('[data-id="' + focused + '"]'); if (again) again.focus(); }
}

function renderRecipes() {
  var list = $('recipes');
  catalog.recipes.forEach(function (recipe) {
    var button = el('button', { type: 'button', 'data-recipe': recipe.id, title: recipe.purpose }, [
      el('span', { text: recipe.id }),
      el('span', { class: 'tag', text: recipe.triggers.join(', ') })
    ]);
    button.addEventListener('click', function () {
      $('proposed-caption').textContent = 'Recipe example: ' + recipe.id + ' (' + recipe.purpose + ')';
      load($('proposed'), base + 'gallery/' + recipe.id);
      say('Showing the compiled example for ' + recipe.id + '. Select a block to return to your page.');
    });
    list.appendChild(el('li', {}, [button]));
  });
}

function renderTokens(state) {
  var limits = catalog.durationLimits;
  var duration = $('duration');
  duration.min = limits.min; duration.max = limits.max; duration.step = limits.step;
  // The token may be authored in seconds or above the slider's range.
  var match = /^(d+(?:.d+)?)(ms|s)$/.exec(state.tokens['motion-duration'] || '');
  var ms = match ? Math.round(Number(match[1]) * (match[2] === 's' ? 1000 : 1)) : NaN;
  if (document.activeElement !== duration) {
    if (!isNaN(ms)) duration.value = String(Math.min(ms, limits.max));
    $('duration-out').textContent = isNaN(ms) ? duration.value + 'ms' : ms + 'ms' + (ms > limits.max ? ' (above the slider)' : '');
  }
  fill($('easing'), catalog.easings, state.tokens['motion-easing']);
  fill($('policy'), catalog.policies, state.tokens['motion-policy']);
}

function fill(select, values, value) {
  if (select.options.length === 0) values.forEach(function (v) { select.appendChild(el('option', { value: v, text: v })); });
  if (value) select.value = value;
}

function renderInspector() {
  var box = $('inspector');
  // The select is rebuilt on every render; keep keyboard focus on it.
  var refocus = document.activeElement !== null && document.activeElement.id === 'recipe';
  box.textContent = '';
  if (!selected || !current.inspections[selected]) { box.appendChild(el('p', { class: 'muted', text: 'Select a block.' })); return; }
  $('proposed-caption').textContent = 'Proposed';
  var info = current.inspections[selected];
  var block = info.block;
  var select = el('select', { id: 'recipe', 'aria-label': 'Motion recipe for ' + block.id });
  select.appendChild(el('option', { value: '', text: 'none (block default)' }));
  block.compatible.forEach(function (id) { select.appendChild(el('option', { value: id, text: id })); });
  select.value = block.motion || '';
  select.addEventListener('change', function () {
    var next = clone(proposal);
    next.blocks = next.blocks || {};
    next.blocks[block.id] = select.value === '' ? null : select.value;
    propose(next);
  });
  box.appendChild(el('p', {}, [el('strong', { text: block.id }), el('span', { class: 'muted', text: ' ' + block.type + ' at ' + block.path })]));
  box.appendChild(el('label', { for: 'recipe', text: 'Recipe' }));
  box.appendChild(select);
  if (refocus) select.focus();
  if (block.compatible.length === 0) box.appendChild(el('p', { class: 'muted small', text: 'No recipe targets this block type.' }));
  if (!info.recipe) return;
  var recipe = info.recipe;
  var timing = info.timing;
  var lanes = el('div', { class: 'lanes', role: 'list', 'aria-label': 'Phase timeline' });
  var widest = Math.max(timing.baseMs * 2.5, 1);
  recipe.phases.forEach(function (phase) {
    var width = Math.min(100, (timing.durationMs / widest) * 100);
    var bar = el('div', { class: 'fill' });
    bar.style.width = width + '%';
    lanes.appendChild(el('div', { class: 'lane', role: 'listitem' }, [
      el('span', { text: phase }),
      el('div', { class: 'track' }, [bar, el('span', { class: 'fill-label', text: timing.durationMs + 'ms · ' + timing.easing })])
    ]));
  });
  box.appendChild(lanes);
  var dl = el('dl');
  [
    ['Purpose', recipe.purpose],
    ['Triggers', recipe.triggers.join(', ')],
    ['Duration', recipe.duration + ' = ' + timing.durationMs + 'ms (motion-duration ' + timing.baseMs + 'ms)'],
    ['Easing', recipe.easing + (recipe.easing === 'standard' ? ' (theme: ' + timing.easing + ')' : '')],
    ['Properties', recipe.properties.join(', ')],
    ['Runtime', recipe.runtime],
    ['Plays in', recipe.states.join(', ') + ' · ' + recipe.role],
    ['Fallback', recipe.reduced]
  ].forEach(function (pair) { dl.appendChild(el('dt', { text: pair[0] })); dl.appendChild(el('dd', { text: pair[1] })); });
  box.appendChild(dl);
  box.appendChild(el('h3', { class: 'small', text: 'Emitted CSS' }));
  box.appendChild(el('pre', { class: 'code', id: 'css', tabindex: '0', text: info.css || '(none on this page)' }));
}

function renderFindings(state) {
  var list = $('findings');
  list.textContent = '';
  var findings = state.audit ? state.audit.findings : [];
  if (findings.length === 0) { list.appendChild(el('li', { text: state.ok ? 'No motion findings.' : 'The spec does not compile.' })); return; }
  findings.forEach(function (finding) {
    list.appendChild(el('li', {}, [
      el('code', { text: finding.severity + ' ' + finding.rule }),
      el('span', { text: ' ' + finding.message + '. ' + finding.fix })
    ]));
  });
}

function renderDiff(diff) {
  var pre = $('diff');
  pre.textContent = '';
  if (!diff) { pre.textContent = '(no changes)'; return; }
  diff.split('\\n').forEach(function (line) {
    var kind = line.charAt(0) === '+' && line.indexOf('+++') !== 0 ? 'add' : line.charAt(0) === '-' && line.indexOf('---') !== 0 ? 'del' : '';
    pre.appendChild(el('span', kind ? { class: kind, text: line } : { text: line + '\\n' }));
  });
}

function frameDoc() {
  try { return $('proposed').contentDocument; } catch (error) { return null; }
}

var timer = 0;
function tokenChanged(name, value) {
  var next = clone(proposal);
  next.tokens = next.tokens || {};
  next.tokens[name] = value;
  propose(next);
}

function start() {
  $('duration').addEventListener('input', function () {
    $('duration-out').textContent = $('duration').value + 'ms';
    clearTimeout(timer);
    timer = setTimeout(function () { tokenChanged('motion-duration', $('duration').value + 'ms'); }, 250);
  });
  $('easing').addEventListener('change', function () { tokenChanged('motion-easing', $('easing').value); });
  $('policy').addEventListener('change', function () { tokenChanged('motion-policy', $('policy').value); });
  $('preview-mode').addEventListener('change', function () { refresh(); });
  $('tokens').addEventListener('submit', function (event) { event.preventDefault(); });
  $('undo').addEventListener('click', function () {
    if (history.length === 0) return;
    proposal = history.pop();
    refresh();
  });
  $('reset').addEventListener('click', function () { if (!isEmpty(proposal)) { history.push(proposal); proposal = {}; refresh(); } });
  $('compare').addEventListener('click', function () {
    var on = $('compare').getAttribute('aria-pressed') !== 'true';
    $('compare').setAttribute('aria-pressed', String(on));
    $('original-figure').hidden = !on;
    $('frames').classList.toggle('split', on);
    if (on && current.original) load($('original'), current.original);
  });
  $('replay').addEventListener('click', function () {
    load($('proposed'), $('proposed').getAttribute('src'));
    if ($('compare').getAttribute('aria-pressed') === 'true') load($('original'), $('original').getAttribute('src'));
  });
  $('pause').addEventListener('click', function () {
    var doc = frameDoc();
    if (!doc || typeof doc.getAnimations !== 'function') return;
    paused = !paused;
    doc.getAnimations().forEach(function (animation) { if (paused) animation.pause(); else animation.play(); });
    $('pause').setAttribute('aria-pressed', String(paused));
    $('pause').textContent = paused ? 'Resume' : 'Pause';
  });
  $('stress').addEventListener('click', function () {
    var doc = frameDoc();
    if (!doc) return;
    var scope = selected ? doc.querySelector('[data-ak-id="' + selected + '"]') : doc.body;
    if (!scope) scope = doc.body;
    var targets = Array.prototype.slice.call(scope.querySelectorAll('[role="tab"], summary, [data-ak-on-click], input[type="radio"], input[type="checkbox"]'));
    for (var round = 0; round < 3; round += 1) targets.forEach(function (target) { target.click(); });
    say(targets.length ? 'Sent ' + targets.length * 3 + ' rapid clicks; the page should settle on its final state.' : 'Nothing to toggle in the selected block.');
  });
  $('accept').addEventListener('click', function () {
    var button = $('accept');
    button.disabled = true;
    say('Writing the proposal…');
    // Write the proposal whose diff is on screen, never a newer one in flight.
    post('api/accept', { proposal: current.state.proposal, hash: original.state.source.hash }).then(function (reply) {
      if (reply.status !== 200) {
        say(reply.data.error || 'Accept failed.', 'error');
        button.disabled = false;
        return;
      }
      say('Accepted. ' + original.state.source.path + ' now carries the change.');
      return post('api/state', { proposal: {}, preview: $('preview-mode').value }).then(function (fresh) {
        original = fresh.data; current = fresh.data; proposal = {}; history = [];
        render();
        say('Accepted. ' + original.state.source.path + ' now carries the change.');
      });
    }).catch(function () {
      say('Accept failed: the studio is not reachable. The file was not confirmed written; reload to check.', 'error');
      button.disabled = false;
    });
  });
  $('scheme').addEventListener('click', function () {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark' ||
      (!document.documentElement.hasAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'light' : 'dark');
    $('scheme').textContent = dark ? 'Dark' : 'Light';
  });
  if (matchMedia('(prefers-color-scheme: dark)').matches) $('scheme').textContent = 'Light';
  listKeys($('blocks'));
  listKeys($('recipes'));

  fetch(base + 'api/catalog').then(function (r) { return r.json(); }).then(function (data) {
    catalog = data;
    renderRecipes();
    return post('api/state', { proposal: {} });
  }).then(function (reply) {
    if (reply.status !== 200) { say(reply.data.error || 'The studio could not read the spec.', 'error'); return; }
    original = reply.data; current = reply.data;
    var first = original.state.blocks.filter(function (b) { return b.motion; })[0] || original.state.blocks[0];
    selected = first ? first.id : null;
    render();
  });
}
start();
})();
`;
