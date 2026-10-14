/**
 * The motion lifecycle runtime, emitted only when a page uses a recipe whose
 * `runtime` is `lifecycle` (`recipes.ts`).
 *
 * The runtime never animates anything itself. It marks a block with a
 * transient attribute (`data-ak-entering`, `data-ak-leaving`) that the
 * recipe's guarded CSS animates, and clears it when the animation ends. Every
 * settle carries a generation token, so a rapid second change supersedes the
 * first instead of racing it, and a timeout derived from the computed
 * animation time clears the attribute if `animationend` never arrives. Under
 * restrained or still motion the guard keeps the animation off, the computed
 * time is zero, and the change completes at once.
 */

/** Settle and cancel helpers, shared by every lifecycle recipe. */
export const MOTION_LIFECYCLE = `
var motionTokens = typeof WeakMap === 'function' ? new WeakMap() : null;
function motionMs(value) {
  var longest = 0;
  String(value || '').split(',').forEach(function (part) {
    var text = part.trim();
    var amount = parseFloat(text) || 0;
    var ms = /ms$/.test(text) ? amount : amount * 1000;
    if (ms > longest) longest = ms;
  });
  return longest;
}
function motionToken(el, attribute, token) {
  if (!motionTokens) return token;
  var held = motionTokens.get(el) || {};
  if (token !== undefined) { held[attribute] = token; motionTokens.set(el, held); }
  return held[attribute];
}
function motionSettle(el, attribute, done) {
  var token = {};
  motionToken(el, attribute, token);
  var finished = false;
  var timer = 0;
  var finish = function () {
    if (finished) return;
    finished = true;
    el.removeEventListener('animationend', onEnd, false);
    el.removeEventListener('animationcancel', onEnd, false);
    window.clearTimeout(timer);
    // A later settle or a cancel owns the attribute now.
    if (motionTokens && motionToken(el, attribute) !== token) return;
    el.removeAttribute(attribute);
    if (done) done();
  };
  var onEnd = function (event) { if (event.target === el && !event.pseudoElement) finish(); };
  // Re-adding the attribute restarts an animation that is still running.
  el.removeAttribute(attribute);
  void el.offsetWidth;
  el.setAttribute(attribute, '');
  var style = window.getComputedStyle(el);
  var ms = motionMs(style.animationDuration) + motionMs(style.animationDelay);
  if (!motionAllowed() || ms === 0 || doc.hidden) { finish(); return; }
  el.addEventListener('animationend', onEnd, false);
  el.addEventListener('animationcancel', onEnd, false);
  timer = window.setTimeout(finish, ms + 150);
}
function motionCancel(el, attribute) {
  motionToken(el, attribute, {});
  el.removeAttribute(attribute);
}`;

/** The sliding tab marker and the panel fade. */
export const MOTION_TABS = `
function placeTabMarker(list) {
  var tab = q('[role="tab"][aria-selected="true"]', list);
  if (!tab || tab.closest('[role="tablist"]') !== list) return;
  // The attribute positions the list first, so offsets resolve against it.
  list.setAttribute('data-ak-indicator', '');
  list.style.setProperty('--ak-tab-x', tab.offsetLeft + 'px');
  list.style.setProperty('--ak-tab-y', tab.offsetTop + 'px');
  list.style.setProperty('--ak-tab-w', tab.offsetWidth + 'px');
  list.style.setProperty('--ak-tab-h', tab.offsetHeight + 'px');
}
function wireTabMotion() {
  qa('[data-ak-motion="tabs-slide"]').forEach(function (container) {
    var list = q(':scope > [role="tablist"]', container);
    if (!list) return;
    placeTabMarker(list);
    // The first placement never slides; later ones do.
    window.requestAnimationFrame(function () { list.setAttribute('data-ak-indicator-live', ''); });
    if (typeof window.MutationObserver === 'function') {
      new window.MutationObserver(function (records) {
        records.forEach(function (record) {
          var el = record.target;
          if (record.attributeName === 'aria-selected' && el.parentElement === list) placeTabMarker(list);
          if (record.attributeName === 'hidden' && el.parentElement === container && el.getAttribute('role') === 'tabpanel' && !el.hidden) {
            motionSettle(el, 'data-ak-entering', null);
          }
        });
      }).observe(container, { subtree: true, attributes: true, attributeFilter: ['aria-selected', 'hidden'] });
    }
    var replace = function () { placeTabMarker(list); };
    if (typeof window.ResizeObserver === 'function') {
      var sizes = new window.ResizeObserver(replace);
      sizes.observe(list);
      qa(':scope > [role="tab"]', list).forEach(function (tab) { sizes.observe(tab); });
    } else {
      window.addEventListener('resize', replace, false);
    }
  });
}`;

/** The fade a block plays each time its visibleWhen shows it. */
export const MOTION_SWAP = `
function wireSwapMotion() {
  if (typeof window.MutationObserver !== 'function') return;
  qa('.ak-when').forEach(function (wrapper) {
    var block = wrapper.firstElementChild;
    if (!block || block.getAttribute('data-ak-motion') !== 'fade-swap') return;
    new window.MutationObserver(function () {
      if (!wrapper.hidden) motionSettle(block, 'data-ak-entering', null);
    }).observe(wrapper, { attributes: true, attributeFilter: ['hidden'] });
  });
}`;

/**
 * The dialog runtime with an exit phase. It replaces the plain dialog runtime
 * on pages that use `dialog-pop`: the close button, Escape and an action all
 * share one exit, focus returns to the opener once the exit ends, and a reopen
 * during the exit cancels it. A dialog without the recipe closes at once.
 */
export const MOTION_DIALOG = `
var lastFocus = null;
function openDialog(dialog) {
  if (dialog.hasAttribute('data-ak-leaving')) {
    motionCancel(dialog, 'data-ak-leaving');
    return;
  }
  if (dialog.open) return;
  lastFocus = doc.activeElement;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  var focusable = q('button, [href], input', dialog);
  if (focusable) focusable.focus();
  fire(dialog, 'open');
}
function closeDialog(dialog) {
  if (dialog.hasAttribute('data-ak-leaving')) return;
  var finish = function () {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
    fire(dialog, 'close');
  };
  if (dialog.getAttribute('data-ak-motion') !== 'dialog-pop') { finish(); return; }
  motionSettle(dialog, 'data-ak-leaving', finish);
}
// The browser closes a modal on Escape by itself; route it through the exit.
doc.addEventListener('cancel', function (event) {
  var dialog = event.target;
  if (!dialog || dialog.tagName !== 'DIALOG' || dialog.getAttribute('data-ak-motion') !== 'dialog-pop') return;
  event.preventDefault();
  closeDialog(dialog);
}, true);`;

/** The lifecycle parts a page needs for the recipes it uses, and their boot calls. */
export function motionRuntime(used: ReadonlySet<string>): { code: string[]; boot: string[] } {
  const code: string[] = [];
  const boot: string[] = [];
  const lifecycle = used.has('tabs-slide') || used.has('fade-swap') || used.has('dialog-pop');
  if (!lifecycle) return { code, boot };
  code.push(MOTION_LIFECYCLE);
  if (used.has('tabs-slide')) {
    code.push(MOTION_TABS);
    boot.push('wireTabMotion();');
  }
  if (used.has('fade-swap')) {
    code.push(MOTION_SWAP);
    boot.push('wireSwapMotion();');
  }
  return { code, boot };
}
