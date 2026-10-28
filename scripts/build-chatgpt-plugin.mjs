#!/usr/bin/env node
/**
 * The ChatGPT Plugins Directory package: a ZIP whose `mcp.json` points at the
 * hosted remote MCP server, so a ChatGPT user needs no Node or npm.
 *
 *   node scripts/build-chatgpt-plugin.mjs           check, then write the ZIP
 *   node scripts/build-chatgpt-plugin.mjs --check   check only
 *
 * The package source is `packaging/chatgpt/`. The root `plugin.json` and
 * `mcp.json` stay the local Codex package that runs `npx … mcp` over stdio;
 * both formats fix those file names at the package root, so the remote package
 * needs its own folder rather than a second entry beside the local one.
 *
 * The check covers what the OpenAI upload validates and what its review needs:
 * the Agent Plugins 1.0.0 schemas (vendored under `schema/agent-plugins/`),
 * the listing limits, one Streamable HTTP server over HTTPS with OAuth and no
 * headers, five positive and three negative review cases, and square PNG icons.
 * Icons are read from the repository's `assets/` (`assetRoot`): the manifest's
 * `./assets/…` paths name where they sit inside the ZIP, so the package folder
 * itself holds only the two manifests.
 * The ZIP is deterministic: fixed entry order and timestamps, and entries are
 * stored uncompressed, so the same sources give the same bytes and hash on any
 * Node or zlib build. It is written to `.tmp/chatgpt-plugin/`, outside the npm
 * package's `files`.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
export const PACKAGE_DIR = join(repoRoot, 'packaging/chatgpt');

/** Public-submission limits from the OpenAI plugin package field reference. */
const LIMITS = {
  displayName: 30,
  shortDescription: 30,
  longDescription: 4000,
  developerName: 80,
  url: 1024,
  prompts: 3,
  prompt: 128,
  capabilities: 20,
  capability: 120,
  iconBytes: 5 * 1024 * 1024,
  iconMin: 48,
  iconMax: 4096,
  positiveCases: 5,
  negativeCases: 3,
};

const LISTING_URLS = ['websiteURL', 'supportURL', 'privacyPolicyURL', 'termsOfServiceURL'];
const OAUTH_CLIENT_MODES = ['provided', 'dcr', 'cimd'];

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

function schemaValidator(name) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  return ajv.compile(readJson(join(repoRoot, 'schema/agent-plugins/1.0.0', name)));
}

/**
 * The width and height of a PNG, or undefined when the bytes are not a PNG.
 * The IHDR chunk always comes first, right after the 8-byte signature.
 */
export function pngSize(bytes) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || signature.some((byte, index) => bytes[index] !== byte)) return;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function isHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

/** The package-relative paths of the images the listing references. */
export function referencedAssets(plugin) {
  const ui = plugin.extensions?.['com.openai']?.interface ?? {};
  return ['composerIcon', 'composerIconDark', 'logo', 'logoDark']
    .map((key) => ui[key])
    .concat(ui.screenshots ?? [])
    .filter((path) => typeof path === 'string');
}

