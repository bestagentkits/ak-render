import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const assetsDir = fileURLToPath(new URL('../../fixtures/assets', import.meta.url));

export interface BrowserWorkspaceOptions {
  /** Copy `fixtures/assets` beside the pages, for fixtures that reference `assets/…`. */
  assets?: boolean;
}

export interface BrowserWorkspace {
  /** The directory, recreated (with its assets, when asked for) if it is missing. */
  dir(): string;
  /** Writes `html` to `<name>.html` in the workspace and returns the absolute path. */
  write(name: string, html: string): string;
}

/**
 * A directory a browser spec writes compiled pages into and opens over `file://`.
 *
 * Each worker process gets its own directory, keyed by the spec's prefix and the
 * process id, so parallel workers never share files. Specs do not delete it in a
 * file-level `afterAll`: with `fullyParallel`, that hook can run while the same
 * worker still has tests from the file queued, which then open a page that is
 * gone. The directory lives under the OS temp dir instead, and every call
 * re-creates whatever is missing, so a page is always on disk when it is opened.
 */
export function browserWorkspace(
  prefix: string,
  options: BrowserWorkspaceOptions = {},
): BrowserWorkspace {
  const root = join(tmpdir(), `ak-render-${prefix}-${process.pid}`);
  const dir = (): string => {
    mkdirSync(root, { recursive: true });
    const assets = join(root, 'assets');
    if (options.assets === true && !existsSync(assets)) {
      cpSync(assetsDir, assets, { recursive: true });
    }
    return root;
  };
  return {
    dir,
    write(name, html) {
      const target = join(dir(), `${name}.html`);
      writeFileSync(target, html, 'utf8');
      return target;
    },
  };
}
