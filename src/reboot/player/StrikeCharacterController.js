import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector.js';
import { PhysicsCharacterController, CharacterSupportedState } from '@babylonjs/core/Physics/v2/characterController.js';
import { PhysicsShapeCapsule, PhysicsShapeSphere } from '@babylonjs/core/Physics/v2/physicsShape.js';
import { ProximityCastResult } from '@babylonjs/core/Physics/proximityCastResult.js';
import { ShapeCastResult } from '@babylonjs/core/Physics/shapeCastResult.js';
import { WorldRaycaster, createHitRecord } from '../physics/Raycast.js';
import { clamp, lerp, damp, easeInOutSine, easeOutCubic } from '../core/MathUtil.js';

// ---- "Call of Duty weight" tuning ---------------------------------------------------------------------------------
// Body
const STAND_HEIGHT = 1.78, CROUCH_HEIGHT = 1.2, RADIUS = 0.36; // capsule (crouch capsule lets you slide under cover)
const EYE_STAND = 1.62, EYE_CROUCH = 1.05;                    // eye above the feet
const CROUCH_TIME = 0.18;                                      // stand↔crouch eye transition (eased)
// Ground movement: fast, snappy starts/stops (≈0.08 s to walk speed, ≈0.1 s to stop) but a slower build into
// sprint so top speed feels earned. Direction changes run through the same limits, which is what reads as "mass".
const ACCEL = 55;          // m/s² toward the target velocity
const DECEL = 45;          // m/s² friction when releasing / slowing
const SPRINT_ACCEL = 9;    // m/s² above walk speed (4.3 → 6.4 in ≈0.23 s)
const AIR_CONTROL = 0.25;  // fraction of ACCEL available airborne (momentum is kept, you mostly steer)
const AIR_DRAG = 0.4;      // m/s² bleed when airborne with no input
const SPEED_SPRINT = 6.4, SPEED_WALK = 4.3, SPEED_SLOW = 2.2, SPEED_CROUCH = 2.1, SPEED_CROUCH_SLOW = 1.4;
const ADS_SPEED_MUL = 0.62;
const STRAFE_MUL = 0.93, BACK_MUL = 0.8;   // backpedal / strafe are slower than forward (weight + CoD feel)
const SPRINT_MIN_FORWARD = 0.6;            // sprint needs a clearly-forward stick / W
const SPRINT_STRAFE_MUL = 0.5;             // lateral input authority while sprinting
// Slide (CoD): burst out of a sprint, decays over SLIDE_TIME, limited steering, cooldown after it ends.
const SLIDE_SPEED = 8.5, SLIDE_END_SPEED = 2.6, SLIDE_TIME = 0.75, SLIDE_COOLDOWN = 0.9, SLIDE_STEER = 1.1, SLIDE_MIN_SPEED = 5.0;
// Jump / gravity: gravity heavier than 9.81 so jumps are short and grounded (apex ≈0.88 m, airtime ≈0.65 s).
const GRAVITY = 16.5, JUMP_SPEED = 5.4, MAX_FALL = 30;
const COYOTE_TIME = 0.1;       // jump still allowed this long after walking off a ledge
const JUMP_BUFFER = 0.12;      // jump pressed this long before landing still fires on touchdown
const JUMP_GROUND_LOCK = 0.12; // ignore ground support right after take-off
const JUMP_FATIGUE_WINDOW = 0.6, JUMP_FATIGUE = 0.82; // CS-style anti bunny-hop: quick re-jumps are weaker
const GROUND_STICK = 0.6;      // m/s pressed into the ground so slopes / stair ramps are followed, not launched off
const LANDING_SPEED_LOSS = 0.35; // heavy landing scrubs up to 35% horizontal speed (stagger)
// Lean (Q/E)
const LEAN_RATE = 10, LEAN_PROBE = 0.55;
export const LEAN_OFFSET = 0.32; // lateral head offset at full lean — CameraRig imports it so probe and camera agree
// Look
const PITCH_LIMIT = 1.45;
// Eye smoothing over steps (step-up teleports / curbs)
const STEP_SMOOTH_RATE = 14, STEP_MAX = 0.45;
const HEAD_PROBE_R = 0.34;     // headroom sphere radius (slightly under RADIUS so walls we touch do not count)
// Babylon's built-in step-up only works when a frame's travel exceeds keepDistance (≈3 m/s at 60 fps), so slow
// crouch/slow-walk moves get a small assist, and small drops are snapped instead of free-falling (smooth curbs).
const MAX_STEP = 0.35, STEP_ASSIST = 0.34, SNAP_DOWN = 0.4, GROUND_GAP = 0.02;
// Mantle / vault (CoD MW): jump facing a ledge 0.5–1.5 m above the ground (or keep pushing into one while airborne)
// and the body climbs it kinematically: rise first, then over, so the path can be validated with two capsule sweeps.
// Thin obstacles (jersey barriers, planters, low walls ≤ VAULT_MAX_DEPTH deep) are vaulted straight over instead.
// Railings / perimeter walls are never mantled (level design keeps them as hard edges).
const MANTLE_MIN = 0.5, MANTLE_MAX = 1.5;   // ledge height above the ground we left
const MANTLE_REACH = 0.45;                   // how far in front of the body a ledge can be grabbed
const MANTLE_GAP = 0.04;                     // clearance above the ledge while moving over it
const MANTLE_BASE_TIME = 0.24, MANTLE_TIME_PER_M = 0.2, VAULT_EXTRA_TIME = 0.06; // ≈0.4 s waist-high, ≈0.55 s chest-high
const VAULT_MAX_DEPTH = 0.9, MANTLE_COOLDOWN = 0.25, MANTLE_PROBE_INTERVAL = 0.05;
const VAULT_LANDING_SOFTEN = 0.35;           // vault drop-offs are planned: land softer than a real fall

