#!/usr/bin/env node
/**
 * Live smoke test for a deployed cloud renderer: remote MCP plus REST.
 *
 *   BASE_URL=https://render.agentkit.best node scripts/cloud-smoke.mjs
 *   BASE_URL=... TOKEN=<agentkit bearer> node scripts/cloud-smoke.mjs
 *   BASE_URL=... TOKEN=... EXPECT_EXPORT=1 node scripts/cloud-smoke.mjs
 *
 * Without TOKEN only the unauthenticated surface is checked: MCP initialize,
 * tools/list and catalog, and that render is refused without a bearer. With
 * TOKEN it also renders through MCP and REST, checks the artifact is the same
 * HTML from both, and runs a share through create, read, revoke and gone.
 * Screenshot and PDF are checked when the deployment answers them; a 501
 * (no Browser Run binding) is reported, and fails only with EXPECT_EXPORT=1.
 *
 * The token is sent only as an Authorization header to BASE_URL and is never
 * printed. Every share this script creates is revoked before it exits.
 */

const BASE_URL = (process.env.BASE_URL ?? 'https://render.agentkit.best').replace(/\/+$/u, '');
const TOKEN = process.env.TOKEN ?? '';
const EXPECT_EXPORT = process.env.EXPECT_EXPORT === '1';

const SPEC = {
  version: 1,
  meta: { title: 'Cloud smoke' },
  blocks: [
    { type: 'hero', title: 'Cloud smoke' },
    { type: 'stats', items: [{ label: 'Checks', value: '1' }] },
  ],
};

const failures = [];
const createdShares = [];

function check(condition, label, detail = '') {
  if (condition) {
    console.log(`ok    ${label}`);
  } else {
    console.log(`FAIL  ${label}${detail === '' ? '' : `: ${detail}`}`);
    failures.push(label);
  }
  return condition;
}

function notice(message) {
  console.log(`note  ${message}`);
}

const auth = (withToken) => (withToken && TOKEN !== '' ? { authorization: `Bearer ${TOKEN}` } : {});

let rpcId = 0;

/** POST one JSON-RPC message to /mcp and return { status, body }. */
async function mcp(method, params, withToken = false) {
  rpcId += 1;
  const response = await fetch(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-11-25',
      ...auth(withToken),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      ...(method.startsWith('notifications/') ? {} : { id: rpcId }),
      method,
      ...(params === undefined ? {} : { params }),
    }),
  });
  const text = await response.text();
  let body;
  try {
    body = text === '' ? undefined : JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  return { status: response.status, body };
}

/** Call one tool and parse its text content as JSON when it is JSON. */
async function callTool(name, args, withToken = false) {
  const { status, body } = await mcp('tools/call', { name, arguments: args }, withToken);
  const result = body?.result;
  const raw = result?.content?.[0]?.text ?? '';
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = { text: raw };
  }
  return { status, isError: result?.isError === true, payload, error: body?.error };
}

function isHtmlDocument(html) {
  return /^<!doctype html>/iu.test(html.trimStart()) && html.trimEnd().endsWith('</html>');
}

async function rest(method, path, body, withToken = true) {
  return fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...auth(withToken),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function unauthenticatedSurface() {
  const init = await mcp('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'ak-render-cloud-smoke', version: '1' },
  });
  check(
    init.status === 200 && typeof init.body?.result?.protocolVersion === 'string',
    'mcp initialize',
    `status ${init.status}`,
  );
  const initialized = await mcp('notifications/initialized');
  check(
    initialized.status === 202,
    'mcp notification accepted with 202',
    `status ${initialized.status}`,
  );

  const listed = await mcp('tools/list', {});
  const names = (listed.body?.result?.tools ?? []).map((tool) => tool.name);
  check(
    ['catalog', 'describe', 'validate', 'render', 'themes'].every((name) => names.includes(name)),
    'mcp tools/list',
    names.join(','),
  );

  const catalog = await callTool('catalog', {});
  check(!catalog.isError && catalog.payload.blockCount > 0, 'mcp catalog without a bearer');

  const render = await callTool('render', { spec: SPEC });
  check(
    render.isError && render.payload.code === 'UNAUTHENTICATED',
    'mcp render refused without a bearer',
    JSON.stringify(render.payload),
  );

  const restRender = await rest('POST', '/v1/render', { spec: SPEC }, false);
  check(
    restRender.status === 401,
    'rest render refused without a bearer',
    `status ${restRender.status}`,
  );

  const unknownShare = await rest(
    'GET',
    '/v1/share/11111111-2222-3333-4444-555555555555',
    undefined,
    false,
  );
  check(unknownShare.status === 404, 'unknown share answers 404', `status ${unknownShare.status}`);

  const get = await fetch(`${BASE_URL}/mcp`);
  check(get.status === 405, 'GET /mcp answers 405', `status ${get.status}`);
}

