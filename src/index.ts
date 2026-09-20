/**
 * `@agentkit/render` public library surface.
 *
 * The compiler pipeline (`parse -> validate -> normalize -> ... -> assemble`)
 * and the catalog/theme APIs are added by the milestones that implement them.
 * This entry point is the single stable import path; additions here are
 * additive and versioned.
 */

export type { RenderErrorCode, RenderErrorOptions } from './errors.js';
export { isRenderError, RenderError } from './errors.js';
export { PACKAGE_NAME, VERSION } from './version.js';
