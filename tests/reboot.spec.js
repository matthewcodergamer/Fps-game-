import { test, expect } from '@playwright/test';

const PRESETS = ['NIGHT_CITY', 'GOLDEN_HOUR', 'DAYLIGHT', 'OVERCAST'];

function entryFor(testInfo) {
  return testInfo.project.name.startsWith('desktop') ? '/desktop.html?ci=reboot' : '/?ci=reboot';
}

async function boot(page, testInfo) {
  const pageErrors = [];
  const consoleErrors = [];
  const cdnRequests = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  // Any babylonjs.com request means a GLSL shader forced the glslang/tint download or an asset was fetched remotely.
  page.on('request', request => { if (/babylonjs\.com/.test(request.url())) cdnRequests.push(request.url()); });

  await page.goto(entryFor(testInfo), { waitUntil: 'domcontentloaded' });

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
  return { status, pageErrors, consoleErrors, cdnRequests };
}

test('boots WebGPU + Havok with platform profile and WGSL-only rendering', async ({ page }, testInfo) => {
  const { status, pageErrors, cdnRequests } = await boot(page, testInfo);
  const desktop = testInfo.project.name.startsWith('desktop');
  expect(status.platform).toBe(desktop ? 'desktop' : 'mobile');
  expect(['MOBILE', 'MEDIUM', 'HIGH', 'ULTRA']).toContain(status.tier);
  if (!desktop) expect(status.tier).toBe('MOBILE');
  expect(PRESETS).toContain(status.lighting);
  expect(Array.isArray(status.passes)).toBe(true);
  // Let a few frames render with the full post stack before checking for shader compiler fallbacks.
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => window.__PROJECT_STRIKE_REBOOT__);
  expect(after.glslFallbackUsed, 'a GLSL shader forced the glslang/tint CDN compiler').toBe(false);
  expect(cdnRequests).toEqual([]);
  await testInfo.attach('deployed', { body: await page.screenshot(), contentType: 'image/png' });
  expect(pageErrors).toEqual([]);
});

test('switches every lighting preset and the bodycam camera at runtime', async ({ page }, testInfo) => {
  const { pageErrors, cdnRequests } = await boot(page, testInfo);
  for (const preset of PRESETS) {
    await page.evaluate(name => window.__PROJECT_STRIKE_DEBUG__.setLighting(name), preset);
    await expect.poll(() => page.evaluate(() => window.__PROJECT_STRIKE_DEBUG__.getState().lighting)).toBe(preset);
    await page.waitForTimeout(700);
    await testInfo.attach(`lighting-${preset}`, { body: await page.screenshot(), contentType: 'image/png' });
  }
  await page.evaluate(() => window.__PROJECT_STRIKE_DEBUG__.setCamera('BODYCAM'));
  await expect.poll(() => page.evaluate(() => window.__PROJECT_STRIKE_DEBUG__.getState().camera)).toBe('BODYCAM');
  await expect(page.locator('#bodycamOverlay')).toBeVisible();
  await page.waitForTimeout(700);
  await testInfo.attach('bodycam', { body: await page.screenshot(), contentType: 'image/png' });
  await page.evaluate(() => window.__PROJECT_STRIKE_DEBUG__.setCamera('STANDARD'));
  await expect.poll(() => page.evaluate(() => window.__PROJECT_STRIKE_DEBUG__.getState().camera)).toBe('STANDARD');
  const status = await page.evaluate(() => window.__PROJECT_STRIKE_REBOOT__);
  expect(status.glslFallbackUsed).toBe(false);
  expect(cdnRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('real fire input spends ammunition', async ({ page }, testInfo) => {
  const { pageErrors } = await boot(page, testInfo);
  const before = await page.evaluate(() => window.__PROJECT_STRIKE_DEBUG__.getState().ammo);
  expect(before).toBeGreaterThan(0);
  if (testInfo.project.name.startsWith('desktop')) {
    await page.mouse.move(640, 360);
    await page.mouse.down();
    await page.waitForTimeout(1500);
    await page.mouse.up();
  } else {
    const fire = page.locator('#fireBtn');
    await expect(fire).toBeVisible();
    const box = await fire.boundingBox();
    await page.dispatchEvent('#fireBtn', 'pointerdown', { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 });
    await page.waitForTimeout(1500);
    await page.dispatchEvent('#fireBtn', 'pointerup', { pointerId: 7, pointerType: 'touch', isPrimary: true });
  }
  await expect.poll(() => page.evaluate(() => window.__PROJECT_STRIKE_DEBUG__.getState().ammo), { timeout: 10_000 }).toBeLessThan(before);
  expect(pageErrors).toEqual([]);
});
