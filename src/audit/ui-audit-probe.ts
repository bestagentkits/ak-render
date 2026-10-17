/**
 * In-page measurement for the publication preset.
 *
 * `measurePage` and `exerciseControls` are serialized by the browser driver
 * and run inside the audited page, so each must be self-contained: no imports,
 * no references to module scope. They only read layout and computed style (and
 * `exerciseControls` clicks the page's own controls); they never fetch.
 */

export interface ProbeOptions {
  /** Which measurements to take in this check. */
  overflow: boolean;
  chartLabels: boolean;
  tables: boolean;
  contrast: boolean;
  smallText: boolean;
  touchTargets: boolean;
  images: boolean;
  motion: boolean;
  /** Measure overflow again with every closed `<details>` opened, then close them. */
  disclosures: boolean;
  /** Upper bound on elements inspected per measurement. */
  maxElements: number;
  /** Text below this size in px is reported. */
  smallTextPx: number;
  /** A control below this size in px either way is reported. */
  targetPx: number;
}

export interface ProbeLocation {
  nodeId?: string;
  /** A short, stable description of the element: tag, first class and text. */
  selector: string;
}

export interface ProbeOverflow {
  scrollWidth: number;
  offenders: (ProbeLocation & { left: number; right: number })[];
}

/** Text smaller than this (px) is hard to read on any screen. */
export const SMALL_TEXT_PX = 10;

/** WCAG 2.2 AA target size (2.5.8): a control at least this many px each way. */
export const TOUCH_TARGET_PX = 24;

export interface ProbeResult {
  scrollWidth: number;
  clientWidth: number;
  overflow: (ProbeLocation & { left: number; right: number })[];
  /** Overflow with the page's closed disclosures opened; absent when not measured or none overflow. */
  disclosureOverflow?: ProbeOverflow;
  clippedLabels: (ProbeLocation & { label: string; by: number })[];
  wideTables: (ProbeLocation & { scrollWidth: number; clientWidth: number; scrolls: boolean })[];
  contrast: (ProbeLocation & {
    ratio: number;
    minimum: number;
    foreground: string;
    background: string;
  })[];
  smallText: (ProbeLocation & { size: number })[];
  touchTargets: (ProbeLocation & { width: number; height: number })[];
  brokenImages: (ProbeLocation & { source: string })[];
  motion: (ProbeLocation & { transition: string; animation: string })[];
  /** Blocks with a rendered box, by `data-ak-id`. */
  visibleBlocks: string[];
}

