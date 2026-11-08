import { defineConfig, devices } from '@playwright/test';

// Specs that drive WebGL run on SwiftShader software GL in CI, which is several
// times slower than a GPU. Tag them `@gl` (on the test or its describe block)
// instead of raising timeouts per test: they get one shared, wider budget, and
// the timing report below keeps slow tests visible rather than silently widened.
const GL_TAG = /@gl\b/;
const GL_TIMEOUT_MS = 120_000;
// The 3D benchmark is slow and contends for the GPU, so it runs only through
// `pnpm bench:3d`. Kept in each project's grepInvert, which replaces a top-level one.
const BENCH = process.env.npm_lifecycle_event?.startsWith('bench:3d') ? [] : [/@bench/];

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  // Each worker launches a browser. On a busy or small machine an uncapped
  // worker pool starves the whole suite and unrelated tests time out, so the
  // pool is bounded rather than left to the core count.
  workers: 4,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['github'], ['list'], ['json', { outputFile: 'playwright-report/results.json' }]]
    : [['list']],
  use: {
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      grepInvert: [GL_TAG, ...BENCH],
      use: { ...devices['Desktop Chromium'] },
    },
    {
      name: 'chromium-gl',
      grep: GL_TAG,
      grepInvert: BENCH,
      timeout: GL_TIMEOUT_MS,
      // Software GL is CPU-bound and the GL specs land in one shard, so four
      // scenes rasterizing at once starve each other past the budget on CI.
      workers: process.env.CI ? 2 : 4,
      use: { ...devices['Desktop Chromium'] },
    },
  ],
});
