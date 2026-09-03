import { test, expect } from '@playwright/test';
test('Babylon reboot boots WebGPU + Havok vertical slice', async ({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/?ci=reboot',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#deployBtn')).toBeEnabled({timeout:180000});
  const status=await page.evaluate(()=>window.__PROJECT_STRIKE_REBOOT__);
  expect(status?.ready).toBe(true);expect(status?.renderer).toBe('WebGPU');expect(status?.physics).toBe('Havok');expect(status?.characterController).toBe('PhysicsCharacterController');
  await page.locator('#deployBtn').click();await expect(page.locator('#hud')).not.toHaveClass(/hidden/);
  expect(errors).toEqual([]);
});
