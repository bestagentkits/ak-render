#!/usr/bin/env node
/**
 * The ChatGPT Plugins Directory review cases, run against a deployed remote MCP.
 *
 *   node scripts/chatgpt-review-cases.mjs
 *   TOKEN=<reviewer bearer> node scripts/chatgpt-review-cases.mjs --json evidence.json
 *
 * Exactly five positive and three negative cases, the same ones the reviewer
 * packet in docs/chatgpt-review/README.md lists with their prompts. Each case
 * calls the production tools a ChatGPT session would call and checks what the
 * reviewer would see: real downloadable HTML, a public share that stops
 * resolving once revoked, and truthful errors. The positive cases and the
 * invalid-spec case need TOKEN (every tool past discovery requires a bearer);
 * without it they are reported as skipped and only the unauthenticated
 * boundary checks run.
 *
 * The token is sent only as an Authorization header to BASE_URL and is never
 * printed or written to the evidence file. Every share a case creates is
 * revoked before the script exits.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC_DIR = join(ROOT, 'docs', 'chatgpt-review', 'specs');

/** The synthetic reviewer specs, read as the YAML text a ChatGPT session sends. */
export function reviewSpec(name) {
  return readFileSync(join(SPEC_DIR, `${name}.yaml`), 'utf8');
}

export const INVALID_SPEC = `version: 1
meta:
  title: Broken reviewer spec
blocks:
  - type: hero
  - type: not-a-block
    title: Unknown block type
`;

/**
 * The review cases. `prompt` is what the reviewer types into ChatGPT, `tools`
 * the tool names that turn should call, and `expected` the observable result.
 */
export const CASES = [
  {
    id: 'P1',
    kind: 'positive',
    title: 'Report page renders to downloadable HTML',
    prompt: 'Use AK Render to turn this quarterly status report into an HTML page: <report.yaml>.',
    tools: ['validate', 'render'],
    expected:
      'validate answers ok with no diagnostics; render returns an artifactUrl and expiresAt about one hour out; the URL serves a complete HTML document.',
  },
  {
    id: 'P2',
    kind: 'positive',
    title: 'Dashboard with KPIs, chart and table',
    prompt: 'Make a service health dashboard from these metrics with AK Render: <dashboard.yaml>.',
    tools: ['render'],
    expected:
      'render reports the chart, kpi and data-table features with no warnings; the artifact serves HTML.',
  },
  {
    id: 'P3',
    kind: 'positive',
    title: 'Shared comparison link',
    prompt:
      'Render this hosting comparison with AK Render and give me a link I can share: <comparison.yaml>.',
    tools: ['render'],
    expected:
      'render with share: true answers shared: true and a /v1/share/ URL about 30 days out; the URL opens without signing in.',
  },
  {
    id: 'P4',
    kind: 'positive',
    title: 'Start from a recipe',
    prompt: 'Show me an AK Render starter for an incident report and check that it is valid.',
    tools: ['recipe', 'validate'],
    expected: 'recipe returns a YAML starter spec; validate answers ok.',
  },
  {
    id: 'P5',
    kind: 'positive',
    title: 'Edit by block id, then re-render',
    prompt:
      'Change the report title to "Northwind Q3 status report (revised)" and render it again.',
    tools: ['patch', 'render'],
    expected:
      'patch applies one replace at /blocks/@report-hero/title with no errors; the re-render has a different hash from P1.',
  },
  {
    id: 'N1',
    kind: 'negative',
    title: 'Invalid spec is refused with a fixable diagnostic',
    prompt:
      'Render this page with AK Render: <spec with a hero missing its title and an unknown block>.',
    tools: ['validate', 'render'],
    expected:
      'validate answers ok: false with SPEC_UNKNOWN_BLOCK at $.blocks[1].type; render answers isError with a code and path and stores nothing.',
  },
  {
    id: 'N2',
    kind: 'negative',
    title: 'Unauthorized request is challenged',
    prompt: 'Call render before connecting, or after the connection was revoked.',
    tools: ['render'],
    expected:
      'HTTP 401 with a Bearer challenge naming the protected-resource metadata; a rejected bearer adds error="invalid_token".',
  },
  {
    id: 'N3',
    kind: 'negative',
    title: 'Private, revoked and unknown artifacts do not leak',
    prompt: 'Open an AK Render link that was never issued, or one that was revoked.',
    tools: [],
    expected:
      'an unknown artifact id answers 404 NOT_FOUND; revoking a share without a bearer answers 401; a revoked share answers 404. An expired artifact answers 410 EXPIRED (covered by tests/unit/cloud-remote-mcp.test.ts).',
  },
];

const BASE_URL = (process.env.BASE_URL ?? 'https://render.agentkit.best').replace(/\/+$/u, '');
const TOKEN = process.env.TOKEN ?? '';

const auth = (withToken) => (withToken && TOKEN !== '' ? { authorization: `Bearer ${TOKEN}` } : {});

let rpcId = 0;

