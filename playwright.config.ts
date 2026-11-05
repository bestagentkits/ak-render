import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  // Each worker launches a browser. On a busy or small machine an uncapped
  // worker pool starves the whole suite and unrelated tests time out, so the
  // pool is bounded rather than left to the core count.
  workers: 4,
  // The 3D benchmark is slow and contends for the GPU, so it runs only through `pnpm bench:3d`.
  ...(process.env.npm_lifecycle_event?.startsWith('bench:3d') ? {} : { grepInvert: /@bench/ }),
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chromium'] },
    },
  ],
});
