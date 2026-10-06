/**
 * Runtime for the data table: column sorting, row search and the sticky
 * header's fit check. ES5-style, like `runtime.ts`, and emitted only on pages
 * that use the feature.
 *
 * The markup reads completely without it: rows keep their authored order and
 * the search bar stays hidden until `data-ak-table-ready` is set. Sort buttons
 * are created here, inside each `<th>`, so a page without scripts never shows a
 * control that does nothing.
 *
 * Search hides a row with `data-ak-dt-miss`, not `hidden`, so a filter that
 * toggles `hidden` on the same rows composes with it instead of fighting it.
 */

export const DATA_TABLE_RUNTIME = `
var DT_NUMBER = /^-?\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?$/i;
function dtRows(table) { return table.tBodies.length ? Array.prototype.slice.call(table.tBodies[0].rows) : []; }
function dtHeads(table) { return table.tHead && table.tHead.rows.length ? Array.prototype.slice.call(table.tHead.rows[0].cells) : []; }
function sortDataTable(table, index) {
  var heads = dtHeads(table);
  var head = heads[index];
  if (!head) return;
  var direction = head.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending';
  var rows = dtRows(table);
  var values = rows.map(function (row) {
    var cell = row.cells[index];
    return cell && cell.hasAttribute('data-sort') ? cell.getAttribute('data-sort') : null;
  });
  var numeric = values.every(function (value) { return value === null || DT_NUMBER.test(value); });
  var order = rows.map(function (row, position) { return position; });
  order.sort(function (a, b) {
    var x = values[a];
    var y = values[b];
    // Empty cells sort last in both directions; ties keep their current order.
    if (x === null || y === null) return x === y ? a - b : (x === null ? 1 : -1);
    var result = numeric ? Number(x) - Number(y) : (x < y ? -1 : (x > y ? 1 : 0));
    if (direction === 'descending') result = -result;
    return result || a - b;
  });
  var body = table.tBodies[0];
  order.forEach(function (position) { body.appendChild(rows[position]); });
  heads.forEach(function (cell) { cell.removeAttribute('aria-sort'); });
  head.setAttribute('aria-sort', direction);
  announce('Sorted by ' + (head.textContent || '').trim() + ', ' + direction);
}
function searchDataTable(block, table, query, speak) {
  var needle = String(query || '').trim().toLowerCase();
  var rows = dtRows(table);
  var shown = 0;
  rows.forEach(function (row) {
    var hit = needle === '' || (row.textContent || '').toLowerCase().indexOf(needle) !== -1;
    if (hit) row.removeAttribute('data-ak-dt-miss');
    else row.setAttribute('data-ak-dt-miss', '');
    if (hit && !row.hidden) shown += 1;
  });
  var total = rows.length;
  var noun = total === 1 ? ' row' : ' rows';
  var count = q('[data-ak-dt-count]', block);
  if (count) count.textContent = shown === total ? total + noun : shown + ' of ' + total + noun;
  var empty = q('[data-ak-dt-empty]', block);
  if (empty) empty.hidden = shown !== 0;
  if (speak) announce(shown + ' of ' + total + noun + ' shown');
}
function fitDataTables() {
  qa('[data-ak-data-table][data-ak-sticky]').forEach(function (block) {
    var wrap = q('.ak-table-wrap', block);
    if (!wrap) return;
    // Measure as a scroller; a table that fits needs no sideways scroll, so its
    // frame stops being a scroll container and the header can stick to the page.
    block.removeAttribute('data-ak-dt-fits');
    if (wrap.scrollWidth <= wrap.clientWidth + 1) block.setAttribute('data-ak-dt-fits', '');
  });
}
function wireDataTables() {
  var blocks = qa('[data-ak-data-table]');
  blocks.forEach(function (block) {
    var table = q('table', block);
    if (!table) return;
    dtHeads(table).forEach(function (head, index) {
      var button = doc.createElement('button');
      button.type = 'button';
      button.className = 'ak-dt-sort';
      while (head.firstChild) button.appendChild(head.firstChild);
      var icon = doc.createElement('span');
      icon.className = 'ak-dt-sort-icon';
      icon.setAttribute('aria-hidden', 'true');
      button.appendChild(icon);
      head.appendChild(button);
      button.addEventListener('click', function () { sortDataTable(table, index); }, false);
    });
    var input = q('[data-ak-dt-search]', block);
    if (input) {
      input.addEventListener('input', function () { searchDataTable(block, table, input.value, true); }, false);
      if (input.value) searchDataTable(block, table, input.value, false);
    }
    block.setAttribute('data-ak-table-ready', '');
  });
  if (!blocks.length) return;
  fitDataTables();
  var pending = false;
  window.addEventListener('resize', function () {
    if (pending) return;
    pending = true;
    window.requestAnimationFrame(function () { pending = false; fitDataTables(); });
  }, false);
}`;
