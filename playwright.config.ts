import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: process.env.CI ? 2 : 4,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.APP_URL ?? 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } }
  ],
  webServer: {
    command: 'npm run dev',
    // Dialogue journeys intercept provider-bound HTTP requests with test-only fixtures.
    // This non-secret sentinel enables the form in CI without granting provider access.
    env: { OPENAI_API_KEY: 'unused-playwright-fixture-sentinel', NPC_PROVIDER: 'openai' },
    url: `${process.env.APP_URL ?? 'http://127.0.0.1:3000'}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
