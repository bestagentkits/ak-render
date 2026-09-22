/**
 * Compile a Page Spec with the same package code the local CLI uses.
 *
 * The cloud renderer is a transport, not a second implementation: it calls the
 * published compiler, so cloud output and local output are identical for the
 * same spec, version, and options. The parity test asserts exactly that.
 *
 * A render response is never stored. Only an explicit share or export persists
 * anything, and the caller must hold the matching scope for that.
 */

import { compile, isRenderError, VERSION } from '../../../src/index.js';
import type { Env } from './bindings.js';
import { checkNodes, checkOutputBytes, type BudgetViolation } from './config.js';

export interface RenderPayload {
  /** A Page Spec as an object (JSON) or a string (YAML or JSON text). */
  spec: unknown;
  theme?: unknown;
  themeToggle?: boolean;
}

export interface RenderedArtifact {
  html: string;
  bytes: number;
  hash: string;
  nodes: number;
  version: string;
}

export type RenderOutcome =
  | { ok: true; artifact: RenderedArtifact }
  | { ok: false; status: 400 | 413; code: string; message: string; details?: unknown }
  | { ok: false; status: 422; code: string; message: string; details?: unknown };

export function renderArtifact(payload: RenderPayload, _env: Env): RenderOutcome {
  if (payload.spec === undefined || payload.spec === null) {
    return { ok: false, status: 400, code: 'MISSING_SPEC', message: 'a Page Spec is required' };
  }
  let result: ReturnType<typeof compile>;
  try {
    result = compile(payload.spec, {
      ...(payload.theme === undefined ? {} : { theme: payload.theme }),
      ...(payload.themeToggle === undefined ? {} : { themeToggle: payload.themeToggle }),
      source: 'cloud',
    });
  } catch (error) {
    if (isRenderError(error)) {
      return {
        ok: false,
        status: 422,
        code: error.code,
        message: error.message,
        details: error.path,
      };
    }
    return {
      ok: false,
      status: 422,
      code: 'RENDER_FAILED',
      message: 'the spec could not be compiled',
    };
  }

  const violations: BudgetViolation[] = [];
  const output = checkOutputBytes(result.bytes);
  if (output !== undefined) violations.push(output);
  const nodes = checkNodes(result.ir.nodes.length);
  if (nodes !== undefined) violations.push(nodes);
  if (violations.length > 0) {
    const first = violations[0];
    return {
      ok: false,
      status: 413,
      code: 'BUDGET_EXCEEDED',
      message: `the artifact exceeds the ${first?.budget ?? 'output'} budget`,
      details: violations,
    };
  }

  return {
    ok: true,
    artifact: {
      html: result.html,
      bytes: result.bytes,
      hash: result.hash,
      nodes: result.ir.nodes.length,
      version: VERSION,
    },
  };
}
