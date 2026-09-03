const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class InputRouter {
  constructor(canvas) {
    this.canvas = canvas;
    this.move = { x: 0, y: 0 };
    this.look = { x: 0, y: 0 };
    this.actions = new Set();
    this.held = new Set();
    this.keys = new Set();
    this.pointerLocked = false;
    this._movePointer = null;
    this._lookPointer = null;
    this._bindKeyboard();
    this._bindPointer();
    this._bindTouch();
  }

  _bindKeyboard() {
    addEventListener('keydown', e => {
      this.keys.add(e.code);
      if (!e.repeat) {
        if (e.code === 'Space') this.actions.add('jump');
        if (e.code === 'KeyR') this.actions.add('reload');
        if (e.code === 'KeyG') this.actions.add('grenade');
        if (e.code === 'KeyC' || e.code === 'ControlLeft') this.actions.add('slide');
      }
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('mousedown', e => {
      if (e.button === 0) this.held.add('fire');
      if (e.button === 2) this.held.add('ads');
      if (!this.pointerLocked) this.canvas.requestPointerLock?.();
    });
    addEventListener('mouseup', e => {
      if (e.button === 0) this.held.delete('fire');
      if (e.button === 2) this.held.delete('ads');
    });
    addEventListener('contextmenu', e => e.preventDefault());
  }

  _bindPointer() {
    document.addEventListener('pointerlockchange', () => { this.pointerLocked = document.pointerLockElement === this.canvas; });
    addEventListener('mousemove', e => {
      if (!this.pointerLocked) return;
      this.look.x += e.movementX * 0.0021;
      this.look.y += e.movementY * 0.0021;
    });
  }

  _bindTouch() {
    const pad = document.querySelector('#movePad');
    const knob = pad?.querySelector('i');
    const look = document.querySelector('#lookZone');
    if (pad) {
      const update = e => {
        const r = pad.getBoundingClientRect();
        const x = e.clientX - (r.left + r.width / 2);
        const y = e.clientY - (r.top + r.height / 2);
        const radius = r.width * .33;
        const len = Math.hypot(x, y) || 1;
        const scale = Math.min(1, radius / len);
        const px = x * scale, py = y * scale;
        this.move.x = clamp(px / radius, -1, 1);
        this.move.y = clamp(-py / radius, -1, 1);
        if (knob) knob.style.transform = `translate(${px}px,${py}px)`;
      };
      pad.addEventListener('pointerdown', e => { this._movePointer = e.pointerId; pad.setPointerCapture(e.pointerId); update(e); });
      pad.addEventListener('pointermove', e => { if (e.pointerId === this._movePointer) update(e); });
      const end = e => { if (e.pointerId !== this._movePointer) return; this._movePointer = null; this.move.x = this.move.y = 0; if (knob) knob.style.transform = ''; };
      pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);
    }
    if (look) {
      let lastX = 0, lastY = 0;
      look.addEventListener('pointerdown', e => { this._lookPointer = e.pointerId; lastX = e.clientX; lastY = e.clientY; look.setPointerCapture(e.pointerId); });
      look.addEventListener('pointermove', e => {
        if (e.pointerId !== this._lookPointer) return;
        this.look.x += (e.clientX - lastX) * 0.0032;
        this.look.y += (e.clientY - lastY) * 0.0032;
        lastX = e.clientX; lastY = e.clientY;
      });
      const end = e => { if (e.pointerId === this._lookPointer) this._lookPointer = null; };
      look.addEventListener('pointerup', end); look.addEventListener('pointercancel', end);
    }
    const bindHold = (id, action) => {
      const el = document.querySelector(id); if (!el) return;
      const down = e => { e.preventDefault(); this.held.add(action); el.setPointerCapture?.(e.pointerId); };
      const up = e => { e.preventDefault(); this.held.delete(action); };
      el.addEventListener('pointerdown', down); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    };
    const bindTap = (id, action) => document.querySelector(id)?.addEventListener('pointerdown', e => { e.preventDefault(); this.actions.add(action); });
    bindHold('#fireBtn', 'fire'); bindHold('#adsBtn', 'ads');
    bindTap('#jumpBtn', 'jump'); bindTap('#slideBtn', 'slide'); bindTap('#reloadBtn', 'reload'); bindTap('#grenadeBtn', 'grenade');
  }

  sample() {
    const keyboardMove = {
      x: (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0),
      y: (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0),
    };
    const x = Math.abs(this.move.x) > .02 ? this.move.x : keyboardMove.x;
    const y = Math.abs(this.move.y) > .02 ? this.move.y : keyboardMove.y;
    const length = Math.hypot(x, y) || 1;
    const state = {
      moveX: Math.abs(x) > 1 ? x / length : x,
      moveY: Math.abs(y) > 1 ? y / length : y,
      lookX: this.look.x,
      lookY: this.look.y,
      fire: this.held.has('fire'),
      ads: this.held.has('ads'),
      sprint: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      jump: this.actions.has('jump'),
      slide: this.actions.has('slide'),
      reload: this.actions.has('reload'),
      grenade: this.actions.has('grenade'),
    };
    this.look.x = this.look.y = 0;
    this.actions.clear();
    return state;
  }
}
