/**
 * Motion Studio server: a loopback-only development dashboard over one Page
 * Spec file.
 *
 * It is never part of a compiled page. The browser UI, the previews and the
 * API share one origin on 127.0.0.1, behind a random per-session path, so
 * another site in the same browser can neither read the previews nor post an
 * accept. Requests with a foreign Host header (DNS rebinding) are refused.
 * Previews are the real compiler output of the proposed spec, served with the
 * page's own CSP; the studio adds nothing to them.
 */

import { randomBytes } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename, dirname, join } from 'node:path';
import { RenderError } from '../../errors.js';
import { compile } from '../../render/render.js';
import { motionCatalog } from '../motion-catalog.js';
import { getMotionRecipe } from '../recipes.js';
import {
  checkProposal,
  inspectBlock,
  readSource,
  STUDIO_DURATION_LIMITS,
  STUDIO_TOKENS,
  type StudioOptions,
  type StudioProposal,
  studioState,
} from './studio-model.js';
import { STUDIO_CSS, STUDIO_HTML, STUDIO_JS } from './studio-page.js';

export interface MotionStudioOptions extends StudioOptions {
  /** The spec file the studio reads and, on Accept, writes. */
  file: string;
  /** Port on 127.0.0.1; 0 picks a free one. */
  port?: number;
}

export interface MotionStudio {
  /** The studio URL, including its session path. */
  url: string;
  port: number;
  close(): Promise<void>;
}

const MAX_BODY_BYTES = 1_000_000;
/** Previews kept in memory; older ones are dropped first. */
const MAX_PREVIEWS = 64;

const STUDIO_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self'",
  "frame-src 'self'",
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * Motion policies the preview can be viewed under. `os-reduce` is what a
 * reader with the OS reduced-motion setting sees: the still state, whatever
 * the policy.
 */
const PREVIEW_MODES = ['full', 'reduced', 'none', 'os-reduce'] as const;
type PreviewMode = (typeof PREVIEW_MODES)[number];

function previewMode(value: unknown): PreviewMode | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'string' && (PREVIEW_MODES as readonly string[]).includes(value)) {
    return value as PreviewMode;
  }
  throw new HttpError(400, `preview must be one of ${PREVIEW_MODES.join(', ')}`);
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

function send(
  response: ServerResponse,
  status: number,
  type: string,
  body: string,
  csp?: string,
): void {
  response.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...(csp === undefined ? {} : { 'content-security-policy': csp }),
  });
  response.end(body);
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  send(response, status, 'application/json; charset=utf-8', JSON.stringify(value));
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (!/^application\/json\b/u.test(request.headers['content-type'] ?? '')) {
    throw new HttpError(415, 'send application/json');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'request body is too large');
    chunks.push(chunk as Buffer);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      throw new Error('not an object');
    return value as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'request body must be a JSON object');
  }
}