/** Every problem with the package in `dir`; an empty list means it is ready to upload. */
export function checkPackage({ dir = PACKAGE_DIR, assetRoot = repoRoot, version } = {}) {
  const problems = [];
  const fail = (message) => problems.push(message);
  const plugin = readJson(join(dir, 'plugin.json'));
  const mcp = readJson(join(dir, 'mcp.json'));

  const validPlugin = schemaValidator('plugin.schema.json');
  if (!validPlugin(plugin)) {
    for (const error of validPlugin.errors)
      fail(`plugin.json${error.instancePath} ${error.message}`);
  }
  // OpenAI reads each server's auth from `extensions["com.openai"]`, a key
  // the portable 1.0.0 schema does not list yet; check the rest against it.
  const portableMcp = {
    ...mcp,
    mcpServers: Object.fromEntries(
      Object.entries(mcp.mcpServers ?? {}).map(([name, { extensions, ...server }]) => [
        name,
        server,
      ]),
    ),
  };
  const validMcp = schemaValidator('mcp.schema.json');
  if (!validMcp(portableMcp)) {
    for (const error of validMcp.errors) fail(`mcp.json${error.instancePath} ${error.message}`);
  }

  if (version !== undefined && plugin.version !== version) {
    fail(`plugin.json version ${plugin.version} is not the package version ${version}`);
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(plugin.name ?? '')) {
    fail('plugin.json name must be lowercase letters, numbers and single hyphens');
  }

  const openai = plugin.extensions?.['com.openai'] ?? {};
  for (const key of ['apps', 'hooks']) {
    if (openai[key] !== undefined) fail(`extensions.com.openai.${key} cannot be submitted`);
  }

  const ui = openai.interface ?? {};
  for (const key of [
    'displayName',
    'shortDescription',
    'longDescription',
    'developerName',
    'category',
  ]) {
    if (typeof ui[key] !== 'string' || ui[key].trim() === '') {
      fail(`interface.${key} is required`);
    } else if (LIMITS[key] !== undefined && ui[key].length > LIMITS[key]) {
      fail(`interface.${key} is ${ui[key].length} characters; the limit is ${LIMITS[key]}`);
    }
  }
  for (const key of LISTING_URLS) {
    if (!isHttpsUrl(ui[key]) || ui[key].length > LIMITS.url) {
      fail(`interface.${key} must be an HTTPS URL of at most ${LIMITS.url} characters`);
    }
  }
  const prompts = ui.defaultPrompt ?? [];
  if (
    prompts.length > LIMITS.prompts ||
    new Set(prompts).size !== prompts.length ||
    prompts.some(
      (prompt) =>
        typeof prompt !== 'string' || prompt.length > LIMITS.prompt || prompt.includes('@'),
    )
  ) {
    fail(`interface.defaultPrompt takes up to ${LIMITS.prompts} unique prompts without @mentions`);
  }
  const capabilities = ui.capabilities ?? [];
  if (
    capabilities.length > LIMITS.capabilities ||
    capabilities.some((label) => typeof label !== 'string' || label.length > LIMITS.capability)
  ) {
    fail(`interface.capabilities takes up to ${LIMITS.capabilities} short labels`);
  }
  if (ui.brandColor !== undefined && !/^#[0-9A-Fa-f]{6}$/u.test(ui.brandColor)) {
    fail('interface.brandColor must be #RRGGBB');
  }
  if (typeof ui.logo !== 'string') fail('interface.logo is required for submission');

  for (const path of referencedAssets(plugin)) {
    if (!/^\.\/assets\/[^/]+\.png$/u.test(path)) {
      fail(`${path} must be a PNG under ./assets/`);
      continue;
    }
    let bytes;
    try {
      bytes = readFileSync(join(assetRoot, path));
    } catch {
      fail(`${path} does not exist`);
      continue;
    }
    const size = pngSize(bytes);
    if (
      size === undefined ||
      size.width !== size.height ||
      size.width < LIMITS.iconMin ||
      size.width > LIMITS.iconMax ||
      bytes.length > LIMITS.iconBytes
    ) {
      fail(`${path} must be a square PNG of ${LIMITS.iconMin}–${LIMITS.iconMax} px under 5 MiB`);
    }
  }

  const servers = Object.entries(mcp.mcpServers ?? {});
  if (servers.length !== 1) fail('mcp.json must declare exactly one MCP server');
  for (const [name, server] of servers) {
    if (server.type !== 'streamable-http' || !isHttpsUrl(server.url)) {
      fail(`mcp.json server ${name} must be streamable-http over HTTPS`);
    }
    if (Object.keys(server.headers ?? {}).length > 0) {
      fail(`mcp.json server ${name} must not send headers; public submission rejects them`);
    }
    const auth = server.extensions?.['com.openai']?.auth;
    if (auth?.type !== 'oauth') {
      fail(`mcp.json server ${name} must declare OAuth; the server refuses requests without it`);
    } else if (auth.client !== undefined) {
      const { mode, clientId, clientSecret } = auth.client;
      if (!OAUTH_CLIENT_MODES.includes(mode))
        fail(`auth.client.mode must be one of ${OAUTH_CLIENT_MODES}`);
      if (clientSecret !== undefined) fail('auth.client.clientSecret must never be in the package');
      if (mode !== 'provided' && clientId !== undefined) {
        fail('auth.client.clientId belongs only to a provided client');
      }
    }
  }

  const cases = openai.review?.test_cases ?? {};
  const positive = cases.positive ?? [];
  const negative = cases.negative ?? [];
  if (positive.length !== LIMITS.positiveCases || negative.length !== LIMITS.negativeCases) {
    fail(
      `review needs exactly ${LIMITS.positiveCases} positive and ${LIMITS.negativeCases} negative test cases`,
    );
  }
  for (const [index, testCase] of positive.entries()) {
    for (const key of ['description', 'prompt', 'tools_triggered', 'expected_behavior']) {
      if (typeof testCase[key] !== 'string' || testCase[key].trim() === '') {
        fail(`review positive case ${index + 1} needs ${key}`);
      }
    }
  }
  for (const [index, testCase] of negative.entries()) {
    for (const key of ['description', 'prompt']) {
      if (typeof testCase[key] !== 'string' || testCase[key].trim() === '') {
        fail(`review negative case ${index + 1} needs ${key}`);
      }
    }
  }
  for (const key of ['test_credentials', 'reviewer_instructions']) {
    if (openai.review?.[key] !== undefined) fail(`review.${key} must stay out of the package`);
  }
  return problems;
}

