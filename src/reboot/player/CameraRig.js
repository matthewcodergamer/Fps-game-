import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { clamp, lerp, damp, DEG, Spring, createRng } from '../core/MathUtil.js';
import { LEAN_OFFSET } from './StrikeCharacterController.js';

// Presentation layer: owns camera.position / camera.rotation / camera.fov. Gameplay (controller) stays clean; every
// "feel" offset lives here so STANDARD and BODYCAM can blend smoothly into each other.

// ---- FOV --------------------------------------------------------------------------------------------------------
// settings.fov is a CoD-style *horizontal* FOV measured on a 16:9 reference screen (80 ≈ CoD default ≈ 50.5° vertical).
// Wider screens (phones at ~2.16:1, ultrawide) keep that vertical FOV and see more to the sides (Hor+); screens narrower
// than 16:9 keep the horizontal FOV down to 4:3, then vertical is held. Babylon's camera.fov is VERTICAL radians.
const REF_ASPECT = 16 / 9, MIN_ASPECT = 4 / 3;
const BODYCAM_VFOV = 100 * DEG;     // ultra-wide chest cam; BodycamPostProcess barrel-distorts it into a fisheye
const BODYCAM_MAX_HFOV = 140 * DEG; // keeps ultrawide / very long phones from stretching the rectilinear edges further
const SPRINT_FOV = 0.07;            // +7% (applied to tan(fov/2), i.e. a true 7% wider view)
const SLIDE_FOV = 0.05;
const MIN_VFOV = 15 * DEG, MAX_VFOV = 120 * DEG;

// ---- Body-mounted camera ------------------------------------------------------------------------------------------
const CHEST_DROP = 0.28, CHEST_FORWARD = 0.12; // chest mount relative to the eye
const MODE_BLEND_RATE = 9;                      // STANDARD ↔ BODYCAM crossfade (~0.3 s)

// ---- Head bob (figure-8: vertical at step rate, lateral/roll at half rate) ----------------------------------------
// [vertical m, lateral m, roll deg, pitch deg, reference speed m/s]
const BOB = {
  SPRINT: [0.036, 0.026, 0.85, 0.45, 6.4],
  WALK: [0.019, 0.015, 0.35, 0.18, 4.3],
  SLOW_WALK: [0.008, 0.007, 0.12, 0.07, 2.2],
  CROUCH_WALK: [0.012, 0.011, 0.25, 0.12, 2.1],
};
const BOB_ADS_MUL = 0.2;       // CoD: ADS almost kills bob
const BODYCAM_BOB_MUL = 1.8;   // chest rigs bounce much harder than a stabilised head
const STRAFE_ROLL = 1.2 * DEG; // Quake/CoD strafe tilt, ≤1.2°
const LEAN_ROLL = 9 * DEG;
const LEAN_DROP = 0.05;        // leaning lowers the head a little
const SLIDE_DROP = 0.1, SLIDE_ROLL = 5 * DEG;

// ---- Springs (stiffness, damping) -------------------------------------------------------------------------------
// Recoil kick: ζ≈0.72, returns in ~0.15 s. KICK_IMPULSE converts a kick angle into the spring impulse that peaks at
// roughly that angle.
const KICK_K = 280, KICK_C = 24, KICK_IMPULSE = 45;
const BODYCAM_RECOIL_MUL = 1.7;
const MAX_KICK = 6 * DEG;
const LAND_K = 170, LAND_C = 17;      // landing dip (m) — slightly under-damped so heavy drops bounce once
const LANDP_K = 150, LANDP_C = 17;    // landing nod (rad)
const JOLT_K = 420, JOLT_C = 24;      // footfall jolts (bodycam judder)
const LAG_K = 150, LAG_C = 22;        // bodycam rotational lag (ζ≈0.9, ~0.1 s behind the head)
const POS_K = 300, POS_C = 26;        // recoil push-back along the view

const TWO_PI = Math.PI * 2;

