// Unified desktop (KBM + pointer lock) and touch input. Continuous state (move / look / held buttons) is merged with
// edge-triggered presses so a tap shorter than one frame is never lost. sample() returns ONE reused object — read it
// during the frame, never keep a reference across frames.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Base look rates (radians per CSS pixel) before the player's sensitivity multiplier.
const MOUSE_RAD_PER_PX = 0.0021;   // ~0.12°/count — same as V11.0 so existing muscle memory carries over
const TOUCH_RAD_PER_PX = 0.0032;   // thumbs travel far less than a mouse
const MOUSE_SPIKE_PX = 600;        // Chrome pointer-lock bug occasionally reports huge single deltas: drop them
const PAD_DEADZONE = 0.08;
const TOUCH_SPRINT_PUSH = 0.95;    // CoD Mobile: stick ≥95% forward…
const TOUCH_SPRINT_HOLD_MS = 250; // …for 0.25 s latches sprint
const TOUCH_SPRINT_RELEASE = 0.55; // latch holds until the stick comes back below this
const TAP_TOGGLE_MS = 260;         // hybrid touch buttons: quick tap toggles, long press acts as hold
const WHEEL_COOLDOWN_MS = 120;     // trackpads emit bursts of wheel events; one weapon step per notch
const COMPAT_MOUSE_IGNORE_MS = 900;// synthetic mouse events that follow touches must not fire the gun

// Keys the game owns; with Ctrl/Alt held we still swallow them (Ctrl+R while crouch-reloading must not reload the page).
const GAME_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyG', 'KeyQ', 'KeyE', 'KeyF', 'KeyV', 'KeyL', 'KeyC', 'KeyX',
  'Space', 'Digit1', 'Digit2', 'Numpad1', 'Numpad2', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'AltLeft', 'AltRight', 'Tab',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const UI_SELECTOR = 'button,select,input,textarea,label,a,[data-ui],#pauseMenu';
const isFormField = t => !!t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
const isUiTarget = t => !!(t && t.closest && t.closest(UI_SELECTOR));
const capture = (el, id) => { try { el.setPointerCapture?.(id); } catch { /* synthetic / already released pointer */ } };
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
// iOS Safari ignores preventDefault on pointerdown for scrolling / double-tap zoom / long-press callouts: the element
// itself must opt out. Set inline so the controls work even if the stylesheet forgets it.
const hardenTouch = el => {
  const st = el.style; if (!st) return;
  st.touchAction = 'none'; st.userSelect = 'none'; st.webkitUserSelect = 'none'; st.webkitTouchCallout = 'none';
};

