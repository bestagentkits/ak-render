/**
 * Export formats and the failure taxonomy shared by the local and the cloud
 * exporter. Free of Node built-ins so the Worker can import it.
 */

export const EXPORT_FORMATS = ['png', 'pdf'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** Why an export failed, stable for agents and scripts to branch on. */
export type ExportErrorCode =
  | 'usage'
  | 'invalid-input'
  | 'invalid-spec'
  | 'browser-unavailable'
  | 'driver-unavailable'
  | 'load-failed'
  | 'timeout'
  | 'webgl-unavailable'
  | 'scene-error'
  | 'capture-failed'
  | 'write-failed'
  /** Cloud: the upload manifest was not approved, or the approval does not match the bytes. */
  | 'consent-required'
  /** Cloud: the credentials are missing, invalid or lack the Browser Run permission. */
  | 'cloud-unauthorized'
  /** Cloud: Browser Run answered with an error that is not a scene or timeout outcome. */
  | 'cloud-failed';

export class ExportError extends Error {
  constructor(
    readonly code: ExportErrorCode,
    message: string,
  ) {
    super(message);
  }
}
