/**
 * The review runtime: comments on selected text and on top-level sections,
 * decision answers, and the copied feedback text. Comment text is only ever
 * written with `textContent`, never parsed as markup.
 *
 * Written in the runtime's ES5 style: no arrow functions, no template literals.
 */

export const REVIEW_RUNTIME = `
function wireReview() {
  var panel = q('[data-ak-feedback]');
  var main = q('.ak-main');
  if (!panel || !main) return;
  var storeKey = 'ak-render-review:' + panel.getAttribute('data-ak-review-key');
  var store = { comments: [], general: '', decisions: {} };
  try {
    var saved = JSON.parse(window.localStorage.getItem(storeKey) || 'null');
    if (saved && saved.comments && saved.decisions) store = saved;
  } catch (error) {}
  var save = function () {
    try { window.localStorage.setItem(storeKey, JSON.stringify(store)); } catch (error) {}
  };
  var clean = function (text) { return String(text || '').replace(/\\s+/g, ' ').trim(); };
  var make = function (tag, className, text) {
    var el = doc.createElement(tag);
    if (className) el.className = className;
    if (text) el.textContent = text;
    return el;
  };
  var button = function (className, text, variant) {
    var el = make('button', 'ak-btn ' + className, text);
    el.type = 'button';
    if (variant) el.setAttribute('data-variant', variant);
    return el;
  };
  var ranges = [];
  var paintHighlights = function () {
    if (!(window.CSS && CSS.highlights && typeof window.Highlight === 'function')) return;
    var live = ranges.filter(function (entry) {
      return store.comments.some(function (comment) { return comment.id === entry.id; });
    });
    var highlight = new window.Highlight();
    live.forEach(function (entry) { highlight.add(entry.range); });
    CSS.highlights.set('ak-review', highlight);
  };

  qa('[data-ak-decision] input, [data-ak-decision] textarea, [data-ak-feedback] textarea, [data-ak-feedback] button').forEach(function (el) {
    el.disabled = false;
  });
  root.setAttribute('data-ak-review-ready', '');

  var decisions = qa('[data-ak-decision]');
  var readDecision = function (fieldset) {
    var checked = q('input:checked', fieldset);
    return { choice: checked ? checked.value : '', note: q('[data-ak-decision-note]', fieldset).value };
  };
  decisions.forEach(function (fieldset) {
    var id = fieldset.getAttribute('data-ak-id');
    var answer = store.decisions[id];
    if (answer) {
      qa('input[type="radio"]', fieldset).forEach(function (radio) { radio.checked = radio.value === answer.choice; });
      q('[data-ak-decision-note]', fieldset).value = answer.note || '';
    }
    var remember = function () { store.decisions[id] = readDecision(fieldset); save(); };
    fieldset.addEventListener('change', remember, false);
    fieldset.addEventListener('input', remember, false);
  });

  var general = q('[data-ak-feedback-general]', panel);
  general.value = store.general || '';
  general.addEventListener('input', function () { store.general = general.value; save(); }, false);

  // Where a comment points: the top-level section, the block's own title, and code line numbers.
  var whereOf = function (range) {
    var start = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    var parts = [];
    var section = start.closest('.ak-main > .ak-section');
    var sectionTitle = section ? q('.ak-section-head h2', section) : null;
    if (sectionTitle) parts.push(clean(sectionTitle.textContent));
    var block = start.closest('.ak-block:not(.ak-section), .ak-code');
    var blockTitle = block ? q('.ak-section-head :is(h2,h3), .ak-code-head .ak-label', block) : null;
    if (blockTitle && clean(blockTitle.textContent) !== parts[0]) parts.push(clean(blockTitle.textContent));
    var lineOf = function (node) {
      var el = node.nodeType === 1 ? node : node.parentElement;
      var line = el ? el.closest('.ak-line') : null;
      return line ? qa('.ak-line', line.parentElement).indexOf(line) + 1 : 0;
    };
    var first = lineOf(range.startContainer);
    var last = lineOf(range.endContainer);
    if (first) parts.push(last > first ? 'lines ' + first + '-' + last : 'line ' + first);
    return parts.join(' › ') || doc.title;
  };

  var editor = make('div', 'ak-review-editor');
  editor.setAttribute('role', 'dialog');
  editor.setAttribute('aria-label', 'Comment');
  editor.hidden = true;
  var editorWhere = make('p', 'ak-review-where');
  var editorQuote = make('blockquote', 'ak-review-quote');
  var editorLabel = make('label', '', 'Comment');
  var editorText = make('textarea');
  editorText.id = 'ak-review-editor-text';
  editorText.rows = 4;
  editorLabel.htmlFor = editorText.id;
  var editorSave = button('ak-review-save', 'Save', 'primary');
  var editorCancel = button('ak-review-cancel', 'Cancel', 'ghost');
  var editorActions = make('div', 'ak-review-editor-actions');
  editorActions.appendChild(editorSave);
  editorActions.appendChild(editorCancel);
  [editorWhere, editorQuote, editorLabel, editorText, editorActions].forEach(function (el) { editor.appendChild(el); });
  doc.body.appendChild(editor);
  var editing = null;
  var returnFocus = null;

  var place = function (el, rect) {
    var width = Math.min(380, doc.documentElement.clientWidth - 16);
    var left = Math.max(8, Math.min(rect.left + window.scrollX, window.scrollX + doc.documentElement.clientWidth - width - 8));
    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(rect.bottom + window.scrollY + 8) + 'px';
  };
  var closeEditor = function () {
    editor.hidden = true;
    editing = null;
    if (returnFocus && returnFocus.focus) returnFocus.focus();
    returnFocus = null;
  };
  var openEditor = function (comment, rect, opener) {
    editing = comment;
    returnFocus = opener || null;
    editorWhere.textContent = comment.where;
    editorQuote.textContent = comment.quote;
    editorQuote.hidden = comment.quote === '';
    editorText.value = comment.text || '';
    editor.hidden = false;
    place(editor, rect);
    editorText.focus();
  };
  var saveEditor = function () {
    if (!editing) return;
    var text = editorText.value.trim();
    var existing = store.comments.filter(function (comment) { return comment.id === editing.id; })[0];
    if (text === '') {
      store.comments = store.comments.filter(function (comment) { return comment.id !== editing.id; });
    } else if (existing) {
      existing.text = text;
    } else {
      var range = editing.range;
      delete editing.range;
      editing.text = text;
      store.comments.push(editing);
      if (range) ranges.push({ id: editing.id, range: range });
    }
    var announced = text === '' ? 'Comment removed' : 'Comment saved';
    save();
    renderList();
    closeEditor();
    announce(announced);
  };
  editorSave.addEventListener('click', saveEditor, false);
  editorCancel.addEventListener('click', closeEditor, false);
  editor.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') { event.preventDefault(); closeEditor(); }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); saveEditor(); }
  }, false);
  var newComment = function (where, quote, range) {
    return { id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), where: where, quote: quote, text: '', range: range };
  };

  var floating = button('ak-review-float', 'Comment', 'primary');
  floating.hidden = true;
  doc.body.appendChild(floating);
  var pending = null;
  var readSelection = function () {
    var selection = window.getSelection ? window.getSelection() : null;
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    var range = selection.getRangeAt(0);
    var common = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    if (!common || !main.contains(common)) return null;
    if (common.closest('[data-ak-feedback], [data-ak-decision], input, textarea, select, button')) return null;
    var quote = clean(selection.toString());
    if (quote === '') return null;
    if (quote.length > 300) quote = quote.slice(0, 300) + '…';
    return { range: range.cloneRange(), quote: quote };
  };
  doc.addEventListener('selectionchange', function () {
    pending = readSelection();
    floating.hidden = pending === null;
    if (pending) place(floating, pending.range.getBoundingClientRect());
  }, false);
  // Keep the selection alive while the button is pressed.
  floating.addEventListener('mousedown', function (event) { event.preventDefault(); }, false);
  floating.addEventListener('click', function () {
    if (!pending) return;
    var rect = pending.range.getBoundingClientRect();
    var comment = newComment(whereOf(pending.range), pending.quote, pending.range);
    floating.hidden = true;
    openEditor(comment, rect, null);
  }, false);

  qa('.ak-main > .ak-section > .ak-section-head').forEach(function (head) {
    var title = q('h2', head);
    if (!title) return;
    var add = make('button', 'ak-review-add', 'Comment');
    add.type = 'button';
    add.setAttribute('aria-label', 'Comment on ' + clean(title.textContent));
    head.appendChild(add);
    add.addEventListener('click', function () {
      openEditor(newComment(clean(title.textContent), '', null), add.getBoundingClientRect(), add);
    }, false);
  });

  var list = q('[data-ak-feedback-list]', panel);
  var bar = make('div', 'ak-review-bar');
  var barButton = button('ak-review-bar-button', '', '');
  bar.appendChild(barButton);
  doc.body.appendChild(bar);
  if ('IntersectionObserver' in window) {
    new window.IntersectionObserver(function (entries) {
      bar.hidden = entries[0].isIntersecting;
    }).observe(panel);
  }
  barButton.addEventListener('click', function () {
    panel.scrollIntoView({ behavior: motionAllowed() ? 'smooth' : 'auto', block: 'start' });
    var copyButton = q('[data-ak-feedback-copy]', panel);
    if (copyButton) copyButton.focus({ preventScroll: true });
  }, false);

  var renderList = function () {
    list.textContent = '';
    store.comments.forEach(function (comment) {
      var item = make('li', 'ak-feedback-item');
      item.appendChild(make('p', 'ak-review-where', comment.where));
      if (comment.quote) item.appendChild(make('blockquote', 'ak-review-quote', comment.quote));
      item.appendChild(make('p', 'ak-feedback-text', comment.text));
      var actions = make('div', 'ak-feedback-item-actions');
      var edit = button('ak-feedback-edit', 'Edit', 'ghost');
      var remove = button('ak-feedback-remove', 'Remove', 'ghost');
      edit.addEventListener('click', function () { openEditor(comment, edit.getBoundingClientRect(), edit); }, false);
      remove.addEventListener('click', function () {
        store.comments = store.comments.filter(function (other) { return other.id !== comment.id; });
        save();
        renderList();
        announce('Comment removed');
      }, false);
      actions.appendChild(edit);
      actions.appendChild(remove);
      item.appendChild(actions);
      list.appendChild(item);
    });
    list.hidden = store.comments.length === 0;
    var count = store.comments.length;
    barButton.textContent = count === 0 ? 'Select text to comment' : count + (count === 1 ? ' comment' : ' comments') + ' · Review';
    paintHighlights();
  };

  var indent = function (text) { return String(text).replace(/\\n/g, '\\n   '); };
  var buildFeedback = function () {
    var lines = ['Feedback on "' + doc.title + '"', ''];
    if (decisions.length > 0) {
      lines.push('## Decisions');
      decisions.forEach(function (fieldset, index) {
        var checked = q('input:checked', fieldset);
        var answer = checked ? checked.value + (checked.hasAttribute('data-ak-recommended') ? ' (the recommended option)' : '') : 'no answer';
        lines.push((index + 1) + '. ' + clean(q('legend', fieldset).textContent));
        lines.push('   Answer: ' + answer);
        var note = q('[data-ak-decision-note]', fieldset).value.trim();
        if (note) lines.push('   Note: ' + indent(note));
      });
      lines.push('');
    }
    if (store.comments.length > 0) {
      lines.push('## Comments');
      store.comments.forEach(function (comment, index) {
        lines.push((index + 1) + '. On "' + comment.where + '"');
        if (comment.quote) lines.push('   > ' + comment.quote);
        lines.push('   ' + indent(comment.text));
      });
      lines.push('');
    }
    var notes = general.value.trim();
    if (notes) lines.push('## General notes', notes, '');
    if (decisions.length === 0 && store.comments.length === 0 && !notes) lines.push('No comments.');
    return lines.join('\\n').trim() + '\\n';
  };
  var copy = q('[data-ak-feedback-copy]', panel);
  copy.addEventListener('click', function () { copyText(buildFeedback(), copy); }, false);

  var clear = q('[data-ak-feedback-clear]', panel);
  var armed = 0;
  clear.addEventListener('click', function () {
    if (!armed) {
      clear.textContent = 'Click again to clear';
      armed = window.setTimeout(function () { armed = 0; clear.textContent = 'Clear'; }, 3000);
      return;
    }
    window.clearTimeout(armed);
    armed = 0;
    clear.textContent = 'Clear';
    store = { comments: [], general: '', decisions: {} };
    ranges = [];
    general.value = '';
    decisions.forEach(function (fieldset) {
      qa('input[type="radio"]', fieldset).forEach(function (radio) { radio.checked = radio.hasAttribute('data-ak-recommended'); });
      q('[data-ak-decision-note]', fieldset).value = '';
    });
    try { window.localStorage.removeItem(storeKey); } catch (error) {}
    renderList();
    announce('Feedback cleared');
  }, false);

  renderList();
}`;
