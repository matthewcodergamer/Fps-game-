import { defineConfig } from '@playwright/test';

const webgpuArgs = [
  '--enable-unsafe-webgpu',
  '--enable-features=Vulkan',
  '--use-angle=vulkan',
  '--use-vulkan=swiftshader',
  '--use-webgpu-adapter=swiftshader',
  '--disable-vulkan-surface',
  '--disable-dev-shm-usage'
];

export default defineConfig({
  testDir: './tests',
  // V10 waits for real building/operator/body/weapon/grenade GLBs plus WebGPU
  // pipeline compilation before ENTER becomes available. Software Vulkan CI is
  // much slower than the actual iPhone GPU, so keep a generous hard timeout.
  timeout: 300_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['line']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: false,
    launchOptions: { args: webgpuArgs },
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
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1'
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
