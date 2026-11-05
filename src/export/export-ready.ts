/**
 * The in-page half of export, shared by the local and the cloud exporter.
 *
 * Both backends pin the high-quality profile, wait for every 3D scene to leave
 * its static plan, freeze the live WebGL frame into an image and then measure
 * that image. A frame with almost no pixel signal (a cleared or black canvas)
 * is a failed capture, never a pass. The local exporter drives these functions
 * through Playwright; Browser Run has no evaluate, so the cloud exporter
 * inlines the same functions as a nonce-bearing script that writes its outcome
 * to `<html data-ak-export>`.
 *
 * Every function passed to the page is self-contained: it is serialized with
 * `Function.prototype.toString` and must not close over module scope.
 * Free of Node built-ins so the Worker can import it.
 */

/** Pixel signal of one frozen frame, sampled at a fixed grid. */
export interface FrameSignal {
  /** Distinct colors in the sample after quantizing each channel to 4 bits. */
  colors: number;
  /** Share of sampled pixels that differ from the most common color, 0..1. */
  lit: number;
}

/** A frame under either bound reads as blank. Real scenes measure far above both. */
export const MIN_FRAME_COLORS = 6;
export const MIN_FRAME_LIT = 0.02;

/** Indices of frames whose signal is too weak to be a drawn scene. */
export function unsignalledFrames(signals: readonly FrameSignal[]): number[] {
  return signals.flatMap((signal, index) =>
    signal.colors < MIN_FRAME_COLORS || signal.lit < MIN_FRAME_LIT ? [index] : [],
  );
}

/** Scene states the page reports once every 3D block has settled. */
export interface SceneProbe {
  states: string[];
  renderer: string;
}

