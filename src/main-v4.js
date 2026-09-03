// V10.1 keeps the historical entry filename so existing Pages/source links stay
// valid, but the old V4/V8/V9 monkey-patch stack is no longer imported.
const status = document.querySelector('#renderStatus');
const button = document.querySelector('#playBtn');
const runtimeError = document.querySelector('#runtimeError');

globalThis.__PROJECT_STRIKE_ENTRY_LOADED__ = true;
if (globalThis.__PROJECT_STRIKE_BOOT__) globalThis.__PROJECT_STRIKE_BOOT__.phase = 'entry-v10.1';

(async () => {
  try {
    if (status) status.textContent = 'Refreshing V10.1 cache state…';
    await Promise.race([
      Promise.resolve(globalThis.__PROJECT_STRIKE_PREBOOT__),
      new Promise(resolve => setTimeout(resolve, 2400))
    ]);

    const { installMobileMovementBridgeV10 } = await import('./input/MobileMovementBridgeV10.js');
    installMobileMovementBridgeV10();

    const { installWebGPUHotSwapGuard } = await import('./rendering/WebGPUHotSwapGuard.js');
    installWebGPUHotSwapGuard();

    if (status) status.textContent = 'Starting V10.1 WebGPU runtime…';
    await import('./main-v10.js');
  } catch (error) {
    console.error('Project Strike V10.1 entry failed.', error);
    if (button) {
      button.disabled = true;
      button.textContent = 'FAILED';
    }
    if (status) status.textContent = 'V10.1 STARTUP ERROR';
    if (runtimeError) {
      runtimeError.textContent = String(error?.message || error).slice(0, 220);
      runtimeError.classList.add('show', 'fatal');
    }
  }
})();