/** Call one tool over MCP; parse its text content as JSON when it is JSON. */
async function callTool(name, args, withToken = true, bearer) {
  rpcId += 1;
  const response = await fetch(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-11-25',
      ...(bearer === undefined ? auth(withToken) : { authorization: `Bearer ${bearer}` }),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: rpcId,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  const raw = body?.result?.content?.[0]?.text ?? '';
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = { text: raw };
  }
  return {
    status: response.status,
    challenge: response.headers.get('www-authenticate') ?? '',
    isError: body?.result?.isError === true,
    payload,
    error: body?.error,
  };
}

async function fetchPage(url) {
  const response = await fetch(url);
  const html = await response.text();
  return {
    status: response.status,
    html,
    bytes: new TextEncoder().encode(html).byteLength,
    isHtml: /^<!doctype html>/iu.test(html.trimStart()) && html.trimEnd().endsWith('</html>'),
  };
}

/** One case's checks: each records a label, whether it held, and what was seen. */
function recorder() {
  const checks = [];
  return {
    checks,
    check(condition, label, observed) {
      checks.push({ ok: Boolean(condition), label, observed });
      return Boolean(condition);
    },
  };
}

const createdShares = [];

const RUNNERS = {
  async P1({ check }, state) {
    const spec = reviewSpec('report');
    const validated = await callTool('validate', { spec });
    check(
      validated.payload.ok === true && validated.payload.diagnostics?.length === 0,
      'validate ok',
      { status: validated.status, ok: validated.payload.ok },
    );
    const rendered = await callTool('render', { spec });
    const url = String(rendered.payload.artifactUrl ?? '');
    check(
      !rendered.isError && /\/v1\/artifact\/[0-9a-f-]{36}$/u.test(url),
      'render stores an artifact',
      {
        hash: rendered.payload.hash,
        expiresAt: rendered.payload.expiresAt,
      },
    );
    state.reportHash = rendered.payload.hash;
    const ttl = Date.parse(rendered.payload.expiresAt ?? '') - Date.now();
    check(ttl > 50 * 60_000 && ttl <= 61 * 60_000, 'artifact expires in about one hour', { ttl });
    const page = await fetchPage(url);
    check(page.status === 200 && page.isHtml, 'artifact serves a complete HTML document', {
      status: page.status,
      bytes: page.bytes,
    });
  },

  async P2({ check }) {
    const rendered = await callTool('render', { spec: reviewSpec('dashboard') });
    const features = rendered.payload.features ?? [];
    check(
      !rendered.isError &&
        ['chart', 'kpi', 'data-table'].every((feature) => features.includes(feature)) &&
        rendered.payload.warnings?.length === 0,
      'render reports chart, kpi and data-table with no warnings',
      { features, warnings: rendered.payload.warnings },
    );
    const page = await fetchPage(String(rendered.payload.artifactUrl ?? ''));
    check(page.status === 200 && page.isHtml, 'artifact serves HTML', {
      status: page.status,
      bytes: page.bytes,
    });
  },

  async P3({ check }, state) {
    const rendered = await callTool('render', { spec: reviewSpec('comparison'), share: true });
    const url = String(rendered.payload.artifactUrl ?? '');
    const id = url.match(/\/v1\/share\/([0-9a-f-]{36})$/u)?.[1];
    if (id !== undefined) createdShares.push(id);
    state.shareId = id;
    check(
      !rendered.isError && rendered.payload.shared === true && id !== undefined,
      'render shares',
      {
        shared: rendered.payload.shared,
        expiresAt: rendered.payload.expiresAt,
      },
    );
    const days = (Date.parse(rendered.payload.expiresAt ?? '') - Date.now()) / 86_400_000;
    check(days > 29 && days <= 30.1, 'share expires in about 30 days', { days });
    const page = await fetchPage(url);
    check(page.status === 200 && page.isHtml, 'share opens without a bearer', {
      status: page.status,
      bytes: page.bytes,
    });
  },

  async P4({ check }) {
    const recipe = await callTool('recipe', { name: 'incident-report' });
    const yaml = String(recipe.payload.text ?? '');
    check(!recipe.isError && yaml.startsWith('version: 1'), 'recipe returns a YAML starter', {
      lines: yaml.split('\n').length,
    });
    const validated = await callTool('validate', { spec: yaml });
    check(validated.payload.ok === true, 'the starter validates', { ok: validated.payload.ok });
  },

  async P5({ check }, state) {
    const patched = await callTool('patch', {
      spec: reviewSpec('report'),
      ops: [
        {
          op: 'replace',
          path: '/blocks/@report-hero/title',
          value: 'Northwind Q3 status report (revised)',
        },
      ],
    });
    check(
      patched.payload.ok === true &&
        patched.payload.applied === true &&
        patched.payload.errors === 0,
      'patch applies by block id',
      { changes: patched.payload.changes },
    );
    const rendered = await callTool('render', { spec: patched.payload.spec });
    check(
      !rendered.isError && rendered.payload.hash !== state.reportHash,
      're-render produces a new page',
      { hash: rendered.payload.hash, before: state.reportHash },
    );
  },

  async N1({ check }) {
    const validated = await callTool('validate', { spec: INVALID_SPEC });
    const unknown = (validated.payload.diagnostics ?? []).find(
      (diagnostic) => diagnostic.code === 'SPEC_UNKNOWN_BLOCK',
    );
    check(
      validated.payload.ok === false && unknown?.path === '$.blocks[1].type',
      'validate names the unknown block and its path',
      { codes: (validated.payload.diagnostics ?? []).map((diagnostic) => diagnostic.code) },
    );
    const rendered = await callTool('render', { spec: INVALID_SPEC });
    check(
      rendered.isError &&
        typeof rendered.payload.code === 'string' &&
        rendered.payload.artifactUrl === undefined,
      'render refuses with a code and stores nothing',
      { code: rendered.payload.code, path: rendered.payload.details },
    );
  },

  async N2({ check }) {
    const spec = reviewSpec('report');
    const anonymous = await callTool('render', { spec }, false);
    check(
      anonymous.status === 401 && /resource_metadata="[^"]+"/u.test(anonymous.challenge),
      'no bearer answers 401 with the protected-resource challenge',
      { status: anonymous.status, message: anonymous.error?.message },
    );
    const rejected = await callTool('render', { spec }, false, 'not-a-real-token');
    check(
      rejected.status === 401 && rejected.challenge.includes('error="invalid_token"'),
      'a rejected bearer answers 401 invalid_token',
      { status: rejected.status, message: rejected.error?.message },
    );
  },

  async N3({ check }, state) {
    const unknown = await fetch(`${BASE_URL}/v1/artifact/00000000-0000-4000-8000-000000000000`);
    check(unknown.status === 404, 'an unknown artifact answers 404', { status: unknown.status });
    const shareId = state.shareId ?? '11111111-2222-3333-4444-555555555555';
    const anonymousRevoke = await fetch(`${BASE_URL}/v1/share/${shareId}`, { method: 'DELETE' });
    check(anonymousRevoke.status === 401, 'revoking without a bearer answers 401', {
      status: anonymousRevoke.status,
    });
    if (state.shareId === undefined) return;
    const revoked = await fetch(`${BASE_URL}/v1/share/${shareId}`, {
      method: 'DELETE',
      headers: auth(true),
    });
    if (revoked.status === 200) createdShares.splice(createdShares.indexOf(shareId), 1);
    const gone = await fetch(`${BASE_URL}/v1/share/${shareId}`);
    check(revoked.status === 200 && gone.status === 404, 'a revoked share answers 404', {
      revoke: revoked.status,
      read: gone.status,
    });
  },
};