/** The tool names the positive review cases expect, for a check against the server. */
export function reviewedToolNames({ dir = PACKAGE_DIR } = {}) {
  const plugin = readJson(join(dir, 'plugin.json'));
  const positive = plugin.extensions?.['com.openai']?.review?.test_cases?.positive ?? [];
  return [
    ...new Set(
      positive.flatMap(({ tools_triggered }) =>
        typeof tools_triggered === 'string' ? tools_triggered.split(/\s*,\s*/u) : [],
      ),
    ),
  ];
}

/** ZIP entries in a fixed order: the two manifests, then the listed assets. */
export function packageEntries({ dir = PACKAGE_DIR, assetRoot = repoRoot } = {}) {
  const plugin = readJson(join(dir, 'plugin.json'));
  return [
    { name: 'plugin.json', data: readFileSync(join(dir, 'plugin.json')) },
    { name: 'mcp.json', data: readFileSync(join(dir, 'mcp.json')) },
    ...[...new Set(referencedAssets(plugin))].sort().map((path) => ({
      name: path.slice(2),
      data: readFileSync(join(assetRoot, path)),
    })),
  ];
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** 1980-01-01 00:00 in DOS time: a fixed stamp keeps the archive deterministic. */
const DOS_DATE = (1 << 5) | 1;

/** A stored (uncompressed) ZIP of `entries`, byte-identical for identical input. */
export function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(10, 4); // version needed: stored
    header.writeUInt16LE(0x0800, 6); // UTF-8 names
    header.writeUInt16LE(0, 8); // stored
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(DOS_DATE, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    header.writeUInt16LE(0, 28);
    locals.push(header, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4); // made by: Unix, 2.0
    central.writeUInt16LE(10, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // -rw-r--r--
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += header.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { version } = readJson(join(repoRoot, 'package.json'));
  const problems = checkPackage({ version });
  if (problems.length > 0) {
    for (const problem of problems) console.error(`FAIL  ${problem}`);
    console.error(`ChatGPT plugin package: ${problems.length} problem(s)`);
    process.exit(1);
  }
  console.log('ChatGPT plugin package: ok');
  if (!process.argv.includes('--check')) {
    const archive = zip(packageEntries());
    const outDir = join(repoRoot, '.tmp/chatgpt-plugin');
    const out = join(outDir, `ak-render-chatgpt-${version}.zip`);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(out, archive);
    const sha256 = createHash('sha256').update(archive).digest('hex');
    console.log(`${relative(repoRoot, out)} ${archive.length} bytes sha256:${sha256}`);
  }
}
