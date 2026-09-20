/**
 * Schema versioning and migrations.
 *
 * A Page Spec declares its own `version`, independent of the package version.
 * Older supported versions are upgraded in memory before validation, so a
 * document that was valid when it was written keeps working. Removing a
 * supported version is a major release; see `docs/release-policy.md`.
 */

import type { DiagnosticBag } from '../diagnostics.js';
import { isPlainObject } from '../json.js';
import { SPEC_SCHEMA_VERSION } from '../registry/registry.js';

export const CURRENT_SPEC_VERSION = SPEC_SCHEMA_VERSION;

export interface Migration {
  from: number;
  to: number;
  description: string;
  apply(document: Record<string, unknown>): Record<string, unknown>;
}

/**
 * Version 0 is the pre-versioning authoring shape: a bare `blocks` array (or a
 * document whose only meaningful key is `blocks`). The migration adds the
 * envelope so v1 validation and normalization have one shape to handle.
 */
const VERSION_0_TO_1: Migration = {
  from: 0,
  to: 1,
  description:
    'Wrap a bare block document in the v1 envelope: adds version, meta, theme, and policy defaults.',
  apply(document) {
    const blocks = Array.isArray(document) ? document : (document.blocks ?? []);
    return {
      version: 1,
      meta: { title: 'Untitled page', locale: 'en' },
      theme: { preset: 'editorial' },
      policy: { network: 'deny' },
      blocks,
    };
  },
};

export const MIGRATIONS: readonly Migration[] = [VERSION_0_TO_1];

export function supportedVersions(): number[] {
  return [0, CURRENT_SPEC_VERSION];
}

/** The declared version, or 0 for the pre-versioning shape, or undefined. */
export function detectSpecVersion(document: unknown): number | undefined {
  if (Array.isArray(document)) return 0;
  if (!isPlainObject(document)) return undefined;
  const declared = document.version;
  if (typeof declared === 'number') return declared;
  if (declared !== undefined) return Number.NaN;
  if (Array.isArray(document.blocks)) return 0;
  return undefined;
}

export interface MigrationResult {
  document: Record<string, unknown>;
  /** Version the document was written in, before any migration. */
  originalVersion: number;
  applied: string[];
}

/**
 * Detect, validate, and apply migrations. Returns the document in the current
 * schema version. Reports diagnostics instead of throwing so `validate()` can
 * surface every problem at once.
 */
export function migrateSpec(document: unknown, bag: DiagnosticBag): MigrationResult | undefined {
  if (!Array.isArray(document) && !isPlainObject(document)) {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path: '$',
      message: 'expected a Page Spec object or a block array',
    });
    return undefined;
  }

  const detected = detectSpecVersion(document);
  if (detected === undefined || Number.isNaN(detected)) {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path: '$.version',
      message: `"version" must be a number; supported versions are ${supportedVersions().join(', ')}`,
      details: { supported: supportedVersions() },
    });
    return undefined;
  }

  if (!Number.isInteger(detected) || detected < 0) {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path: '$.version',
      message: `"${String(detected)}" is not a supported schema version`,
      details: { supported: supportedVersions() },
    });
    return undefined;
  }

  if (detected > CURRENT_SPEC_VERSION) {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      path: '$.version',
      message: `schema version ${detected} is newer than this compiler supports (${CURRENT_SPEC_VERSION})`,
      details: { supported: supportedVersions(), documentVersion: detected },
    });
    return undefined;
  }

  let current = Array.isArray(document) ? { blocks: [...document] } : { ...document };
  const applied: string[] = [];
  let version = detected;

  while (version < CURRENT_SPEC_VERSION) {
    const migration = MIGRATIONS.find((candidate) => candidate.from === version);
    if (migration === undefined) {
      bag.add({
        code: 'SPEC_VALIDATION_ERROR',
        path: '$.version',
        message: `no migration path from schema version ${version}`,
        details: { supported: supportedVersions() },
      });
      return undefined;
    }
    current = migration.apply(current);
    applied.push(`v${migration.from}->v${migration.to}`);
    version = migration.to;
  }

  return { document: current, originalVersion: detected, applied };
}