const DOWN = new Vector3(0, -1, 0);

/**
 * Havok PhysicsCharacterController driven with CoD-style acceleration, sprint/slide/crouch/lean rules.
 * The controller no longer touches the camera after construction: CameraRig presents the returned eye/yaw/pitch.
 *
 * update() returns ONE reused result object whose Vector3 members (position, eye, velocity, forward, right, aimForward)
 * are also reused every frame — read or copy them during the frame; never retain references across frames.
 */
export class StrikeCharacterController {
  /**
   * @param {import('@babylonjs/core/scene.js').Scene} scene
   * @param {import('@babylonjs/core/Cameras/camera.js').Camera} camera only used for the initial pose
   * @param {{position?:Vector3, yaw?:number}} [spawn] feet position + facing
   * @param {{adsSensitivity?:number, raycaster?:WorldRaycaster}} [options]
   */
  constructor(scene, camera, spawn = {}, options = {}) {
    this.scene = scene;
    this.camera = camera;
    this.adsSensitivity = Number.isFinite(options.adsSensitivity) ? options.adsSensitivity : 0.85;
    this.raycaster = options.raycaster || new WorldRaycaster(scene);

    // Two pre-built capsules swapped on stance change (never rebuilt per frame).
    this._standShape = new PhysicsShapeCapsule(new Vector3(0, STAND_HEIGHT / 2 - RADIUS, 0), new Vector3(0, -STAND_HEIGHT / 2 + RADIUS, 0), RADIUS, scene);
    this._crouchShape = new PhysicsShapeCapsule(new Vector3(0, CROUCH_HEIGHT / 2 - RADIUS, 0), new Vector3(0, -CROUCH_HEIGHT / 2 + RADIUS, 0), RADIUS, scene);
    this._headShape = new PhysicsShapeSphere(Vector3.Zero(), HEAD_PROBE_R, scene);
    this._standOpts = { shape: this._standShape, capsuleHeight: STAND_HEIGHT, capsuleRadius: RADIUS };
    this._crouchOpts = { shape: this._crouchShape, capsuleHeight: CROUCH_HEIGHT, capsuleRadius: RADIUS };

    const feet = spawn.position || new Vector3(0, 0.05, 9);
    const start = new Vector3(feet.x, feet.y + STAND_HEIGHT / 2 + 0.02, feet.z);
    this.controller = new PhysicsCharacterController(start, this._standOpts, scene);
    this.controller.maxSlopeCosine = Math.cos(50 * Math.PI / 180); // stair ramps are ≤40°
    this.controller.maxStepHeight = MAX_STEP;                       // curbs / low steps climb without a jump
    this.controller.characterMass = 82;
    this.controller.characterStrength = 3500;
    this.controller.maxCharacterSpeedForSolver = MAX_FALL + 2;
    this.controller.acceleration = 18;

    const body = this.controller._body; // Babylon keeps it private; used only to exclude ourselves from queries
    this.rayQuery = body ? { ignoreBody: body } : undefined;
    this._proxQuery = { shape: this._headShape, position: new Vector3(), rotation: Quaternion.Identity(), maxDistance: 0, shouldHitTriggers: false, ignoreBody: body };
    this._stepQuery = { shape: null, position: new Vector3(), rotation: Quaternion.Identity(), maxDistance: 0, shouldHitTriggers: false, ignoreBody: body };
    this._castQuery = { shape: null, rotation: Quaternion.Identity(), startPosition: new Vector3(), endPosition: new Vector3(), shouldHitTriggers: false, ignoreBody: body };
    this._castIn = new ShapeCastResult();
    this._castHit = new ShapeCastResult();
    this._proxIn = new ProximityCastResult();
    this._proxHit = new ProximityCastResult();
    this._hit = createHitRecord();

    this._support = {
      isSurfaceDynamic: false, supportedState: CharacterSupportedState.UNSUPPORTED,
      averageSurfaceNormal: new Vector3(0, 1, 0), averageSurfaceVelocity: new Vector3(), averageAngularSurfaceVelocity: new Vector3(),
    };
    this._gravity = new Vector3(0, -GRAVITY, 0);
    this._vel = new Vector3();
    this._tmp = new Vector3();
    this._tmp2 = new Vector3();
    this._slideDir = new Vector3(0, 0, 1);
    // Pre-allocated mantle state (start centre, rise, horizontal travel, exit direction/speed).
    this._mantle = { active: false, t: 0, dur: 0, sx: 0, sy: 0, sz: 0, rise: 0, dx: 0, dz: 0, fx: 0, fz: 1, exitSpeed: 0, vault: false, height: 0 };

    this.yaw = Number.isFinite(spawn.yaw) ? spawn.yaw : Math.PI;
    this.pitch = 0;
    this._resetState();

    this._forward = new Vector3();
    this._right = new Vector3();
    this._aim = new Vector3();
    this._eye = new Vector3();
    this._outPos = new Vector3();
    this._outVel = new Vector3();
    this._moveInput = { x: 0, y: 0 };
    this.result = {
      grounded: false, position: this._outPos, eye: this._eye, velocity: this._outVel, speed: 0, state: 'IDLE', stance: 'STAND',
      sprinting: false, walking: false, crouching: false, sliding: false, justJumped: false, justLanded: false, landingImpact: 0,
      airTime: 0, yaw: this.yaw, pitch: 0, lookDeltaX: 0, lookDeltaY: 0, forward: this._forward, right: this._right,
      moveInput: this._moveInput, lean: 0,
      // extras (not in the base contract, safe to ignore)
      aimForward: this._aim, crouchAmount: 0, moving: false, stride: 0, footstep: false, footstepIntensity: 0,
      groundSurface: 'concrete', fallSpeed: 0, slideProgress: 0, headroomBlocked: false, verticalSpeed: 0,
      mantling: false, vaulting: false, mantleProgress: 0, mantleHeight: 0,
    };
    this._updateBasis();
    this._computeEye(0);
    // Initial pose only — from now on CameraRig owns the camera.
    if (camera) { camera.position.copyFrom(this._eye); if (!camera.rotationQuaternion) camera.rotation.set(this.pitch, this.yaw, 0); }
  }

