// Keep this entry intentionally tiny. It executes before the large Three.js/V4
// bundle so the boot screen can immediately prove that JavaScript started.
const status = document.querySelector('#renderStatus');
const button = document.querySelector('#playBtn');
const runtimeError = document.querySelector('#runtimeError');

globalThis.__PROJECT_STRIKE_ENTRY_LOADED__ = true;
globalThis.__PROJECT_STRIKE_BOOT__ = {
  startedAt: performance.now(),
  phase: 'entry',
  build: 'v8-ios-survival'
};

if (status) status.textContent = 'Preparing V8 survival runtime…';

const slowTimer = setTimeout(() => {
  if (globalThis.__PROJECT_STRIKE_RUNTIME_STARTED__) return;
  if (status) status.textContent = 'V8 runtime bundle is loading slowly…';
}, 4500);

const fatalTimer = setTimeout(() => {
  if (globalThis.__PROJECT_STRIKE_RUNTIME_STARTED__) return;
  if (status) status.textContent = 'V8 runtime did not start · reload recommended';
  if (button) {
    button.disabled = false;
    button.textContent = 'RELOAD V8';
    button.onclick = () => location.replace(`${location.pathname}?v=8&reload=${Date.now()}`);
  }
}, 12000);

(async () => {
  try {
    if (status) status.textContent = 'Refreshing old Project Strike cache…';
    await Promise.race([
      Promise.resolve(globalThis.__PROJECT_STRIKE_PREBOOT__),
      new Promise(resolve => setTimeout(resolve, 2200))
    ]);

    if (status) status.textContent = 'Applying zero-model iPhone survival guard…';
    await import('./mobile-stability-patch.js');

    if (status) status.textContent = 'Loading IK and gameplay recovery…';
    await import('./v4-runtime-patch.js');

    if (status) status.textContent = 'Finalizing iPhone procedural fallback…';
    await import('./ios-survival-runtime-patch.js');

    if (status) status.textContent = 'Loading AAA weapon feel…';
    await import('./aaa-runtime-patch.js');

    if (status) status.textContent = 'Loading physical hit reactions…';
    await import('./gore-runtime-patch.js');

    if (status) status.textContent = 'Starting low-memory WebGL renderer…';
    globalThis.__PROJECT_STRIKE_BOOT__.phase = 'stage3-import';
    await import('./main-stage3.js');
  } catch (error) {
    console.error('Project Strike V8 startup failed.', error);
    if (button) {
      button.disabled = false;
      button.textContent = 'RELOAD V8';
      button.onclick = () => location.replace(`${location.pathname}?v=8&reload=${Date.now()}`);
    }
    if (status) status.textContent = 'V8 STARTUP ERROR · tap reload';
    if (runtimeError) {
      runtimeError.textContent = `Startup failed · ${String(error?.message || error).slice(0, 170)}`;
      runtimeError.classList.add('show', 'fatal');
    }
  } finally {
    clearTimeout(slowTimer);
    if (globalThis.__PROJECT_STRIKE_RUNTIME_STARTED__) clearTimeout(fatalTimer);
  }
})();