/** Runs in the page. Reads each scene's state and the WebGL 2 renderer string. */
export function probeScenes(): SceneProbe {
  const states = [...document.querySelectorAll('[data-ak-3d]')].map(
    (el) => el.getAttribute('data-ak-3d-state') ?? 'static',
  );
  let renderer = '';
  const gl = document.createElement('canvas').getContext('webgl2');
  if (gl !== null) {
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    renderer = String(
      gl.getParameter(debug === null ? gl.RENDERER : debug.UNMASKED_RENDERER_WEBGL),
    );
    // Give the probe context back; a page with many scenes needs every slot.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
  return { states, renderer };
}

/** Runs in the page after freeze(). Samples every frozen frame image on a 64x36 grid. */
export function measureFrameSignal(): FrameSignal[] {
  const width = 64;
  const height = 36;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  return [...document.querySelectorAll<HTMLImageElement>('.ak-3d-frame')].map((img) => {
    if (context === null) return { colors: 0, lit: 0 };
    context.clearRect(0, 0, width, height);
    context.drawImage(img, 0, 0, width, height);
    const data = context.getImageData(0, 0, width, height).data;
    const counts = new Map<number, number>();
    for (let i = 0; i < data.length; i += 4) {
      const key =
        ((data[i] ?? 0) >> 4) * 4096 +
        ((data[i + 1] ?? 0) >> 4) * 256 +
        ((data[i + 2] ?? 0) >> 4) * 16 +
        ((data[i + 3] ?? 0) >> 4);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const total = width * height;
    const dominant = Math.max(...counts.values());
    return { colors: counts.size, lit: Math.round(((total - dominant) / total) * 1000) / 1000 };
  });
}

/** Outcome the in-page settle script writes for the cloud exporter. */
export interface ExportReadyDetail {
  states: string[];
  renderer: string;
  frames: { width: number; height: number }[];
  signals: FrameSignal[];
}

/**
 * Runs in the page (cloud). Waits for fonts and every scene, freezes, measures
 * and writes `data-ak-export` = `ready` or a failure code from the export
 * taxonomy, plus `data-ak-export-detail` as JSON. Browser Run waits for
 * `html[data-ak-export="ready"]`, so a failure can never be captured as success.
 */
function settleForExport(
  probe: typeof probeScenes,
  measure: typeof measureFrameSignal,
  minColors: number,
  minLit: number,
  budgetMs: number,
): void {
  const root = document.documentElement;
  const began = performance.now();
  const finish = (code: string, detail: Partial<ExportReadyDetail>): void => {
    root.setAttribute('data-ak-export-detail', JSON.stringify(detail));
    root.setAttribute('data-ak-export', code);
  };
  const step = async (): Promise<void> => {
    const scenes = [...document.querySelectorAll('[data-ak-3d]')];
    const waiting =
      document.fonts.status !== 'loaded' ||
      scenes.some((el) => (el.getAttribute('data-ak-3d-state') ?? 'static') === 'static');
    if (waiting) {
      if (performance.now() - began > budgetMs) {
        finish('timeout', { states: probe().states });
        return;
      }
      setTimeout(() => void step().catch(fail), 50);
      return;
    }
    const { states, renderer } = probe();
    const failed = states.filter((state) => state !== 'ready');
    if (failed.length > 0) {
      finish(failed.includes('error') ? 'scene-error' : 'webgl-unavailable', { states, renderer });
      return;
    }
    const api = (
      window as unknown as { akRender3d?: { freeze(): { width: number; height: number }[] } }
    ).akRender3d;
    const frames = scenes.length > 0 && api !== undefined ? api.freeze() : [];
    await Promise.all(
      [...document.querySelectorAll<HTMLImageElement>('.ak-3d-frame')].map((img) => img.decode()),
    );
    const signals = measure();
    const blank = signals.some((signal) => signal.colors < minColors || signal.lit < minLit);
    const complete = frames.length === scenes.length && signals.length === scenes.length;
    finish(complete && !blank ? 'ready' : 'capture-failed', { states, renderer, frames, signals });
  };
  const fail = (): void => finish('scene-error', {});
  void step().catch(fail);
}

/** Pin the high-quality profile so the frame does not depend on the exporting machine's cores. */
export function withHighQuality(html: string): string {
  return html.replace(/<html\b([^>]*)>/iu, (_match, attrs: string) => {
    const kept = attrs.replace(/\sdata-ak-3d-quality="[^"]*"/giu, '');
    return `<html${kept} data-ak-3d-quality="high">`;
  });
}

/** Selector Browser Run waits for; present only once every frame passed. */
export const EXPORT_READY_SELECTOR = 'html[data-ak-export="ready"]';
/** Selector that appears on any outcome, used to read a failure's code. */
export const EXPORT_SETTLED_SELECTOR = 'html[data-ak-export]';

/** True when the compiled page holds at least one 3D scene. */
export const hasScenes = (html: string): boolean => /\sdata-ak-3d[\s=>]/u.test(html);

/**
 * Prepare a compiled page for a capture without evaluate: pin high quality and
 * inline the settle script under the page's own CSP nonce. A page without a
 * script nonce has no runtime and therefore no scene; it is returned pinned only.
 */
export function withExportReadyScript(html: string, budgetMs: number): string {
  const pinned = withHighQuality(html);
  const nonce = /<script\b[^>]*\snonce="([^"]+)"/iu.exec(pinned)?.[1];
  if (nonce === undefined || !hasScenes(pinned)) return pinned;
  const call = `(${settleForExport.toString()})(${probeScenes.toString()}, ${measureFrameSignal.toString()}, ${MIN_FRAME_COLORS}, ${MIN_FRAME_LIT}, ${Math.max(1, Math.floor(budgetMs))});`;
  // Runs after the runtime: the window load event fires once every script has run.
  // A bundler that keeps function names (wrangler does) may emit `__name(...)`
  // calls inside the serialized functions; the shim keeps them harmless.
  const script = `<script nonce="${nonce}">(function () { var __name = function (f) { return f; }; addEventListener('load', function () { ${call} }); })();</script>`;
  const at = pinned.lastIndexOf('</body>');
  return at === -1 ? `${pinned}${script}` : `${pinned.slice(0, at)}${script}${pinned.slice(at)}`;
}

/** Parse `data-ak-export` and its detail out of a page's serialized HTML. */
export function readExportOutcome(
  html: string,
): { code: string; detail: Partial<ExportReadyDetail> } | undefined {
  const code = /<html\b[^>]*\sdata-ak-export="([^"]*)"/iu.exec(html)?.[1];
  if (code === undefined) return undefined;
  const raw = /<html\b[^>]*\sdata-ak-export-detail="([^"]*)"/iu.exec(html)?.[1];
  let detail: Partial<ExportReadyDetail> = {};
  if (raw !== undefined) {
    try {
      detail = JSON.parse(
        raw
          .replace(/&quot;/gu, '"')
          .replace(/&lt;/gu, '<')
          .replace(/&gt;/gu, '>')
          .replace(/&#39;/gu, "'")
          .replace(/&amp;/gu, '&'),
      ) as Partial<ExportReadyDetail>;
    } catch {
      detail = {};
    }
  }
  return { code, detail };
}
