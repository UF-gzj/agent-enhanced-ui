import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3001',
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 960 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run server',
    url: 'http://127.0.0.1:3001/health',
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === 'true',
    timeout: 120_000,
  },
});
