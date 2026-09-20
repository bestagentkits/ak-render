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

import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isRenderError, type RenderError } from './errors.js';
import { catalog, describe } from './registry/registry.js';
import { compile } from './render/render.js';
import { validate } from './spec/validate.js';
import { themePresetNames } from './theme/load-theme.js';
import { PACKAGE_NAME, VERSION } from './version.js';

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const defaultIo: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

interface Flags {
  json: boolean;
  out?: string;
  theme?: string;
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
    return readFileSync(path, 'utf8');
  } catch (error) {
    io.stderr(
      `ak-render: cannot read ${path}: ${error instanceof Error ? error.message : String(error)}\n`,
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
      source: file,
      ...(flags.theme === undefined ? {} : { theme: flags.theme }),
    });

    if (flags.out !== undefined) {
      writeFileSync(flags.out, result.html, 'utf8');
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
            source: file,
            out: flags.out ?? null,
            bytes: result.bytes,
            hash: result.hash,
            title: result.ir.meta.title,
            theme: result.theme.name,
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

const COMMANDS: Record<string, Command> = {
  compile: {
    summary: 'Compile a Page Spec to a standalone HTML artifact.',
    usage: 'ak-render <spec.yaml|spec.json> [--out <file.html>] [--theme <preset>] [--json]',
    run: compileCommand,
  },
  validate: {
    summary: 'Validate a Page Spec without rendering it.',
    usage: 'ak-render validate <spec.yaml|spec.json> [--json]',
    run: (args, io, flags) => {
      const file = args[0];
      if (file === undefined) {
        io.stderr('ak-render: validate requires a spec path\n');
        return 2;
      }
      const text = readSpecFile(file, io);
      if (text === undefined) return 2;

      const result = validate(text, { source: file });
      if (flags.json) {
        io.stdout(`${JSON.stringify(result, null, 2)}\n`);
      } else if (result.ok) {
        const { summary } = result;
        io.stdout(
          `ok: ${file}\n  title: ${summary.title}\n  theme: ${summary.themePreset}\n  blocks: ${summary.blocks} (nodes: ${summary.nodes})\n  depth: ${summary.depth}, bytes: ${summary.bytes}\n`,
        );
      } else {
        reportDiagnostics(io, result.diagnostics);
      }
      if (!flags.json) {
        for (const warning of result.diagnostics.filter((item) => item.severity === 'warning')) {
          io.stderr(`warning: ${warning.path}: ${warning.message}\n`);
        }
      }
      return result.ok ? 0 : 1;
    },
  },
  catalog: {
    summary: 'List available blocks and actions (compact).',
    usage: 'ak-render catalog [--json]',
    run: (_args, io, flags) => {
      const listing = catalog();
      if (flags.json) {
        io.stdout(`${JSON.stringify(listing, null, 2)}\n`);
        return 0;
      }
      io.stdout(`Page Spec v${listing.schemaVersion} — ${listing.blockCount} blocks\n\n`);
      for (const entry of listing.blocks) {
        io.stdout(`${entry.type.padEnd(16)} ${entry.kind.padEnd(10)} ${entry.summary}\n`);
      }
      io.stdout(`\nActions: ${listing.actions.map((action) => action.type).join(', ')}\n`);
      return 0;
    },
  },
  describe: {
    summary: 'Show the full machine-readable contract for one block type.',
    usage: 'ak-render describe <type> [--json]',
    run: (args, io, flags) => {
      const type = args[0];
      if (type === undefined) {
        io.stderr('ak-render: describe requires a block type\n');
        return 2;
      }
      let contract: ReturnType<typeof describe>;
      try {
        contract = describe(type);
      } catch (error) {
        if (isRenderError(error)) {
          io.stderr(`ak-render: ${error.message}\n`);
          return 1;
        }
        throw error;
      }
      if (flags.json) {
        io.stdout(`${JSON.stringify(contract, null, 2)}\n`);
        return 0;
      }
      io.stdout(`${contract.type} (${contract.kind}, v${contract.version})\n\n`);
      io.stdout(`purpose:  ${contract.purpose}\n`);
      io.stdout(`summary:  ${contract.summary}\n`);
      io.stdout(`props:    ${Object.keys(contract.props).join(', ') || '(none)'}\n`);
      io.stdout(`actions:  ${contract.actions.join(', ') || '(none)'}\n`);
      io.stdout(`features: ${contract.runtimeFeatures.join(', ') || '(none)'}\n`);
      io.stdout(`network:  ${contract.network}\n`);
      io.stdout(
        `sizes:    ${contract.sizing.sizes.join(', ')} (default: ${contract.sizing.default})\n`,
      );
      io.stdout(`a11y:     ${contract.a11y}\n`);
      return 0;
    },
  },
  themes: {
    summary: 'List built-in theme presets.',
    usage: 'ak-render themes [--json]',
    run: (_args, io, flags) => {
      const names = themePresetNames();
      if (flags.json) {
        io.stdout(`${JSON.stringify(names, null, 2)}\n`);
        return 0;
      }
      io.stdout(`${names.join('\n')}\n`);
      return 0;
    },
  },
};

function helpText(): string {
  const usage = Object.values(COMMANDS)
    .map((command) => `  ${command.usage}`)
    .join('\n');
  const summaries = Object.entries(COMMANDS)
    .map(([name, command]) => `  ${name.padEnd(10)} ${command.summary}`)
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
implied. All commands accept --json and never prompt.
`;
}

const VALUE_FLAGS = ['--out', '--theme'] as const;

function parseArgs(args: string[]): ParsedArgs | { error: string } {
  const flags: Flags = { json: false };
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) continue;
    if (arg === '--json') {
      flags.json = true;
      continue;
    }
    const valueFlag = VALUE_FLAGS.find((candidate) => candidate === arg);
    if (valueFlag !== undefined) {
      const value = args[index + 1];
      if (value === undefined) return { error: `${valueFlag} requires a value` };
      if (valueFlag === '--out') flags.out = value;
      else flags.theme = value;
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