export class CameraRig {
  /**
   * @param {import('@babylonjs/core/Cameras/targetCamera.js').TargetCamera} camera
   * @param {object} [profile] DeviceProfile (platform used for comfort scaling)
   * @param {{fov?:number, camera?:'STANDARD'|'BODYCAM'}} [settings]
   */
  constructor(camera, profile = {}, settings = {}) {
    this.camera = camera;
    this.profile = profile;
    this.mode = settings.camera === 'BODYCAM' ? 'BODYCAM' : 'STANDARD';
    this.baseFovDeg = 80;
    this.setBaseFov(Number.isFinite(settings.fov) ? settings.fov : (profile.platform === 'mobile' ? 74 : 80));
    this._comfort = profile.platform === 'mobile' ? 0.85 : 1; // small screens: a little less bob/shake

    camera.fovMode = Camera.FOVMODE_VERTICAL_FIXED;
    if (camera.rotationQuaternion) camera.rotationQuaternion = null; // we drive Euler rotation (incl. roll)
    camera.updateUpVectorFromRotation = true; // roll-correct up vector every frame

    this._rng = createRng(0x5eed);
    this._t = 0;
    this._b = this.mode === 'BODYCAM' ? 1 : 0; // BODYCAM blend
    this._kickPitch = new Spring(KICK_K, KICK_C);
    this._kickYaw = new Spring(KICK_K, KICK_C);
    this._kickRoll = new Spring(KICK_K, KICK_C);
    this._posKick = new Spring(POS_K, POS_C);
    this._landY = new Spring(LAND_K, LAND_C);
    this._landPitch = new Spring(LANDP_K, LANDP_C);
    this._joltY = new Spring(JOLT_K, JOLT_C);
    this._joltPitch = new Spring(JOLT_K, JOLT_C);
    this._joltRoll = new Spring(JOLT_K, JOLT_C);
    this._lagYaw = new Spring(LAG_K, LAG_C);
    this._lagPitch = new Spring(LAG_K, LAG_C);
    this._lagInit = false;
    this._amp = [0, 0, 0, 0]; // smoothed bob amplitudes
    this._ownStride = 0;
    this._sprint = 0; this._slide = 0; this._strafeRoll = 0; this._turnRoll = 0;
    this._trauma = 0;        // hit shake (squared for output)
    this._energy = 0;        // generic shake energy (shots, footfalls, landings) → rolling shutter
    this._vFov = camera.fov;
  }

  /** 'STANDARD' | 'BODYCAM' — blends over ~0.3 s. */
  setMode(mode) {
    const m = mode === 'BODYCAM' ? 'BODYCAM' : 'STANDARD';
    if (m === this.mode) return;
    this.mode = m;
    this._energy = Math.max(this._energy, 0.35); // a little "handling" jolt when switching
  }

  /** CoD-style horizontal FOV in degrees at a 16:9 reference aspect (see header). */
  setBaseFov(deg) {
    if (Number.isFinite(deg)) this.baseFovDeg = clamp(deg, 50, 120);
  }

  /** Vertical FOV (radians) for a horizontal-at-16:9 FOV in degrees on the given aspect. */
  static verticalFovFor(deg, aspect) {
    const tanH = Math.tan(clamp(deg, 1, 170) * DEG / 2);
    const a = clamp(aspect || REF_ASPECT, MIN_ASPECT, REF_ASPECT); // Hor+ above 16:9, Vert- between 4:3 and 16:9
    return 2 * Math.atan(tanH / a);
  }

  /** 0..1 camera shake for post-fx (bodycam rolling shutter / sync jitter). */
  get shake() { return clamp(this._energy + this._trauma * this._trauma, 0, 1); }
  get verticalFov() { return this._vFov; }

  reset() {
    for (const s of [this._kickPitch, this._kickYaw, this._kickRoll, this._posKick, this._landY, this._landPitch, this._joltY, this._joltPitch, this._joltRoll]) s.reset(0);
    this._lagInit = false; this._trauma = 0; this._energy = 0;
  }

  _kickScale(k) {
    // Kick may be authored in degrees (like the recoil pattern) or radians. Anything ≥0.06 cannot be a sane radian kick
    // on every axis at once (3.4°), so treat it as degrees.
    const m = Math.max(Math.abs(k.pitch || 0), Math.abs(k.yaw || 0), Math.abs(k.roll || 0));
    return m >= 0.06 ? DEG : 1;
  }