/** Cases that cannot run without a bearer. */
const NEEDS_TOKEN = new Set(['P1', 'P2', 'P3', 'P4', 'P5', 'N1']);

async function main() {
  const jsonAt = process.argv.indexOf('--json');
  const jsonPath = jsonAt === -1 ? undefined : process.argv[jsonAt + 1];
  const version = await (await fetch(`${BASE_URL}/v1/version`)).json().catch(() => ({}));
  console.log(
    `target ${BASE_URL} ${version.name ?? '?'}@${version.version ?? '?'} build ${version.build ?? '?'}`,
  );

  const state = {};
  const results = [];
  for (const testCase of CASES) {
    if (NEEDS_TOKEN.has(testCase.id) && TOKEN === '') {
      results.push({ id: testCase.id, kind: testCase.kind, status: 'skipped', checks: [] });
      console.log(`skip  ${testCase.id} ${testCase.title} (TOKEN is not set)`);
      continue;
    }
    const record = recorder();
    try {
      await RUNNERS[testCase.id](record, state);
    } catch (error) {
      record.check(false, 'case ran to completion', { error: String(error) });
    }
    const passed = record.checks.every((entry) => entry.ok);
    results.push({
      id: testCase.id,
      kind: testCase.kind,
      status: passed ? 'passed' : 'failed',
      checks: record.checks,
    });
    console.log(`${passed ? 'ok   ' : 'FAIL '} ${testCase.id} ${testCase.title}`);
    for (const entry of record.checks) {
      console.log(
        `      ${entry.ok ? 'ok  ' : 'FAIL'} ${entry.label} ${JSON.stringify(entry.observed)}`,
      );
    }
  }

  for (const id of createdShares) {
    const response = await fetch(`${BASE_URL}/v1/share/${id}`, {
      method: 'DELETE',
      headers: auth(true),
    });
    if (response.status !== 200)
      console.log(`note  could not revoke share ${id}: status ${response.status}`);
  }

  const count = (kind, status) =>
    results.filter((result) => result.kind === kind && result.status === status).length;
  console.log(
    `positive: ${count('positive', 'passed')} passed, ${count('positive', 'failed')} failed, ${count('positive', 'skipped')} skipped; ` +
      `negative: ${count('negative', 'passed')} passed, ${count('negative', 'failed')} failed, ${count('negative', 'skipped')} skipped`,
  );
  if (jsonPath !== undefined) {
    writeFileSync(
      jsonPath,
      `${JSON.stringify(
        {
          target: BASE_URL,
          build: version.build,
          version: version.version,
          ranAt: new Date().toISOString(),
          results,
        },
        null,
        2,
      )}\n`,
    );
  }
  if (results.some((result) => result.status === 'failed')) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
