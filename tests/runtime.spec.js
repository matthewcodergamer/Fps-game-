import fs from 'node:fs';
import { expect, test } from '@playwright/test';

test('boots V9 with real repository models, working mobile input, and bounded recoil', async ({ page }, testInfo) => {
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

  await page.goto('/?ci=v9');
  const playButton = page.locator('#playBtn');
  await expect(playButton).toBeEnabled({ timeout: 120_000 });
  await expect(page.locator('#stageBadge')).toContainText('V9', { timeout: 10_000 });

  const bootDiagnostics = await page.evaluate(() => ({
    runtime: window.__PROJECT_STRIKE_DIAGNOSTICS__,
    ik: window.__PROJECT_STRIKE_IK__,
    aaa: window.__PROJECT_STRIKE_AAA__,
    stability: window.__PROJECT_STRIKE_MOBILE_STABILITY__,
    mobileRuntime: window.__PROJECT_STRIKE_IOS_SURVIVAL_RUNTIME__,
    stream: window.__PROJECT_STRIKE_REAL_ASSET_STREAM__,
    grenades: window.__PROJECT_STRIKE_GRENADE_MODELS__,
    reactions: window.__PROJECT_STRIKE_PHYSICAL_REACTIONS__,
    sourceMode: window.__PROJECT_STRIKE_SOURCE_MODE__,
    build: window.__PROJECT_STRIKE_BUILD__,
    weaponName: document.querySelector('#weaponName')?.textContent,
    touchInput: {
      pad: getComputedStyle(document.querySelector('#leftPad')).pointerEvents,
      look: getComputedStyle(document.querySelector('#lookZone')).pointerEvents,
      padTouchAction: getComputedStyle(document.querySelector('#leftPad')).touchAction,
      lookTouchAction: getComputedStyle(document.querySelector('#lookZone')).touchAction
    }
  }));

  expect(bootDiagnostics.build).toBe('v9-real-assets');
  expect(bootDiagnostics.runtime?.runtime).toBe('v9');
  expect(bootDiagnostics.runtime?.guardedAssetLoads).toBe(true);
  expect(bootDiagnostics.runtime?.barrelBallistics).toBe(true);
  expect(bootDiagnostics.runtime?.weaponIK).toBe(true);
  expect(bootDiagnostics.runtime?.footIK).toBe(true);
  expect(bootDiagnostics.runtime?.realRepositoryModels).toBe(true);
  expect(bootDiagnostics.aaa?.weaponSprings).toBe(true);
  expect(bootDiagnostics.aaa?.splitCameraAndGunRecoil).toBe(true);
  expect(bootDiagnostics.reactions?.limbHealth).toBe(true);
  expect(bootDiagnostics.reactions?.stagger).toBe(true);
  expect(bootDiagnostics.reactions?.euphoriaClaimed).toBe(false);
  expect(bootDiagnostics.sourceMode).toBe(false);
  expect(bootDiagnostics.weaponName).toContain('M4A1');

  // Concrete regression for the real-device movement bug. #hud is intentionally
  // pointer-events:none; these two interactive descendants must opt back in.
  expect(bootDiagnostics.touchInput.pad).toBe('auto');
  expect(bootDiagnostics.touchInput.look).toBe('auto');
  expect(bootDiagnostics.touchInput.padTouchAction).toBe('none');
  expect(bootDiagnostics.touchInput.lookTouchAction).toBe('none');

  const requested = modelRequests.join('\n');
  expect(requested).toMatch(/bamen_military_soldier_animated\.glb/i);
  expect(requested).toMatch(/free_fps_arms_gameready_-_rigged\.glb/i);
  expect(requested).toMatch(/colt_m4a1_carbine\.glb/i);
  expect(requested).toMatch(/high-quality_frag_grenade_3d_model\.glb/i);
  expect(requested).toMatch(/flashbang\.glb/i);

  if (isIphone) {
    expect(bootDiagnostics.stability?.mobileSafe).toBe(true);
    expect(bootDiagnostics.stability?.survivalMode).toBe(false);
    expect(bootDiagnostics.stability?.realAssetStreaming).toBe(true);
    expect(bootDiagnostics.stability?.maxConcurrentModelDecodes).toBe(1);
    expect(bootDiagnostics.stability?.viewModelFallback).toBe(false);
    expect(bootDiagnostics.stability?.operatorFallback).toBe(false);
    expect(bootDiagnostics.stability?.opticFallback).toBe(false);
    expect(bootDiagnostics.stability?.grenadeFallback).toBe(false);
    expect(bootDiagnostics.mobileRuntime?.proceduralViewmodelCountsAsReady).toBe(false);
    expect(bootDiagnostics.mobileRuntime?.realWeaponRequired).toBe(true);
    expect(bootDiagnostics.mobileRuntime?.realArmsRequired).toBe(true);
    expect(bootDiagnostics.mobileRuntime?.realGrenadesRequired).toBe(true);
    expect(bootDiagnostics.stream?.enabled).toBe(true);
    expect(bootDiagnostics.stream?.maxConcurrentModelDecodes).toBe(1);
    expect(bootDiagnostics.grenades?.realRepositoryModels).toBe(true);
    expect(bootDiagnostics.grenades?.frag).toBe(true);
    expect(bootDiagnostics.grenades?.flash).toBe(true);

    // Do not reintroduce the exact 2.6 MB holo model that was on-screen at the
    // Safari crash point. V9 uses the smaller real repository red-dot on iPhone.
    expect(requested).not.toMatch(/free_pbr_holo_sight_optics/i);
    expect(requested).toMatch(/crimson_trace_cts-1550_red_dot_sight\.glb/i);
  } else {
    expect(bootDiagnostics.stability?.mobileSafe).toBe(false);
    expect(bootDiagnostics.ik?.active, JSON.stringify(bootDiagnostics.ik)).toBe(true);
    expect(bootDiagnostics.ik?.activeChains, JSON.stringify(bootDiagnostics.ik)).toBeGreaterThanOrEqual(1);
  }

  await playButton.click();
  await expect(page.locator('#hud')).toBeVisible();
  await expect(page.locator('#weaponName')).toContainText('M4A1');

  if (isIphone) {
    // Reproduce the exact real-phone failure class: fire repeatedly after
    // Deploy, then ensure the recoil spring stays finite/bounded and WebGL lives.
    for (let i = 0; i < 4; i++) {
      await page.locator('#fireBtn').click();
      await page.waitForTimeout(85);
    }
    await page.waitForTimeout(1_000);
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
      stream: window.__PROJECT_STRIKE_REAL_ASSET_STREAM__,
      feel: window.__PROJECT_STRIKE_AAA_STATE__,
      reactions: window.__PROJECT_STRIKE_PHYSICAL_REACTIONS__,
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
  expect(diagnostics.build).toBe('v9-real-assets');
  expect(diagnostics.webglLost).toBe(false);
  expect(diagnostics.feel?.boundedSpring).toBe(true);
  expect(Number.isFinite(diagnostics.feel?.cameraSpring?.pitch)).toBe(true);
  expect(Number.isFinite(diagnostics.feel?.cameraSpring?.yaw)).toBe(true);
  expect(Number.isFinite(diagnostics.feel?.cameraSpring?.roll)).toBe(true);
  expect(Math.abs(diagnostics.feel?.cameraSpring?.pitch || 0)).toBeLessThanOrEqual(1.15);
  expect(Math.abs(diagnostics.feel?.cameraSpring?.yaw || 0)).toBeLessThanOrEqual(.7);
  expect(Math.abs(diagnostics.feel?.cameraSpring?.roll || 0)).toBeLessThanOrEqual(.6);
  expect(diagnostics.reactions?.positionalHitZones).toBe(true);
  expect(mainFrameNavigations).toBe(1);

  if (isIphone) {
    expect(diagnostics.stability?.realAssetStreaming).toBe(true);
    const screenshot = testInfo.outputPath('iphone-v9-real-assets.png');
    await page.screenshot({ path: screenshot, fullPage: true });
    expect(fs.statSync(screenshot).size).toBeGreaterThan(15_000);
  }

  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});