/** Start the studio. Resolves once it listens. */
export function startMotionStudio(options: MotionStudioOptions): Promise<MotionStudio> {
  const session = randomBytes(16).toString('hex');
  const prefix = `/studio/${session}/`;
  const file = options.file;
  const modelOptions: StudioOptions =
    options.themeCatalog === undefined ? {} : { themeCatalog: options.themeCatalog };
  const previews = new Map<string, string>();
  let accepting = false;
  let port = 0;

  const load = () => readSource(file, readFileSync(file, 'utf8'));
  // Read once up front so a missing or unreadable file fails the command.
  load();

  const keep = (html: string): string => {
    const id = randomBytes(8).toString('hex');
    previews.set(id, html);
    while (previews.size > MAX_PREVIEWS) {
      const oldest = previews.keys().next().value as string;
      previews.delete(oldest);
    }
    return `${prefix}preview/${id}`;
  };

  /**
   * The state of a proposal, its preview and the original's preview. A preview
   * mode recompiles both pages under that motion policy for viewing only; the
   * state, audit and diff always describe the proposal as written.
   */
  const view = (proposal: StudioProposal, mode: PreviewMode | undefined) => {
    const source = load();
    const { html, ...state } = studioState(source, proposal, modelOptions);
    const under = (base: StudioProposal): string | undefined => {
      if (mode === undefined) return studioState(source, base, modelOptions).html;
      const policy = mode === 'os-reduce' ? 'none' : mode;
      return studioState(
        source,
        { ...base, tokens: { ...base.tokens, 'motion-policy': policy } },
        modelOptions,
      ).html;
    };
    const preview = mode === undefined ? html : html === undefined ? undefined : under(proposal);
    const original = under({});
    return {
      state,
      preview: preview === undefined ? null : keep(preview),
      original: original === undefined ? null : keep(original),
      inspections: html === undefined ? {} : inspectAll(state, html),
    };
  };

  const inspectAll = (state: Parameters<typeof inspectBlock>[0], html: string) => {
    const result: Record<string, ReturnType<typeof inspectBlock>> = {};
    for (const block of state.blocks) result[block.id] = inspectBlock(state, html, block.id);
    return result;
  };

  const gallery = (id: string): string => {
    const recipe = getMotionRecipe(id);
    if (recipe === undefined) throw new HttpError(404, `unknown motion recipe "${id}"`);
    const spec = {
      version: 1,
      meta: { title: `${id} preview` },
      ...(recipe.requires?.visibleWhen === true ? { state: { show: true } } : {}),
      blocks: [structuredClone(recipe.example)],
    };
    return compile(spec, { source: `${id}.example` }).html;
  };

  const accept = (body: Record<string, unknown>) => {
    if (accepting) throw new HttpError(409, 'another accept is in progress');
    accepting = true;
    try {
      const proposal = checkProposal(body.proposal);
      const source = load();
      if (body.hash !== source.hash) {
        throw new HttpError(
          409,
          'the spec changed on disk since this proposal was made; reload to start again',
          {
            stale: true,
            hash: source.hash,
          },
        );
      }
      const { html, ...state } = studioState(source, proposal, modelOptions);
      if (!state.ok || html === undefined) {
        throw new HttpError(422, state.error?.message ?? 'the proposed spec does not compile', {
          error: state.error,
        });
      }
      if (state.diff === '')
        throw new HttpError(409, 'nothing to accept: the proposal matches the spec');
      // Write beside the file, then rename, so a crash never leaves half a spec.
      const temporary = join(dirname(file), `.${basename(file)}.${session}.tmp`);
      writeFileSync(temporary, state.proposedText, 'utf8');
      renameSync(temporary, file);
      return { accepted: true, diff: state.diff, hash: load().hash };
    } finally {
      accepting = false;
    }
  };

  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    const host = request.headers.host ?? '';
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      throw new HttpError(421, 'unexpected Host header');
    }
    const url = new URL(request.url ?? '/', `http://${host}`);
    if (!url.pathname.startsWith(prefix)) throw new HttpError(404, 'not found');
    const route = url.pathname.slice(prefix.length);
    const method = request.method ?? 'GET';

    if (method === 'GET') {
      if (route === '')
        return send(response, 200, 'text/html; charset=utf-8', STUDIO_HTML, STUDIO_CSP);
      if (route === 'studio.js')
        return send(response, 200, 'text/javascript; charset=utf-8', STUDIO_JS);
      if (route === 'studio.css') return send(response, 200, 'text/css; charset=utf-8', STUDIO_CSS);
      if (route === 'api/catalog') {
        return sendJson(response, 200, {
          ...motionCatalog(),
          tokens: STUDIO_TOKENS,
          durationLimits: STUDIO_DURATION_LIMITS,
          easings: ['ease', 'ease-in-out', 'linear'],
          policies: ['full', 'reduced', 'none'],
        });
      }
      if (route.startsWith('preview/')) {
        const html = previews.get(route.slice('preview/'.length));
        if (html === undefined)
          throw new HttpError(404, 'this preview expired; refresh the studio');
        return send(response, 200, 'text/html; charset=utf-8', html, "frame-ancestors 'self'");
      }
      if (route.startsWith('gallery/')) {
        return send(
          response,
          200,
          'text/html; charset=utf-8',
          gallery(route.slice('gallery/'.length)),
          "frame-ancestors 'self'",
        );
      }
      throw new HttpError(404, 'not found');
    }

    if (method === 'POST') {
      // A cross-site form cannot set this header, and the session path is secret.
      if (request.headers['x-ak-studio'] !== session)
        throw new HttpError(403, 'missing studio session header');
      const body = await readJson(request);
      if (route === 'api/state') {
        return sendJson(
          response,
          200,
          view(checkProposal(body.proposal ?? {}), previewMode(body.preview)),
        );
      }
      if (route === 'api/accept') return sendJson(response, 200, accept(body));
      throw new HttpError(404, 'not found');
    }
    throw new HttpError(405, 'method not allowed');
  };

  const server: Server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      if (error instanceof HttpError)
        return sendJson(response, error.status, { error: error.message, ...error.body });
      if (error instanceof RenderError) {
        return sendJson(response, 422, {
          error: error.message,
          code: error.code,
          path: error.path,
        });
      }
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      port = (server.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}${prefix}`,
        port,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
