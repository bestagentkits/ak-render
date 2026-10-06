/**
 * Runtime parts for the composition blocks: tab selection and the carousel.
 * `runtime.ts` emits them in the same position and order as the other core
 * parts, and only when a page uses the feature.
 */

export const TABS = `
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

export const CAROUSEL = `
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
