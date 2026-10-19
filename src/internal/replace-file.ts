/**
 * Replace a file's contents without ever leaving half of it on disk.
 *
 * The text is written beside the file and renamed over it, so an interrupted
 * write leaves the old file whole. The copy keeps the file's mode, the rename
 * lands on the real file (a symlink stays a symlink), and `check` runs just
 * before the rename so a caller can refuse when the file changed under it.
 * The temporary name is random and created exclusively, so a planted file or
 * symlink at a guessable name is never written through.
 */

import { randomBytes } from 'node:crypto';
import {
  closeSync,
  fchmodSync,
  openSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

export function replaceFile(file: string, text: string, check: () => void): void {
  const target = realpathSync(file);
  const temporary = join(
    dirname(target),
    `.${basename(target)}.${randomBytes(8).toString('hex')}.tmp`,
  );
  const descriptor = openSync(temporary, 'wx', 0o600);
  try {
    try {
      fchmodSync(descriptor, statSync(target).mode & 0o7777);
      writeFileSync(descriptor, text, 'utf8');
    } finally {
      closeSync(descriptor);
    }
    check();
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
}
