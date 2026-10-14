/**
 * Runtime parts for motion recipes. `runtime.ts` includes a part only when a
 * page uses a recipe that needs it, in the style of the other parts: ES5,
 * no globals, and every path ends in the settled state even when an event
 * never fires.
 */

import { ENTER_RECIPES } from './motion-recipes.js';

/**
 * On-enter recipes play as a block arrives. Until then the block shows its
 * final state, so a capture, a print or a disabled script never sees it blank
 * (ADR 0002); the animation's backwards fill supplies the first frame. Blocks
 * already on screen are marked while the page boots, before its first paint,
 * and the rest a little before they scroll in, so a reader never sees a block
 * shown, blanked, then faded in. The attribute is the recipe's own, so the
 * built-in entrance observer cannot start a recipe early.
 */
const ENTER = `
function wireMotionEnter() {
  if (!motionAllowed() || typeof window.IntersectionObserver !== 'function') return;
  var ids = ${JSON.stringify([...ENTER_RECIPES])};
  var enter = function (el) { el.setAttribute('data-ak-entered', ''); };
  var observer = new window.IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      observer.unobserve(entry.target);
      enter(entry.target);
    });
  }, { rootMargin: '0px 0px 12% 0px' });
  qa('[data-ak-motion]').forEach(function (el) {
    if (ids.indexOf(el.getAttribute('data-ak-motion')) === -1) return;
    var box = el.getBoundingClientRect();
    if (box.height > 0 && box.top < window.innerHeight && box.bottom > 0) enter(el);
    else observer.observe(el);
  });
}`;

/**
 * Crossfade marks what a change reveals: a tab panel or slide of a crossfade
 * container, or a crossfade block whose visibleWhen wrapper shows. Wired
 * after every other part, so the authored first view is never marked. A
 * repeated change restarts the fade on the same element; there is no timer or
 * end event to wait for, so rapid changes leave nothing stale.
 */
const CROSSFADE = `
function wireCrossfade() {
  if (typeof window.MutationObserver !== 'function') return;
  var enter = function (el) {
    el.removeAttribute('data-ak-entering');
    void el.offsetWidth;
    el.setAttribute('data-ak-entering', '');
  };
  new window.MutationObserver(function (records) {
    records.forEach(function (record) {
      var el = record.target;
      if (el.hasAttribute('hidden')) return;
      if (el.classList.contains('ak-when')) {
        for (var i = 0; i < el.children.length; i += 1) {
          if (el.children[i].getAttribute('data-ak-motion') === 'crossfade') enter(el.children[i]);
        }
        return;
      }
      if (el.getAttribute('role') !== 'tabpanel' && !el.hasAttribute('data-ak-slide')) return;
      var owner = el.parentElement && el.parentElement.closest('[data-ak-tabs], [data-ak-carousel-root]');
      if (owner && owner.getAttribute('data-ak-motion') === 'crossfade') enter(el);
    });
  }).observe(doc.body, { attributes: true, attributeFilter: ['hidden'], subtree: true });
}`;

/**
 * The tab pill follows the selected tab. It reads the selection from
 * `aria-selected`, so a click, the keyboard and a `select-tab` action all move
 * it, and it measures in a frame, so rapid changes collapse into one move and
 * the CSS transition retargets from wherever the pill is. Until it measures, or
 * when the tabs are not laid out, the selected tab keeps its own surface.
 */
const TAB_INDICATOR = `
function wireTabIndicators() {
  if (typeof window.MutationObserver !== 'function') return;
  qa('[data-ak-motion="tab-indicator"][data-ak-tabs-ready]').forEach(function (container) {
    var list = null;
    for (var i = 0; i < container.children.length; i += 1) {
      if (container.children[i].getAttribute('role') === 'tablist') list = container.children[i];
    }
    if (!list) return;
    var frame = 0;
    var place = function () {
      frame = 0;
      var tab = ownTabs(container, '[role="tab"]').filter(function (candidate) { return candidate.getAttribute('aria-selected') === 'true'; })[0];
      if (!tab || !tab.offsetWidth) { container.removeAttribute('data-ak-indicator'); return; }
      list.style.setProperty('--ak-ind-x', tab.offsetLeft + 'px');
      list.style.setProperty('--ak-ind-y', tab.offsetTop + 'px');
      list.style.setProperty('--ak-ind-w', tab.offsetWidth + 'px');
      list.style.setProperty('--ak-ind-h', tab.offsetHeight + 'px');
      container.setAttribute('data-ak-indicator', '');
    };
    var schedule = function () { if (!frame) frame = window.requestAnimationFrame(place); };
    new window.MutationObserver(schedule).observe(list, { attributes: true, attributeFilter: ['aria-selected'], subtree: true });
    if (typeof window.ResizeObserver === 'function') new window.ResizeObserver(schedule).observe(list);
    else window.addEventListener('resize', schedule, false);
    place();
  });
}`;

