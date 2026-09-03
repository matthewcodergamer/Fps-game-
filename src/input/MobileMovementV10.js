const pad = document.querySelector('#leftPad');

const state = {
  pointerId: null,
  touchId: null,
  activeCodes: new Set(),
  source: null
};

const codeForAxis = {
  left: 'KeyA',
  right: 'KeyD',
  forward: 'KeyW',
  back: 'KeyS'
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

function setCodes(next) {
  for (const code of state.activeCodes) {
    if (!next.has(code)) dispatchKey(code, false);
  }
  for (const code of next) {
    if (!state.activeCodes.has(code)) dispatchKey(code, true);
  }
  state.activeCodes = next;
}

function vectorFromPoint(clientX, clientY) {
  const rect = pad.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const radius = Math.max(30, Math.min(rect.width, rect.height) * 0.32);
  let x = (clientX - cx) / radius;
  let y = (clientY - cy) / radius;
  const length = Math.hypot(x, y);
  if (length > 1) {
    x /= length;
    y /= length;
  }
  return { x, y, radius };
}

function applyPoint(clientX, clientY) {
  if (!pad) return;
  const { x, y, radius } = vectorFromPoint(clientX, clientY);
  const deadzone = 0.16;
  const next = new Set();
  if (x < -deadzone) next.add(codeForAxis.left);
  if (x > deadzone) next.add(codeForAxis.right);
  if (y < -deadzone) next.add(codeForAxis.forward);
  if (y > deadzone) next.add(codeForAxis.back);
  setCodes(next);

  const stick = pad.querySelector('.stick');
  if (stick) {
    stick.style.transform = `translate3d(${x * radius}px,${y * radius}px,0)`;
  }

  globalThis.__PROJECT_STRIKE_MOBILE_MOVEMENT__ = {
    ready: true,
    source: state.source,
    x,
    y,
    activeCodes: [...next],
    captureResilient: true
  };
}

function reset() {
  setCodes(new Set());
  state.pointerId = null;
  state.touchId = null;
  state.source = null;
  const stick = pad?.querySelector('.stick');
  if (stick) stick.style.transform = 'translate3d(0,0,0)';
  globalThis.__PROJECT_STRIKE_MOBILE_MOVEMENT__ = {
    ready: true,
    source: null,
    x: 0,
    y: 0,
    activeCodes: [],
    captureResilient: true
  };
}

if (pad) {
  pad.style.pointerEvents = 'auto';
  pad.style.touchAction = 'none';

  pad.addEventListener('pointerdown', event => {
    if (state.pointerId != null) return;
    state.pointerId = event.pointerId;
    state.source = 'pointer';
    applyPoint(event.clientX, event.clientY);
    try { pad.setPointerCapture?.(event.pointerId); } catch {}
    event.preventDefault();
  }, { passive: false });

  document.addEventListener('pointermove', event => {
    if (state.pointerId == null || event.pointerId !== state.pointerId) return;
    applyPoint(event.clientX, event.clientY);
    event.preventDefault();
  }, { passive: false, capture: true });

  const endPointer = event => {
    if (state.pointerId == null || event.pointerId !== state.pointerId) return;
    reset();
  };
  document.addEventListener('pointerup', endPointer, true);
  document.addEventListener('pointercancel', endPointer, true);

  // Native touch listeners are a compatibility input path, not a visual or
  // model fallback. They keep movement alive on WebKit builds that interrupt
  // Pointer Events while the browser UI/visual viewport changes.
  pad.addEventListener('touchstart', event => {
    if (state.pointerId != null || state.touchId != null) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    state.touchId = touch.identifier;
    state.source = 'touch';
    applyPoint(touch.clientX, touch.clientY);
    event.preventDefault();
  }, { passive: false });

  document.addEventListener('touchmove', event => {
    if (state.pointerId != null || state.touchId == null) return;
    const touch = [...event.changedTouches].find(item => item.identifier === state.touchId);
    if (!touch) return;
    applyPoint(touch.clientX, touch.clientY);
    event.preventDefault();
  }, { passive: false, capture: true });

  const endTouch = event => {
    if (state.pointerId != null || state.touchId == null) return;
    const ended = [...event.changedTouches].some(item => item.identifier === state.touchId);
    if (ended) reset();
  };
  document.addEventListener('touchend', endTouch, true);
  document.addEventListener('touchcancel', endTouch, true);

  window.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) reset();
  });
}

globalThis.__PROJECT_STRIKE_MOBILE_MOVEMENT__ = {
  ready: Boolean(pad),
  source: null,
  x: 0,
  y: 0,
  activeCodes: [],
  captureResilient: true
};
