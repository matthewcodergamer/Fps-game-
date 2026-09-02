import fs from 'node:fs';
import { expect, test } from '@playwright/test';

test('boots V7 with iOS memory guard, IK, AAA feel and physical reactions', async ({ page }, testInfo) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') pageErrors.push(message.text());
  });

  await page.goto('/');
  const playButton = page.locator('#playBtn');
  await expect(playButton).toBeEnabled({ timeout: 60_000 });
  await expect(page.locator('#stageBadge')).toContainText('V7', { timeout: 8_000 });

  const bootDiagnostics = await page.evaluate(() => ({
    runtime: window.__PROJECT_STRIKE_DIAGNOSTICS__,
    ik: window.__PROJECT_STRIKE_IK__,
    aaa: window.__PROJECT_STRIKE_AAA__,
    stability: window.__PROJECT_STRIKE_MOBILE_STABILITY__,
    reactions: window.__PROJECT_STRIKE_PHYSICAL_REACTIONS__,
    sourceMode: window.__PROJECT_STRIKE_SOURCE_MODE__
  }));

  expect(bootDiagnostics.runtime?.runtime).toBe('v7');
  expect(bootDiagnostics.runtime?.guardedAssetLoads).toBe(true);
  expect(bootDiagnostics.runtime?.barrelBallistics).toBe(true);
  expect(bootDiagnostics.runtime?.weaponIK).toBe(true);
  expect(bootDiagnostics.runtime?.footIK).toBe(true);
  expect(bootDiagnostics.runtime?.largeAssetCacheDisabled).toBe(true);
  expect(bootDiagnostics.ik?.active, JSON.stringify(bootDiagnostics.ik)).toBe(true);
  expect(bootDiagnostics.ik?.activeChains, JSON.stringify(bootDiagnostics.ik)).toBeGreaterThanOrEqual(1);
  expect(bootDiagnostics.aaa?.weaponSprings).toBe(true);
  expect(bootDiagnostics.aaa?.splitCameraAndGunRecoil).toBe(true);
  expect(bootDiagnostics.aaa?.freeAimBox).toBe(true);
  expect(bootDiagnostics.aaa?.reloadIKRetargeting).toBe(true);
  expect(bootDiagnostics.reactions?.limbHealth).toBe(true);
  expect(bootDiagnostics.reactions?.stagger).toBe(true);
  expect(bootDiagnostics.reactions?.heavyWeaponDismemberment).toBe(true);
  expect(bootDiagnostics.reactions?.euphoriaClaimed).toBe(false);
  expect(bootDiagnostics.sourceMode).toBe(false);

  if (testInfo.project.name === 'iphone-11-landscape') {
    expect(bootDiagnostics.stability?.mobileSafe).toBe(true);
    expect(bootDiagnostics.stability?.maxConcurrentModelDecodes).toBe(1);
    expect(bootDiagnostics.stability?.operatorFallback).toBe(true);
    expect(bootDiagnostics.stability?.opticFallback).toBe(true);
    expect(bootDiagnostics.stability?.grenadeFallback).toBe(true);
    expect(bootDiagnostics.stability?.pmremDisabled).toBe(true);
    expect(bootDiagnostics.stability?.initialEnterableBuildings).toBeLessThanOrEqual(3);
    expect(bootDiagnostics.stability?.heavyWorldPropsDeferred).toBe(true);
  } else {
    expect(bootDiagnostics.stability?.mobileSafe).toBe(false);
  }

  await playButton.click();
  await expect(page.locator('#hud')).toBeVisible();
  await expect(page.locator('#weaponName')).toContainText('M4A1');
  await expect(page.locator('#ammo')).toContainText(/\d+/);

  // #statusText is intentionally transient feedback (audio warmup, hit,
  // reload, equip). It is not a runtime readiness contract. Gameplay state,
  // canvas output, diagnostics and page errors are the real gate.
  if (testInfo.project.name === 'desktop-chromium') {
    await page.keyboard.down('w');
    await page.keyboard.down('Shift');
    await page.waitForTimeout(350);
    await page.keyboard.press('c');
    await page.waitForTimeout(180);
    await page.keyboard.up('Shift');
    await page.keyboard.up('w');
    await page.mouse.down();
    await page.waitForTimeout(100);
    await page.mouse.up();
    await page.keyboard.press('r');
  } else {
    await page.locator('#fireBtn').click();
    await page.locator('#slideBtn').click();
  }

  // Keep the mobile page alive beyond the transition that previously produced
  // Safari's white-screen/process-reload loop.
  await page.waitForTimeout(testInfo.project.name === 'iphone-11-landscape' ? 2_500 : 1_000);

  const diagnostics = await page.evaluate(() => {
    const canvas = document.querySelector('#game');
    return {
      width: canvas.width,
      height: canvas.height,
      cssWidth: canvas.clientWidth,
      cssHeight: canvas.clientHeight,
      visibility: document.visibilityState,
      ik: window.__PROJECT_STRIKE_IK__,
      aaa: window.__PROJECT_STRIKE_AAA__,
      feel: window.__PROJECT_STRIKE_AAA_STATE__,
      stability: window.__PROJECT_STRIKE_MOBILE_STABILITY__,
      reactions: window.__PROJECT_STRIKE_PHYSICAL_REACTIONS__
    };
  });

  expect(diagnostics.width).toBeGreaterThan(250);
  expect(diagnostics.height).toBeGreaterThan(150);
  expect(diagnostics.cssWidth / diagnostics.cssHeight).toBeCloseTo(
    testInfo.project.use.viewport.width / testInfo.project.use.viewport.height,
    1
  );
  expect(diagnostics.visibility).toBe('visible');
  expect(diagnostics.ik?.active, JSON.stringify(diagnostics.ik)).toBe(true);
  expect(diagnostics.aaa?.weaponSprings).toBe(true);
  expect(diagnostics.feel).toBeTruthy();
  expect(diagnostics.reactions?.positionalHitZones).toBe(true);

  const screenshot = testInfo.outputPath('gameplay.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  expect(fs.statSync(screenshot).size).toBeGreaterThan(20_000);
  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});