export class InputRouter {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{sensitivity?:number, invertY?:boolean}} [settings]
   */
  constructor(canvas, settings = {}) {
    this.canvas = canvas;
    this.move = { x: 0, y: 0 };          // touch move pad (analog)
    this.look = { x: 0, y: 0 };          // accumulated look (radians, before sensitivity)
    this.actions = new Set();            // edge presses since last sample()
    this.held = new Set();               // held pointer/touch buttons ('fire','ads','crouch')
    this.keys = new Set();               // held keyboard codes
    this.pointerLocked = false;
    this.sensitivity = Number.isFinite(settings.sensitivity) ? settings.sensitivity : 1;
    this.invertY = !!settings.invertY;
    this.touchActive = false;            // becomes true after the first touch — lets UI/hints adapt
    this.touchSprint = false;            // CoD Mobile auto-sprint latch (read-only for UI)
    this._enabled = true;
    this._movePointer = null;
    this._lookPointer = null;
    this._firePointer = null;
    this._padRect = null;
    this._knob = null;
    this._pad = null;
    this._pushStart = -1;              // timestamp the stick first reached TOUCH_SPRINT_PUSH (-1 = not pushed)
    this._lastTouchAt = -1e9;
    this._lastWheelAt = -1e9;
    this._lastPauseAt = -1e9;
    this._expectUnlock = false;
    this._touchToggles = { ads: false, crouch: false };
    this._bound = new WeakSet();         // DOM controls already wired (bindControls() is idempotent)
    this._fine = typeof matchMedia === 'function' ? matchMedia('(pointer:fine)').matches : true;
    this._state = {
      moveX: 0, moveY: 0, lookX: 0, lookY: 0, fire: false, firePressed: false, ads: false, sprint: false, walk: false,
      crouch: false, crouchPressed: false, crouchToggle: false, jump: false, slide: false, reload: false, grenade: false,
      leanLeft: false, leanRight: false, switchWeapon: 0, nextWeapon: false, inspect: false, toggleBodycam: false,
      cycleLighting: false, pause: false,
    };
    this._onBeforeUnload = e => { e.preventDefault(); e.returnValue = ''; return ''; };
    this._bindKeyboard();
    this._bindPointer();
    this._bindTouchGlobal();
    this.bindControls();
    this._bindLifecycle();
  }

  /** false while a menu is open: gameplay input is ignored and everything held is released. `pause` still passes. */
  get enabled() { return this._enabled; }
  set enabled(v) {
    v = !!v;
    if (v === this._enabled) return;
    this._enabled = v;
    this.releaseAll();
  }

  setSensitivity(v) { if (Number.isFinite(v) && v > 0) this.sensitivity = v; }
  setInvertY(v) { this.invertY = !!v; }

  /** Desktop only; safe to call from a click handler. Handles the promise form and `unadjustedMovement` fallback. */
  requestPointerLock() {
    const el = this.canvas;
    if (!el || !el.requestPointerLock || this.pointerLocked || !this._fine) return;
    const fallback = () => { try { const p = el.requestPointerLock(); p?.catch?.(() => {}); } catch { /* denied */ } };
    try {
      const p = el.requestPointerLock({ unadjustedMovement: true });
      if (p && typeof p.catch === 'function') p.catch(fallback);
    } catch { fallback(); }
  }

  /** Releases pointer lock without it being reported as a pause request. */
  exitPointerLock() {
    if (!this.pointerLocked) return;
    this._expectUnlock = true;
    try { document.exitPointerLock?.(); } catch { /* ignore */ }
  }

  /** Drop every held key/button/touch (menu open, tab hidden, window blur) so nothing sticks. */
  releaseAll() {
    this.keys.clear();
    this.held.clear();
    this.actions.clear();
    this.look.x = this.look.y = 0;
    this.move.x = this.move.y = 0;
    this._movePointer = this._lookPointer = this._firePointer = null;
    this._touchToggles.ads = this._touchToggles.crouch = false;
    this._pushStart = -1;
    this._setTouchSprint(false);
    if (this._knob) this._knob.style.transform = '';
  }

  _pause() {
    const t = now();
    if (t - this._lastPauseAt < 300) return; // Esc keydown + pointer-lock loss arrive together in some browsers
    this._lastPauseAt = t;
    this.actions.add('pause');
  }

  _bindKeyboard() {
    addEventListener('keydown', e => {
      if (e.code === 'Escape') { if (!e.repeat) this._pause(); return; }
      if (isFormField(e.target)) return;
      if (!this._enabled) return;
      if (GAME_CODES.has(e.code) && (this.pointerLocked || e.ctrlKey || e.altKey || e.code === 'Space' || e.code === 'Tab')) {
        e.preventDefault(); // Space scroll, Alt menu-bar focus, Ctrl+R/S/D/F… browser shortcuts (Ctrl+W cannot be blocked)
      }
      this.keys.add(e.code);
      if (e.repeat) return;
      switch (e.code) {
        case 'Space': this.actions.add('jump'); break;
        case 'KeyR': this.actions.add('reload'); break;
        case 'KeyG': this.actions.add('grenade'); break;
        case 'KeyC': case 'ControlLeft': this.actions.add('crouchPressed'); break;
        case 'Digit1': case 'Numpad1': this.actions.add('weapon1'); break;
        case 'Digit2': case 'Numpad2': this.actions.add('weapon2'); break;
        case 'KeyF': this.actions.add('inspect'); break;
        case 'KeyV': this.actions.add('toggleBodycam'); break;
        case 'KeyL': this.actions.add('cycleLighting'); break;
        default: break;
      }
    });
    addEventListener('keyup', e => {
      this.keys.delete(e.code);
      if (e.code === 'AltLeft' || e.code === 'AltRight') e.preventDefault(); // Windows: Alt release focuses the menu bar
    });
    addEventListener('mousedown', e => {
      if (!this._enabled || isUiTarget(e.target)) return;
      if (now() - this._lastTouchAt < COMPAT_MOUSE_IGNORE_MS) return; // emulated mouse event after a touch
      if (e.button === 0) { this.held.add('fire'); this.actions.add('firePressed'); }
      if (e.button === 2) this.held.add('ads');
      if (!this.pointerLocked) this.requestPointerLock();
    });
    addEventListener('mouseup', e => {
      if (e.button === 0) this.held.delete('fire');
      if (e.button === 2) this.held.delete('ads');
    });
    addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('wheel', e => {
      if (!this._enabled || isUiTarget(e.target) || e.deltaY === 0) return;
      const t = now();
      if (t - this._lastWheelAt < WHEEL_COOLDOWN_MS) return;
      this._lastWheelAt = t;
      this.actions.add('nextWeapon');
    }, { passive: true });
  }

  _bindPointer() {
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas;
      const wasLocked = this.pointerLocked;
      this.pointerLocked = locked;
      // Ctrl+W (crouch + forward) cannot be intercepted: ask before closing while actively playing with the mouse.
      if (locked) addEventListener('beforeunload', this._onBeforeUnload);
      else removeEventListener('beforeunload', this._onBeforeUnload);
      if (wasLocked && !locked) {
        // Esc in pointer lock is swallowed by the browser; losing the lock unexpectedly therefore means "pause".
        if (this._enabled && !this._expectUnlock) this._pause();
        this._expectUnlock = false;
        this.held.delete('fire'); this.held.delete('ads');
      }
    });
    document.addEventListener('pointerlockerror', () => { this.pointerLocked = false; });
    addEventListener('mousemove', e => {
      if (!this.pointerLocked || !this._enabled) return;
      const dx = e.movementX || 0, dy = e.movementY || 0;
      if (dx > MOUSE_SPIKE_PX || dx < -MOUSE_SPIKE_PX || dy > MOUSE_SPIKE_PX || dy < -MOUSE_SPIKE_PX) return;
      this.look.x += dx * MOUSE_RAD_PER_PX;
      this.look.y += dy * MOUSE_RAD_PER_PX;
    });
  }

  _setTouchSprint(on) {
    if (this.touchSprint === on) return;
    this.touchSprint = on;
    this._pad?.classList?.toggle('sprinting', on); // UI hook (style optional)
  }

  _bindTouchGlobal() {
    // Any touch anywhere marks this as a touch session and suppresses the compat mouse events that follow it.
    addEventListener('pointerdown', e => { if (e.pointerType === 'touch') { this._lastTouchAt = now(); this.touchActive = true; } }, { capture: true, passive: true });
    addEventListener('pointerup', e => { if (e.pointerType === 'touch') this._lastTouchAt = now(); }, { capture: true, passive: true });
    // iOS Safari pinch-zoom (ignores user-scalable=no) would rescale the canvas mid-fight.
    if (typeof document !== 'undefined') document.addEventListener('gesturestart', e => e.preventDefault(), { passive: false });
  }

  /** Returns the element if present and not wired yet (marks it wired). */
  _claim(selector) {
    const el = typeof document !== 'undefined' ? document.querySelector(selector) : null;
    if (!el || this._bound.has(el)) return null;
    this._bound.add(el);
    hardenTouch(el);
    return el;
  }

  /**
   * Wires the touch controls (#movePad #lookZone #fireBtn #adsBtn #jumpBtn #slideBtn #reloadBtn #grenadeBtn #crouchBtn
   * #swapBtn #camBtn #lightBtn #pauseBtn) that exist right now. Idempotent: call again after the HUD adds controls.
   */
  bindControls() {
    const pad = this._claim('#movePad');
    const look = this._claim('#lookZone');
    if (pad) {
      const knob = pad.querySelector('i');
      this._pad = pad; this._knob = knob;
      const update = e => {
        const r = this._padRect || (this._padRect = pad.getBoundingClientRect());
        const x = e.clientX - (r.left + r.width / 2);
        const y = e.clientY - (r.top + r.height / 2);
        const radius = Math.max(1, r.width * .33);
        const len = Math.hypot(x, y) || 1;
        const scale = Math.min(1, radius / len);
        const px = x * scale, py = y * scale;
        let mx = clamp(px / radius, -1, 1), my = clamp(-py / radius, -1, 1);
        const mag = Math.hypot(mx, my);
        if (mag < PAD_DEADZONE) { mx = my = 0; } else {
          const k = (mag - PAD_DEADZONE) / (1 - PAD_DEADZONE) / mag; // rescale so the deadzone edge starts at 0
          mx *= k; my *= k;
        }
        this.move.x = mx; this.move.y = my;
        if (knob) knob.style.transform = `translate(${px}px,${py}px)`;
      };
      pad.addEventListener('pointerdown', e => {
        if (!this._enabled) return;
        e.preventDefault();
        this._movePointer = e.pointerId;
        this._padRect = pad.getBoundingClientRect(); // read once per drag: no layout thrash on pointermove
        capture(pad, e.pointerId);
        update(e);
      });
      pad.addEventListener('pointermove', e => { if (e.pointerId === this._movePointer && this._enabled) update(e); });
      const end = e => {
        if (e.pointerId !== this._movePointer) return;
        this._movePointer = null; this._padRect = null;
        this.move.x = this.move.y = 0; this._pushStart = -1; this._setTouchSprint(false);
        if (knob) knob.style.transform = '';
      };
      pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end); pad.addEventListener('lostpointercapture', end);
    }

    const bindLookDrag = (el, isOwner, setOwner) => {
      let lastX = 0, lastY = 0;
      el.addEventListener('pointerdown', e => {
        if (e.pointerType !== 'mouse') e.preventDefault(); // no emulated mouse events (they would fire the gun)
        if (!this._enabled) return;
        setOwner(e.pointerId); lastX = e.clientX; lastY = e.clientY; capture(el, e.pointerId);
      });
      el.addEventListener('pointermove', e => {
        if (!isOwner(e.pointerId) || !this._enabled) return;
        this.look.x += (e.clientX - lastX) * TOUCH_RAD_PER_PX;
        this.look.y += (e.clientY - lastY) * TOUCH_RAD_PER_PX;
        lastX = e.clientX; lastY = e.clientY;
      });
    };
    if (look) {
      bindLookDrag(look, id => id === this._lookPointer, id => { this._lookPointer = id; });
      const end = e => { if (e.pointerId === this._lookPointer) this._lookPointer = null; };
      look.addEventListener('pointerup', end); look.addEventListener('pointercancel', end);
    }

    const bindHold = (id, action) => {
      const el = this._claim(id); if (!el) return null;
      const down = e => {
        e.preventDefault();
        if (!this._enabled) return;
        this.held.add(action);
        if (action === 'fire') this.actions.add('firePressed');
        capture(el, e.pointerId);
      };
      const up = e => { e.preventDefault(); this.held.delete(action); };
      el.addEventListener('pointerdown', down); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
      return el;
    };
    // Hybrid hold/toggle (ADS, crouch): tap < TAP_TOGGLE_MS flips a toggle, longer press behaves as hold.
    const bindHybrid = (id, action, onToggle, onDown) => {
      const el = this._claim(id); if (!el) return;
      let downAt = 0, pid = null;
      el.addEventListener('pointerdown', e => {
        e.preventDefault();
        if (!this._enabled) return;
        downAt = now(); pid = e.pointerId; capture(el, e.pointerId);
        this.held.add(action);
        onDown?.();
      });
      const up = e => {
        e.preventDefault();
        if (pid === null || e.pointerId !== pid) return;
        pid = null;
        this.held.delete(action);
        if (!this._enabled) return;
        if (e.type === 'pointerup' && now() - downAt < TAP_TOGGLE_MS) onToggle();
      };
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    };
    const bindTap = (id, action) => {
      const el = this._claim(id); if (!el) return;
      el.addEventListener('pointerdown', e => {
        e.preventDefault();
        if (action === 'pause') { this._pause(); return; } // pause must work while the menu is open
        if (this._enabled) this.actions.add(action);
      });
    };

    const fire = bindHold('#fireBtn', 'fire');
    if (fire) {
      // CoD Mobile: dragging on the fire button also aims, so the right thumb can shoot and track at once.
      let lastX = 0, lastY = 0;
      fire.addEventListener('pointerdown', e => { this._firePointer = e.pointerId; lastX = e.clientX; lastY = e.clientY; });
      fire.addEventListener('pointermove', e => {
        if (e.pointerId !== this._firePointer || !this._enabled) return;
        this.look.x += (e.clientX - lastX) * TOUCH_RAD_PER_PX;
        this.look.y += (e.clientY - lastY) * TOUCH_RAD_PER_PX;
        lastX = e.clientX; lastY = e.clientY;
      });
      const end = e => { if (e.pointerId === this._firePointer) this._firePointer = null; };
      fire.addEventListener('pointerup', end); fire.addEventListener('pointercancel', end);
    }
    bindHybrid('#adsBtn', 'ads', () => {
      this._touchToggles.ads = !this._touchToggles.ads;
      document.querySelector('#adsBtn')?.classList?.toggle('active', this._touchToggles.ads);
    });
    // Crouch edge fires on touch-down (instant slide out of a sprint); a quick tap additionally flips the crouch toggle.
    bindHybrid('#crouchBtn', 'crouch', () => this.actions.add('crouchToggle'), () => this.actions.add('crouchPressed'));
    bindTap('#jumpBtn', 'jump'); bindTap('#slideBtn', 'slide'); bindTap('#reloadBtn', 'reload'); bindTap('#grenadeBtn', 'grenade');
    bindTap('#swapBtn', 'nextWeapon'); bindTap('#camBtn', 'toggleBodycam'); bindTap('#lightBtn', 'cycleLighting');
    bindTap('#pauseBtn', 'pause');
  }

  _bindLifecycle() {
    addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseAll(); });
  }

  /** Clears the touch ADS toggle (e.g. after a weapon swap / reload the game may want to drop ADS). */
  clearAdsToggle() {
    this._touchToggles.ads = false;
    document.querySelector('#adsBtn')?.classList?.remove('active');
  }

  sample() {
    const s = this._state;
    const a = this.actions;
    s.pause = a.has('pause');
    if (!this._enabled) {
      // Menu open: neutral state, but pause/resume requests still pass through.
      s.moveX = s.moveY = s.lookX = s.lookY = 0; s.switchWeapon = 0;
      s.fire = s.firePressed = s.ads = s.sprint = s.walk = s.crouch = s.crouchPressed = s.crouchToggle = false;
      s.jump = s.slide = s.reload = s.grenade = s.leanLeft = s.leanRight = s.nextWeapon = false;
      s.inspect = s.toggleBodycam = s.cycleLighting = false;
      a.clear(); this.look.x = this.look.y = 0;
      return s;
    }
    const k = this.keys;
    const kx = ((k.has('KeyD') || k.has('ArrowRight')) ? 1 : 0) - ((k.has('KeyA') || k.has('ArrowLeft')) ? 1 : 0);
    const ky = ((k.has('KeyW') || k.has('ArrowUp')) ? 1 : 0) - ((k.has('KeyS') || k.has('ArrowDown')) ? 1 : 0);
    const touchMove = Math.abs(this.move.x) > .02 || Math.abs(this.move.y) > .02;
    let x = touchMove ? this.move.x : kx;
    let y = touchMove ? this.move.y : ky;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; } // diagonal WASD is not faster

    // CoD Mobile auto-sprint: stick pinned forward for TOUCH_SPRINT_HOLD latches sprint until the stick eases off.
    if (this._movePointer !== null) {
      if (this.move.y >= TOUCH_SPRINT_PUSH) {
        const t = now();
        if (this._pushStart < 0) this._pushStart = t;
        else if (t - this._pushStart >= TOUCH_SPRINT_HOLD_MS) this._setTouchSprint(true);
      } else this._pushStart = -1;
      if (this.touchSprint && this.move.y < TOUCH_SPRINT_RELEASE) this._setTouchSprint(false);
    }

    const sens = this.sensitivity;
    s.moveX = x; s.moveY = y;
    s.lookX = this.look.x * sens;
    s.lookY = this.look.y * sens * (this.invertY ? -1 : 1);
    s.firePressed = a.has('firePressed');
    s.fire = this.held.has('fire') || s.firePressed; // a sub-frame click still produces one firing frame
    s.ads = this.held.has('ads') || this._touchToggles.ads;
    s.sprint = k.has('ShiftLeft') || k.has('ShiftRight') || this.touchSprint;
    s.walk = k.has('AltLeft') || k.has('AltRight') || k.has('KeyX');
    s.crouchPressed = a.has('crouchPressed');
    s.crouchToggle = a.has('crouchToggle');
    s.crouch = k.has('KeyC') || k.has('ControlLeft') || this.held.has('crouch');
    s.jump = a.has('jump');
    s.slide = a.has('slide');
    s.reload = a.has('reload');
    s.grenade = a.has('grenade');
    s.leanLeft = k.has('KeyQ');
    s.leanRight = k.has('KeyE');
    s.switchWeapon = a.has('weapon1') ? 1 : a.has('weapon2') ? 2 : 0;
    s.nextWeapon = a.has('nextWeapon');
    s.inspect = a.has('inspect');
    s.toggleBodycam = a.has('toggleBodycam');
    s.cycleLighting = a.has('cycleLighting');
    this.look.x = this.look.y = 0;
    a.clear();
    return s;
  }
}
