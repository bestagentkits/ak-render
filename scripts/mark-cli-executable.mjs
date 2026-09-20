#!/usr/bin/env node
/**
 * Ensure the published CLI entry point is executable after `tsc`.
 */

import { chmodSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cliPath = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

if (!existsSync(cliPath)) {
  console.error(`mark-cli-executable: missing ${cliPath}; run the TypeScript build first`);
  process.exit(1);
}

chmodSync(cliPath, 0o755);
