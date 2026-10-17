#!/usr/bin/env node
/**
 * `ak-render` command-line entry point.
 *
 * Help output is generated from the command table, so a command that is not
 * implemented cannot be advertised. Every command supports `--json` for
 * scripted and CI use, and never prompts.
 *
 * `ak-render <spec> [--out <file>]` is the documented primary surface; naming a
 * known command is optional.
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Diagnostic } from './diagnostics.js';
import { isRenderError, type RenderError } from './errors.js';
import {
  describeIcon,
  iconPackSummaries,
  isIconProblem,
  SEARCH_MAX_LIMIT,
  searchIcons,
} from './icons/icon-catalog.js';
import { ICON_PACK_IDS, isIconPack } from './icons/icon-packs.js';
import { serveMcp } from './mcp-server.js';
import {
  auditMotionHtml,
  auditMotionSpec,
  compareMotionAudits,
  MOTION_SEVERITIES,
  type MotionAuditReport,
  type MotionFinding,
  type MotionSeverity,
  motionAuditFails,
} from './motion/motion-audit.js';
import { describeMotion, motionCatalog, searchMotions } from './motion/motion-catalog.js';
import { startMotionStudio } from './motion/studio/studio-server.js';
import { type PageRecipe, recipe, recipes } from './recipes/index.js';
import { BLOCK_CATEGORIES } from './registry/block-module.js';
import { searchCatalog } from './registry/catalog-search.js';
import { type CompactBlockDescription, describeMany } from './registry/describe-many.js';
import { type Catalog, catalog, describe, formatCatalogJson } from './registry/registry.js';
import type { BlockDefinition } from './registry/roster.js';
import { compile } from './render/render.js';
import { parseSpec } from './spec/parse.js';
import { patchSpecFile } from './spec/patch-file.js';
import { repair } from './spec/repair.js';
import { validate } from './spec/validate.js';
import { buildThemeCatalog, type ThemeCatalog } from './theme/theme-catalog.js';
import { PACKAGE_NAME, VERSION } from './version.js';

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Reads the whole of standard input; used when the spec path is `-`. */
  stdin?: () => string;
}

const defaultIo: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  stdin: () => readFileSync(0, 'utf8'),
};

/** The spec path that means "read the spec from standard input". */
const STDIN_PATH = '-';

/** Source label for diagnostics: `<stdin>` rather than a misleading `-`. */
function sourceLabel(path: string): string {
  return path === STDIN_PATH ? '<stdin>' : path;
}

interface Flags {
  json: boolean;
  compact: boolean;
  suggest: boolean;
  category?: string;
  pack?: string;
  limit?: string;
  failOn?: string;
  baseline?: string;
  port?: string;
  baseHash?: string;
  dryRun: boolean;
  out?: string;
  theme?: string;
  themeFile?: string;
  themeDiscovery: boolean;
}

interface ParsedArgs {
  flags: Flags;
  positional: string[];
}

interface Command {
  summary: string;
  usage: string;
  run: (args: string[], io: CliIo, flags: Flags) => number;
}

