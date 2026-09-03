const state = {
  activePointer: null,
  pointerType: null,
  keys: new Set(),
  bound: false,
  x: 0,
  y: 0
};

function publish(x = state.x, y = state.y) {
  state.x = Number.isFinite(x) ? x : 0;
  state.y = Number.isFinite(y) ? y : 0;
  const deadZone = 0.16;
  const keys = [];
  if (state.y < -deadZone) keys.push('KeyW');
  if (state.y > deadZone) keys.push('KeyS');
  if (state.x < -deadZone) keys.push('KeyA');
  if (state.x > deadZone) keys.push('KeyD');
  state.keys = new Set(keys);

  // V10 consumes x/y directly every frame. Do not translate touch movement
  // through synthetic KeyboardEvents: WebKit and headless WebGPU browsers can
  // legitimately treat constructed key events differently from real hardware.
  globalThis.__PROJECT_STRIKE_MOBILE_INPUT_BRIDGE__ = {
    active: Math.hypot(state.x, state.y) > deadZone,
    keys,
    x: state.x,
    y: state.y,
    pointerType: state.pointerType,
    captureIndependent: true,
    analogAuthoritative: true,
    installed: state.bound
  };
}

function reset() {
  state.activePointer = null;
  state.pointerType = null;
  state.keys.clear();
  publish(0, 0);
}

function applyVector(x, y) {
  publish(x, y);
}

function vectorFromPoint(pad, clientX, clientY) {
  const rect = pad.getBoundingClientRect();
  const radius = Math.max(30, Math.min(rect.width, rect.height) * 0.32);
  const dx = clientX - (rect.left + rect.width / 2);
  const dy = clientY - (rect.top + rect.height / 2);
  const length = Math.hypot(dx, dy);
  const scale = length > radius ? radius / Math.max(length, 0.0001) : 1;
  return { x: (dx * scale) / radius, y: (dy * scale) / radius };
}

export function installMobileMovementBridgeV10() {
  if (state.bound) return;
  const pad = document.querySelector('#leftPad');
  if (!pad) return;
  state.bound = true;
  pad.style.pointerEvents = 'auto';
  pad.style.touchAction = 'none';

  const begin = (pointerId, pointerType, clientX, clientY) => {
    if (state.activePointer != null && state.activePointer !== pointerId) return;
    state.activePointer = pointerId;
    state.pointerType = pointerType;
    const vector = vectorFromPoint(pad, clientX, clientY);
    applyVector(vector.x, vector.y);
  };

  const move = (pointerId, clientX, clientY) => {
    if (state.activePointer !== pointerId) return;
    const vector = vectorFromPoint(pad, clientX, clientY);
    applyVector(vector.x, vector.y);
  };

  const end = pointerId => {
    if (state.activePointer !== pointerId) return;
    reset();
  };

  pad.addEventListener('pointerdown', event => {
    begin(event.pointerId, event.pointerType || 'pointer', event.clientX, event.clientY);
    try { pad.setPointerCapture?.(event.pointerId); } catch {}
    event.preventDefault();
  }, { passive: false });

  // Capture on window makes the stick survive fingers leaving the visual pad,
  // VisualViewport shifts, and Safari chrome appearing/disappearing.
  window.addEventListener('pointermove', event => {
    move(event.pointerId, event.clientX, event.clientY);
  }, { passive: true, capture: true });
  window.addEventListener('pointerup', event => end(event.pointerId), { passive: true, capture: true });
  window.addEventListener('pointercancel', event => end(event.pointerId), { passive: true, capture: true });

  // Native Touch Events remain only as an input compatibility path. They are
  // not a rendering/model fallback and still feed the same authoritative x/y.
  pad.addEventListener('touchstart', event => {
    if (state.activePointer != null) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    begin(`touch-${touch.identifier}`, 'touch', touch.clientX, touch.clientY);
    event.preventDefault();
  }, { passive: false });
  window.addEventListener('touchmove', event => {
    if (typeof state.activePointer !== 'string' || !state.activePointer.startsWith('touch-')) return;
    const identifier = Number(state.activePointer.slice(6));
    const touch = [...event.touches].find(item => item.identifier === identifier);
    if (!touch) return;
    move(state.activePointer, touch.clientX, touch.clientY);
  }, { passive: true, capture: true });
  window.addEventListener('touchend', event => {
    if (typeof state.activePointer !== 'string' || !state.activePointer.startsWith('touch-')) return;
    const identifier = Number(state.activePointer.slice(6));
    if ([...event.changedTouches].some(item => item.identifier === identifier)) reset();
  }, { passive: true, capture: true });
  window.addEventListener('touchcancel', () => reset(), { passive: true, capture: true });
  window.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });

  publish(0, 0);
}
