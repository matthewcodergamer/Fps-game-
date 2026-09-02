import fs from 'node:fs';
import { expect, test } from '@playwright/test';

test('boots V6 with IK + AAA feel, renders repository viewmodel, and enters gameplay', async ({ page }, testInfo) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') pageErrors.push(message.text());
  });

  await page.goto('/');
  const playButton = page.locator('#playBtn');
  await expect(playButton).toBeEnabled({ timeout: 60_000 });
  await expect(page.locator('#renderStatus')).toContainText('WebGL2 stable');

  const bootDiagnostics = await page.evaluate(() => ({
    runtime: window.__PROJECT_STRIKE_DIAGNOSTICS__,
    ik: window.__PROJECT_STRIKE_IK__,
    aaa: window.__PROJECT_STRIKE_AAA__,
    sourceMode: window.__PROJECT_STRIKE_SOURCE_MODE__
  }));
  expect(bootDiagnostics.runtime?.runtime).toBe('v4');
  expect(bootDiagnostics.runtime?.guardedAssetLoads).toBe(true);
  expect(bootDiagnostics.runtime?.trueBody).toBe(true);
  expect(bootDiagnostics.runtime?.barrelBallistics).toBe(true);
  expect(bootDiagnostics.runtime?.weaponIK).toBe(true);
  expect(bootDiagnostics.runtime?.footIK).toBe(true);
  expect(bootDiagnostics.runtime?.ikSolver).toBe('Three.js CCDIKSolver');
  expect(bootDiagnostics.ik?.active, JSON.stringify(bootDiagnostics.ik)).toBe(true);
  expect(bootDiagnostics.ik?.activeChains, JSON.stringify(bootDiagnostics.ik)).toBeGreaterThanOrEqual(1);
  expect(bootDiagnostics.aaa?.weaponSprings).toBe(true);
  expect(bootDiagnostics.aaa?.splitCameraAndGunRecoil).toBe(true);
  expect(bootDiagnostics.aaa?.freeAimBox).toBe(true);
  expect(bootDiagnostics.aaa?.scopeParallax).toBe(true);
  expect(bootDiagnostics.aaa?.tacticalReload).toBe(true);
  expect(bootDiagnostics.aaa?.emptyReload).toBe(true);
  expect(bootDiagnostics.aaa?.reloadIKRetargeting).toBe(true);
  expect(bootDiagnostics.aaa?.materialImpactDebris).toBe(true);
  // Vite production output rewrites the source entry to a hashed bundle, so
  // source mode must be false in the deployed/preview artifact.
  expect(bootDiagnostics.sourceMode).toBe(false);

  await playButton.click();
  await expect(page.locator('#hud')).toBeVisible();
  await expect(page.locator('#weaponName')).toContainText('M4A1');
  await expect(page.locator('#statusText')).toContainText('READY', { timeout: 30_000 });

  if (testInfo.project.name === 'desktop-chromium') {
    await page.keyboard.down('w');
    await page.keyboard.down('Shift');
    await page.waitForTimeout(450);
    await page.keyboard.press('c');
    await page.waitForTimeout(250);
    await page.keyboard.up('Shift');
    await page.keyboard.up('w');
    await page.mouse.down();
    await page.waitForTimeout(120);
    await page.mouse.up();
    await page.keyboard.press('r');
  } else {
    await page.locator('#fireBtn').click();
    await page.locator('#slideBtn').click();
  }
  await page.waitForTimeout(850);

  const diagnostics = await page.evaluate(() => {
    const canvas = document.querySelector('#game');
    return {
      width: canvas.width,
      height: canvas.height,
      cssWidth: canvas.clientWidth,
      cssHeight: canvas.clientHeight,
      ik: window.__PROJECT_STRIKE_IK__,
      aaa: window.__PROJECT_STRIKE_AAA__,
      feel: window.__PROJECT_STRIKE_AAA_STATE__
    };
  });

  expect(diagnostics.width).toBeGreaterThan(300);
  expect(diagnostics.height).toBeGreaterThan(200);
  expect(diagnostics.cssWidth / diagnostics.cssHeight).toBeCloseTo(
    testInfo.project.use.viewport.width / testInfo.project.use.viewport.height,
    1
  );
  expect(diagnostics.ik?.active, JSON.stringify(diagnostics.ik)).toBe(true);
  expect(diagnostics.aaa?.weaponSprings).toBe(true);
  expect(diagnostics.feel).toBeTruthy();

  const screenshot = testInfo.outputPath('gameplay.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  expect(fs.statSync(screenshot).size).toBeGreaterThan(20_000);
  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});