export function measurePage(options: ProbeOptions): ProbeResult {
  const root = document.documentElement;
  const viewport = root.clientWidth;
  const all = Array.from(document.body.querySelectorAll('*')).slice(0, options.maxElements);

  const blockOf = (element: Element): string | undefined =>
    element.closest('[data-ak-id]')?.getAttribute('data-ak-id') ?? undefined;
  const describeElement = (element: Element): string => {
    const tag = element.tagName.toLowerCase();
    const className =
      typeof element.className === 'string' ? element.className.trim().split(/\s+/u)[0] : '';
    const text = (element.textContent ?? '').replace(/\s+/gu, ' ').trim().slice(0, 40);
    return `${tag}${className === '' || className === undefined ? '' : `.${className}`}${text === '' ? '' : ` "${text}"`}`;
  };
  const locate = (element: Element): ProbeLocation => {
    const nodeId = blockOf(element);
    return nodeId === undefined
      ? { selector: describeElement(element) }
      : { nodeId, selector: describeElement(element) };
  };
  const rendered = (element: Element): boolean => {
    const box = element.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) return false;
    // Parked off the page until focused, like the skip link.
    if (box.right + window.scrollX <= 0 || box.bottom + window.scrollY <= 0) return false;
    // Content of a closed `<details>` keeps a layout box but is not drawn.
    if (typeof element.checkVisibility === 'function' && !element.checkVisibility()) return false;
    const style = getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none';
  };
  const clips = (style: CSSStyleDeclaration): boolean =>
    style.overflowX !== 'visible' || style.overflowY !== 'visible';
  /** True when an ancestor below the page itself scrolls or clips horizontally. */
  const contained = (element: Element): boolean => {
    for (let node = element.parentElement; node !== null; node = node.parentElement) {
      if (node === document.body || node === root) return false;
      const overflowX = getComputedStyle(node).overflowX;
      if (overflowX !== 'visible') return true;
    }
    return false;
  };
  const screenReaderOnly = (element: Element): boolean =>
    element.closest('.ak-sr,[aria-hidden="true"],[hidden]') !== null;

  const result: ProbeResult = {
    scrollWidth: root.scrollWidth,
    clientWidth: viewport,
    overflow: [],
    clippedLabels: [],
    wideTables: [],
    contrast: [],
    smallText: [],
    touchTargets: [],
    brokenImages: [],
    motion: [],
    visibleBlocks: [],
  };

  for (const element of Array.from(document.querySelectorAll('[data-ak-id]'))) {
    const id = element.getAttribute('data-ak-id');
    if (id !== null && rendered(element)) result.visibleBlocks.push(id);
  }

  /** The outermost elements that push the page wider than the viewport. */
  const overflowing = (): ProbeOverflow['offenders'] => {
    const offenders: ProbeOverflow['offenders'] = [];
    if (root.scrollWidth <= viewport + 1) return offenders;
    const offending = (element: Element): boolean => {
      const box = element.getBoundingClientRect();
      return (box.right > viewport + 1 || box.left < -1) && box.width > 0;
    };
    for (const element of all) {
      if (!offending(element) || contained(element)) continue;
      // Report the outermost offender: its descendants overflow with it.
      const parent = element.parentElement;
      if (parent !== null && parent !== document.body && offending(parent) && !contained(parent))
        continue;
      if (getComputedStyle(element).position === 'fixed') continue;
      const box = element.getBoundingClientRect();
      offenders.push({
        ...locate(element),
        left: Math.round(box.left),
        right: Math.round(box.right),
      });
    }
    return offenders;
  };

  if (options.overflow) result.overflow = overflowing();

  if (options.overflow && options.disclosures && root.scrollWidth <= viewport + 1) {
    // A reader opens disclosures; what they hold must fit the page too.
    const closed = Array.from(document.querySelectorAll('details:not([open])'));
    if (closed.length > 0) {
      for (const details of closed) details.setAttribute('open', '');
      const scrollWidth = root.scrollWidth;
      const offenders = overflowing();
      for (const details of closed) details.removeAttribute('open');
      if (scrollWidth > viewport + 1) result.disclosureOverflow = { scrollWidth, offenders };
    }
  }

  if (options.chartLabels) {
    for (const label of Array.from(document.querySelectorAll('.ak-chart svg text'))) {
      if (screenReaderOnly(label) || !rendered(label)) continue;
      // The label is cut by the nearest ancestor that clips: the SVG itself
      // unless it lets overflow show, or a container.
      let clip: Element | null = label.closest('svg');
      while (clip !== null && !clips(getComputedStyle(clip))) clip = clip.parentElement;
      if (clip === null) continue;
      const box = label.getBoundingClientRect();
      const frame = clip.getBoundingClientRect();
      // A container that scrolls on an axis shows everything in its scroll
      // extent there: only what lies outside that extent is cut.
      const style = getComputedStyle(clip);
      const scrolls = (overflow: string): boolean => overflow === 'auto' || overflow === 'scroll';
      const left = scrolls(style.overflowX)
        ? frame.left + clip.clientLeft - clip.scrollLeft
        : frame.left;
      const right = scrolls(style.overflowX) ? left + clip.scrollWidth : frame.right;
      const top = scrolls(style.overflowY)
        ? frame.top + clip.clientTop - clip.scrollTop
        : frame.top;
      const bottom = scrolls(style.overflowY) ? top + clip.scrollHeight : frame.bottom;
      const by = Math.max(left - box.left, box.right - right, top - box.top, box.bottom - bottom);
      if (by > 1) {
        result.clippedLabels.push({
          ...locate(label),
          label: (label.textContent ?? '').trim().slice(0, 60),
          by: Math.round(by),
        });
      }
    }
  }

  if (options.tables) {
    for (const table of Array.from(document.querySelectorAll('table'))) {
      if (!rendered(table)) continue;
      const wrapper = table.parentElement;
      if (wrapper === null) continue;
      const style = getComputedStyle(wrapper);
      result.wideTables.push({
        ...locate(table),
        scrollWidth: table.scrollWidth,
        clientWidth: wrapper.clientWidth,
        scrolls: style.overflowX === 'auto' || style.overflowX === 'scroll',
      });
    }
  }

  /** `rgb()`, `rgba()` or `color(srgb …)` as 0–255 channels and alpha. */
  const parseColor = (value: string): [number, number, number, number] | undefined => {
    const rgb = /^rgba?\(([^)]+)\)$/u.exec(value);
    if (rgb !== null) {
      const parts = (rgb[1] ?? '').split(/[\s,/]+/u).filter((part) => part !== '');
      const [red, green, blue] = parts.slice(0, 3).map(Number);
      const alpha = parts[3] === undefined ? 1 : Number(parts[3]);
      if ([red, green, blue, alpha].some((part) => part === undefined || Number.isNaN(part)))
        return undefined;
      return [red as number, green as number, blue as number, alpha];
    }
    const srgb = /^color\(srgb ([^)]+)\)$/u.exec(value);
    if (srgb !== null) {
      const parts = (srgb[1] ?? '').split(/[\s/]+/u).filter((part) => part !== '');
      const [red, green, blue] = parts.slice(0, 3).map((part) => Number(part) * 255);
      const alpha = parts[3] === undefined ? 1 : Number(parts[3]);
      if ([red, green, blue, alpha].some((part) => part === undefined || Number.isNaN(part)))
        return undefined;
      return [red as number, green as number, blue as number, alpha];
    }
    return undefined;
  };
  const over = (
    top: [number, number, number, number],
    bottom: [number, number, number],
  ): [number, number, number] => [
    top[0] * top[3] + bottom[0] * (1 - top[3]),
    top[1] * top[3] + bottom[1] * (1 - top[3]),
    top[2] * top[3] + bottom[2] * (1 - top[3]),
  ];
  const luminance = (channels: [number, number, number]): number => {
    const linear = (channel: number): number => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    return (
      0.2126 * linear(channels[0]) + 0.7152 * linear(channels[1]) + 0.0722 * linear(channels[2])
    );
  };
  /**
   * The opaque colour behind an element, compositing translucent layers. A
   * background image or gradient below the page itself makes the colour
   * unknowable from style alone, so the element is skipped.
   */
  const backdrop = (element: Element): [number, number, number] | undefined => {
    const layers: [number, number, number, number][] = [];
    for (let node: Element | null = element; node !== null; node = node.parentElement) {
      const style = getComputedStyle(node);
      const isPage = node === document.body || node === root;
      if (!isPage && style.backgroundImage !== 'none') return undefined;
      const color = parseColor(style.backgroundColor);
      if (color === undefined) return undefined;
      if (color[3] > 0) layers.push(color);
      if (color[3] >= 1) break;
    }
    let base: [number, number, number] = [255, 255, 255];
    for (let index = layers.length - 1; index >= 0; index -= 1) {
      const layer = layers[index];
      if (layer !== undefined) base = over(layer, base);
    }
    return base;
  };
  const hex = (channels: [number, number, number]): string =>
    `#${channels.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;

  if (options.contrast || options.smallText) {
    const seen = new Set<Element>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text !== null; text = walker.nextNode()) {
      if (seen.size >= options.maxElements) break;
      const element = text.parentElement;
      if (element === null || seen.has(element)) continue;
      if ((text.textContent ?? '').trim() === '') continue;
      seen.add(element);
      if (element.closest('svg,script,style,noscript,template') !== null) continue;
      if (screenReaderOnly(element) || !rendered(element)) continue;
      if (element.closest(':disabled,[aria-disabled="true"]') !== null) continue;
      const style = getComputedStyle(element);
      const size = Number.parseFloat(style.fontSize);
      if (options.smallText && size < options.smallTextPx) {
        result.smallText.push({ ...locate(element), size: Math.round(size * 10) / 10 });
      }
      if (!options.contrast) continue;
      const foreground = parseColor(style.color);
      if (foreground === undefined || foreground[3] === 0) continue;
      const clipped = style.getPropertyValue('-webkit-background-clip');
      if (clipped === 'text' || style.getPropertyValue('background-clip') === 'text') continue;
      const behind = backdrop(element);
      if (behind === undefined) continue;
      const front = over(foreground, behind);
      const [light, dark] = [luminance(front), luminance(behind)].sort((a, b) => b - a) as [
        number,
        number,
      ];
      const ratio = (light + 0.05) / (dark + 0.05);
      const weight = Number.parseInt(style.fontWeight, 10);
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      const minimum = large ? 3 : 4.5;
      if (ratio + 0.005 < minimum) {
        result.contrast.push({
          ...locate(element),
          ratio: Math.round(ratio * 100) / 100,
          minimum,
          foreground: hex(front),
          background: hex(behind),
        });
      }
    }
  }

  if (options.touchTargets) {
    const controls = document.querySelectorAll(
      'button,[role="tab"],[role="button"],summary,select,input:not([type="hidden"]),textarea,.ak-btn',
    );
    for (const control of Array.from(controls).slice(0, options.maxElements)) {
      if (screenReaderOnly(control) || !rendered(control)) continue;
      // A form control's label activates it, so the label is the target.
      const label =
        control instanceof HTMLInputElement
          ? (control.closest('label') ?? control.labels?.[0])
          : null;
      const box = (label ?? control).getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (Math.min(box.width, box.height) < options.targetPx) {
        result.touchTargets.push({
          ...locate(control),
          width: Math.round(box.width),
          height: Math.round(box.height),
        });
      }
    }
  }

  if (options.images) {
    for (const image of Array.from(document.images)) {
      if (image.complete && image.naturalWidth === 0 && image.getAttribute('src') !== null) {
        result.brokenImages.push({
          ...locate(image),
          source: (image.getAttribute('src') ?? '').slice(0, 120),
        });
      }
    }
  }

  if (options.motion) {
    const seconds = (list: string): number =>
      Math.max(
        0,
        ...list.split(',').map((item) => {
          const value = Number.parseFloat(item);
          if (Number.isNaN(value)) return 0;
          return item.trim().endsWith('ms') ? value / 1000 : value;
        }),
      );
    for (const element of [root, document.body, ...all]) {
      const style = getComputedStyle(element);
      const transition =
        style.transitionProperty !== 'none' ? seconds(style.transitionDuration) : 0;
      const animation =
        style.animationName !== 'none'
          ? seconds(style.animationDuration) *
            (style.animationIterationCount === 'infinite' ? 2 : 1)
          : 0;
      if (transition > 0.01 || animation > 0.01) {
        result.motion.push({
          ...locate(element),
          transition: transition > 0.01 ? style.transitionDuration : '0s',
          animation:
            animation > 0.01 ? `${style.animationName} ${style.animationDuration}` : 'none',
        });
      }
    }
  }

  return result;
}

export interface InteractionProblem {
  nodeId?: string;
  selector: string;
  control: 'tab' | 'disclosure' | 'theme-toggle';
  problem: string;
}

/**
 * Activate a bounded set of the page's own controls once each and check that
 * their state changed, restoring it afterwards.
 */
export async function exerciseControls(limit: number): Promise<InteractionProblem[]> {
  const problems: InteractionProblem[] = [];
  const locate = (element: Element): { nodeId?: string; selector: string } => {
    const nodeId = element.closest('[data-ak-id]')?.getAttribute('data-ak-id') ?? undefined;
    const text = (element.textContent ?? '').replace(/\s+/gu, ' ').trim().slice(0, 40);
    const selector = `${element.tagName.toLowerCase()}${text === '' ? '' : ` "${text}"`}`;
    return nodeId === undefined ? { selector } : { nodeId, selector };
  };
  const visible = (element: Element): boolean => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };

  for (const list of Array.from(document.querySelectorAll('[role="tablist"]')).slice(0, limit)) {
    const tabs = Array.from(list.querySelectorAll('[role="tab"]')).filter(visible);
    const selected = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true');
    const target = tabs.find((tab) => tab !== selected);
    if (target === undefined || !(target instanceof HTMLElement)) continue;
    target.click();
    if (target.getAttribute('aria-selected') !== 'true') {
      problems.push({
        ...locate(target),
        control: 'tab',
        problem: 'aria-selected did not become true',
      });
      continue;
    }
    const panelId = target.getAttribute('aria-controls');
    const panel = panelId === null ? null : document.getElementById(panelId);
    if (panel !== null && !visible(panel)) {
      problems.push({
        ...locate(target),
        control: 'tab',
        problem: 'the selected panel is not visible',
      });
    }
    if (selected instanceof HTMLElement) selected.click();
  }

  for (const summary of Array.from(document.querySelectorAll('details > summary')).slice(
    0,
    limit,
  )) {
    const details = summary.parentElement;
    if (!(details instanceof HTMLDetailsElement) || !(summary instanceof HTMLElement)) continue;
    if (!visible(summary)) continue;
    const before = details.open;
    summary.click();
    if (details.open === before) {
      problems.push({ ...locate(summary), control: 'disclosure', problem: 'open did not change' });
      continue;
    }
    summary.click();
  }

  for (const button of Array.from(
    document.querySelectorAll('button[aria-expanded]:not([role="tab"])'),
  ).slice(0, limit)) {
    if (!(button instanceof HTMLElement) || !visible(button)) continue;
    if (button.closest('[role="dialog"],dialog') !== null) continue;
    const before = button.getAttribute('aria-expanded');
    button.click();
    if (button.getAttribute('aria-expanded') === before) {
      problems.push({
        ...locate(button),
        control: 'disclosure',
        problem: 'aria-expanded did not change',
      });
      continue;
    }
    button.click();
  }

  const toggle = document.querySelector('[data-ak-theme-toggle]');
  if (toggle instanceof HTMLElement && visible(toggle)) {
    const root = document.documentElement;
    const before = root.getAttribute('data-theme');
    toggle.click();
    // The runtime may apply the scheme inside a view transition, a frame or
    // more after the click, so the change is awaited for a bounded time.
    for (
      let waited = 0;
      waited < 1000 && root.getAttribute('data-theme') === before;
      waited += 50
    ) {
      await new Promise((done) => setTimeout(done, 50));
    }
    if (root.getAttribute('data-theme') === before) {
      problems.push({
        ...locate(toggle),
        control: 'theme-toggle',
        problem: 'data-theme did not change',
      });
    } else {
      toggle.click();
    }
  }

  return problems;
}
