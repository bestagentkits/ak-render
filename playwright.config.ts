import { defineConfig, devices } from '@playwright/test';

// Specs that drive WebGL run on SwiftShader software GL in CI, which is several
// times slower than a GPU. Tag them `@gl` (on the test or its describe block)
// instead of raising timeouts per test: they get one shared, wider budget, and
// the timing report below keeps slow tests visible rather than silently widened.
const GL_TAG = /@gl\b/;
const GL_TIMEOUT_MS = 120_000;

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
      grepInvert: GL_TAG,
      use: { ...devices['Desktop Chromium'] },
    },
    {
      name: 'chromium-gl',
      grep: GL_TAG,
      timeout: GL_TIMEOUT_MS,
      use: { ...devices['Desktop Chromium'] },
    },
  ],
});
