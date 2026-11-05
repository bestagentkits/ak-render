import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM script without type declarations
import { scope } from '../../scripts/ci-scope.mjs';

describe('ci-scope', () => {
  it('runs every lane when nothing is known', () => {
    expect(scope([])).toEqual({ browser: true, crossPlatform: true, package: true });
  });

  it('runs every lane for source and unknown paths', () => {
    expect(scope(['src/render/render.ts'])).toEqual({
      browser: true,
      crossPlatform: true,
      package: true,
    });
    expect(scope(['README.md', 'some/new/place.json'])).toEqual({
      browser: true,
      crossPlatform: true,
      package: true,
    });
  });

  it('skips the expensive lanes for docs-only changes', () => {
    expect(
      scope(['README.md', 'docs/motion.md', 'plans/x/plan.md', 'docs/gallery/index.html']),
    ).toEqual({
      browser: false,
      crossPlatform: false,
      package: false,
    });
  });

  it('keeps the browser lane for browser baselines in docs/artifacts', () => {
    expect(scope(['docs/artifacts/benchmark-browser.json']).browser).toBe(true);
  });

  it('runs only the browser lane for browser spec changes', () => {
    expect(scope(['tests/browser/three-scene.spec.ts'])).toEqual({
      browser: true,
      crossPlatform: false,
      package: false,
    });
  });

  it('skips browser and package for unit-test or cloud-only changes', () => {
    expect(scope(['tests/unit/foo.test.ts', 'apps/cloud/src/worker.ts'])).toEqual({
      browser: false,
      crossPlatform: true,
      package: false,
    });
  });

  it('treats a ci.yml change as touching everything', () => {
    expect(scope(['.github/workflows/ci.yml'])).toEqual({
      browser: true,
      crossPlatform: true,
      package: true,
    });
    expect(scope(['.github/workflows/release.yml']).browser).toBe(false);
  });
});
