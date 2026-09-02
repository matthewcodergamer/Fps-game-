// Keep this entry intentionally tiny. It executes before the large Three.js/V4
// bundle so the boot screen can immediately prove that JavaScript started.
const status = document.querySelector('#renderStatus');
const button = document.querySelector('#playBtn');
const runtimeError = document.querySelector('#runtimeError');

globalThis.__PROJECT_STRIKE_ENTRY_LOADED__ = true;
globalThis.__PROJECT_STRIKE_BOOT__ = {
  startedAt: performance.now(),
  phase: 'entry'
};

if (status) status.textContent = 'Loading Project Strike runtime…';

const slowTimer = setTimeout(() => {
  if (globalThis.__PROJECT_STRIKE_RUNTIME_STARTED__) return;
  if (status) status.textContent = 'Runtime bundle is loading slowly…';
}, 4500);

const fatalTimer = setTimeout(() => {
  if (globalThis.__PROJECT_STRIKE_RUNTIME_STARTED__) return;
  if (status) status.textContent = 'Runtime did not start · reload recommended';
  if (button) {
    button.disabled = false;
    button.textContent = 'RELOAD';
    button.onclick = () => location.reload();
  }
}, 12000);

(async () => {
  try {
    if (status) status.textContent = 'Loading gameplay systems…';
    await import('./v4-runtime-patch.js');

    if (status) status.textContent = 'Starting WebGL renderer…';
    globalThis.__PROJECT_STRIKE_BOOT__.phase = 'stage3-import';
    await import('./main-stage3.js');
  } catch (error) {
    console.error('Project Strike V4 startup failed.', error);
    if (button) {
      button.disabled = false;
      button.textContent = 'RELOAD';
      button.onclick = () => location.reload();
    }
    if (status) status.textContent = 'STARTUP ERROR · tap reload';
    if (runtimeError) {
      runtimeError.textContent = `Startup failed · ${String(error?.message || error).slice(0, 170)}`;
      runtimeError.classList.add('show', 'fatal');
    }
  } finally {
    clearTimeout(slowTimer);
    if (globalThis.__PROJECT_STRIKE_RUNTIME_STARTED__) clearTimeout(fatalTimer);
  }
})();
