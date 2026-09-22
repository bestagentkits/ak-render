/**
 * Package version.
 *
 * Kept as a literal so the value is available to any runtime (including a
 * worker bundle) without reading a manifest. `tests/unit/version.test.ts`
 * asserts that it stays equal to the `version` field in `package.json`, so a
 * release that forgets one of them fails fast.
 */
export const VERSION = '0.1.1-next.1';

/** Published package name, used by CLI output and release tooling. */
export const PACKAGE_NAME = '@bestagentkits/render';
