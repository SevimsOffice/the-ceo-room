import { defineConfig } from '@playwright/test';

/**
 * End-to-end: the main CEO journey on the built site (vite preview, base /the-ceo-room/).
 * Run with `pnpm e2e` (builds first). Chromium only. Set PW_CHROMIUM_PATH to use a specific
 * Chromium binary when the installed browsers do not match this Playwright version.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173/the-ceo-room/',
    viewport: { width: 1440, height: 900 },
    trace: 'off',
    browserName: 'chromium',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: {
    command: 'pnpm exec vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/the-ceo-room/',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
