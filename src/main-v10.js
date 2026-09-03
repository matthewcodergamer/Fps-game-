// Tiny V10 entry: no V4/V8/V9 monkey patches are loaded here.
const status = document.querySelector('#renderStatus');
const button = document.querySelector('#playBtn');
const runtimeError = document.querySelector('#runtimeError');

window.__PROJECT_STRIKE_ENTRY_LOADED__ = true;
window.__PROJECT_STRIKE_BUILD__ = 'v10-webgpu-real-assets';
window.__PROJECT_STRIKE_BOOT__ = {
  build: 'v10-webgpu-real-assets',
  phase: 'entry',
  startedAt: performance.now()
};

if (status) status.textContent = 'CLEARING OLD RUNTIME CACHE';

(async () => {
  try {
    await Promise.race([
      Promise.resolve(window.__PROJECT_STRIKE_PREBOOT__),
      new Promise(resolve => setTimeout(resolve, 2800))
    ]);

    window.__PROJECT_STRIKE_BOOT__.phase = 'runtime-import';
    if (status) status.textContent = 'STARTING WEBGPU RUNTIME';
    await import('./main-v10-runtime.js');
  } catch (error) {
    console.error('Project Strike V10 startup failed.', error);
    window.__PROJECT_STRIKE_BOOT__.phase = 'fatal';
    if (status) status.textContent = 'V10 STARTUP FAILED';
    if (button) {
      button.disabled = true;
      button.textContent = 'FAILED';
    }
    if (runtimeError) {
      runtimeError.textContent = `V10 startup failed · ${String(error?.message || error).slice(0, 190)}`;
      runtimeError.classList.add('show', 'fatal');
    }
  }
})();
