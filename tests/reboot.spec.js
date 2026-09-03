import { test, expect } from '@playwright/test';

test('Babylon reboot boots WebGPU + Havok vertical slice', async ({ page }) => {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/?ci=reboot', { waitUntil: 'domcontentloaded' });

  const gpuProbe = await page.evaluate(async () => {
    const gpu = navigator.gpu ?? null;
    if (!gpu) return { hasGpu: false, hasAdapter: false };
    const adapter = await gpu.requestAdapter();
    return { hasGpu: true, hasAdapter: Boolean(adapter) };
  });
  expect(gpuProbe, `CI WebGPU probe failed: ${JSON.stringify(gpuProbe)}`).toEqual({ hasGpu: true, hasAdapter: true });

  await expect.poll(async () => page.evaluate(() => window.__PROJECT_STRIKE_REBOOT__ ?? null), {
    timeout: 90_000,
    message: 'Project Strike reboot did not publish a runtime status'
  }).not.toBeNull();

  const status = await page.evaluate(() => window.__PROJECT_STRIKE_REBOOT__);
  expect(status, `Runtime failed: ${JSON.stringify(status)} console=${consoleErrors.join(' | ')}`).toMatchObject({
    ready: true,
    renderer: 'WebGPU',
    physics: 'Havok',
    characterController: 'PhysicsCharacterController'
  });

  await expect(page.locator('#deployBtn')).toBeEnabled({ timeout: 5_000 });
  await page.locator('#deployBtn').click();
  await expect(page.locator('#hud')).not.toHaveClass(/hidden/);
  expect(pageErrors).toEqual([]);
});
