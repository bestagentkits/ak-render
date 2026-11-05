/**
 * Local point cloud files, read on the compiler side (Node only).
 *
 * A `point-cloud-3d` block's `src` names a text file beside the spec: one
 * point per line, `x y z` and an optional intensity, separated by commas,
 * semicolons, tabs or spaces (`.xyz`, `.csv`, `.txt`). An optional header row
 * names the columns. The compiler parses it into the same columns an inline
 * `data` block carries, so the page stays offline and its bytes deterministic.
 *
 * Nothing is dropped quietly: a cloud over the point limit, a malformed row or
 * a non-finite value fails with the line number and a fix, and header columns
 * the widget does not draw are reported as a warning. Reads are confined to
 * `baseDir` with the same rules as model assets (no absolute paths, no `..`,
 * no links that leave it) and never pull more than the per-file cap plus one
 * byte. The compiler never fetches a remote cloud.
 *
 * This module touches the file system, so it must never be imported by the
 * Worker or the browser runtime.
 */

import { closeSync, fstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { extname, isAbsolute, resolve } from 'node:path';
import type { Diagnostic } from '../diagnostics.js';
import { isRemote } from '../spec/network-policy.js';
import { hasParentSegment, inside } from './model-assets.js';

/** The most points one cloud may hold; the same bound applies to inline and file input. */
export const MAX_CLOUD_POINTS = 100_000;

const MIB = 1024 * 1024;

export interface PointCloudLimits {
  /** Largest single cloud file. */
  readonly perFileBytes: number;
  /** Largest total of cloud files on one page. */
  readonly perPageBytes: number;
}

export const POINT_CLOUD_LIMITS: PointCloudLimits = {
  perFileBytes: 8 * MIB,
  perPageBytes: 16 * MIB,
};

export const POINT_CLOUD_EXTENSIONS: readonly string[] = ['.xyz', '.csv', '.txt'];

/** Parsed columns, in file order. */
export interface PointCloudColumns {
  x: number[];
  y: number[];
  z: number[];
  intensity: number[] | null;
}

export interface PointCloudResult {
  cloud?: PointCloudColumns;
  diagnostics: Diagnostic[];
}

/** Resolve one cloud reference at a JSON path; see `createPointCloudResolver`. */
export type PointCloudResolver = (reference: string, path: string) => PointCloudResult;

/** Values farther from zero than this are rejected, as for inline columns. */
const MAX_ABS = 1e12;
const COLUMN_NAMES: Readonly<Record<string, keyof PointCloudColumns>> = {
  x: 'x',
  y: 'y',
  z: 'z',
  intensity: 'intensity',
  i: 'intensity',
};

/** A plain decimal number: no hex, no empty cell, no `Infinity`. */
const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/u;

const count = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/gu, ',');

/**
 * A resolver for `compile({ pointCloudResolver })`: every cloud on the page
 * reads from `baseDir` and shares one page budget.
 */
export function createPointCloudResolver(
  baseDir: string,
  limits: PointCloudLimits = POINT_CLOUD_LIMITS,
): PointCloudResolver {
  let used = 0;
  return (reference, path) => {
    const result = readPointCloud(reference, path, baseDir, limits, used);
    if (result.bytes !== undefined) used += result.bytes;
    return { ...(result.cloud ? { cloud: result.cloud } : {}), diagnostics: result.diagnostics };
  };
}

