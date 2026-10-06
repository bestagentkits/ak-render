/**
 * Runtime parts for the input controls and the filter bar. ES5-style, like
 * `runtime.ts`, and appended in registry order: `controls` before
 * `filter-bar`, which reuses its readers.
 *
 * Nothing here reads a selector, handler or expression from the spec. A
 * control writes its coerced value through `setPath` (one path for every state
 * write) and fires `change` with `{ value }`. A bound control follows state
 * written elsewhere through the core `data-ak-bind-target="state"` binding,
 * observed as an attribute change. A filter bar resolves its target by the
 * compiled node id and parses each row's `data-ak-row` once. Print shows
 * every row: the bar is hidden there, so a filtered printout would be
 * silently partial.
 */

export const CONTROLS_RUNTIME = `
var controlSyncHooks = [];
function controlInputs(control) {
  return qa('input, select', control).filter(function (el) { return el.closest('[data-ak-control]') === control; });
}
function readControl(control) {
  var kind = control.getAttribute('data-ak-control');
  var inputs = controlInputs(control);
  if (!inputs.length) return null;
  if (kind === 'checkbox' || kind === 'switch') return inputs[0].checked;
  if (kind === 'radio-group') {
    for (var i = 0; i < inputs.length; i += 1) if (inputs[i].checked) return inputs[i].value;
    return '';
  }
  var raw = inputs[0].value;
  if (kind === 'number-input') {
    if (raw === '') return null;
    var number = Number(raw);
    return isFinite(number) ? number : null;
  }
  return raw;
}
function writeControl(control, value) {
  var kind = control.getAttribute('data-ak-control');
  controlInputs(control).forEach(function (input) {
    if (kind === 'checkbox' || kind === 'switch') { input.checked = value === true; return; }
    if (kind === 'radio-group') { input.checked = input.value === String(value); return; }
    // Never rewrite the field being typed in: it would move the caret.
    if (input === doc.activeElement) return;
    var text = value === null || value === undefined ? '' : String(value);
    if (input.value !== text) input.value = text;
  });
}
function resetControl(control) {
  controlInputs(control).forEach(function (input) {
    if (input.tagName === 'SELECT') {
      for (var i = 0; i < input.options.length; i += 1) input.options[i].selected = input.options[i].defaultSelected;
    } else if (input.type === 'checkbox' || input.type === 'radio') {
      input.checked = input.defaultChecked;
    } else {
      input.value = input.defaultValue;
    }
  });
}
function commitControl(control) {
  var value = readControl(control);
  var path = control.getAttribute('data-ak-bind');
  if (path) setPath(path, value);
  fire(control, 'change', { value: value });
}
function wireControls() {
  qa('[data-ak-control]').forEach(function (control) {
    controlInputs(control).forEach(function (input) {
      input.disabled = false;
      var live = input.type === 'text' || input.type === 'number';
      input.addEventListener(live ? 'input' : 'change', function () { commitControl(control); }, false);
    });
    control.setAttribute('data-ak-ready', '');
  });
  if (typeof window.MutationObserver !== 'function') return;
  new window.MutationObserver(function (records) {
    records.forEach(function (record) {
      var control = record.target;
      if (!control.hasAttribute('data-ak-control')) return;
      var value = readPath(control.getAttribute('data-ak-bind'));
      if (value === undefined || value === null) return;
      writeControl(control, value);
      controlSyncHooks.forEach(function (hook) { hook(control); });
    });
  }).observe(doc.body, { attributes: true, attributeFilter: ['data-ak-state'], subtree: true });
}`;

export const FILTER_BAR_RUNTIME = `
function foldAscii(text) {
  return String(text).replace(/[A-Z]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) + 32); });
}
function filterCriteria(bar) {
  var criteria = [];
  qa('[data-ak-control][data-ak-field]', bar).forEach(function (control) {
    var value = readControl(control);
    if (value === null || value === '' || value === false) return;
    criteria.push({
      kind: control.getAttribute('data-ak-control'),
      field: control.getAttribute('data-ak-field'),
      match: control.getAttribute('data-ak-match'),
      value: value
    });
  });
  qa('input[data-ak-search]', bar).forEach(function (input) {
    var text = String(input.value || '').trim().toLowerCase();
    if (text !== '') criteria.push({ match: 'text', value: text });
  });
  return criteria;
}
function criterionHolds(criterion, entry) {
  var match = criterion.match;
  if (match === 'text') return (entry.item.textContent || '').toLowerCase().indexOf(criterion.value) !== -1;
  var raw = Object.prototype.hasOwnProperty.call(entry.row, criterion.field) ? entry.row[criterion.field] : null;
  if (match === 'truthy') return Boolean(raw);
  if (raw === null || raw === undefined) return false;
  if (match === 'contains') return foldAscii(raw).indexOf(foldAscii(criterion.value)) !== -1;
  if (criterion.kind === 'number-input') {
    var number = typeof raw === 'number' ? raw : parseFloat(raw);
    if (!isFinite(number)) return false;
    if (match === 'min') return number >= criterion.value;
    if (match === 'max') return number <= criterion.value;
    return number === criterion.value;
  }
  var text = String(raw);
  // A date filter compares the calendar day of an ISO date or timestamp.
  if (criterion.kind === 'date-input') text = text.slice(0, 10);
  if (match === 'min') return text >= criterion.value;
  if (match === 'max') return text <= criterion.value;
  return text === String(criterion.value);
}
function wireFilterBars() {
  qa('[data-ak-filter-bar]').forEach(function (bar) {
    var target = byId(bar.getAttribute('data-ak-filter-target'))[0];
    var count = q('[data-ak-filter-count]', bar);
    var reset = q('[data-ak-filter-reset]', bar);
    var noun = bar.getAttribute('data-ak-filter-noun') || 'items';
    var entries = (target ? qa('[data-ak-filter-item]', target) : []).map(function (item) {
      var row = null;
      try { row = JSON.parse(item.getAttribute('data-ak-row') || '{}'); } catch (error) { row = null; }
      return { item: item, row: row && typeof row === 'object' ? row : {} };
    });
    var last = '';
    var apply = function (speak) {
      var criteria = filterCriteria(bar);
      var shown = 0;
      entries.forEach(function (entry) {
        var keep = criteria.every(function (criterion) { return criterionHolds(criterion, entry); });
        entry.item.hidden = !keep;
        if (keep) shown += 1;
      });
      var text = shown + ' of ' + entries.length + ' ' + noun;
      if (count) count.textContent = text;
      if (speak || text !== last) { if (last !== '') announce(text); }
      last = text;
    };
    var onEdit = function (event) {
      // The core search announces its own count first; the bar's count replaces it.
      apply(Boolean(event.target && event.target.hasAttribute && event.target.hasAttribute('data-ak-search')));
    };
    bar.addEventListener('input', onEdit, false);
    bar.addEventListener('change', onEdit, false);
    if (reset) {
      reset.addEventListener('click', function () {
        qa('[data-ak-control]', bar).forEach(function (control) {
          resetControl(control);
          commitControl(control);
        });
        qa('input[data-ak-search]', bar).forEach(function (input) { input.value = ''; });
        apply(true);
      }, false);
    }
    controlSyncHooks.push(function (control) { if (bar.contains(control)) apply(false); });
    // Print hides the bar, so the printout carries every row, as without script.
    window.addEventListener('beforeprint', function () {
      entries.forEach(function (entry) { entry.item.hidden = false; });
    });
    window.addEventListener('afterprint', function () { apply(false); });
    apply(false);
    bar.setAttribute('data-ak-ready', '');
  });
}`;
