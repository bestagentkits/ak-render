/**
 * Replace a file's contents without ever leaving half of it on disk.
 *
 * The text is written beside the file and renamed over it, so an interrupted
 * write leaves the old file whole. The copy keeps the file's mode, the rename
 * lands on the real file (a symlink stays a symlink), and `check` runs just
 * before the rename so a caller can refuse when the file changed under it.
 */

import { chmodSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export function replaceFile(file: string, text: string, tag: string, check: () => void): void {
  const target = realpathSync(file);
  const temporary = join(dirname(target), `.${basename(target)}.${tag}.tmp`);
  try {
    writeFileSync(temporary, text, { encoding: 'utf8', mode: 0o600 });
    chmodSync(temporary, statSync(target).mode & 0o7777);
    check();
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
}
