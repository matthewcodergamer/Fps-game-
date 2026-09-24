// Dynamic resolution + feature shedding + last-resort 30 fps cap.
//
// Signals:
//   frame EMA  – real rendered-frame interval (what the player feels). On a 60 Hz vsync'd display it never drops below
//                16.7 ms, so it can only say "too slow", never "headroom".
//   busy EMA   – begin-of-frame → GPU-work-done latency, sampled 4×/s with queue.onSubmittedWorkDone(). This is the
//                headroom signal on 60 Hz panels (iPhone 11) and also detects browser throttling (iOS Low Power Mode
//                caps rAF at 30 Hz while the GPU idles — shedding quality would not help there).
// Policy (per 1.25 s window): slow → pixelRatio −0.08 down to min, then shed a level every 3 s of slowness.
// Fast → pixelRatio +0.05 up to the tier's nominal ratio, then un-shed a level per 8 s of speed, then keep climbing to
// max (features before supersampling). Mobile at shed 3 still >1.25× target for 4 s → 30 fps cap via shouldRender().

const WINDOW_SECONDS = 1.25;
const STEP_DOWN = 0.08;
const STEP_UP = 0.05;
const SLOW_FACTOR = 1.12;
const FAST_FACTOR = 0.85;
const SHED_AFTER = 3;
const UNSHED_AFTER = 8;
const CAP_ENGAGE_FACTOR = 1.25;
const CAP_ENGAGE_AFTER = 4;
const CAP_RELEASE_AFTER = 10;
const MAX_SHED = 3;
const IGNORE_FRAME_MS = 250;
const PROBE_INTERVAL_MS = 250;
const PROBE_TIMEOUT_MS = 1000;
const EPS = 1e-3;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const round2 = v => Math.round(v * 100) / 100;

export class PerformanceGovernor {
  /**
   * @param {import('@babylonjs/core/Engines/abstractEngine.js').AbstractEngine} engine
   * @param {object} profile detectDeviceProfile() result
   * @param {{onShed?:(level:number)=>void, onPixelRatio?:(ratio:number)=>void, onCap?:(capped:boolean)=>void}} [callbacks]
   */
  constructor(engine, profile, { onShed, onPixelRatio, onCap } = {}) {
    this.engine = engine;
    this.profile = profile;
    this.onShed = typeof onShed === 'function' ? onShed : null;
    this.onPixelRatio = typeof onPixelRatio === 'function' ? onPixelRatio : null;
    this.onCap = typeof onCap === 'function' ? onCap : null;

    const r = profile?.render || {};
    this._min = r.minPixelRatio > 0 ? r.minPixelRatio : 0.7;
    this._max = Math.max(this._min, r.maxPixelRatio > 0 ? r.maxPixelRatio : 1);
    this._nominal = Math.min(this._max, Math.max(this._min, r.pixelRatio > 0 ? r.pixelRatio : 1));
    this._ratio = this._nominal;
    this._mobile = profile?.platform === 'mobile';
    this._targetFps = r.targetFps > 0 ? r.targetFps : 60;
    this._targetMs = 1000 / this._targetFps;
    this._capMs = 1000 / 30;

    this._shed = 0;
    this._locked = false;
    this._capped = false;
    this._elapsed = 0;
    this._settleUntil = 2.5; // shader/pipeline compilation hitches right after boot are not a performance signal

    this._ema = this._targetMs;        // control EMA (hitch-clamped)
    this._displayEma = this._targetMs; // unclamped, for fps/frameMs readouts
    this._window = 0;
    this._slowAtMin = 0;
    this._fastAtNominal = 0;
    this._capSlow = 0;
    this._capComfort = 0;
    this._capReleaseAfter = CAP_RELEASE_AFTER;
    this._lastUncapAt = -1e9;
    this._ceiling = Infinity;
    this._ceilingUntil = 0;
    this._slow = false;
    this._fast = false;
    this._throttled = false;
    this._longStreak = 0;

    // shouldRender() bookkeeping
    this._lastTick = -1;
    this._tickEma = this._targetMs;
    this._lastRenderTick = -1e9;

    // GPU busy probe
    this._busyEma = 0;
    this._busyAt = -1e9;
    this._frameBegin = 0;
    this._probeArmed = false;
    this._probeInflight = false;
    this._probeSentAt = 0;
    this._probeGen = 0;
    this._lastProbeAt = -1e9;
    this._probeEnabled = true;
    this._onBegin = () => { this._frameBegin = now(); };
    this._onEnd = () => this._sendProbe();
    this._beginObserver = engine?.onBeginFrameObservable?.add?.(this._onBegin) ?? null;
    this._endObserver = engine?.onEndFrameObservable?.add?.(this._onEnd) ?? null;

    // createStrikeEngine already applied profile.render.pixelRatio; only re-apply if something else changed it.
    const level = engine?.getHardwareScalingLevel?.();
    if (Number.isFinite(level) && Math.abs(level - 1 / this._ratio) > 1e-4) this._applyRatio(false);
  }

