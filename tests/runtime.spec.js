import fs from 'node:fs';
import { expect, test } from '@playwright/test';

const REQUIRED_MODEL_PATTERNS = [
  /bamen_military_soldier_animated\.glb/i,
  /bamen_military_soldier\.glb/i,
  /free_fps_arms_gameready_-_rigged\.glb/i,
  /colt_m4a1_carbine\.glb/i,
  /high-quality_frag_grenade_3d_model\.glb/i,
  /flashbang\.glb/i,
  /building-a-enterable\.glb/i
];

test('V10 loads only real combat assets on WebGPU and survives movement + firing', async ({ page }, testInfo) => {
  const pageErrors = [];
  const modelRequests = [];
  let mainFrameNavigations = 0;
  const isIphone = testInfo.project.name === 'iphone-11-landscape';

  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') pageErrors.push(message.text());
  });
  page.on('request', request => {
    if (/\.(?:glb|gltf|fbx)(?:[?#]|$)/i.test(request.url())) modelRequests.push(request.url());
  });
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) mainFrameNavigations++;
  });

  await page.goto('/?ci=v10', { waitUntil: 'domcontentloaded' });
  const playButton = page.locator('#playBtn');
  await expect(playButton).toBeEnabled({ timeout: 180_000 });
  await expect(playButton).toHaveText('ENTER');
  await expect(page.locator('#loadPercent')).toHaveText('100%');
  await expect(page.locator('#renderStatus')).toContainText('REAL ASSETS + WEBGPU READY');

  const boot = await page.evaluate(() => ({
    build: window.__PROJECT_STRIKE_BUILD__,
    runtime: window.__PROJECT_STRIKE_DIAGNOSTICS__,
    gpuEffects: window.__PROJECT_STRIKE_GPU_EFFECTS__,
    grenades: window.__PROJECT_STRIKE_GRENADE_MODELS__,
    arena: window.__PROJECT_STRIKE_ARENA__,
    body: window.__PROJECT_STRIKE_TRUE_BODY__,
    assetDiagnostics: window.__PROJECT_STRIKE_ASSET_MANAGER__?.diagnostics,
    navigatorGPU: Boolean(navigator.gpu),
    touchCss: {
      padPointer: getComputedStyle(document.querySelector('#leftPad')).pointerEvents,
      padTouchAction: getComputedStyle(document.querySelector('#leftPad')).touchAction,
      lookPointer: getComputedStyle(document.querySelector('#lookZone')).pointerEvents,
      lookTouchAction: getComputedStyle(document.querySelector('#lookZone')).touchAction
    }
  }));

  expect(boot.navigatorGPU).toBe(true);
  expect(boot.build).toBe('v10-webgpu-real-assets');
  expect(boot.runtime?.runtime).toBe('v10');
  expect(boot.runtime?.renderer).toBe('WebGPU');
  expect(boot.runtime?.webglFallback).toBe(false);
  expect(boot.runtime?.strictRealAssets).toBe(true);
  expect(boot.runtime?.proceduralFallbacks).toBe(false);
  expect(boot.runtime?.realM4A1).toBe(true);
  expect(boot.runtime?.realRiggedArms).toBe(true);
  expect(boot.runtime?.realGrenades).toBe(true);
  expect(boot.runtime?.realOperator).toBe(true);
  expect(boot.runtime?.realLocalBody).toBe(true);
  expect(boot.runtime?.weaponIK).toBe(true);
  expect(boot.runtime?.activeIKChains).toBeGreaterThanOrEqual(1);
  expect(boot.runtime?.gpuWeaponEffects).toBe(true);
  expect(boot.runtime?.singleRecoilOwner).toBe(true);
  expect(boot.runtime?.spawnClearOfCurb).toBe(true);

  expect(boot.gpuEffects?.backend).toBe('WebGPU compute');
  expect(boot.gpuEffects?.cpuParticleMeshes).toBe(false);
  expect(boot.gpuEffects?.crossQuadMuzzleFlash).toBe(true);
  expect(boot.grenades?.realRepositoryModels).toBe(true);
  expect(boot.grenades?.fallbacks).toBe(false);
  expect(boot.grenades?.frag).toBe(true);
  expect(boot.grenades?.flash).toBe(true);
  expect(boot.arena?.strictRealModels).toBe(true);
  expect(boot.arena?.fallbackTargets).toBe(false);
  expect(boot.body?.ready).toBe(true);
  expect(boot.body?.proceduralFallback).toBe(false);
  expect(boot.assetDiagnostics?.strictRealAssets).toBe(true);
  expect(boot.assetDiagnostics?.modelFallbacks).toBe(false);
  if (isIphone) {
    expect(boot.assetDiagnostics?.serializedDecoding).toBe(true);
    expect(boot.assetDiagnostics?.maxConcurrentModelDecodes).toBe(1);
    expect(boot.assetDiagnostics?.peakDecodes).toBeLessThanOrEqual(1);
  }

  expect(boot.touchCss.padPointer).toBe('auto');
  expect(boot.touchCss.lookPointer).toBe('auto');
  expect(boot.touchCss.padTouchAction).toBe('none');
  expect(boot.touchCss.lookTouchAction).toBe('none');

  const requested = modelRequests.join('\n');
  for (const pattern of REQUIRED_MODEL_PATTERNS) expect(requested).toMatch(pattern);

  // The required models finished before ENTER became available. No primitive
  // substitute should have shortened this loading contract.
  await playButton.click();
  await expect(page.locator('#boot')).toBeHidden();
  await expect(page.locator('#hud')).toBeVisible();
  await expect(page.locator('#stageBadge')).toHaveText('V10');
  await page.waitForTimeout(250);

  // Real regression for the user's "player cannot move" report. Drive the
  // left virtual stick with Pointer Events and require actual world displacement.
  const before = await page.evaluate(() => window.__PROJECT_STRIKE_INPUT_STATE__?.position || null);
  expect(before).not.toBeNull();
  const pad = page.locator('#leftPad');
  const box = await pad.boundingBox();
  expect(box).not.toBeNull();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const pointerId = 41;
  await pad.dispatchEvent('pointerdown', {
    pointerId,
    pointerType: 'touch',
    isPrimary: true,
    clientX: cx,
    clientY: cy
  });
  await pad.dispatchEvent('pointermove', {
    pointerId,
    pointerType: 'touch',
    isPrimary: true,
    clientX: cx,
    clientY: cy - box.height * .28
  });
  await page.waitForTimeout(550);
  await pad.dispatchEvent('pointerup', {
    pointerId,
    pointerType: 'touch',
    isPrimary: true,
    clientX: cx,
    clientY: cy - box.height * .28
  });
  await page.waitForTimeout(120);

  const after = await page.evaluate(() => window.__PROJECT_STRIKE_INPUT_STATE__?.position || null);
  expect(after).not.toBeNull();
  const displacement = Math.hypot(after[0] - before[0], after[2] - before[2]);
  expect(displacement).toBeGreaterThan(.08);

  // Reproduce the violent-shake failure with repeated shots. V10 has no camera
  // spring or transform monkey-patch; aim impulse must remain finite and small.
  const fire = page.locator('#fireBtn');
  for (let i = 0; i < 8; i++) {
    await fire.click();
    await page.waitForTimeout(105);
  }
  await page.waitForTimeout(500);

  const gameplay = await page.evaluate(() => ({
    recoil: window.__PROJECT_STRIKE_RECOIL_STATE__,
    input: window.__PROJECT_STRIKE_INPUT_STATE__,
    build: window.__PROJECT_STRIKE_BUILD__,
    canvas: {
      width: document.querySelector('#game')?.width || 0,
      height: document.querySelector('#game')?.height || 0,
      cssWidth: document.querySelector('#game')?.clientWidth || 0,
      cssHeight: document.querySelector('#game')?.clientHeight || 0
    }
  }));

  expect(gameplay.build).toBe('v10-webgpu-real-assets');
  expect(gameplay.recoil?.owner).toBe('single-shot-impulse');
  expect(gameplay.recoil?.cameraSpring).toBe(false);
  expect(gameplay.recoil?.transformPatch).toBe(false);
  expect(gameplay.recoil?.finite).toBe(true);
  expect(gameplay.recoil?.shots).toBeGreaterThanOrEqual(5);
  expect(Math.abs(gameplay.recoil?.pitch || 0)).toBeLessThan(.3);
  expect(Math.abs(gameplay.recoil?.yaw || 0)).toBeLessThan(.2);
  expect(gameplay.canvas.width).toBeGreaterThan(200);
  expect(gameplay.canvas.height).toBeGreaterThan(120);
  expect(gameplay.canvas.cssWidth / gameplay.canvas.cssHeight).toBeCloseTo(
    testInfo.project.use.viewport.width / testInfo.project.use.viewport.height,
    1
  );

  // One extra navigation is tolerated because Chromium/service-worker claim can
  // produce a navigation event in CI. More than that suggests a reload loop.
  expect(mainFrameNavigations).toBeLessThanOrEqual(2);

  const screenshot = testInfo.outputPath(isIphone ? 'iphone-v10-webgpu.png' : 'desktop-v10-webgpu.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  expect(fs.statSync(screenshot).size).toBeGreaterThan(15_000);
  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});
