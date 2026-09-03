import fs from 'node:fs';
import { expect, test } from '@playwright/test';

function pointer(type, x, y, pointerId = 21) {
  return {
    pointerId,
    pointerType: 'touch',
    isPrimary: true,
    clientX: x,
    clientY: y,
    bubbles: true,
    cancelable: true,
    buttons: type === 'pointerup' ? 0 : 1
  };
}

async function stableEvaluate(page, expression) {
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await page.evaluate(expression);
    } catch (error) {
      lastError = error;
      if (!/Execution context was destroyed|navigation/i.test(String(error))) throw error;
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(300);
    }
  }
  throw lastError;
}

function isSoftwareWebGPUMappedBufferLimit(message) {
  const match = String(message).match(/createBuffer failed, size \((\d+)\) is too large for the implementation when mappedAtCreation == true/i);
  if (!match) return false;
  const bytes = Number(match[1]);
  return Number.isFinite(bytes) && bytes > 0 && bytes < 1024 * 1024;
}

test('V10.1 renders world, keeps body out of camera, switches real weapons and enables convolution audio', async ({ page }, testInfo) => {
  const errors = [];
  const modelRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => {
    if (/\.(?:glb|gltf|fbx)(?:[?#]|$)/i.test(request.url())) modelRequests.push(request.url());
  });

  await page.goto('/?ci=v10.1', { waitUntil: 'domcontentloaded' });
  const playButton = page.locator('#playBtn');
  await expect(playButton).toBeVisible({ timeout: 240_000 });
  await page.waitForFunction(() => {
    const button = document.querySelector('#playBtn');
    return Boolean(button && (!button.disabled || button.textContent?.includes('FAILED')));
  }, null, { timeout: 240_000 });
  await page.waitForTimeout(550);
  await expect(playButton).toBeVisible({ timeout: 30_000 });

  const startup = await stableEvaluate(page, () => ({
    disabled: document.querySelector('#playBtn')?.disabled,
    text: document.querySelector('#playBtn')?.textContent,
    error: document.querySelector('#runtimeError')?.textContent,
    diagnostics: window.__PROJECT_STRIKE_DIAGNOSTICS__
  }));
  if (startup.disabled) throw new Error(`V10.1 startup failed: ${JSON.stringify({ startup, errors }, null, 2)}`);

  await expect(page.locator('#stageBadge')).toHaveText('V10.1');
  expect(startup.diagnostics?.runtime).toBe('v10.1');
  expect(startup.diagnostics?.renderer).toBe('WebGPU');
  expect(startup.diagnostics?.worldVisible).toBe(true);
  expect(startup.diagnostics?.requiredWorldModels?.length).toBeGreaterThanOrEqual(8);
  expect(startup.diagnostics?.worldLighting?.sun).toBeGreaterThan(3);
  expect(startup.diagnostics?.worldLighting?.hemisphere).toBeGreaterThan(1);
  expect(startup.diagnostics?.weaponSwitching).toBe('real-repository-models');
  expect(startup.diagnostics?.audioEnvironment).toBe('industrial-convolution');

  await playButton.click();
  await expect(page.locator('#hud')).toBeVisible();
  await page.waitForTimeout(250);
  const audio = await stableEvaluate(page, () => window.__PROJECT_STRIKE_AUDIO_ENVIRONMENT__);
  expect(audio?.convolution).toBe(true);
  expect(audio?.wet).toBeGreaterThan(0.15);

  const bodyBefore = await stableEvaluate(page, () => window.__PROJECT_STRIKE_TRUE_BODY_CLEARANCE__);
  expect(bodyBefore?.cameraClearance).toBeGreaterThanOrEqual(0.44);

  const pad = page.locator('#leftPad');
  const padBox = await pad.boundingBox();
  expect(padBox).not.toBeNull();
  const cx = padBox.x + padBox.width / 2;
  const cy = padBox.y + padBox.height / 2;
  await pad.dispatchEvent('pointerdown', pointer('pointerdown', cx, cy));
  await pad.dispatchEvent('pointermove', pointer('pointermove', cx, cy - padBox.height * .31));
  await page.waitForTimeout(250);
  await page.locator('#slideBtn').click();
  await page.waitForTimeout(140);
  const bodySlide = await stableEvaluate(page, () => ({
    clearance: window.__PROJECT_STRIKE_TRUE_BODY_CLEARANCE__,
    player: window.__PROJECT_STRIKE_PLAYER_STATE__
  }));
  expect(bodySlide.clearance?.slideWeight).toBeGreaterThan(0.2);
  expect(bodySlide.clearance?.cameraClearance).toBeGreaterThan(0.5);
  await pad.dispatchEvent('pointerup', pointer('pointerup', cx, cy - padBox.height * .31));

  const beforeWeapon = await page.locator('#weaponName').textContent();
  await page.locator('#switchBtn').click();
  await page.waitForFunction(before => document.querySelector('#weaponName')?.textContent !== before, beforeWeapon, { timeout: 60_000 });
  const afterWeapon = await page.locator('#weaponName').textContent();
  expect(afterWeapon).not.toBe(beforeWeapon);
  const switched = modelRequests.join('\n');
  expect(switched).toMatch(/ak74\.glb|scarl\.glb|vss\.glb/i);
  const switchedDiag = await stableEvaluate(page, () => window.__PROJECT_STRIKE_IK__);
  expect(switchedDiag?.active).toBe(true);

  const screenshot = testInfo.outputPath('v10-1-world-visible.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  expect(fs.statSync(screenshot).size).toBeGreaterThan(15_000);

  // GitHub's Linux runner uses software WebGPU. Chrome 151 can intermittently
  // expose an impossible mappedAtCreation ceiling of only a few KiB (we have
  // observed both 9,552 and 1,956 byte legal vertex buffers rejected). Ignore
  // only that exact sub-megabyte software-backend signature; every other GPU,
  // renderer, world, weapon, IK, audio or browser error remains a hard failure.
  const actionable = errors.filter(message =>
    !/Instance dropped in popErrorScope/i.test(message) &&
    !isSoftwareWebGPUMappedBufferLimit(message)
  );
  expect(actionable, actionable.join('\n')).toEqual([]);
});
