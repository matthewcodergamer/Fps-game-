import fs from 'node:fs';
import { expect, test } from '@playwright/test';

function pointer(type, x, y, pointerId = 7) {
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

test('V10 uses WebGPU, real repository assets, working touch movement and non-accumulating recoil', async ({ page }, testInfo) => {
  const pageErrors = [];
  const modelRequests = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') pageErrors.push(message.text());
  });
  page.on('request', request => {
    if (/\.(?:glb|gltf|fbx)(?:[?#]|$)/i.test(request.url())) modelRequests.push(request.url());
  });

  await page.goto('/?ci=v10', { waitUntil: 'domcontentloaded' });
  const capability = await page.evaluate(() => ({ gpu: Boolean(navigator.gpu), build: window.__PROJECT_STRIKE_BUILD__ }));
  expect(capability.build).toBe('v10-webgpu-real-assets');
  expect(capability.gpu, 'CI Chromium did not expose WebGPU with the configured SwiftShader/Vulkan flags').toBe(true);

  const playButton = page.locator('#playBtn');
  await expect(playButton).toBeEnabled({ timeout: 240_000 });
  await expect(page.locator('#stageBadge')).toHaveText('V10');
  await expect(page.locator('#loadPercent')).toHaveText('100%');

  const boot = await page.evaluate(() => ({
    runtime: window.__PROJECT_STRIKE_DIAGNOSTICS__,
    ik: window.__PROJECT_STRIKE_IK__,
    body: window.__PROJECT_STRIKE_TRUE_BODY__,
    vfx: window.__PROJECT_STRIKE_GPU_VFX__,
    touch: {
      padEvents: getComputedStyle(document.querySelector('#leftPad')).pointerEvents,
      lookEvents: getComputedStyle(document.querySelector('#lookZone')).pointerEvents,
      padTouchAction: getComputedStyle(document.querySelector('#leftPad')).touchAction,
      lookTouchAction: getComputedStyle(document.querySelector('#lookZone')).touchAction
    }
  }));

  expect(boot.runtime?.runtime).toBe('v10');
  expect(boot.runtime?.renderer).toBe('WebGPU');
  expect(boot.runtime?.webGPUBackend).toBe(true);
  expect(boot.runtime?.noRenderingFallback).toBe(true);
  expect(boot.runtime?.noProceduralAssetFallbacks).toBe(true);
  expect(boot.runtime?.cumulativeCameraShake).toBe(false);
  expect(boot.runtime?.realRepositoryModels).toBe(true);
  expect(boot.runtime?.arms?.realRepositoryModel).toBe(true);
  expect(boot.runtime?.weapon?.realRepositoryModel).toBe(true);
  expect(boot.runtime?.frag?.realRepositoryModel).toBe(true);
  expect(boot.runtime?.flash?.realRepositoryModel).toBe(true);
  expect(boot.runtime?.requiredWorldModels?.length).toBeGreaterThanOrEqual(8);
  expect(boot.ik?.active, JSON.stringify(boot.ik)).toBe(true);
  expect(boot.ik?.activeChains, JSON.stringify(boot.ik)).toBeGreaterThanOrEqual(1);
  expect(boot.body?.ready).toBe(true);
  expect(boot.body?.proceduralFallback).toBe(false);
  expect(boot.vfx?.backend).toBe('WebGPU compute');
  expect(boot.vfx?.cpuParticleLoops).toBe(false);
  expect(boot.touch.padEvents).toBe('auto');
  expect(boot.touch.lookEvents).toBe('auto');
  expect(boot.touch.padTouchAction).toBe('none');
  expect(boot.touch.lookTouchAction).toBe('none');

  const requested = modelRequests.join('\n');
  for (const expression of [
    /free_fps_arms_gameready_-_rigged\.glb/i,
    /colt_m4a1_carbine\.glb/i,
    /free_pbr_holo_sight_optics.*\.glb/i,
    /bamen_military_soldier_animated\.glb/i,
    /bamen_military_soldier\.glb/i,
    /high-quality_frag_grenade_3d_model\.glb/i,
    /flashbang\.glb/i,
    /building-a-enterable\.glb/i
  ]) expect(requested).toMatch(expression);

  await playButton.click();
  await expect(page.locator('#hud')).toBeVisible();
  await expect(page.locator('#weaponName')).toHaveText('M4A1');

  const beforeMove = await page.evaluate(() => window.__PROJECT_STRIKE_PLAYER_STATE__?.position || [0, 0, 12]);
  const padBox = await page.locator('#leftPad').boundingBox();
  expect(padBox).not.toBeNull();
  const cx = padBox.x + padBox.width / 2;
  const cy = padBox.y + padBox.height / 2;
  await page.locator('#leftPad').dispatchEvent('pointerdown', pointer('pointerdown', cx, cy));
  await page.locator('#leftPad').dispatchEvent('pointermove', pointer('pointermove', cx, cy - padBox.height * 0.31));
  await page.waitForTimeout(850);
  await page.locator('#leftPad').dispatchEvent('pointerup', pointer('pointerup', cx, cy - padBox.height * 0.31));
  await page.waitForTimeout(120);

  const afterMove = await page.evaluate(() => window.__PROJECT_STRIKE_PLAYER_STATE__);
  expect(afterMove?.movementInputActive).toBe(false);
  const moved = Math.hypot(afterMove.position[0] - beforeMove[0], afterMove.position[2] - beforeMove[2]);
  expect(moved, `player failed to move: ${JSON.stringify({ beforeMove, afterMove })}`).toBeGreaterThan(0.35);

  const beforeFire = await page.evaluate(() => ({ ...window.__PROJECT_STRIKE_PLAYER_STATE__ }));
  const fire = page.locator('#fireBtn');
  const fireBox = await fire.boundingBox();
  const fx = fireBox.x + fireBox.width / 2;
  const fy = fireBox.y + fireBox.height / 2;
  await fire.dispatchEvent('pointerdown', pointer('pointerdown', fx, fy, 12));
  await page.waitForTimeout(480);
  await fire.dispatchEvent('pointerup', pointer('pointerup', fx, fy, 12));
  await page.waitForTimeout(1200);

  const afterFire = await page.evaluate(() => ({
    player: window.__PROJECT_STRIKE_PLAYER_STATE__,
    diagnostics: window.__PROJECT_STRIKE_DIAGNOSTICS__,
    canvas: {
      width: document.querySelector('#game').width,
      height: document.querySelector('#game').height,
      cssWidth: document.querySelector('#game').clientWidth,
      cssHeight: document.querySelector('#game').clientHeight
    },
    ammo: Number(document.querySelector('#ammo')?.textContent || 0)
  }));

  expect(afterFire.ammo).toBeLessThan(30);
  expect(Number.isFinite(afterFire.player?.pitch)).toBe(true);
  expect(Number.isFinite(afterFire.player?.yaw)).toBe(true);
  expect(Math.abs(afterFire.player.pitch - beforeFire.pitch)).toBeLessThan(0.16);
  expect(Math.abs(afterFire.player.yaw - beforeFire.yaw)).toBeLessThan(0.14);
  expect(afterFire.diagnostics?.recoilOwner).toContain('deterministic-player-aim');
  expect(afterFire.diagnostics?.cumulativeCameraShake).toBe(false);
  expect(afterFire.canvas.width).toBeGreaterThan(300);
  expect(afterFire.canvas.height).toBeGreaterThan(150);
  expect(afterFire.canvas.cssWidth / afterFire.canvas.cssHeight).toBeCloseTo(
    testInfo.project.use.viewport.width / testInfo.project.use.viewport.height,
    1
  );

  const screenshot = testInfo.outputPath('iphone-v10-webgpu-real-assets.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  expect(fs.statSync(screenshot).size).toBeGreaterThan(15_000);
  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});