  /** The Havok body of the capsule (exclude it from your own ray queries: `{ ignoreBody: controller.body }`). */
  get body() { return this.controller._body; }

  setAdsSensitivity(v) { if (Number.isFinite(v) && v > 0) this.adsSensitivity = v; }

  _resetState() {
    this._hx = 0; this._hz = 0; this._vy = 0;
    this._stance = 'STAND'; this._crouchAmount = 0; this._crouchToggled = false; this._holdSuppressed = false;
    this._sprinting = false; this._sliding = false; this._slideT = 0; this._slideSpeed = 0; this._slideCooldown = 0; this._slideBlocked = 0;
    this._grounded = false; this._wasGrounded = false; this._airTime = 0; this._coyote = 0; this._jumpBuffer = 0; this._jumpLock = 0;
    this._jumped = false; this._sinceLand = 10; this._lastAirVy = 0; this._landSlow = 0;
    this._lean = 0; this._stride = 0; this._stepOffset = 0; this._prevFeetY = null; this._standCheck = 0; this._standBlocked = false;
    this._blocked = false;
    this._surface = 'concrete';
    this._lastGroundY = this.controller ? this._feetY() : 0;
    this._mantle.active = false; this._mantleCooldown = 0; this._mantleProbe = 0; this._softLand = false;
  }

  /** Respawn / teleport: feet position + yaw. Resets velocity, stance and timers. */
  teleport(position, yaw = this.yaw) {
    if (this._stance !== 'STAND') this.controller.setShapeOptions(this._standOpts, true);
    this._tmp.set(position.x, position.y + STAND_HEIGHT / 2 + 0.02, position.z);
    this.controller.setPosition(this._tmp);
    this._vel.setAll(0);
    this.controller.setVelocity(this._vel);
    this.yaw = yaw; this.pitch = 0;
    this._resetState();
    this._updateBasis();
    this._computeEye(0);
  }