/**
 * The dialog part for pages with an exit recipe; it replaces the plain one.
 * Dialogs with the recipe sink away before they close. Closing ends in one
 * place, \`settleClose\`, which closes, restores focus and fires \`close\` exactly
 * once. It runs at once when motion is off, the page is hidden or the exit
 * animation is not running, on \`animationend\`, or after a bounded timeout if
 * that event never comes. Opening during an exit cancels it and keeps the
 * dialog open; a second close during an exit is ignored.
 */
export const DIALOG_WITH_EXIT = `
var lastFocus = null;
function stopClosing(dialog) {
  var pendingClose = dialog.akPendingClose;
  if (!pendingClose) return false;
  dialog.akPendingClose = null;
  window.clearTimeout(pendingClose.timer);
  dialog.removeEventListener('animationend', pendingClose.onEnd, false);
  dialog.removeAttribute('data-ak-closing');
  return true;
}
function openDialog(dialog) {
  // Reopened mid-exit: it never closed, so it does not announce opening again.
  if (stopClosing(dialog)) return;
  lastFocus = doc.activeElement;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  var focusable = q('button, [href], input', dialog);
  if (focusable) focusable.focus();
  fire(dialog, 'open');
}
function settleClose(dialog) {
  stopClosing(dialog);
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
  if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  fire(dialog, 'close');
}
function closeDialog(dialog) {
  if (!dialog || dialog.akPendingClose || !dialog.hasAttribute('open')) return;
  if (dialog.getAttribute('data-ak-motion') !== 'dialog-rise' || !motionAllowed() || doc.hidden) { settleClose(dialog); return; }
  dialog.setAttribute('data-ak-closing', '');
  var style = window.getComputedStyle(dialog);
  if (String(style.animationName).indexOf('ak-m-dialog-sink') === -1) { settleClose(dialog); return; }
  var seconds = parseFloat(style.animationDuration) || 0;
  var pendingClose = { timer: 0, onEnd: null };
  pendingClose.onEnd = function (event) {
    if (event.target === dialog && event.animationName === 'ak-m-dialog-sink') settleClose(dialog);
  };
  pendingClose.timer = window.setTimeout(function () { settleClose(dialog); }, Math.min(seconds * 1000 + 120, 1500));
  dialog.akPendingClose = pendingClose;
  dialog.addEventListener('animationend', pendingClose.onEnd, false);
}
function wireDialogMotion() {
  qa('dialog[data-ak-motion="dialog-rise"]').forEach(function (dialog) {
    // Escape is a close request: keep the dialog open until its exit ends.
    dialog.addEventListener('cancel', function (event) { event.preventDefault(); closeDialog(dialog); }, false);
    // Closed some other way mid-exit (a form, a browser that ignores the
    // cancel): finish the exit now so focus and the event still follow.
    dialog.addEventListener('close', function () { if (dialog.akPendingClose) settleClose(dialog); }, false);
  });
  doc.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    var open = q('dialog[open][data-ak-motion="dialog-rise"]');
    if (!open) return;
    event.preventDefault();
    closeDialog(open);
  }, false);
  doc.addEventListener('visibilitychange', function () {
    if (doc.hidden) qa('dialog[data-ak-closing]').forEach(settleClose);
  }, false);
}`;

/** The motion parts and their wiring calls for the recipes a page uses. */
export function motionRuntime(used: ReadonlySet<string>): { code: string[]; boot: string[] } {
  const code: string[] = [];
  const boot: string[] = [];
  if ([...used].some((id) => ENTER_RECIPES.has(id))) {
    code.push(ENTER);
    boot.push('wireMotionEnter();');
  }
  if (used.has('tab-indicator')) {
    code.push(TAB_INDICATOR);
    boot.push('wireTabIndicators();');
  }
  if (used.has('dialog-rise')) boot.push('wireDialogMotion();');
  if (used.has('crossfade')) {
    code.push(CROSSFADE);
    boot.push('wireCrossfade();');
  }
  return { code, boot };
}