  get pixelRatio() { return this._ratio; }
  get shedLevel() { return this._shed; }
  get fps() { return this._displayEma > 0 ? 1000 / this._displayEma : 0; }
  get frameMs() { return this._displayEma; }
  /** Smoothed begin-frame → GPU-done latency in ms (0 when unavailable). */
  get gpuMs() { return this._busyValid() ? this._busyEma : 0; }
  get capped() { return this._capped; }
  get locked() { return this._locked; }
  /** True while the browser (not our workload) limits the frame rate, e.g. iOS Low Power Mode. */
  get throttled() { return this._throttled; }
  get targetFps() { return this._capped ? 30 : this._targetFps; }

  /** Freeze adaptation (CI / screenshots). Readouts keep updating. Unlocking restarts with a short settle period. */
  lock(locked = true) {
    this._locked = !!locked;
    this._resetTimers();
    if (this._locked && this._capped) this._setCapped(false);
    if (!this._locked) this.settle(1.5);
  }

  /** Ignore the next `seconds` of frames for adaptation (call after preset switches / big scene changes). */
  settle(seconds = 1.5) {
    this._settleUntil = Math.max(this._settleUntil, this._elapsed + seconds);
  }

  /**
   * Call once per rAF tick before doing any frame work; returns false when the 30 fps cap wants this tick skipped
   * (then skip input/sim/render for the tick — the canvas keeps the last presented frame).
   */
  shouldRender(nowMs = now()) {
    if (this._lastTick >= 0) {
      const dt = nowMs - this._lastTick;
      if (dt > 0 && dt < IGNORE_FRAME_MS) this._tickEma += (dt - this._tickEma) * 0.1;
    }
    this._lastTick = nowMs;
    if (!this._capped) return true;
    // Time-based so it also halves 120 Hz panels correctly; 4 ms slack absorbs rAF timestamp jitter.
    if (nowMs - this._lastRenderTick >= this._capMs - 4) { this._lastRenderTick = nowMs; return true; }
    return false;
  }

  /** @param {number} frameSeconds real (unclamped) interval since the previous *rendered* frame. */
  update(frameSeconds) {
    let ms = frameSeconds * 1000;
    if (!(ms > 0)) return;
    // Readout EMA (unclamped up to 1 s so a genuinely slow device still reports its real fps).
    if (ms <= 1000) this._displayEma += (ms - this._displayEma) * (1 - Math.exp(-frameSeconds / 0.5));
    if (ms > IGNORE_FRAME_MS) {
      // Isolated spikes (tab hidden, alt-tab, GC, debugger) are ignored; a sustained run is real (<4 fps) slowness.
      if (++this._longStreak < 3) return;
      ms = IGNORE_FRAME_MS;
    } else this._longStreak = 0;
    const dt = ms / 1000;
    this._elapsed += dt;

    // Control EMA: single hitches are clamped so they cannot trigger shedding on their own.
    const target = this._capped ? this._capMs : this._targetMs;
    const sample = ms < target * 2.5 ? ms : target * 2.5;
    this._ema += (sample - this._ema) * (1 - Math.exp(-dt / 0.6));

    this._armProbe();
    if (this._locked || this._elapsed < this._settleUntil) return;

    const avg = this._ema;
    const busyOk = this._busyValid();
    const busy = this._busyEma;
    // Browser throttling: frames are slow but the GPU/CPU finish early — dropping quality would only cost looks.
    this._throttled = busyOk && avg > SLOW_FACTOR * target && busy < 0.55 * this._targetMs;
    this._slow = avg > SLOW_FACTOR * target && !this._throttled;
    this._fast = avg < FAST_FACTOR * target || (busyOk && avg < 1.08 * target && busy < 0.78 * this._targetMs);

    if (this._capped) { this._updateCapped(dt, busyOk, busy); return; }

    const atMin = this._ratio <= this._min + EPS;
    const atNominal = this._ratio >= this._nominal - EPS;

    // Shedding: only once resolution is exhausted.
    if (this._slow && atMin && this._shed < MAX_SHED) {
      this._slowAtMin += dt;
      if (this._slowAtMin >= SHED_AFTER) { this._setShed(this._shed + 1); this._slowAtMin = 0; }
    } else this._slowAtMin = Math.max(0, this._slowAtMin - dt);

    // Un-shedding: restore features once the nominal resolution is back (before any supersampling).
    if (this._fast && atNominal && this._shed > 0) {
      this._fastAtNominal += dt;
      if (this._fastAtNominal >= UNSHED_AFTER) { this._setShed(this._shed - 1); this._fastAtNominal = 0; }
    } else if (!this._fast) this._fastAtNominal = Math.max(0, this._fastAtNominal - dt * 2);

    // Last resort for phones: 30 fps cap.
    if (this._mobile && this._shed >= MAX_SHED && avg > CAP_ENGAGE_FACTOR * this._targetMs && !this._throttled) {
      this._capSlow += dt;
      if (this._capSlow >= CAP_ENGAGE_AFTER) {
        // Re-capping soon after a release means the release was premature: demand a longer calm period next time.
        if (this._elapsed - this._lastUncapAt < 30) this._capReleaseAfter = Math.min(60, this._capReleaseAfter * 2);
        this._setCapped(true);
        return;
      }
    } else this._capSlow = Math.max(0, this._capSlow - dt);

    // Resolution steps every window.
    this._window += dt;
    if (this._window < WINDOW_SECONDS) return;
    this._window = 0;
    if (this._slow && !atMin) {
      this._ceiling = this._ratio - STEP_UP; // do not climb straight back into the ratio that was too slow
      this._ceilingUntil = this._elapsed + 25;
      this._setRatio(this._ratio - STEP_DOWN);
    } else if (this._fast) {
      if (this._shed > 0 && atNominal) return; // features first
      let ceiling = this._elapsed < this._ceilingUntil ? Math.min(this._max, this._ceiling) : this._max;
      if (this._shed > 0) ceiling = Math.min(ceiling, this._nominal);
      if (this._ratio < ceiling - EPS) this._setRatio(Math.min(ceiling, this._ratio + STEP_UP));
    }
  }