function readSpecFile(path: string, io: CliIo): string | undefined {
  try {
    if (path === STDIN_PATH) {
      if (io.stdin === undefined) throw new Error('standard input is not available');
      return io.stdin();
    }
    return readFileSync(path, 'utf8');
  } catch (error) {
    io.stderr(
      `ak-render: cannot read ${sourceLabel(path)}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return undefined;
  }
}

function reportDiagnostics(
  io: CliIo,
  diagnostics: readonly { severity: string; path: string; nodeId?: string; message: string }[],
): void {
  for (const diagnostic of diagnostics) {
    const location = diagnostic.nodeId === undefined ? '' : ` [${diagnostic.nodeId}]`;
    io.stderr(`${diagnostic.severity}: ${diagnostic.path}${location}: ${diagnostic.message}\n`);
  }
}

/** Longest JSON value a fix line prints before eliding the rest. */
const FIX_VALUE_PREVIEW = 60;

/** One line per suggested fix, under the diagnostics they belong to. */
function reportFixes(io: CliIo, diagnostics: readonly Diagnostic[]): void {
  for (const diagnostic of diagnostics) {
    for (const fix of diagnostic.fixes ?? []) {
      const edit = fix.patch.find((operation) => operation.op !== 'test');
      if (edit === undefined) continue;
      let action: string;
      if (edit.op === 'move') {
        action = `rename ${edit.from} to ${edit.path}`;
      } else {
        const value = JSON.stringify(edit.value);
        const preview =
          value.length > FIX_VALUE_PREVIEW ? `${value.slice(0, FIX_VALUE_PREVIEW)}...` : value;
        action = `${edit.op} ${edit.path} with ${preview}`;
      }
      io.stderr(`  fix (${fix.classification}, ${fix.rule}) ${fix.path}: ${action}\n`);
    }
  }
}

function repairCommand(args: string[], io: CliIo, flags: Flags): number {
  const file = args[0];
  if (file === undefined) {
    io.stderr('ak-render: repair requires a spec path\n');
    return 2;
  }
  const input = readSpecFile(file, io);
  if (input === undefined) return 2;

  const result = repair(input, { source: sourceLabel(file), mode: 'safe' });
  const repaired = result.text ?? input;
  const parsed = result.spec !== undefined;
  if (flags.out !== undefined && parsed) {
    try {
      mkdirSync(dirname(resolve(flags.out)), { recursive: true });
      writeFileSync(flags.out, repaired, 'utf8');
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      io.stderr(`ak-render: cannot write ${flags.out}: ${reason}\n`);
      return 2;
    }
  }

  if (flags.json) {
    const { spec: _spec, text: _text, ...report } = result;
    io.stdout(
      `${JSON.stringify(
        {
          source: sourceLabel(file),
          out: flags.out ?? null,
          ...report,
          ...(flags.out === undefined && result.changed ? { text: repaired } : {}),
        },
        null,
        2,
      )}\n`,
    );
    return result.ok ? 0 : 1;
  }

  // The repaired spec is the artifact on stdout; the change log goes to stderr.
  if (flags.out === undefined && parsed) io.stdout(repaired);
  for (const change of result.changes) {
    io.stderr(`repaired: ${change.path}: ${change.rule}\n`);
  }
  const errors = result.diagnostics.filter((item) => item.severity === 'error');
  reportDiagnostics(io, errors);
  reportFixes(io, errors);
  const where = flags.out === undefined ? '' : ` to ${flags.out}`;
  io.stderr(
    `ak-render: ${result.changes.length} safe change(s)${parsed ? where : ''}, ${errors.length} error(s) left\n`,
  );
  return result.ok ? 0 : 1;
}

function compileCommand(args: string[], io: CliIo, flags: Flags): number {
  const file = args[0];
  if (file === undefined) {
    io.stderr('ak-render: a spec path is required\n');
    return 2;
  }
  const text = readSpecFile(file, io);
  if (text === undefined) return 2;

  try {
    const result = compile(text, {
      source: sourceLabel(file),
      themeCatalog: themeCatalogFor(flags, io),
      ...(flags.theme === undefined ? {} : { theme: flags.theme }),
    });

    if (flags.out !== undefined) {
      // A write failure is an environment problem, not a spec problem, so it
      // exits 2 like an unreadable input instead of 1 ("fix the spec").
      try {
        mkdirSync(dirname(resolve(flags.out)), { recursive: true });
        writeFileSync(flags.out, result.html, 'utf8');
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        io.stderr(`ak-render: cannot write ${flags.out}: ${reason}\n`);
        return 2;
      }
    } else {
      io.stdout(result.html);
      // Human-readable summary goes to stderr so stdout stays a clean artifact.
      if (!flags.json) {
        io.stderr(
          `ak-render: ${result.bytes} bytes, ${result.features.length} runtime features, hash ${result.hash}\n`,
        );
      }
    }

    if (flags.json) {
      io.stdout(
        `${JSON.stringify(
          {
            source: sourceLabel(file),
            out: flags.out ?? null,
            bytes: result.bytes,
            hash: result.hash,
            title: result.ir.meta.title,
            theme: result.theme.name,
            themeBase: result.theme.base,
            themeChain: result.theme.chain,
            features: result.features,
            nodes: result.ir.nodes.length,
            warnings: result.warnings,
          },
          null,
          2,
        )}\n`,
      );
    } else if (flags.out !== undefined) {
      io.stdout(
        `wrote ${result.bytes} bytes to ${flags.out} (${result.features.length} runtime features, hash ${result.hash})\n`,
      );
    }
    for (const warning of result.warnings) {
      io.stderr(`warning: ${warning.path}: ${warning.message}\n`);
    }
    return 0;
  } catch (error) {
    if (isRenderError(error)) {
      const renderError = error as RenderError;
      io.stderr(`ak-render: ${renderError.message} (${renderError.path ?? '$'})\n`);
      const diagnostics = renderError.details?.diagnostics;
      if (Array.isArray(diagnostics)) {
        reportDiagnostics(
          io,
          diagnostics as { severity: string; path: string; nodeId?: string; message: string }[],
        );
      }
      return 1;
    }
    throw error;
  }
}

/**
 * The catalog for reading: one section per category, in `BLOCK_CATEGORIES`
 * order, one `type — summary` line per block, then the action names.
 */
function catalogText(listing: Catalog): string {
  const lines = [`Page Spec v${listing.schemaVersion} — ${listing.blockCount} blocks`];
  for (const category of BLOCK_CATEGORIES) {
    const entries = listing.blocks.filter((entry) => entry.category === category);
    if (entries.length === 0) continue;
    lines.push('', `## ${category}`);
    for (const entry of entries) lines.push(`${entry.type} — ${entry.summary}`);
  }
  lines.push('', `Actions: ${listing.actions.map((action) => action.type).join(', ')}`);
  return lines.join('\n');
}

/** The full contract as text: the fields an author scans first. */
function contractText(contract: BlockDefinition): string {
  return `${contract.type} (${contract.kind}, v${contract.version})

purpose:  ${contract.purpose}
summary:  ${contract.summary}
props:    ${Object.keys(contract.props).join(', ') || '(none)'}
actions:  ${contract.actions.join(', ') || '(none)'}
features: ${contract.runtimeFeatures.join(', ') || '(none)'}
network:  ${contract.network}
sizes:    ${contract.sizing.sizes.join(', ')} (default: ${contract.sizing.default})
a11y:     ${contract.a11y}
`;
}

/** The compact contract as text: one line per prop, slot and parent. */
function compactContractText(contract: CompactBlockDescription): string {
  const lines = [
    `${contract.type} (${contract.kind}, ${contract.category}, v${contract.version}) — ${contract.summary}`,
    '  props:',
    ...contract.props.map((prop) => `    ${prop}`),
  ];
  if (contract.slots !== undefined) {
    lines.push('  slots:', ...contract.slots.map((slot) => `    ${slot}`));
  }
  if (contract.parents !== undefined) lines.push(`  parents: ${contract.parents.join(', ')}`);
  if (contract.data !== undefined) {
    const need = contract.data.required ? 'required' : 'optional';
    lines.push(`  data: ${need} — ${contract.data.description}`);
  }
  if (contract.actions !== undefined) lines.push(`  actions: ${contract.actions.join(', ')}`);
  if (contract.motion !== undefined) lines.push(`  motion: ${contract.motion.join(', ')}`);
  return `${lines.join('\n')}\n`;
}

function iconsCommand(args: string[], io: CliIo, flags: Flags): number {
  const [action, ...rest] = args;
  if (action === 'packs') {
    const packs = iconPackSummaries();
    if (flags.json) io.stdout(`${JSON.stringify(packs, null, 2)}\n`);
    else {
      for (const pack of packs) {
        io.stdout(`${pack.pack} (${pack.glyphs} icons, ${pack.license}) — ${pack.role}\n`);
        if (pack.attribution !== undefined) io.stdout(`  ${pack.attribution}\n`);
      }
    }
    return 0;
  }
  if (action === 'search') {
    if (rest.length === 0) {
      io.stderr('ak-render: icons search requires search terms\n');
      return 2;
    }
    if (flags.pack !== undefined && !isIconPack(flags.pack)) {
      io.stderr(`ak-render: --pack must be one of ${ICON_PACK_IDS.join(', ')}\n`);
      return 2;
    }
    const limit = flags.limit === undefined ? undefined : Number(flags.limit);
    if (
      limit !== undefined &&
      (!Number.isInteger(limit) || limit < 1 || limit > SEARCH_MAX_LIMIT)
    ) {
      io.stderr(`ak-render: --limit must be an integer from 1 to ${SEARCH_MAX_LIMIT}\n`);
      return 2;
    }
    const query = rest.join(' ');
    const hits = searchIcons(query, {
      ...(flags.pack === undefined || !isIconPack(flags.pack) ? {} : { pack: flags.pack }),
      ...(limit === undefined ? {} : { limit }),
    });
    if (flags.json) io.stdout(`${JSON.stringify(hits, null, 2)}\n`);
    else if (hits.length === 0) io.stdout(`no icons match "${query}"\n`);
    else for (const hit of hits) io.stdout(`${hit.icon}  [${hit.packs.join(', ')}]\n`);
    return 0;
  }
  if (action === 'describe') {
    const id = rest[0];
    if (id === undefined) {
      io.stderr('ak-render: icons describe requires an icon id\n');
      return 2;
    }
    const described = describeIcon(id);
    if (isIconProblem(described)) {
      io.stderr(`ak-render: ${described.message}\n`);
      const suggestions = (described.details as { suggestions?: string[] } | undefined)
        ?.suggestions;
      if (suggestions !== undefined && suggestions.length > 0) {
        io.stderr(`did you mean: ${suggestions.join(', ')}\n`);
      }
      return 1;
    }
    if (flags.json) io.stdout(`${JSON.stringify(described, null, 2)}\n`);
    else {
      io.stdout(`${described.icon} (${described.kind})\n`);
      for (const pack of described.packs) {
        io.stdout(
          `  ${pack.pack}: ${pack.glyph}  [${pack.variants.join(', ')}]  ${pack.license}\n`,
        );
      }
    }
    return 0;
  }
  io.stderr('ak-render: icons takes search, describe or packs\n');
  return 2;
}

function motionsCommand(args: string[], io: CliIo, flags: Flags): number {
  const [action, ...rest] = args;
  if (action === undefined) {
    const listing = motionCatalog();
    if (flags.json) {
      io.stdout(`${JSON.stringify(listing, null, 2)}\n`);
      return 0;
    }
    const width = Math.max(...listing.recipes.map((entry) => entry.id.length));
    for (const entry of listing.recipes) {
      const blocks = entry.blocks === '*' ? 'any block' : entry.blocks.join(', ');
      io.stdout(
        `${entry.id.padEnd(width)}  ${entry.triggers.join(', ')}${entry.script ? ' (adds script)' : ''} — ${entry.purpose}\n${' '.repeat(width + 2)}blocks: ${blocks}\n`,
      );
    }
    io.stdout(`\n${listing.usage}\n`);
    return 0;
  }
  if (action === 'search') {
    if (rest.length === 0) {
      io.stderr('ak-render: motions search requires search terms\n');
      return 2;
    }
    const query = rest.join(' ');
    const hits = searchMotions(query);
    if (flags.json) io.stdout(`${JSON.stringify(hits, null, 2)}\n`);
    else if (hits.length === 0) io.stdout(`no motion recipes match "${query}"\n`);
    else for (const hit of hits) io.stdout(`${hit.id} — ${hit.purpose}\n`);
    return 0;
  }
  if (action === 'describe') {
    if (rest.length === 0) {
      io.stderr('ak-render: motions describe requires a recipe id\n');
      return 2;
    }
    let described: ReturnType<typeof describeMotion>[];
    try {
      described = rest.map((id) => describeMotion(id, { compact: flags.compact }));
    } catch (error) {
      if (isRenderError(error)) {
        io.stderr(`ak-render: ${error.message}\n`);
        const suggestions = (error.details as { suggestions?: string[] } | undefined)?.suggestions;
        if (suggestions !== undefined && suggestions.length > 0) {
          io.stderr(`did you mean: ${suggestions.slice(0, 3).join(', ')}\n`);
        }
        return 1;
      }
      throw error;
    }
    if (flags.json) {
      io.stdout(`${JSON.stringify(rest.length === 1 ? described[0] : described, null, 2)}\n`);
      return 0;
    }
    io.stdout(described.map(motionDescriptionText).join('\n'));
    return 0;
  }
  io.stderr('ak-render: motions takes no argument, search <terms> or describe <id...>\n');
  return 2;
}

/** A recipe descriptor as text: one `field: value` line each, the example last. */
function motionDescriptionText(described: ReturnType<typeof describeMotion>): string {
  const lines = [`${described.id} — ${described.purpose}`];
  for (const [key, value] of Object.entries(described)) {
    if (key === 'id' || key === 'purpose' || key === 'example') continue;
    const text = Array.isArray(value)
      ? value.join(', ')
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
    lines.push(`  ${key}: ${text}`);
  }
  lines.push(`  example: ${JSON.stringify(described.example)}`);
  return `${lines.join('\n')}\n`;
}

const HTML_INPUT = /\.html?$/iu;

/** A piped page may open with a BOM or comments before its doctype. */
function looksLikeHtml(text: string): boolean {
  const start = text.replace(/^\uFEFF/u, '').replace(/^(?:\s*<!--[\s\S]*?-->)*\s*/u, '');
  // A YAML or JSON spec never starts with a tag, so any leading tag is a page
  // or a fragment of one.
  return /^<[!a-z]/iu.test(start);
}

function isMotionSeverity(value: string): value is MotionSeverity | 'none' {
  return value === 'none' || (MOTION_SEVERITIES as readonly string[]).includes(value);
}

function findingText(finding: MotionFinding): string {
  const where = finding.nodeId === undefined ? finding.path : `${finding.path} [${finding.nodeId}]`;
  const evidence = finding.evidence === undefined ? '' : `\n    evidence: ${finding.evidence}`;
  return `${finding.severity} ${finding.rule}: ${where}: ${finding.message}${evidence}\n    fix: ${finding.fix}\n`;
}

function motionCommand(args: string[], io: CliIo, flags: Flags): number {
  const [action, file, ...extra] = args;
  if (action === 'studio' && file !== undefined && extra.length === 0) {
    return motionStudioCommand(file, io, flags);
  }
  if (action !== 'audit' || file === undefined || extra.length > 0) {
    io.stderr(`ak-render: usage: ${COMMANDS.motion?.usage ?? 'ak-render motion audit <spec>'}\n`);
    return 2;
  }
  const failOn = flags.failOn ?? 'error';
  if (!isMotionSeverity(failOn)) {
    io.stderr(`ak-render: --fail-on must be one of ${[...MOTION_SEVERITIES, 'none'].join(', ')}\n`);
    return 2;
  }
  const text = readSpecFile(file, io);
  if (text === undefined) return 2;
  let baseline: MotionAuditReport | undefined;
  if (flags.baseline !== undefined) {
    try {
      baseline = JSON.parse(readFileSync(flags.baseline, 'utf8')) as MotionAuditReport;
      if (!Array.isArray(baseline.findings)) throw new Error('it has no findings list');
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      io.stderr(`ak-render: cannot read baseline ${flags.baseline}: ${reason}\n`);
      return 2;
    }
  }
  const html = HTML_INPUT.test(file) || (file === STDIN_PATH && looksLikeHtml(text));
  const result = html
    ? auditMotionHtml(text)
    : auditMotionSpec(text, { source: sourceLabel(file) });
  const comparison = baseline === undefined ? undefined : compareMotionAudits(baseline, result);
  // A baseline forgives known warnings and notes, never a standing error.
  const gated =
    comparison === undefined
      ? result.findings
      : [...comparison.added, ...result.findings.filter((finding) => finding.severity === 'error')];
  const failed = motionAuditFails(gated, failOn);

  if (flags.json) {
    io.stdout(
      `${JSON.stringify(
        {
          source: sourceLabel(file),
          ...result,
          ...(comparison === undefined ? {} : { baseline: comparison }),
          gate: { failOn, failed },
        },
        null,
        2,
      )}\n`,
    );
  } else {
    for (const finding of result.findings) io.stdout(findingText(finding));
    const { error, warning, info } = result.counts;
    io.stdout(
      `${sourceLabel(file)}: ${result.mode} audit (${result.reliability}), ${error} error(s), ${warning} warning(s), ${info} info; score ${result.score.value}/100 (advisory)\n`,
    );
    if (comparison !== undefined) {
      io.stdout(
        `baseline: ${comparison.added.length} new, ${comparison.resolved.length} resolved\n`,
      );
    }
    if (failed) io.stdout(`gate failed: findings at ${failOn} or above\n`);
  }
  return failed ? 1 : 0;
}

/**
 * Start the loopback Motion Studio for one spec file. The server keeps the
 * process alive until it is interrupted; a failed start sets the exit code.
 */
function motionStudioCommand(file: string, io: CliIo, flags: Flags): number {
  if (file === STDIN_PATH || HTML_INPUT.test(file)) {
    io.stderr('ak-render: motion studio edits a YAML or JSON spec file, not stdin or HTML\n');
    return 2;
  }
  const port = flags.port === undefined ? 0 : Number(flags.port);
  if (!/^\d{1,5}$/u.test(flags.port ?? '0') || port > 65_535) {
    io.stderr('ak-render: --port must be an integer from 0 to 65535\n');
    return 2;
  }
  if (!existsSync(file)) {
    io.stderr(`ak-render: cannot read ${file}: no such file\n`);
    return 2;
  }
  startMotionStudio({ file, port, themeCatalog: themeCatalogFor(flags, io) }).then(
    (studio) => {
      io.stdout(
        flags.json
          ? `${JSON.stringify({ url: studio.url, port: studio.port, file })}\n`
          : `Motion Studio for ${file}\n  ${studio.url}\nPress Ctrl-C to stop.\n`,
      );
      const stop = () => {
        void studio.close().then(() => process.exit(0));
      };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    },
    (error: unknown) => {
      io.stderr(
        `ak-render: motion studio failed to start: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    },
  );
  return 0;
}

/**
 * `ak-render patch <spec> <ops>`: edit the spec file in place. Ops are inline
 * JSON (an argument starting with `[`), a JSON or YAML file, or `-` for stdin.
 * The output is the hash and change list, never the spec.
 */
function patchCommand(args: string[], io: CliIo, flags: Flags): number {
  const [file, opsArg] = args;
  if (file === undefined || opsArg === undefined) {
    io.stderr('ak-render: patch requires a spec file and operations\n');
    return 2;
  }
  if (file === STDIN_PATH) {
    io.stderr('ak-render: patch edits a spec file in place; pass a file path, not -\n');
    return 2;
  }
  const inline = opsArg.trimStart().startsWith('[');
  const opsText = inline ? opsArg : readSpecFile(opsArg, io);
  if (opsText === undefined) return 2;
  let ops: unknown;
  try {
    ops = parseSpec(opsText, { source: inline ? '<ops>' : sourceLabel(opsArg) });
  } catch (error) {
    if (!isRenderError(error)) throw error;
    io.stderr(`ak-render: ${error.message}\n`);
    return 2;
  }

  let result: ReturnType<typeof patchSpecFile>;
  try {
    result = patchSpecFile(file, ops, {
      dryRun: flags.dryRun,
      ...(flags.baseHash === undefined ? {} : { baseHash: flags.baseHash }),
    });
  } catch (error) {
    if (isRenderError(error)) throw error;
    io.stderr(
      `ak-render: cannot patch ${file}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 2;
  }

  if (flags.json) {
    io.stdout(`${JSON.stringify({ source: file, ...result }, null, 2)}\n`);
  } else {
    if (result.written) {
      io.stdout(
        `patched ${file}: ${result.changes.length} operations, hash ${result.hash} (was ${result.baseHash})\n`,
      );
    } else if (result.applied) {
      const why = flags.dryRun
        ? 'dry run'
        : result.changes.length === 0
          ? 'no operations'
          : 'the patch adds errors';
      io.stdout(
        `not written (${why}): ${file}, hash ${result.hash} (current ${result.baseHash})\n`,
      );
    }
    if (!result.preserved && result.written) {
      io.stderr(`warning: ${file} was re-serialized; YAML comments and layout were not kept\n`);
    }
    reportDiagnostics(io, result.diagnostics);
  }
  return result.ok ? 0 : 1;
}

const COMMANDS: Record<string, Command> = {
  compile: {
    summary: 'Compile a Page Spec to a standalone HTML artifact.',
    usage: 'ak-render <spec.yaml|spec.json|-> [--out <file.html>] [--theme <preset>] [--json]',
    run: compileCommand,
  },
  validate: {
    summary: 'Validate a Page Spec without rendering it.',
    usage: 'ak-render validate <spec.yaml|spec.json|-> [--suggest] [--json]',
    run: (args, io, flags) => {
      const file = args[0];
      if (file === undefined) {
        io.stderr('ak-render: validate requires a spec path\n');
        return 2;
      }
      const text = readSpecFile(file, io);
      if (text === undefined) return 2;

      const result = validate(text, { source: sourceLabel(file), suggest: flags.suggest });
      if (flags.json) {
        io.stdout(`${JSON.stringify(result, null, 2)}\n`);
      } else if (result.ok) {
        const { summary } = result;
        io.stdout(
          `ok: ${sourceLabel(file)}\n  title: ${summary.title}\n  theme: ${summary.themePreset}\n  blocks: ${summary.blocks} (nodes: ${summary.nodes})\n  depth: ${summary.depth}, bytes: ${summary.bytes}\n`,
        );
      } else {
        reportDiagnostics(io, result.diagnostics);
        reportFixes(io, result.diagnostics);
      }
      if (!flags.json) {
        for (const warning of result.diagnostics.filter((item) => item.severity === 'warning')) {
          io.stderr(`warning: ${warning.path}: ${warning.message}\n`);
        }
      }
      return result.ok ? 0 : 1;
    },
  },
  repair: {
    summary:
      'Apply only semantics-preserving fixes to a Page Spec, revalidate, and log each change.',
    usage: 'ak-render repair <spec.yaml|spec.json|-> [--out <file>] [--json]',
    run: repairCommand,
  },
  patch: {
    summary:
      'Edit a spec file in place with a JSON Patch; /blocks/@<id> addresses a block by its id.',
    usage:
      "ak-render patch <spec.yaml|spec.json> <ops.json|-|'[...]'> [--base-hash <hash>] [--dry-run] [--json]",
    run: patchCommand,
  },
  catalog: {
    summary: 'List available blocks by category, and actions (compact).',
    usage: `ak-render catalog [--category <${BLOCK_CATEGORIES.join('|')}>] [--json]`,
    run: (_args, io, flags) => {
      const listing = catalog(flags.category === undefined ? {} : { category: flags.category });
      io.stdout(`${flags.json ? formatCatalogJson(listing) : catalogText(listing)}\n`);
      return 0;
    },
  },
  'search-catalog': {
    summary: 'Find block types by intent words, best match first.',
    usage: 'ak-render search-catalog <terms...> [--json]',
    run: (args, io, flags) => {
      if (args.length === 0) {
        io.stderr('ak-render: search-catalog requires search terms\n');
        return 2;
      }
      const query = args.join(' ');
      const hits = searchCatalog(query);
      if (flags.json) {
        io.stdout(`${JSON.stringify(hits, null, 2)}\n`);
      } else if (hits.length === 0) {
        io.stdout(`no blocks match "${query}"\n`);
      } else {
        for (const hit of hits) io.stdout(`${hit.type} (${hit.category}) — ${hit.summary}\n`);
      }
      return 0;
    },
  },
  icons: {
    summary: 'Find and describe icons: search <query>, describe <icon>, packs.',
    usage: `ak-render icons <search <query...> [--pack <${ICON_PACK_IDS.join('|')}>] [--limit <n>]|describe <icon>|packs> [--json]`,
    run: (args, io, flags) => iconsCommand(args, io, flags),
  },
  describe: {
    summary: 'Show the machine-readable contract for one or more block types.',
    usage: 'ak-render describe <type...> [--compact] [--json]',
    run: (args, io, flags) => {
      if (args.length === 0) {
        io.stderr('ak-render: describe requires a block type\n');
        return 2;
      }
      let contracts: (BlockDefinition | CompactBlockDescription)[];
      try {
        // One type without --compact keeps the original single-contract path.
        contracts =
          args.length === 1 && !flags.compact
            ? [describe(args[0] as string)]
            : describeMany(args, { compact: flags.compact });
      } catch (error) {
        if (isRenderError(error)) {
          io.stderr(`ak-render: ${error.message}\n`);
          return 1;
        }
        throw error;
      }
      if (flags.json) {
        // The reply's shape follows the call: one type, one object.
        io.stdout(`${JSON.stringify(args.length === 1 ? contracts[0] : contracts, null, 2)}\n`);
        return 0;
      }
      const sections = contracts.map((contract) =>
        'purpose' in contract ? contractText(contract) : compactContractText(contract),
      );
      io.stdout(sections.join('\n'));
      return 0;
    },
  },
  recipes: {
    summary: 'List page recipes: complete starter specs for common pages.',
    usage: 'ak-render recipes [--json]',
    run: (_args, io, flags) => {
      const listing = recipes();
      if (flags.json) {
        io.stdout(`${JSON.stringify(listing, null, 2)}\n`);
        return 0;
      }
      const width = Math.max(...listing.map((entry) => entry.name.length));
      for (const entry of listing) io.stdout(`${entry.name.padEnd(width)}  ${entry.summary}\n`);
      return 0;
    },
  },
  recipe: {
    summary: 'Print one page recipe as a starter Page Spec (YAML).',
    usage: 'ak-render recipe <name> [--json]',
    run: (args, io, flags) => {
      const name = args[0];
      if (name === undefined) {
        io.stderr('ak-render: recipe requires a recipe name (see ak-render recipes)\n');
        return 2;
      }
      let found: PageRecipe;
      try {
        found = recipe(name);
      } catch (error) {
        if (isRenderError(error)) {
          io.stderr(`ak-render: ${error.message}\n`);
          return 1;
        }
        throw error;
      }
      io.stdout(flags.json ? `${JSON.stringify(found, null, 2)}\n` : found.spec);
      return 0;
    },
  },
  motions: {
    summary: 'List, search and describe compiler-owned motion recipes.',
    usage: 'ak-render motions [search <terms...>|describe <id...> [--compact]] [--json]',
    run: motionsCommand,
  },
  motion: {
    summary:
      'Audit the motion of a Page Spec or compiled page, or open the local Motion Studio for a spec.',
    usage:
      'ak-render motion audit <spec|page.html|-> [--fail-on <error|warning|info|none>] [--baseline <report.json>] [--json]\n  ak-render motion studio <spec> [--port <n>] [--json]',
    run: motionCommand,
  },
  mcp: {
    summary:
      'Serve the catalog, describe, icon, motion, recipe, validate, repair, patch, audit-motion, render and themes tools over MCP stdio.',
    usage: 'ak-render mcp',
    run: () => {
      // The server keeps the process alive until its client closes stdin.
      serveMcp();
      return 0;
    },
  },
  themes: {
    summary: 'List available theme presets, including discovered project or user presets.',
    usage: 'ak-render themes [--theme-file <file>] [--no-theme-discovery] [--json]',
    run: (_args, io, flags) => {
      const catalog = themeCatalogFor(flags, io);
      const names = Object.keys(catalog.entries).sort();
      if (flags.json) {
        io.stdout(
          `${JSON.stringify(
            catalog.sources.sort((a, b) => (a.name < b.name ? -1 : 1)),
            null,
            2,
          )}\n`,
        );
        return 0;
      }
      for (const name of names) {
        const source = catalog.sources.find((entry) => entry.name === name);
        const origin = source?.origin ?? 'built-in';
        const file = source?.file;
        io.stdout(`${name.padEnd(16)} ${origin}${file === undefined ? '' : ` (${file})`}\n`);
      }
      return 0;
    },
  },
};

function helpText(): string {
  const usage = Object.values(COMMANDS)
    .map((command) => `  ${command.usage}`)
    .join('\n');
  const width = Math.max(...Object.keys(COMMANDS).map((name) => name.length));
  const summaries = Object.entries(COMMANDS)
    .map(([name, command]) => `  ${name.padEnd(width)} ${command.summary}`)
    .join('\n');
  return `${PACKAGE_NAME} ${VERSION}

Deterministic, offline compiler from a declarative Page Spec (JSON/YAML) to a
self-contained interactive HTML artifact. The local compiler is canonical: no
account, no network, no server.

Usage:
${usage}
  ak-render --help
  ak-render --version

Commands:
${summaries}

The first positional argument may be a spec path with the compile command
implied. Pass - as the spec path to read the spec from standard input. No
command prompts, and every command except mcp accepts --json.
`;
}

const VALUE_FLAGS = [
  '--out',
  '--theme',
  '--theme-file',
  '--category',
  '--pack',
  '--limit',
  '--fail-on',
  '--baseline',
  '--port',
  '--base-hash',
] as const;

/** Build the preset catalog for this invocation from flags and discovery. */
function themeCatalogFor(flags: Flags, io: CliIo): ThemeCatalog {
  const catalog = buildThemeCatalog({
    cwd: process.cwd(),
    home: homedir(),
    ...(flags.themeFile === undefined ? {} : { files: [flags.themeFile] }),
    discovery: flags.themeDiscovery,
  });
  for (const problem of catalog.problems) {
    io.stderr(`warning: ${problem.path}: ${problem.message}\n`);
  }
  return catalog;
}

function parseArgs(args: string[]): ParsedArgs | { error: string } {
  const flags: Flags = {
    json: false,
    compact: false,
    dryRun: false,
    suggest: false,
    themeDiscovery: true,
  };
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) continue;
    if (arg === '--json') {
      flags.json = true;
      continue;
    }
    if (arg === '--compact') {
      flags.compact = true;
      continue;
    }
    if (arg === '--suggest') {
      flags.suggest = true;
      continue;
    }
    if (arg === '--dry-run') {
      flags.dryRun = true;
      continue;
    }
    if (arg === '--no-theme-discovery') {
      flags.themeDiscovery = false;
      continue;
    }
    const valueFlag = VALUE_FLAGS.find((candidate) => candidate === arg);
    if (valueFlag !== undefined) {
      const value = args[index + 1];
      if (value === undefined) return { error: `${valueFlag} requires a value` };
      if (valueFlag === '--out') flags.out = value;
      else if (valueFlag === '--theme') flags.theme = value;
      else if (valueFlag === '--category') flags.category = value;
      else if (valueFlag === '--pack') flags.pack = value;
      else if (valueFlag === '--limit') flags.limit = value;
      else if (valueFlag === '--fail-on') flags.failOn = value;
      else if (valueFlag === '--baseline') flags.baseline = value;
      else if (valueFlag === '--port') flags.port = value;
      else if (valueFlag === '--base-hash') flags.baseHash = value;
      else flags.themeFile = value;
      index += 1;
      continue;
    }
    positional.push(arg);
  }
  return { flags, positional };
}

/** Run the CLI. Returns the process exit code. */
export function run(argv: readonly string[], io: CliIo = defaultIo): number {
  const args = argv.filter((arg) => arg !== '');
  const first = args[0];

  if (args.length === 0) {
    io.stdout(helpText());
    return 2;
  }
  if (first === '--help' || first === '-h' || first === 'help') {
    io.stdout(helpText());
    return 0;
  }
  if (first === '--version' || first === '-v' || first === 'version') {
    io.stdout(`${VERSION}\n`);
    return 0;
  }

  // `ak-render <command> --help` prints that command's usage instead of
  // treating the flag as a spec path; `ak-render page.yaml --help` means compile.
  const named = (first === undefined ? undefined : COMMANDS[first]) ?? COMMANDS.compile;
  if (named !== undefined && args.slice(1).some((arg) => arg === '--help' || arg === '-h')) {
    io.stdout(`${named.summary}\n\nUsage:\n  ${named.usage}\n`);
    return 0;
  }

  const parsed = parseArgs(args.slice(1));
  if ('error' in parsed) {
    io.stderr(`ak-render: ${parsed.error}\n`);
    return 2;
  }

  // `ak-render page.yaml --out page.html` is the documented primary surface.
  const command = first === undefined ? undefined : COMMANDS[first];
  const resolved = command ?? COMMANDS.compile;
  const positional =
    command === undefined && first !== undefined
      ? [first, ...parsed.positional]
      : parsed.positional;

  try {
    return resolved === undefined ? 2 : resolved.run(positional, io, parsed.flags);
  } catch (error) {
    if (isRenderError(error)) {
      io.stderr(`ak-render: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

/** True when this module is the process entry point (npm bin symlinks included). */
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  process.exitCode = run(process.argv.slice(2));
}
