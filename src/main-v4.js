import './v4-runtime-patch.js';

// Keep the proven Stage 3 game loop as the authoritative runtime. V4 patches
// reliability, body/lighting, tactility and ballistics around it instead of
// forking a second copy of the whole game architecture.
import('./main-stage3.js').catch(error => {
  console.error('Project Strike V4 failed to enter the Stage 3 runtime.', error);
  const button = document.querySelector('#playBtn');
  const status = document.querySelector('#renderStatus');
  if (button) {
    button.disabled = true;
    button.textContent = 'FAILED';
  }
  if (status) status.textContent = 'STARTUP ERROR';
});