function readPointCloud(
  reference: string,
  path: string,
  baseDir: string,
  limits: PointCloudLimits,
  used: number,
): PointCloudResult & { bytes?: number } {
  const diagnostics: Diagnostic[] = [];
  const fail = (
    code: Diagnostic['code'],
    message: string,
    fix: string,
    details: Record<string, unknown> = {},
  ) => {
    diagnostics.push({
      code,
      severity: 'error',
      path,
      message,
      details: { reference, fix, ...details },
    });
    return { diagnostics };
  };

  if (isRemote(reference))
    return fail(
      'POLICY_VIOLATION',
      `point cloud "${reference}" must be a local file; the compiler never fetches a remote cloud`,
      'download the file next to the spec and reference it by a relative path',
    );
  const ext = extname(reference).toLowerCase();
  if (!POINT_CLOUD_EXTENSIONS.includes(ext))
    return fail(
      'SPEC_VALIDATION_ERROR',
      `point cloud "${reference}" must be a ${POINT_CLOUD_EXTENSIONS.join(', ')} text file`,
      'export the cloud as text, one "x y z [intensity]" point per line',
      { allowed: POINT_CLOUD_EXTENSIONS },
    );
  if (
    isAbsolute(reference) ||
    /^[\\/]/u.test(reference) ||
    /^[a-zA-Z]:/u.test(reference) ||
    reference.includes('\0')
  )
    return fail(
      'POLICY_VIOLATION',
      `point cloud path "${reference}" must be relative to the spec`,
      'use a path relative to the spec file, with forward slashes, e.g. scans/site.xyz',
    );
  let root: string;
  try {
    root = realpathSync(resolve(baseDir));
  } catch {
    return fail(
      'SPEC_VALIDATION_ERROR',
      `the spec directory "${baseDir}" does not exist, so point cloud "${reference}" cannot be read`,
      'compile the spec from a file on disk, or pass the directory that holds its assets',
    );
  }
  const candidate = resolve(root, reference.replaceAll('\\', '/'));
  if (hasParentSegment(reference) || !inside(root, candidate))
    return fail(
      'POLICY_VIOLATION',
      `point cloud path "${reference}" leaves the spec directory`,
      'move the file inside the spec directory and reference it without ".."',
    );
  let real: string;
  try {
    real = realpathSync(candidate);
  } catch {
    return fail(
      'SPEC_VALIDATION_ERROR',
      `point cloud file "${reference}" was not found`,
      'check the path is relative to the spec file and the file exists',
    );
  }
  if (!inside(root, real))
    return fail(
      'POLICY_VIOLATION',
      `point cloud path "${reference}" resolves through a link outside the spec directory`,
      'copy the file into the spec directory instead of linking to it',
    );

  try {
    if (!statSync(real).isFile())
      return fail(
        'SPEC_VALIDATION_ERROR',
        `point cloud path "${reference}" is not a file`,
        'point at a file, not a directory',
      );
  } catch {
    return fail(
      'SPEC_VALIDATION_ERROR',
      `point cloud file "${reference}" could not be read`,
      'check the file exists and is readable',
    );
  }
  const cap = limits.perFileBytes;
  let data: Buffer;
  let fd: number | undefined;
  try {
    fd = openSync(real, 'r');
    const stat = fstatSync(fd);
    if (!stat.isFile())
      return fail(
        'SPEC_VALIDATION_ERROR',
        `point cloud path "${reference}" is not a file`,
        'point at a file, not a directory',
      );
    const buffer = Buffer.alloc(Math.min(stat.size, cap) + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = readSync(fd, buffer, length, buffer.length - length, length);
      if (read === 0) break;
      length += read;
    }
    data = buffer.subarray(0, length);
  } catch {
    return fail(
      'SPEC_VALIDATION_ERROR',
      `point cloud file "${reference}" could not be read`,
      'check the file exists and is readable',
    );
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  if (data.length > cap)
    return fail(
      'SPEC_BOUNDS_ERROR',
      `point cloud file "${reference}" is over the ${cap / MIB} MiB limit per file`,
      `thin the cloud to at most ${count(MAX_CLOUD_POINTS)} points or round its coordinates`,
      { limit: cap },
    );
  if (used + data.length > limits.perPageBytes)
    return fail(
      'SPEC_BOUNDS_ERROR',
      `point cloud files on this page are over the ${limits.perPageBytes / MIB} MiB limit per page`,
      'use fewer or smaller clouds on this page',
      { limit: limits.perPageBytes },
    );

  const parsed = parsePointCloudText(data.toString('utf8'));
  if ('error' in parsed)
    return fail(
      'SPEC_VALIDATION_ERROR',
      `point cloud "${reference}": ${parsed.error}`,
      parsed.fix,
      {
        ...(parsed.line === undefined ? {} : { line: parsed.line }),
      },
    );
  for (const name of parsed.ignored)
    diagnostics.push({
      code: 'SPEC_VALIDATION_ERROR',
      severity: 'warning',
      path,
      message: `point cloud "${reference}": column "${name}" is not drawn (only x, y, z and intensity are)`,
      details: { reference, fix: 'drop the column from the file, or ignore this warning' },
    });
  return { cloud: parsed.cloud, diagnostics, bytes: data.length };
}

type ParseResult =
  | { cloud: PointCloudColumns; ignored: string[] }
  | { error: string; fix: string; line?: number };

/**
 * Parse cloud text: optional `#` or `//` comment lines, an optional header
 * naming x, y, z and intensity (or `i`), then one point per line. Without a
 * header the columns are `x y z [intensity]` and every row must have the same
 * three or four values.
 */
export function parsePointCloudText(text: string): ParseResult {
  const lines = text.split(/\r?\n/u);
  const split = (line: string) => line.trim().split(/[\s,;]+/u);
  let slots: (keyof PointCloudColumns | null)[] | null = null;
  let width = 0;
  const ignored: string[] = [];
  const cloud: PointCloudColumns = { x: [], y: [], z: [], intensity: null };
  let points = 0;
  for (let n = 0; n < lines.length; n += 1) {
    const line = (lines[n] ?? '').trim();
    if (line === '' || line.startsWith('#') || line.startsWith('//')) continue;
    const cells = split(line);
    if (cells.includes(''))
      return {
        error: `line ${n + 1} has an empty value`,
        fix: 'give every point a value in every column, with no leading or trailing separator',
        line: n + 1,
      };
    if (slots === null) {
      const numeric = cells.every((cell) => DECIMAL.test(cell));
      if (!numeric) {
        slots = cells.map(
          (cell) => COLUMN_NAMES[cell.toLowerCase().replace(/^"|"$/gu, '')] ?? null,
        );
        cells.forEach((cell, i) => {
          if (slots?.[i] === null) ignored.push(cell);
        });
        for (const axis of ['x', 'y', 'z'] as const)
          if (!slots.includes(axis))
            return {
              error: `the header has no "${axis}" column`,
              fix: 'name the columns x, y, z and optionally intensity',
              line: n + 1,
            };
        if (new Set(slots.filter(Boolean)).size !== slots.filter(Boolean).length)
          return {
            error: 'the header names a column twice',
            fix: 'name each column once',
            line: n + 1,
          };
        width = cells.length;
        if (slots.includes('intensity')) cloud.intensity = [];
        continue;
      }
      if (cells.length !== 3 && cells.length !== 4)
        return {
          error: `line ${n + 1} has ${cells.length} values; without a header a point is "x y z" or "x y z intensity"`,
          fix: 'add a header row naming the columns (x, y, z, intensity), or keep three or four values per line',
          line: n + 1,
        };
      slots = cells.length === 4 ? ['x', 'y', 'z', 'intensity'] : ['x', 'y', 'z'];
      width = cells.length;
      if (cells.length === 4) cloud.intensity = [];
    }
    if (cells.length !== width)
      return {
        error: `line ${n + 1} has ${cells.length} values; the cloud has ${width} columns`,
        fix: 'give every point the same columns',
        line: n + 1,
      };
    points += 1;
    if (points > MAX_CLOUD_POINTS)
      return {
        error: `the cloud has more than ${count(MAX_CLOUD_POINTS)} points`,
        fix: `thin it to at most ${count(MAX_CLOUD_POINTS)} points (for example with a voxel-grid filter); the widget never drops points on its own`,
      };
    for (let i = 0; i < width; i += 1) {
      const slot = slots[i];
      if (!slot) continue;
      const value = Number(cells[i]);
      if (!DECIMAL.test(cells[i] ?? '') || !Number.isFinite(value) || Math.abs(value) > MAX_ABS)
        return {
          error: `line ${n + 1} has "${cells[i]}" for ${slot}, which is not a finite number within ±1e12`,
          fix: 'remove or repair the row',
          line: n + 1,
        };
      (cloud[slot] as number[]).push(value);
    }
  }
  if (points === 0)
    return { error: 'the file has no points', fix: 'write one "x y z [intensity]" point per line' };
  return { cloud, ignored };
}
