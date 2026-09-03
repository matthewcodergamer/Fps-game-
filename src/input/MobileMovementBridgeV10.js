const state = {
  activePointer: null,
  pointerType: null,
  keys: new Set(),
  bound: false
};

function dispatchKey(code, down) {
  const type = down ? 'keydown' : 'keyup';
  window.dispatchEvent(new KeyboardEvent(type, {
    code,
    key: code === 'KeyW' ? 'w' : code === 'KeyS' ? 's' : code === 'KeyA' ? 'a' : 'd',
    bubbles: true,
    cancelable: true
  }));
}

function setKeys(next) {
  for (const code of state.keys) {
    if (!next.has(code)) dispatchKey(code, false);
  }
  for (const code of next) {
    if (!state.keys.has(code)) dispatchKey(code, true);
  }
  state.keys = next;
}

function reset() {
  state.activePointer = null;
  state.pointerType = null;
  setKeys(new Set());
  globalThis.__PROJECT_STRIKE_MOBILE_INPUT_BRIDGE__ = {
    active: false,
    keys: [],
    captureIndependent: true
  };
}

function applyVector(x, y) {
  const deadZone = 0.16;
  const next = new Set();
  if (y < -deadZone) next.add('KeyW');
  if (y > deadZone) next.add('KeyS');
  if (x < -deadZone) next.add('KeyA');
  if (x > deadZone) next.add('KeyD');
  setKeys(next);
  globalThis.__PROJECT_STRIKE_MOBILE_INPUT_BRIDGE__ = {
    active: next.size > 0,
    keys: [...next],
    x,
    y,
    captureIndependent: true
  };
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
    event.preventDefault();
  }, { passive: false });

  window.addEventListener('pointermove', event => {
    move(event.pointerId, event.clientX, event.clientY);
  }, { passive: true, capture: true });
  window.addEventListener('pointerup', event => end(event.pointerId), { passive: true, capture: true });
  window.addEventListener('pointercancel', event => end(event.pointerId), { passive: true, capture: true });

  // Safari fallback for cases where Pointer Events are interrupted by browser UI.
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

  globalThis.__PROJECT_STRIKE_MOBILE_INPUT_BRIDGE__ = {
    active: false,
    keys: [],
    captureIndependent: true,
    installed: true
  };
}
