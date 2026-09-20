#!/usr/bin/env node
/**
 * `ak-render` command-line entry point.
 *
 * The compiler subcommands (`<spec> --out <file>`, `validate`, `catalog`,
 * `describe`) are registered by the milestones that implement them. Until
 * then the CLI exposes only what it can actually do, so help output never
 * advertises a scaffold.
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PACKAGE_NAME, VERSION } from './version.js';

const HELP = `${PACKAGE_NAME} ${VERSION}

Deterministic, offline compiler from a declarative Page Spec (JSON/YAML) to a
self-contained interactive HTML artifact.

Usage:
  ak-render --help
  ak-render --version

Compiler commands (compile, validate, catalog, describe) are not implemented
yet; they land with the Page Spec, compiler, and catalog milestones.
`;

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const defaultIo: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

/** Run the CLI. Returns the process exit code. */
export function run(argv: readonly string[], io: CliIo = defaultIo): number {
  const args = argv.filter((arg) => arg !== '');
  const first = args[0];

  if (args.length === 0 || first === '--help' || first === '-h' || first === 'help') {
    io.stdout(HELP);
    return args.length === 0 ? 2 : 0;
  }

  if (first === '--version' || first === '-v' || first === 'version') {
    io.stdout(`${VERSION}\n`);
    return 0;
  }

  io.stderr(`ak-render: unknown command "${first ?? ''}"\n\n${HELP}`);
  return 2;
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