  _updateBasis() {
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw), sp = Math.sin(this.pitch), cp = Math.cos(this.pitch);
    this._forward.set(sy, 0, cy);
    this._right.set(cy, 0, -sy);
    this._aim.set(sy * cp, -sp, cy * cp); // Babylon: +pitch looks down
  }

  _feetY() { return this.controller.getPosition().y - this.controller.footOffset; }

  _computeEye(stepOffset) {
    const p = this.controller.getPosition();
    const h = lerp(EYE_STAND, EYE_CROUCH, easeInOutSine(this._crouchAmount));
    this._eye.set(p.x, p.y - this.controller.footOffset + h + stepOffset, p.z);
  }

  /** True when the standing capsule fits (Havok sphere overlap at standing head height, ray fallback). */
  _canStand() {
    const p = this.controller.getPosition();
    const feetY = p.y - this.controller.footOffset;
    const plugin = this.scene.getPhysicsEngine?.()?.getPhysicsPlugin?.();
    if (plugin && typeof plugin.shapeProximity === 'function' && this._proxQuery.ignoreBody) {
      this._proxQuery.position.set(p.x, feetY + STAND_HEIGHT - HEAD_PROBE_R - 0.02, p.z);
      plugin.shapeProximity(this._proxQuery, this._proxIn, this._proxHit);
      return !this._proxHit.hasHit;
    }
    this._tmp.set(p.x, feetY + CROUCH_HEIGHT - 0.1, p.z);
    this._hit.normal.set(0, 1, 0);
    return !this.raycaster.cast(this._tmp, Vector3.UpReadOnly, STAND_HEIGHT - CROUCH_HEIGHT + 0.15, this._hit, this.rayQuery).hit;
  }

  _setStance(stance) {
    if (stance === this._stance) return;
    this.controller.setShapeOptions(stance === 'CROUCH' ? this._crouchOpts : this._standOpts, true); // keeps feet fixed
    this._stance = stance;
  }

  _probeSurface() {
    const p = this.controller.getPosition();
    this._tmp.set(p.x, p.y, p.z);
    const hit = this.raycaster.cast(this._tmp, DOWN, this.controller.footOffset + 0.4, this._hit, this.rayQuery);
    if (hit.hit) this._surface = hit.node?.metadata?.surface || 'concrete';
    return this._surface;
  }

  /**
   * @param {number} dt seconds
   * @param {object} input InputRouter.sample()
   * @param {{adsAmount?:number, weaponMoveMul?:number}} [opts]
   */
  update(dt, input, opts = {}) {
    const r = this.result;
    if (!(dt > 0)) return r;
    dt = Math.min(dt, 0.05);
    const adsAmount = clamp(opts.adsAmount ?? (input.ads ? 1 : 0), 0, 1);
    const weaponMoveMul = opts.weaponMoveMul ?? 1;
    const c = this.controller;

    // ---------------------------------------------------------------- look
    const lookScale = lerp(1, this.adsSensitivity, adsAmount);
    const prevYaw = this.yaw, prevPitch = this.pitch;
    this.yaw += (input.lookX || 0) * lookScale;
    this.pitch = clamp(this.pitch + (input.lookY || 0) * lookScale, -PITCH_LIMIT, PITCH_LIMIT);
    this._updateBasis();
    const fwd = this._forward, right = this._right;
    if (this._mantle.active) return this._updateMantle(dt, input, prevYaw, prevPitch);

    // ---------------------------------------------------------------- support / timers
    c.checkSupportToRef(dt, DOWN, this._support);
    if (this._jumpLock > 0) this._jumpLock -= dt;
    const supported = this._support.supportedState === CharacterSupportedState.SUPPORTED;
    const wasGrounded = this._grounded;
    let grounded = supported && this._jumpLock <= 0;
    // Walking off a curb / stair edge: snap down onto the lower ground instead of a free-fall hop.
    if (!grounded && wasGrounded && !this._jumped && this._jumpLock <= 0 && this._groundClamp(SNAP_DOWN) > 0) grounded = true;
    let justLanded = false, justJumped = false, landingImpact = 0, footstep = false;
    this._slideCooldown = Math.max(0, this._slideCooldown - dt);
    this._mantleCooldown = Math.max(0, this._mantleCooldown - dt);
    this._jumpBuffer = Math.max(0, this._jumpBuffer - dt);
    this._landSlow = damp(this._landSlow, 0, 3.5, dt);
    this._sinceLand += dt;
    if (input.jump) this._jumpBuffer = JUMP_BUFFER;

    if (grounded) {
      if (!wasGrounded) {
        const fallSpeed = Math.max(0, -this._lastAirVy);
        r.fallSpeed = fallSpeed;
        // Tiny airborne blips (curb step-downs) are not landings.
        if (this._jumped || this._airTime > 0.15 || fallSpeed > 2.5) {
          justLanded = true;
          landingImpact = clamp((fallSpeed - 2) / 9, 0, 1);
          if (this._softLand) landingImpact *= VAULT_LANDING_SOFTEN;
          const keep = 1 - LANDING_SPEED_LOSS * landingImpact;
          this._hx *= keep; this._hz *= keep;
          this._landSlow = Math.max(this._landSlow, landingImpact * 0.45);
          this._sinceLand = 0;
          this._probeSurface();
        }
        this._jumped = false; this._softLand = false;
      }
      this._coyote = COYOTE_TIME;
      this._lastGroundY = this._feetY();
    } else {
      this._coyote = Math.max(0, this._coyote - dt);
    }
    // airTime runs while airborne, keeps the finished jump's value on the landing frame, then resets.
    if (!grounded) this._airTime = wasGrounded ? dt : this._airTime + dt;
    else if (wasGrounded) this._airTime = 0;
    this._grounded = grounded;

    // ---------------------------------------------------------------- intent
    const mx = input.moveX || 0, my = input.moveY || 0;
    const mag = Math.min(1, Math.hypot(mx, my));
    const hSpeed = Math.hypot(this._hx, this._hz);

    if (input.crouchToggle) this._crouchToggled = !this._crouchToggled;
    if (!input.crouch) this._holdSuppressed = false;

    // Sprint: forward only, not while ADS / firing, not crouched (sprint request stands a toggled crouch up — CoD).
    const sprintIntent = !!input.sprint && my > SPRINT_MIN_FORWARD && !input.ads && adsAmount < 0.35 && !input.fire && !this._sliding;
    if (sprintIntent && this._crouchToggled && !input.crouch) this._crouchToggled = false;

    // Slide: crouch press out of a sprint (or the touch SLIDE button while fast).
    const wantsSlide = (input.crouchPressed || input.slide) && !this._sliding;
    if (wantsSlide) {
      const fastEnough = this._sprinting || hSpeed > SLIDE_MIN_SPEED;
      if (grounded && fastEnough && this._slideCooldown <= 0) {
        this._sliding = true; this._slideT = 0; this._slideBlocked = 0;
        this._slideSpeed = Math.max(SLIDE_SPEED, hSpeed);
        if (hSpeed > 1) this._slideDir.set(this._hx / hSpeed, 0, this._hz / hSpeed); else this._slideDir.copyFrom(fwd);
        this._sprinting = false;
        this._setStance('CROUCH');
        if (input.slide) this._crouchToggled = true; // touch SLIDE button: end the slide crouched (CoD Mobile)
      } else if (input.slide && !input.crouchPressed) {
        this._crouchToggled = !this._crouchToggled; // touch SLIDE button when slow acts as crouch toggle
      }
    }

    // Jump rules: crouched → stand up first (no jump); sliding → slide-cancel jump.
    let doJump = false;
    if (this._jumpBuffer > 0 && (grounded || this._coyote > 0) && !this._jumped) {
      if (this._sliding) {
        if (this._canStand()) { this._endSlide(); this._crouchToggled = false; this._holdSuppressed = !!input.crouch; this._setStance('STAND'); doJump = true; }
        this._jumpBuffer = 0;
      } else if (this._stance === 'CROUCH') {
        this._crouchToggled = false; this._holdSuppressed = !!input.crouch; this._jumpBuffer = 0;
      } else if (my > -0.2 && this._tryMantle(grounded)) {
        // CoD: jump facing a waist/chest-high ledge climbs (or vaults) it instead of hopping into it.
        return this._updateMantle(dt, input, prevYaw, prevPitch);
      } else doJump = true;
    }

    // Stance resolution (+ headroom).
    const wantCrouch = this._sliding || this._crouchToggled || (!!input.crouch && !this._holdSuppressed);
    if (wantCrouch) { this._setStance('CROUCH'); this._standBlocked = false; this._standCheck = 0; }
    else if (this._stance === 'CROUCH') {
      this._standCheck -= dt;
      if (this._standCheck <= 0) {
        if (this._canStand()) { this._setStance('STAND'); this._standBlocked = false; }
        else { this._standBlocked = true; this._standCheck = 0.1; } // re-test at 10 Hz while under cover
      }
    }
    // Airborne and still pushing into a ledge (jumped short of it / ran off a step into a wall): grab it.
    if (!grounded && !doJump && !this._sliding && my > 0.5 && this._stance === 'STAND' && this._mantleCooldown <= 0) {
      this._mantleProbe -= dt;
      if (this._mantleProbe <= 0) {
        this._mantleProbe = MANTLE_PROBE_INTERVAL; // ≤ 20 probes/s while airborne: two rays, rarely two sweeps
        if (this._tryMantle(false)) return this._updateMantle(dt, input, prevYaw, prevPitch);
      }
    }
    const crouched = this._stance === 'CROUCH';
    this._crouchAmount = clamp(this._crouchAmount + (crouched ? dt : -dt) / CROUCH_TIME, 0, 1);

    // Sprint state (kept through the air so sprint-jumps keep their momentum).
    if (grounded) this._sprinting = sprintIntent && !crouched && !this._sliding;
    else if (!sprintIntent) this._sprinting = false;

    // ---------------------------------------------------------------- horizontal velocity
    if (this._sliding) {
      this._slideT += dt;
      const k = Math.min(1, this._slideT / SLIDE_TIME);
      const speed = lerp(SLIDE_END_SPEED, this._slideSpeed, Math.pow(1 - k, 1.5));
      if (mag > 0.2) { // limited steering toward the stick direction
        const dx = right.x * mx + fwd.x * my, dz = right.z * mx + fwd.z * my;
        const cross = this._slideDir.z * dx - this._slideDir.x * dz;
        const dot = this._slideDir.x * dx + this._slideDir.z * dz;
        const ang = clamp(Math.atan2(cross, dot), -SLIDE_STEER * dt, SLIDE_STEER * dt);
        const cs = Math.cos(ang), sn = Math.sin(ang), sx = this._slideDir.x, sz = this._slideDir.z;
        this._slideDir.set(sx * cs + sz * sn, 0, -sx * sn + sz * cs);
      }
      this._hx = this._slideDir.x * speed; this._hz = this._slideDir.z * speed;
      if (k >= 1 || (!grounded && this._airTime > 0.12)) this._endSlide();
    } else {
      let base;
      if (crouched) base = input.walk ? SPEED_CROUCH_SLOW : SPEED_CROUCH;
      else if (this._sprinting) base = SPEED_SPRINT;
      else if (input.walk) base = SPEED_SLOW;
      else base = SPEED_WALK;
      if (!this._sprinting) base *= lerp(1, ADS_SPEED_MUL, adsAmount);
      base *= weaponMoveMul * (1 - this._landSlow);
      let ix = mx, iy = my;
      if (this._sprinting) ix *= SPRINT_STRAFE_MUL;
      const il = Math.hypot(ix, iy);
      let tx = 0, tz = 0;
      if (il > 1e-4) {
        const dirMul = 1 - (1 - STRAFE_MUL) * Math.abs(ix) / il - (1 - BACK_MUL) * Math.max(0, -iy) / il;
        const s = base * dirMul * Math.min(1, mag) / il;
        tx = (right.x * ix + fwd.x * iy) * s;
        tz = (right.z * ix + fwd.z * iy) * s;
      }
      if (grounded) this._accelerate(tx, tz, dt);
      else if (mag > 0.1) {
        // Airborne: keep momentum, steer with AIR_CONTROL authority.
        const tl = Math.hypot(tx, tz);
        if (tl > 1e-4) { const keep = Math.max(tl, hSpeed) / tl; tx *= keep; tz *= keep; }
        this._moveTowards(tx, tz, ACCEL * AIR_CONTROL * dt);
      } else if (hSpeed > 0) {
        const ns = Math.max(0, hSpeed - AIR_DRAG * dt) / hSpeed;
        this._hx *= ns; this._hz *= ns;
      }
    }

    // ---------------------------------------------------------------- vertical velocity
    if (doJump) {
      const fatigue = this._sinceLand < JUMP_FATIGUE_WINDOW ? JUMP_FATIGUE : 1;
      this._vy = JUMP_SPEED * fatigue;
      this._jumped = true; this._jumpLock = JUMP_GROUND_LOCK; this._coyote = 0; this._jumpBuffer = 0;
      this._grounded = false; justJumped = true; this._airTime = 0;
      this._sprinting = this._sprinting && sprintIntent;
    } else if (grounded) {
      // Follow the ground plane *downwards* (descending ramps/stairs without launching) and stay pressed onto it.
      // Climbing is left to the solver's plane projection — projecting up here would ride stale edge normals.
      const n = this._support.averageSurfaceNormal;
      const ok = n.y > 0.3;
      const slope = ok ? -(n.x * this._hx + n.z * this._hz) / n.y : 0;
      this._vy = Math.min(0, slope) - GROUND_STICK;
    } else {
      this._vy = Math.max(-MAX_FALL, this._vy - GRAVITY * dt);
    }
    if (!this._grounded) this._lastAirVy = this._vy;

    // ---------------------------------------------------------------- ground contact fix-ups (teleports happen
    // before integrate so Babylon rebuilds its contact manifold from the corrected position)
    if (this._grounded && !this._sliding && this._blocked) {
      this._stepAssist(this._hx, this._hz); // slow move blocked last frame → try to step onto a low ledge
    } else if (this._grounded && !justJumped && (this._hx !== 0 || this._hz !== 0 || Math.abs(this._stepOffset) > 0.002)) {
      // SUPPORTED only means "a contact within keepContactTolerance": close the ≤0.15 m hover left after curbs/edges.
      this._groundClamp(0.15);
    }

    // ---------------------------------------------------------------- integrate
    const feetBefore = this._feetY();
    this._vel.set(this._hx, this._vy, this._hz);
    if (this._support.supportedState === CharacterSupportedState.SUPPORTED && this._support.isSurfaceDynamic) this._vel.addInPlace(this._support.averageSurfaceVelocity);
    c.setVelocity(this._vel);
    c.maxStepHeight = this._grounded ? MAX_STEP : 0; // no mid-air step-ups (would hop low walls at the jump apex)
    c.integrate(dt, this._support, this._gravity);
    const v = c.getVelocity();
    // Horizontal: keep the *intended* velocity (it is bounded by the accel rules, and Babylon's step-up needs it);
    // the solver's clipped velocity is what we report. Vertical: adopt the solver (ceilings stop jumps, steep slopes do
    // not bank fall speed). The pre-integrate vy was saved in _lastAirVy for landing impact.
    if (!this._grounded) { this._vy = v.y; this._hx = v.x; this._hz = v.z; } // airborne: walls/edges win (no perching)
    const actual = Math.hypot(v.x, v.z);
    const intended = Math.hypot(this._hx, this._hz);
    this._blocked = this._grounded && intended > 0.3 && actual < intended * 0.5;
    if (this._sliding && this._slideT > 0.1) {
      this._slideBlocked = actual < this._slideSpeed * 0.35 ? this._slideBlocked + 1 : 0;
      if (this._slideBlocked >= 2) this._endSlide();
    }

    // ---------------------------------------------------------------- eye (step smoothing)
    const feetY = this._feetY();
    if (this._grounded && wasGrounded && this._prevFeetY !== null) {
      const disc = (feetY - feetBefore) - v.y * dt; // displacement the velocity does not explain = step teleport
      if (Math.abs(disc) > 0.02 && Math.abs(disc) < 0.6) this._stepOffset -= disc;
    }
    this._prevFeetY = feetY;
    this._stepOffset = clamp(damp(this._stepOffset, 0, STEP_SMOOTH_RATE, dt), -STEP_MAX, STEP_MAX);
    if (Math.abs(this._stepOffset) < 1e-4) this._stepOffset = 0;
    this._computeEye(this._stepOffset);

    // ---------------------------------------------------------------- lean (with wall probe)
    let leanTarget = (input.leanRight ? 1 : 0) - (input.leanLeft ? 1 : 0);
    if (this._sprinting || this._sliding) leanTarget = 0;
    let leanLimit = 1;
    if (leanTarget !== 0 || Math.abs(this._lean) > 0.01) {
      const side = leanTarget !== 0 ? Math.sign(leanTarget) : Math.sign(this._lean);
      this._tmp.copyFrom(right).scaleInPlace(side);
      const hit = this.raycaster.cast(this._eye, this._tmp, LEAN_PROBE, this._hit, this.rayQuery);
      if (hit.hit) leanLimit = clamp((hit.distance - 0.12) / (LEAN_OFFSET + 0.05), 0, 1);
    }
    leanTarget = clamp(leanTarget, -leanLimit, leanLimit);
    this._lean = damp(this._lean, leanTarget, LEAN_RATE, dt);
    if (this._lean > leanLimit) this._lean = leanLimit; else if (this._lean < -leanLimit) this._lean = -leanLimit;

    // ---------------------------------------------------------------- stride / footsteps
    const speed = actual;
    const moving = speed > 0.3;
    if (this._grounded && moving && !this._sliding) {
      const cadence = clamp(1.55 + speed * 0.24, 1.5, 3.2); // steps per second: crouch ≈2.1, walk ≈2.6, sprint ≈3.1
      const before = Math.floor(this._stride);
      this._stride += cadence * dt;
      if (Math.floor(this._stride) !== before) { footstep = true; this._probeSurface(); }
    }

    // ---------------------------------------------------------------- state
    const walkingSlow = !crouched && !this._sprinting && (input.walk || (moving && speed < SPEED_SLOW + 0.25 && mag < 0.6));
    let state;
    if (!this._grounded) state = this._jumped && this._vy > 0 ? 'JUMP' : 'FALL';
    else if (this._sliding) state = 'SLIDE';
    else if (crouched) state = moving ? 'CROUCH_WALK' : 'CROUCH';
    else if (this._sprinting && moving) state = 'SPRINT';
    else if (moving) state = walkingSlow ? 'SLOW_WALK' : 'WALK';
    else state = 'IDLE';

    // ---------------------------------------------------------------- result
    this._outVel.copyFrom(v);
    return this._writeResult(state, speed, moving, footstep, justJumped, justLanded, landingImpact, prevYaw, prevPitch, mx, my, crouched);
  }

  /** Fills the reused result object (shared by the normal and the mantle paths). */
  _writeResult(state, speed, moving, footstep, justJumped, justLanded, landingImpact, prevYaw, prevPitch, mx, my, crouched) {
    const r = this.result, m = this._mantle;
    r.grounded = this._grounded;
    this._outPos.copyFrom(this.controller.getPosition());
    r.speed = speed;
    r.state = state;
    r.stance = this._stance;
    r.sprinting = state === 'SPRINT' || (this._sprinting && !this._grounded);
    r.walking = state === 'SLOW_WALK';
    r.crouching = crouched;
    r.sliding = this._sliding;
    r.justJumped = justJumped;
    r.justLanded = justLanded;
    r.landingImpact = landingImpact;
    r.airTime = this._airTime;
    r.yaw = this.yaw;
    r.pitch = this.pitch;
    r.lookDeltaX = this.yaw - prevYaw;
    r.lookDeltaY = this.pitch - prevPitch;
    this._moveInput.x = mx; this._moveInput.y = my;
    r.lean = this._lean;
    r.crouchAmount = this._crouchAmount;
    r.moving = moving;
    r.stride = this._stride;
    r.footstep = footstep;
    r.footstepIntensity = state === 'SPRINT' ? 1 : state === 'WALK' ? 0.62 : state === 'CROUCH_WALK' ? 0.3 : state === 'SLOW_WALK' ? 0.16 : 0;
    r.groundSurface = this._surface;
    r.slideProgress = this._sliding ? Math.min(1, this._slideT / SLIDE_TIME) : 0;
    r.headroomBlocked = this._standBlocked;
    r.verticalSpeed = this._grounded ? 0 : this._vy;
    r.mantling = m.active;
    r.vaulting = m.active && m.vault;
    r.mantleProgress = m.active ? Math.min(1, m.t / m.dur) : 0;
    r.mantleHeight = m.active ? m.height : 0;
    return r;
  }

  /**
   * Looks for a grabbable ledge straight ahead and, if the kinematic climb path is free, starts a mantle (or a vault
   * over a thin obstacle). Costs 2–4 rays + 2 capsule sweeps, only on a jump press / throttled while airborne.
   * @param {boolean} fromGround jump pressed on the ground (vs. grabbing while airborne)
   */
  _tryMantle(fromGround) {
    if (this._stance !== 'STAND' || this._sliding || this._mantleCooldown > 0) return false;
    const plugin = this.scene.getPhysicsEngine?.()?.getPhysicsPlugin?.();
    const q = this._castQuery;
    if (!plugin || typeof plugin.shapeCast !== 'function' || !q.ignoreBody) return false;
    const c = this.controller, p = c.getPosition(), fo = c.footOffset, feetY = p.y - fo;
    const groundY = fromGround ? feetY : Math.min(this._lastGroundY, feetY);
    const f = this._forward, hit = this._hit, rq = this.rayQuery, rc = this.raycaster, tmp = this._tmp;

    // 1) a solid wall facing us, just in front (knee height from the ground; near the feet while airborne)
    const probeY = feetY + (fromGround ? 0.35 : 0.08);
    tmp.set(p.x, probeY, p.z);
    if (!rc.cast(tmp, f, RADIUS + MANTLE_REACH, hit, rq).hit) return false;
    if (hit.normal.y > 0.5 || hit.normal.x * f.x + hit.normal.z * f.z > -0.5) return false; // ramp, or too oblique
    const meta = hit.node?.metadata;
    if (!meta || !meta.surface || meta.railing || meta.perimeter) return false;             // world geometry only
    const face = hit.distance;                                                               // body axis → wall face
    const ex = p.x + f.x * face, ez = p.z + f.z * face;

    // 2) the ledge top, just inside the face (a ray starting inside a taller wall finds nothing → no mantle)
    const top0 = groundY + MANTLE_MAX + 0.05;
    tmp.set(ex + f.x * 0.1, top0, ez + f.z * 0.1);
    if (!rc.cast(tmp, DOWN, top0 - probeY + 0.02, hit, rq).hit || hit.normal.y < 0.7) return false;
    const topY = hit.point.y;
    const height = topY - groundY;
    if (height > MANTLE_MAX || height < (fromGround ? MANTLE_MIN : 0.3) || topY < feetY + 0.02) return false;

    // 3) thin obstacle → vault over it; deep enough → climb onto it
    const back = VAULT_MAX_DEPTH + 0.05;
    tmp.set(ex + f.x * back, topY - 0.08, ez + f.z * back);
    this._tmp2.set(-f.x, 0, -f.z);
    let travel, vault = false;
    if (rc.cast(tmp, this._tmp2, back - 0.02, hit, rq).hit && hit.distance > 0.01) {
      const depth = back - hit.distance;
      vault = depth < VAULT_MAX_DEPTH;
      travel = face + depth + RADIUS + 0.08;              // clear the far face
    }
    if (!vault) {
      travel = face + RADIUS + 0.06;                      // centre just past the edge: standing on the top
      tmp.set(p.x + f.x * travel, topY + 0.25, p.z + f.z * travel);
      if (!rc.cast(tmp, DOWN, 0.35, hit, rq).hit || Math.abs(hit.point.y - topY) > 0.08 || hit.normal.y < 0.7) return false;
    }

    // 4) the climb path must be free for the capsule: straight up, then across
    const rise = topY + MANTLE_GAP + fo - p.y;
    q.shape = c.shape;
    q.startPosition.copyFrom(p);
    q.endPosition.set(p.x, p.y + rise, p.z);
    plugin.shapeCast(q, this._castIn, this._castHit);
    if (this._castHit.hasHit) return false;
    q.startPosition.copyFrom(q.endPosition);
    q.endPosition.set(p.x + f.x * travel, p.y + rise, p.z + f.z * travel);
    plugin.shapeCast(q, this._castIn, this._castHit);
    if (this._castHit.hasHit) return false;

    const m = this._mantle;
    const entry = Math.hypot(this._hx, this._hz);
    m.active = true; m.t = 0; m.vault = vault; m.height = height;
    m.sx = p.x; m.sy = p.y; m.sz = p.z; m.rise = rise; m.dx = f.x * travel; m.dz = f.z * travel; m.fx = f.x; m.fz = f.z;
    m.dur = MANTLE_BASE_TIME + MANTLE_TIME_PER_M * rise + (vault ? VAULT_EXTRA_TIME : 0);
    // Vaults carry you on (you drop off the far side); climbing onto something ends nearly planted.
    m.exitSpeed = vault ? clamp(entry, 2.8, SPEED_WALK) : clamp(entry * 0.5, 0.8, 2.2);
    this._sprinting = false; this._jumped = false; this._jumpBuffer = 0; this._coyote = 0; this._jumpLock = 0;
    this._grounded = false; this._blocked = false;
    this._hx = this._hz = this._vy = 0;
    return true;
  }

  /** Kinematic climb: rise (ease-out), then over the edge (ease-in-out). Collisions were validated at the start. */
  _updateMantle(dt, input, prevYaw, prevPitch) {
    const m = this._mantle, c = this.controller;
    m.t += dt;
    const k = Math.min(1, m.t / m.dur);
    const ky = easeOutCubic(k / 0.55);
    const kx = easeInOutSine((k - 0.5) / 0.5);
    const p = c.getPosition();
    const nx = m.sx + m.dx * kx, ny = m.sy + m.rise * ky, nz = m.sz + m.dz * kx;
    this._outVel.set((nx - p.x) / dt, (ny - p.y) / dt, (nz - p.z) / dt); // presentation velocity (camera roll, sway)
    this._tmp.set(nx, ny, nz);
    c.setPosition(this._tmp);
    this._vel.setAll(0);
    c.setVelocity(this._vel);
    this._grounded = false;
    this._airTime += dt;
    this._lean = damp(this._lean, 0, LEAN_RATE, dt);
    this._crouchAmount = Math.max(0, this._crouchAmount - dt / CROUCH_TIME);
    this._stepOffset = damp(this._stepOffset, 0, STEP_SMOOTH_RATE, dt);
    this._prevFeetY = null;
    if (k >= 1) {
      m.active = false;
      this._mantleCooldown = MANTLE_COOLDOWN;
      this._hx = m.fx * m.exitSpeed; this._hz = m.fz * m.exitSpeed; this._vy = 0;
      this._lastAirVy = -1;          // arriving on top is not a fall
      this._softLand = m.vault;      // the drop behind a vault lands soft
      this._jumped = false;
    }
    this._computeEye(this._stepOffset);
    const speed = Math.hypot(this._outVel.x, this._outVel.z);
    const r = this._writeResult('JUMP', speed, speed > 0.3, false, false, false, 0, prevYaw, prevPitch, input.moveX || 0, input.moveY || 0, false);
    if (!m.active) { r.mantling = true; r.vaulting = m.vault; r.mantleProgress = 1; r.mantleHeight = m.height; } // last frame still reports the mantle
    return r;
  }

  /**
   * Sweep the current capsule straight down ≤ maxDrop; if it lands on walkable ground, move there (keeping
   * GROUND_GAP) and let the eye smoothing hide it. Used for step-downs (unsupported) and hover removal (supported).
   * Returns the drop in metres (0 = nothing done).
   */
  _groundClamp(maxDrop) {
    const plugin = this.scene.getPhysicsEngine?.()?.getPhysicsPlugin?.();
    const q = this._castQuery;
    if (!plugin || typeof plugin.shapeCast !== 'function' || !q.ignoreBody) return 0;
    const c = this.controller, p = c.getPosition();
    q.shape = c.shape;
    q.startPosition.copyFrom(p);
    q.endPosition.set(p.x, p.y - maxDrop, p.z);
    plugin.shapeCast(q, this._castIn, this._castHit);
    const h = this._castHit;
    if (!h.hasHit || h.hitNormal.y < 0.6) return 0;
    const drop = h.hitFraction * maxDrop - GROUND_GAP;
    if (drop < 0.012) return 0;
    this._tmp.set(p.x, p.y - drop, p.z);
    c.setPosition(this._tmp);
    this._stepOffset += drop;
    return drop;
  }

  /** Blocked while moving: lift onto a low ledge (≤ STEP_ASSIST) if the capsule fits there. Returns the lift (m). */
  _stepAssist(hx, hz) {
    const len = Math.hypot(hx, hz);
    if (len < 0.3) return 0;
    const dx = hx / len, dz = hz / len;
    const c = this.controller, p = c.getPosition(), feetY = p.y - c.footOffset;
    const plugin = this.scene.getPhysicsEngine?.()?.getPhysicsPlugin?.();
    if (!plugin || typeof plugin.shapeProximity !== 'function' || !this._stepQuery.ignoreBody) return 0;
    const reach = RADIUS + 0.12;
    this._tmp.set(p.x + dx * reach, feetY + STEP_ASSIST + 0.05, p.z + dz * reach);
    const hit = this.raycaster.cast(this._tmp, DOWN, STEP_ASSIST + 0.05, this._hit, this.rayQuery);
    if (!hit.hit || hit.normal.y < 0.75) return 0;
    const h = hit.point.y - feetY;
    if (h < 0.04 || h > STEP_ASSIST) return 0;
    const lift = h + GROUND_GAP;
    const q = this._stepQuery;
    q.shape = c.shape;
    q.position.set(p.x + dx * 0.08, p.y + lift, p.z + dz * 0.08);
    plugin.shapeProximity(q, this._proxIn, this._proxHit);
    if (this._proxHit.hasHit) return 0;
    c.setPosition(q.position);
    this._stepOffset -= lift;
    return lift;
  }

  _endSlide() {
    if (!this._sliding) return;
    this._sliding = false;
    this._slideCooldown = SLIDE_COOLDOWN;
  }

  _accelerate(tx, tz, dt) {
    const hx = this._hx, hz = this._hz;
    const cur = Math.hypot(hx, hz), tgt = Math.hypot(tx, tz);
    let rate;
    if (tgt < 0.01) rate = DECEL;                                       // released: friction
    else if (hx * tx + hz * tz < 0) rate = (ACCEL + DECEL) * 0.5;      // reversing: brake + push
    else if (tgt < cur - 0.05) rate = DECEL;                           // slowing (ADS in, sprint out)
    else rate = cur < SPEED_WALK * 0.92 ? ACCEL : SPRINT_ACCEL;        // build-up; sprint top end is earned
    this._moveTowards(tx, tz, rate * dt);
  }

  _moveTowards(tx, tz, maxStep) {
    const dx = tx - this._hx, dz = tz - this._hz;
    const d = Math.hypot(dx, dz);
    if (d <= maxStep || d < 1e-6) { this._hx = tx; this._hz = tz; return; }
    const k = maxStep / d;
    this._hx += dx * k; this._hz += dz * k;
  }

  dispose() {
    this.controller.dispose();
    this._standShape.dispose();
    this._crouchShape.dispose();
    this._headShape.dispose();
  }
}