  /** Stop listening to the engine. */
  dispose() {
    if (this._beginObserver) this.engine?.onBeginFrameObservable?.remove?.(this._beginObserver);
    if (this._endObserver) this.engine?.onEndFrameObservable?.remove?.(this._endObserver);
    this._beginObserver = this._endObserver = null;
    this._probeGen++;
  }

  // ---------------------------------------------------------------------------------------------------------------

  _updateCapped(dt, busyOk, busy) {
    // While capped the interval is vsync-locked at 33 ms, so judge 60 fps viability from GPU latency (or, without it,
    // from rAF ticks still arriving at display rate — i.e. rendered frames fit inside one vsync).
    const comfortable = busyOk ? busy < 0.75 * this._targetMs : this._tickEma < 1.1 * this._targetMs;
    if (comfortable) this._capComfort += dt; else this._capComfort = Math.max(0, this._capComfort - dt * 2);
    if (this._capComfort >= this._capReleaseAfter) this._setCapped(false);
  }

  _setCapped(capped) {
    if (this._capped === capped) return;
    this._capped = capped;
    this._resetTimers();
    this._ema = capped ? this._capMs : this._targetMs * 1.1;
    this._lastRenderTick = -1e9;
    if (!capped) { this._lastUncapAt = this._elapsed; this.settle(1); }
    if (this.onCap) this.onCap(capped);
  }

  _setShed(level) {
    const next = Math.max(0, Math.min(MAX_SHED, level));
    if (next === this._shed) return;
    this._shed = next;
    this._window = 0;
    this._capSlow = 0;
    this.settle(1); // pipeline rebuilds hitch for a frame or two
    if (this.onShed) this.onShed(next);
  }

  _setRatio(ratio) {
    const next = round2(Math.max(this._min, Math.min(this._max, ratio)));
    if (Math.abs(next - this._ratio) < EPS) return;
    this._ratio = next;
    this._applyRatio(true);
    this.settle(0.4); // resize reallocates render targets
  }

  _applyRatio(notify) {
    try { this.engine?.setHardwareScalingLevel?.(1 / this._ratio); } catch (error) { console.warn('[PerformanceGovernor] scaling failed', error); }
    if (notify && this.onPixelRatio) this.onPixelRatio(this._ratio);
  }

  _resetTimers() {
    this._window = 0;
    this._slowAtMin = 0;
    this._fastAtNominal = 0;
    this._capSlow = 0;
    this._capComfort = 0;
  }

  _busyValid() { return this._busyAt > 0 && now() - this._busyAt < 2000; }

  _armProbe() {
    if (!this._probeEnabled) return;
    const t = now();
    if (this._probeInflight) {
      if (t - this._probeSentAt > PROBE_TIMEOUT_MS) { this._probeInflight = false; this._probeGen++; } // lost/device reset
      return;
    }
    if (t - this._lastProbeAt >= PROBE_INTERVAL_MS) this._probeArmed = true;
  }

  _sendProbe() {
    if (!this._probeArmed || this._probeInflight) return;
    this._probeArmed = false;
    const queue = this.engine?._device?.queue;
    if (!queue || typeof queue.onSubmittedWorkDone !== 'function') { this._probeEnabled = false; return; }
    const start = this._frameBegin || now();
    const gen = ++this._probeGen;
    this._probeInflight = true;
    this._probeSentAt = this._lastProbeAt = now();
    let promise;
    try { promise = queue.onSubmittedWorkDone(); } catch { this._probeInflight = false; this._probeEnabled = false; return; }
    // Allocates two closures + a promise 4×/s (not per frame).
    promise.then(() => {
      if (gen !== this._probeGen) return;
      this._probeInflight = false;
      const busy = now() - start;
      if (!(busy > 0) || busy > IGNORE_FRAME_MS) return;
      this._busyEma = this._busyAt > 0 ? this._busyEma + (busy - this._busyEma) * 0.25 : busy;
      this._busyAt = now();
    }, () => {
      if (gen === this._probeGen) this._probeInflight = false;
    });
  }
}
