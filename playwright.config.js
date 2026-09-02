import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // Desktop intentionally loads the complete repository scene and can spend
  // well over a minute decoding it on a shared GitHub runner. The iPhone V8
  // path is still required by runtime.spec.js to use zero model requests.
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['line']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { viewport: { width: 1440, height: 900 } }
    },
    {
      name: 'iphone-11-landscape',
      use: {
        viewport: { width: 844, height: 390 },
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 2,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'
      }
    }
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 30_000
  }
});