async function authenticatedSurface() {
  const validate = await callTool('validate', { spec: SPEC }, true);
  check(
    !validate.isError && validate.payload.ok === true,
    'mcp validate',
    JSON.stringify(validate.payload),
  );

  const render = await callTool('render', { spec: SPEC }, true);
  if (
    !check(
      !render.isError && typeof render.payload.artifactUrl === 'string',
      'mcp render',
      JSON.stringify(render.payload),
    )
  ) {
    return;
  }
  check(
    !JSON.stringify(render.payload).includes('<html'),
    'mcp render keeps HTML out of the reply',
  );
  const artifact = await fetch(render.payload.artifactUrl);
  const artifactHtml = await artifact.text();
  check(
    artifact.status === 200 && isHtmlDocument(artifactHtml),
    'mcp artifact is an HTML document',
    `status ${artifact.status}`,
  );
  check(
    new TextEncoder().encode(artifactHtml).length === render.payload.bytes,
    'mcp artifact byte count matches the summary',
  );

  const restRender = await rest('POST', '/v1/render', { spec: SPEC });
  const restHtml = await restRender.text();
  check(
    restRender.status === 200 && isHtmlDocument(restHtml),
    'rest render',
    `status ${restRender.status}`,
  );
  check(restHtml === artifactHtml, 'mcp and rest render return identical bytes');

  // Share lifecycle over REST: create, read, revoke, gone.
  const created = await rest('POST', '/v1/share', { spec: SPEC });
  const share = created.status === 201 ? await created.json() : undefined;
  if (
    check(
      share !== undefined && typeof share.id === 'string',
      'share created',
      `status ${created.status}`,
    )
  ) {
    createdShares.push(share.id);
    const read = await rest('GET', `/v1/share/${share.id}`, undefined, false);
    check(
      read.status === 200 && isHtmlDocument(await read.text()),
      'share readable without a bearer',
    );
    const revoked = await rest('DELETE', `/v1/share/${share.id}`);
    check(revoked.status === 200, 'share revoked by its owner', `status ${revoked.status}`);
    if (revoked.status === 200) createdShares.splice(createdShares.indexOf(share.id), 1);
    const gone = await rest('GET', `/v1/share/${share.id}`, undefined, false);
    check(gone.status === 404, 'revoked share no longer resolves', `status ${gone.status}`);
  }

  // Share through MCP, then clean it up.
  const shared = await callTool('render', { spec: SPEC, share: true }, true);
  if (
    check(
      !shared.isError && shared.payload.shared === true,
      'mcp render with share',
      JSON.stringify(shared.payload),
    )
  ) {
    const id = String(shared.payload.artifactUrl).split('/').pop();
    createdShares.push(id);
  }

  await exportSurface('screenshot', 'image/png', (bytes) => bytes[0] === 0x89 && bytes[1] === 0x50);
  await exportSurface(
    'pdf',
    'application/pdf',
    (bytes) => new TextDecoder().decode(bytes.slice(0, 4)) === '%PDF',
  );
}

async function exportSurface(route, contentType, looksRight) {
  const response = await rest('POST', `/v1/${route}`, { spec: SPEC });
  if (response.status === 501 && !EXPECT_EXPORT) {
    notice(`${route}: 501 EXPORT_UNAVAILABLE (no Browser Run binding); skipped`);
    return;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  check(
    response.status === 200 &&
      (response.headers.get('content-type') ?? '').startsWith(contentType) &&
      looksRight(bytes),
    `${route} export`,
    `status ${response.status}`,
  );
}

async function cleanup() {
  for (const id of createdShares) {
    const response = await rest('DELETE', `/v1/share/${id}`);
    if (response.status !== 200) notice(`could not revoke share ${id}: status ${response.status}`);
  }
}

console.log(`cloud smoke against ${BASE_URL}`);
try {
  await unauthenticatedSurface();
  if (TOKEN === '') {
    notice('TOKEN is not set; authenticated render, share and export checks skipped');
  } else {
    await authenticatedSurface();
  }
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
  console.log(`FAIL  ${failures.at(-1)}`);
} finally {
  if (TOKEN !== '') await cleanup();
}

if (failures.length > 0) {
  console.error(`cloud smoke FAILED: ${failures.length} check(s)`);
  process.exit(1);
}
console.log('cloud smoke passed');
