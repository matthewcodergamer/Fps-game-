import fs from 'node:fs';
import { expect, test } from '@playwright/test';

test('boots V8 iPhone survival mode without model requests or reload loops', async ({ page }, testInfo) => {
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

  await page.goto('/?ci=v8');
  const playButton = page.locator('#playBtn');
  await expect(playButton).toBeEnabled({ timeout: 60_000 });
  await expect(page.locator('#stageBadge')).toContainText('V8', { timeout: 10_000 });

  const bootDiagnostics = await page.evaluate(() => ({
    runtime: window.__PROJECT_STRIKE_DIAGNOSTICS__,
    ik: window.__PROJECT_STRIKE_IK__,
    aaa: window.__PROJECT_STRIKE_AAA__,
    stability: window.__PROJECT_STRIKE_MOBILE_STABILITY__,
    survival: window.__PROJECT_STRIKE_IOS_SURVIVAL_RUNTIME__,
    reactions: window.__PROJECT_STRIKE_PHYSICAL_REACTIONS__,
    sourceMode: window.__PROJECT_STRIKE_SOURCE_MODE__,
    build: window.__PROJECT_STRIKE_BUILD__
  }));

  expect(bootDiagnostics.build).toBe('v8-ios-survival');
  expect(bootDiagnostics.runtime?.runtime).toBe('v8');
  expect(bootDiagnostics.runtime?.guardedAssetLoads).toBe(true);
  expect(bootDiagnostics.runtime?.barrelBallistics).toBe(true);
  expect(bootDiagnostics.runtime?.weaponIK).toBe(true);
  expect(bootDiagnostics.runtime?.footIK).toBe(true);
  expect(bootDiagnostics.runtime?.largeAssetCacheDisabled).toBe(true);
  expect(bootDiagnostics.aaa?.weaponSprings).toBe(true);
  expect(bootDiagnostics.aaa?.splitCameraAndGunRecoil).toBe(true);
  expect(bootDiagnostics.aaa?.freeAimBox).toBe(true);
  expect(bootDiagnostics.reactions?.limbHealth).toBe(true);
  expect(bootDiagnostics.reactions?.stagger).toBe(true);
  expect(bootDiagnostics.reactions?.heavyWeaponDismemberment).toBe(true);
  expect(bootDiagnostics.reactions?.euphoriaClaimed).toBe(false);
  expect(bootDiagnostics.sourceMode).toBe(false);

  if (isIphone) {
    expect(bootDiagnostics.stability?.mobileSafe).toBe(true);
    expect(bootDiagnostics.stability?.survivalMode).toBe(true);
    expect(bootDiagnostics.stability?.maxConcurrentModelDecodes).toBe(0);
    expect(bootDiagnostics.stability?.initialRepositoryModelLoads).toBe(0);
    expect(bootDiagnostics.stability?.initialEnterableBuildings).toBe(0);
    expect(bootDiagnostics.stability?.viewModelFallback).toBe(true);
    expect(bootDiagnostics.stability?.operatorFallback).toBe(true);
    expect(bootDiagnostics.stability?.opticFallback).toBe(true);
    expect(bootDiagnostics.stability?.grenadeFallback).toBe(true);
    expect(bootDiagnostics.stability?.pmremDisabled).toBe(true);
    expect(bootDiagnostics.stability?.shadowMapsDisabled).toBe(true);
    expect(bootDiagnostics.stability?.audioPrewarmDisabled).toBe(true);
    expect(bootDiagnostics.survival?.proceduralViewmodelCountsAsReady).toBe(true);
    expect(modelRequests, JSON.stringify(modelRequests)).toEqual([]);
  } else {
    // Desktop deliberately keeps the complete repository GLB path. On shared
    // CI runners that full scene can saturate software WebGL, so its gate is
    // boot/render/IK correctness rather than synthetic high-rate input timing.
    expect(bootDiagnostics.stability?.mobileSafe).toBe(false);
    expect(bootDiagnostics.ik?.active, JSON.stringify(bootDiagnostics.ik)).toBe(true);
    expect(bootDiagnostics.ik?.activeChains, JSON.stringify(bootDiagnostics.ik)).toBeGreaterThanOrEqual(1);
    expect(modelRequests.length).toBeGreaterThan(0);
  }

  await playButton.click();
  await expect(page.locator('#hud')).toBeVisible();
  await expect(page.locator('#weaponName')).toContainText('M4A1');

  if (isIphone) {
    // This is the actual regression gate for the user's Safari crash: interact
    // after Deploy and remain alive beyond the former white-screen transition.
    await page.locator('#fireBtn').click();
    await page.locator('#slideBtn').click();
    await page.waitForTimeout(5_000);
  } else {
    await page.waitForTimeout(500);
  }

  const diagnostics = await page.evaluate(() => {
    const canvas = document.querySelector('#game');
    return {
      width: canvas.width,
      height: canvas.height,
      cssWidth: canvas.clientWidth,
      cssHeight: canvas.clientHeight,
      visibility: document.visibilityState,
      build: window.__PROJECT_STRIKE_BUILD__,
      stability: window.__PROJECT_STRIKE_MOBILE_STABILITY__,
      reactions: window.__PROJECT_STRIKE_PHYSICAL_REACTIONS__,
      feel: window.__PROJECT_STRIKE_AAA_STATE__,
      webglLost: canvas.getContext('webgl2')?.isContextLost?.() || false
    };
  });

  expect(diagnostics.width).toBeGreaterThan(200);
  expect(diagnostics.height).toBeGreaterThan(120);
  expect(diagnostics.cssWidth / diagnostics.cssHeight).toBeCloseTo(
    testInfo.project.use.viewport.width / testInfo.project.use.viewport.height,
    1
  );
  expect(diagnostics.visibility).toBe('visible');
  expect(diagnostics.build).toBe('v8-ios-survival');
  expect(diagnostics.webglLost).toBe(false);
  expect(diagnostics.feel).toBeTruthy();
  expect(diagnostics.reactions?.positionalHitZones).toBe(true);
  expect(mainFrameNavigations).toBe(1);

  if (isIphone) {
    expect(modelRequests, JSON.stringify(modelRequests)).toEqual([]);
    expect(diagnostics.stability?.survivalMode).toBe(true);
    const screenshot = testInfo.outputPath('iphone-gameplay.png');
    await page.screenshot({ path: screenshot, fullPage: true });
    expect(fs.statSync(screenshot).size).toBeGreaterThan(15_000);
  }

  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});
