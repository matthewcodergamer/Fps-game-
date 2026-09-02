import fs from 'node:fs';
import { expect, test } from '@playwright/test';

test('boots V4 with IK, renders repository viewmodel, and enters gameplay', async ({ page }, testInfo) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') pageErrors.push(message.text());
  });

  await page.goto('/');
  const playButton = page.locator('#playBtn');
  await expect(playButton).toBeEnabled({ timeout: 60_000 });
  await expect(page.locator('#renderStatus')).toContainText('WebGL2 stable');
  await expect(page.locator('#stageBadge')).toContainText('V4');

  const bootDiagnostics = await page.evaluate(() => ({
    runtime: window.__PROJECT_STRIKE_DIAGNOSTICS__,
    ik: window.__PROJECT_STRIKE_IK__
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
      ik: window.__PROJECT_STRIKE_IK__
    };
  });

  expect(diagnostics.width).toBeGreaterThan(300);
  expect(diagnostics.height).toBeGreaterThan(200);
  expect(diagnostics.cssWidth / diagnostics.cssHeight).toBeCloseTo(
    testInfo.project.use.viewport.width / testInfo.project.use.viewport.height,
    1
  );
  expect(diagnostics.ik?.active, JSON.stringify(diagnostics.ik)).toBe(true);

  const screenshot = testInfo.outputPath('gameplay.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  expect(fs.statSync(screenshot).size).toBeGreaterThan(20_000);
  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});
