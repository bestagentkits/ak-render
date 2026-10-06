/**
 * Runtime part for the gallery lightbox, emitted only on pages with a gallery.
 *
 * Without scripts, a thumbnail is a link to its full-size figure, which CSS
 * shows as a `:target` overlay. This part upgrades the same markup: it moves
 * the figure set into a modal `<dialog>` (the browser keeps focus inside it and
 * makes the page inert), then shows one figure at a time. Arrow keys step,
 * Escape and Close shut it, and focus returns to the thumbnail that opened it.
 * Where `showModal` is missing it does nothing, so the links keep working.
 *
 * The keydown handler stops Escape at the dialog, because the shared document
 * handler only knows how to close the `dialog` feature's own dialogs.
 */

export const LIGHTBOX = `
function lightboxShow(set, index, controlSelector) {
  var figures = qa('.ak-lightbox-figure', set);
  if (!figures.length) return 0;
  var current = (index % figures.length + figures.length) % figures.length;
  figures.forEach(function (figure, position) { figure.hidden = position !== current; });
  var control = q(controlSelector, figures[current]) || q('[data-ak-lightbox-close]', figures[current]);
  if (control) control.focus();
  var picture = q('img', figures[current]);
  announce('Image ' + (current + 1) + ' of ' + figures.length + (picture && picture.alt ? ': ' + picture.alt : ''));
  return current;
}
function lightboxControl(element) {
  var step = element && element.closest ? element.closest('[data-ak-lightbox-step]') : null;
  return step ? '[data-ak-lightbox-step="' + step.getAttribute('data-ak-lightbox-step') + '"]' : '[data-ak-lightbox-close]';
}
function wireLightbox() {
  qa('[data-ak-lightbox-root]').forEach(function (root) {
    var set = q('.ak-lightbox', root);
    if (!set) return;
    var dialog = doc.createElement('dialog');
    if (typeof dialog.showModal !== 'function') return;
    dialog.className = 'ak-lightbox-dialog';
    dialog.setAttribute('aria-label', set.getAttribute('data-ak-lightbox-label') || 'Image viewer');
    root.appendChild(dialog);
    dialog.appendChild(set);
    root.setAttribute('data-ak-lightbox-ready', '');
    var current = 0;
    var opener = null;
    function openAt(index, from) {
      opener = from;
      if (!dialog.open) dialog.showModal();
      current = lightboxShow(set, index, '[data-ak-lightbox-close]');
    }
    function step(delta, selector) {
      current = lightboxShow(set, current + delta, selector);
    }
    var thumbs = qa('.ak-lightbox-thumb', root);
    thumbs.forEach(function (thumb, index) {
      thumb.addEventListener('click', function (event) {
        event.preventDefault();
        openAt(index, thumb);
      }, false);
    });
    dialog.addEventListener('click', function (event) {
      if (event.target === dialog) { dialog.close(); return; }
      var stepLink = event.target.closest('[data-ak-lightbox-step]');
      if (stepLink) {
        event.preventDefault();
        step(Number(stepLink.getAttribute('data-ak-lightbox-step')), lightboxControl(stepLink));
        return;
      }
      if (event.target.closest('[data-ak-lightbox-close]')) {
        event.preventDefault();
        dialog.close();
      }
    }, false);
    dialog.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        dialog.close();
        return;
      }
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      step(event.key === 'ArrowRight' ? 1 : -1, lightboxControl(doc.activeElement));
    }, false);
    dialog.addEventListener('close', function () {
      var back = opener;
      opener = null;
      if (back && typeof back.focus === 'function') back.focus();
    }, false);
    // A shared link to a full-size image opens it in the viewer.
    var hash = window.location.hash ? window.location.hash.slice(1) : '';
    if (hash) {
      var figures = qa('.ak-lightbox-figure', set);
      for (var i = 0; i < figures.length; i += 1) {
        if (figures[i].id === hash) openAt(i, thumbs[i] || null);
      }
    }
  });
}`;