  /**
   * @param {number} dt
   * @param {object} player StrikeCharacterController result
   * @param {{ads?:number, fovMul?:number, kick?:{pitch:number,yaw:number,roll:number}, fired?:boolean|number}} [weapon]
   * @param {{hitShake?:number}} [extra]
   */
  update(dt, player, weapon, extra) {
    if (!player || !player.eye || !(dt > 0)) return;
    dt = Math.min(dt, 0.05);
    const cam = this.camera;
    const p = player;
    this._t += dt;
    const t = this._t;
    const b = this._b = damp(this._b, this.mode === 'BODYCAM' ? 1 : 0, MODE_BLEND_RATE, dt);
    const ads = clamp(weapon?.ads ?? 0, 0, 1);
    const comfort = this._comfort;

    // ------------------------------------------------------------ bodycam rotational lag
    if (!this._lagInit || b < 1e-3) {
      this._lagYaw.reset(p.yaw); this._lagPitch.reset(p.pitch); this._lagInit = true;
    } else {
      this._lagYaw.target = p.yaw; this._lagPitch.target = p.pitch;
      this._lagYaw.update(dt); this._lagPitch.update(dt);
    }
    const yawE = lerp(p.yaw, this._lagYaw.value, b);
    const pitchE = lerp(p.pitch, this._lagPitch.value, b);
    const sy = Math.sin(yawE), cy = Math.cos(yawE);

    // ------------------------------------------------------------ state blends
    this._sprint = damp(this._sprint, p.sprinting && p.grounded ? 1 : 0, 6, dt);
    this._slide = damp(this._slide, p.sliding ? 1 : 0, 10, dt);
    const vx = p.velocity ? p.velocity.x : 0, vz = p.velocity ? p.velocity.z : 0;
    const lateral = clamp((vx * cy - vz * sy) / 4.3, -1, 1); // velocity along camera right
    this._strafeRoll = damp(this._strafeRoll, -lateral * STRAFE_ROLL, 6, dt);
    const yawRate = b > 1e-3 ? this._lagYaw.velocity : (p.lookDeltaX || 0) / dt;
    this._turnRoll = damp(this._turnRoll, -clamp(yawRate * 0.018, -0.05, 0.05), 8, dt);

    // ------------------------------------------------------------ head bob (figure-8)
    const prof = p.grounded && !p.sliding ? BOB[p.state] : null;
    const ratio = prof ? clamp(p.speed / prof[4], 0, 1.25) : 0;
    for (let i = 0; i < 4; i++) this._amp[i] = damp(this._amp[i], prof ? prof[i] * ratio : 0, 7, dt);
    let stride = p.stride;
    if (!Number.isFinite(stride)) { // controller without stride output: derive it here
      if (p.grounded && p.speed > 0.3) this._ownStride += clamp(1.55 + p.speed * 0.24, 1.5, 3.2) * dt;
      stride = this._ownStride;
    }
    const bobMul = lerp(lerp(1, BOB_ADS_MUL, ads), BODYCAM_BOB_MUL * lerp(1, 0.6, ads), b) * comfort;
    const c2 = Math.cos(TWO_PI * stride), s1 = Math.sin(Math.PI * stride);
    const bobY = -this._amp[0] * bobMul * (0.5 + 0.5 * c2);     // lowest at each foot plant
    const bobX = this._amp[1] * bobMul * s1;                    // sway over the planted foot
    const bobRoll = -this._amp[2] * DEG * bobMul * s1;
    const bobPitch = this._amp[3] * DEG * bobMul * (0.5 + 0.5 * c2);

    // ------------------------------------------------------------ events → springs
    if (p.footstep) {
      const k = (p.footstepIntensity ?? 0.6) * lerp(0.2, 1, b) * comfort;
      const side = (Math.floor(stride) & 1) ? 1 : -1;
      this._joltY.impulse(-0.5 * k);
      this._joltPitch.impulse(0.44 * k);
      this._joltRoll.impulse(0.36 * k * side);
      this._energy += 0.16 * k * b;
    }
    if (p.justLanded) {
      const i = p.landingImpact || 0;
      const m = lerp(1, 1.4, b) * comfort;
      this._landY.impulse(-(0.3 + 2.6 * i) * m);
      this._landPitch.impulse((0.12 + 1.5 * i) * m);
      this._energy += i * 0.7;
    }
    if (p.justJumped) this._landPitch.impulse(-0.25);
    const shots = weapon?.fired ? (typeof weapon.fired === 'number' ? Math.min(3, weapon.fired) : 1) : 0;
    if (shots > 0 && weapon.kick) {
      const k = weapon.kick, unit = this._kickScale(k);
      const mul = KICK_IMPULSE * lerp(1, BODYCAM_RECOIL_MUL, b) * shots;
      const kp = Math.min(MAX_KICK, Math.abs(k.pitch || 0) * unit);
      const ky = Math.min(MAX_KICK, Math.abs(k.yaw || 0) * unit);
      const kr = Math.min(MAX_KICK, Math.abs(k.roll || 0) * unit);
      const rng = this._rng;
      this._kickPitch.impulse(-kp * mul * (0.85 + 0.3 * rng()));              // up
      this._kickYaw.impulse(ky * mul * (rng() * 2 - 1));                       // random side
      this._kickRoll.impulse(kr * mul * (rng() < 0.5 ? -1 : 1) * (0.6 + 0.4 * rng()));
      this._posKick.impulse(-lerp(0.25, 0.8, b));
      this._energy += lerp(0.05, 0.3, b);
    }
    const hit = extra?.hitShake || 0;
    if (hit > 0) { this._trauma = Math.min(1, this._trauma + hit * 0.6); this._energy += hit * 0.5; }
    this._trauma = Math.max(0, this._trauma - 1.6 * dt);
    this._energy = clamp(damp(this._energy, 0.1 * this._sprint * b, 5, dt), 0, 1.5);

    const kickP = this._kickPitch.update(dt), kickY = this._kickYaw.update(dt), kickR = this._kickRoll.update(dt);
    const posK = this._posKick.update(dt);
    const landY = this._landY.update(dt), landP = this._landPitch.update(dt);
    const joltY = this._joltY.update(dt), joltP = this._joltPitch.update(dt), joltR = this._joltRoll.update(dt);

    // ------------------------------------------------------------ hit trauma + bodycam handheld sway
    const tr = this._trauma * this._trauma * comfort;
    const shP = tr * 1.6 * DEG * (Math.sin(t * 23.1) * 0.6 + Math.sin(t * 37.7 + 1.3) * 0.4);
    const shY = tr * 1.6 * DEG * (Math.sin(t * 19.3 + 2.1) * 0.6 + Math.sin(t * 41.9 + 0.4) * 0.4);
    const shR = tr * 2.5 * DEG * (Math.sin(t * 27.4 + 0.7) * 0.6 + Math.sin(t * 33.1 + 2.9) * 0.4);
    const sway = b * (1 + Math.min(1, p.speed * 0.15));
    const swP = sway * DEG * (0.3 * Math.sin(t * 1.1) + 0.12 * Math.sin(t * 2.9 + 0.5));
    const swY = sway * DEG * (0.35 * Math.sin(t * 0.83 + 2.0) + 0.1 * Math.sin(t * 2.3 + 1.1));
    const swR = sway * DEG * (0.5 * Math.sin(t * 0.61 + 1.0) + 0.15 * Math.sin(t * 1.9 + 0.2));

    // ------------------------------------------------------------ position
    const lean = p.lean || 0;
    const side = bobX + lean * LEAN_OFFSET * lerp(1, 0.6, b);
    const ahead = CHEST_FORWARD * b + posK;
    const drop = CHEST_DROP * b + SLIDE_DROP * this._slide + LEAN_DROP * Math.abs(lean);
    const e = p.eye;
    cam.position.set(
      e.x + cy * side + sy * ahead,
      e.y + bobY + landY + joltY - drop,
      e.z - sy * side + cy * ahead,
    );

    // ------------------------------------------------------------ rotation (+pitch = down, +roll = tilt left)
    const rx = pitchE + kickP + landP + joltP + bobPitch + shP + swP;
    const ry = yawE + kickY + shY + swY;
    const rz = bobRoll + this._strafeRoll + this._turnRoll * b - lean * LEAN_ROLL * lerp(1, 0.7, b)
      + SLIDE_ROLL * this._slide + kickR + joltR + shR + swR;
    cam.rotation.set(clamp(rx, -1.55, 1.55), ry, rz);

    // ------------------------------------------------------------ FOV (vertical radians, blended in tangent space)
    const engine = cam.getEngine();
    const aspect = engine.getAspectRatio ? engine.getAspectRatio(cam) : engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
    const stdV = CameraRig.verticalFovFor(this.baseFovDeg, aspect);
    const fovMul = Number.isFinite(weapon?.fovMul) ? clamp(weapon.fovMul, 0.2, 1.5) : 1;
    const tanStd = Math.tan(stdV / 2) * (1 + SPRINT_FOV * this._sprint + SLIDE_FOV * this._slide) * lerp(1, fovMul, ads);
    const bodyV = Math.min(BODYCAM_VFOV, 2 * Math.atan(Math.tan(BODYCAM_MAX_HFOV / 2) / Math.max(0.1, aspect)));
    const tanHalf = lerp(tanStd, Math.tan(bodyV / 2), b);
    this._vFov = clamp(2 * Math.atan(tanHalf), MIN_VFOV, MAX_VFOV);
    cam.fov = this._vFov;
  }
}
