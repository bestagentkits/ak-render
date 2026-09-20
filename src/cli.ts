#!/usr/bin/env node
/**
 * `ak-render` command-line entry point.
 *
 * Help output is generated from the command table, so a command that is not
 * implemented cannot be advertised. Every command supports `--json` for
 * scripted and CI use, and never prompts.
 */

import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isRenderError } from './errors.js';
import { catalog, describe } from './registry/registry.js';
import { parseSpec } from './spec/parse.js';
import { validate } from './spec/validate.js';
import { PACKAGE_NAME, VERSION } from './version.js';

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const defaultIo: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

interface Command {
  summary: string;
  usage: string;
  run: (args: string[], io: CliIo, flags: Flags) => number;
}

interface Flags {
  json: boolean;
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

const COMMANDS: Record<string, Command> = {
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
        for (const diagnostic of result.diagnostics) {
          const location = diagnostic.nodeId === undefined ? '' : ` [${diagnostic.nodeId}]`;
          io.stderr(
            `${diagnostic.severity}: ${diagnostic.path}${location}: ${diagnostic.message}\n`,
          );
        }
      }
      for (const warning of result.diagnostics.filter((item) => item.severity === 'warning')) {
        if (!result.ok || flags.json) continue;
        io.stderr(`warning: ${warning.path}: ${warning.message}\n`);
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
};

function helpText(): string {
  const commands = Object.entries(COMMANDS)
    .map(
      ([, command]) =>
        `  ${command.usage.split(' ')[0] === 'ak-render' ? command.usage : `ak-render ${command.usage}`}`,
    )
    .join('\n');
  const summaries = Object.entries(COMMANDS)
    .map(([name, command]) => `  ${name.padEnd(10)} ${command.summary}`)
    .join('\n');
  return `${PACKAGE_NAME} ${VERSION}

Deterministic, offline compiler from a declarative Page Spec (JSON/YAML) to a
self-contained interactive HTML artifact. The local compiler is canonical: no
account, no network, no server.

Usage:
${commands}
  ak-render --help
  ak-render --version

Commands:
${summaries}

All commands accept --json for scripted use and never prompt.
`;
}

/** Parse `--json` and positional arguments. */
function splitFlags(args: string[]): { flags: Flags; positional: string[] } {
  const positional: string[] = [];
  let json = false;
  for (const arg of args) {
    if (arg === '--json') json = true;
    else positional.push(arg);
  }
  return { flags: { json }, positional };
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

  const command = first === undefined ? undefined : COMMANDS[first];
  if (command === undefined) {
    io.stderr(`ak-render: unknown command "${first ?? ''}"\n\n${helpText()}`);
    return 2;
  }

  const { flags, positional } = splitFlags(args.slice(1));
  try {
    return command.run(positional, io, flags);
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

/** Exported for tests: the parse helper used by the compile command milestone. */
export { parseSpec };
