import { defineConfig } from '@playwright/test';

const webgpuArgs = [
  '--enable-unsafe-webgpu',
  '--enable-features=Vulkan',
  '--use-angle=vulkan',
  '--use-vulkan=swiftshader',
  '--use-webgpu-adapter=swiftshader',
  '--disable-vulkan-surface',
  '--ignore-gpu-blocklist',
  '--disable-dev-shm-usage'
];

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['line']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: false,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: { args: webgpuArgs }
  },
  projects: [{
    name: 'iphone-11-webgpu-reboot',
    use: {
      viewport: { width: 844, height: 390 },
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: 2,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 Version/27.0 Mobile/15E148 Safari/604.1'
    }
  }],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 30_000
  }
});
