import * as THREE from 'three';
import { AudioManager } from './audio/AudioManager.js';
import { TrueBodyRig } from './characters/TrueBodyRig.js';
import { installCyberLighting } from './rendering/CyberLighting.js';
import { AdvancedFPSViewModel } from './weapons/AdvancedFPSViewModel.js';
import { FPSViewModel } from './weapons/FPSViewModel.js';

const mobile = matchMedia('(any-pointer: coarse)').matches;
let worldScene = null;
let ballisticState = null;

// Capture the existing Stage 3 world scene when its first world light is
// attached, then augment it with the V4 mobile-scalable neon bounce/haze rig.
const sceneAdd = THREE.Scene.prototype.add;
THREE.Scene.prototype.add = function (...objects) {
  const result = sceneAdd.apply(this, objects);
  if (!worldScene && objects.some(object => object?.isHemisphereLight)) {
    worldScene = this;
    this.userData.v4CyberLighting = installCyberLighting(this, { mobile });
  }
  return result;
};

// Bound decoded audio fetches as well. Audio is optional feedback; it should
// never be allowed to make Deploy look frozen on a slow mobile connection.
const decodeArrayBuffer = AudioManager.prototype.decodeArrayBuffer;
AudioManager.prototype.fetchDecode = async function (url) {
  const controller = new AbortController();
  const timeoutMs = mobile ? 6000 : 8000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    return decodeArrayBuffer.call(this, await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
};

const proto = FPSViewModel.prototype;
const originalLoadArms = proto.loadArms;
const originalLoadWeapon = proto.loadWeapon;
const originalUpdate = proto.update;
const originalRecoil = proto.recoil;

proto.loadArms = async function (url) {
  const ready = await originalLoadArms.call(this, url);
  if (!ready) AdvancedFPSViewModel.prototype.installFallbackArms.call(this);
  return ready;
};

proto.loadWeapon = async function (definition) {
  const ready = await originalLoadWeapon.call(this, definition);
  if (!ready) AdvancedFPSViewModel.prototype.installFallbackWeapon.call(this, definition);
  return ready;
};

proto.barrelDirectionWorld = function (out = new THREE.Vector3()) {
  this.scene.updateMatrixWorld(true);
  const socket = this.sockets.muzzle;
  if (!socket) return this.worldCamera.getWorldDirection(out);
  this._v4SocketQuaternion ||= new THREE.Quaternion();
  socket.getWorldQuaternion(this._v4SocketQuaternion);
  out.set(0, 0, -1)
    .applyQuaternion(this._v4SocketQuaternion)
    .applyQuaternion(this.worldCamera.quaternion)
    .normalize();
  return out;
};

proto.update = function (dt, state = {}) {
  const yaw = state.yaw || 0;
  const pitch = state.pitch || 0;
  const speed = state.speed || 0;
  this._v4LastYaw ??= yaw;
  this._v4LastPitch ??= pitch;
  this._v4LastSpeed ??= speed;
  this._v4LastAccel ??= 0;
  this._v4FreeAimX ??= 0;
  this._v4FreeAimY ??= 0;
  this._v4Jerk ??= 0;

  const yawDelta = THREE.MathUtils.clamp(yaw - this._v4LastYaw, -.09, .09);
  const pitchDelta = THREE.MathUtils.clamp(pitch - this._v4LastPitch, -.09, .09);
  const accel = (speed - this._v4LastSpeed) / Math.max(dt, .001);
  const jerk = Math.abs((accel - this._v4LastAccel) / Math.max(dt, .001));
  this._v4LastYaw = yaw;
  this._v4LastPitch = pitch;
  this._v4LastSpeed = speed;
  this._v4LastAccel = accel;
  this._v4Jerk = THREE.MathUtils.damp(this._v4Jerk, Math.min(95, jerk), 16, dt);

  this._v4FreeAimX = THREE.MathUtils.clamp(this._v4FreeAimX - yawDelta * .52, -.044, .044);
  this._v4FreeAimY = THREE.MathUtils.clamp(this._v4FreeAimY + pitchDelta * .38, -.03, .03);
  this._v4FreeAimX = THREE.MathUtils.damp(this._v4FreeAimX, 0, this.ads ? 25 : 7.5, dt);
  this._v4FreeAimY = THREE.MathUtils.damp(this._v4FreeAimY, 0, this.ads ? 25 : 8.5, dt);

  originalUpdate.call(this, dt, state);

  const jerkWeight = THREE.MathUtils.clamp(this._v4Jerk / 70, 0, 1);
  const pulse = Math.sin((state.time || performance.now() * .001) * 43) * jerkWeight;
  this.weaponRoot.position.x += this._v4FreeAimX;
  this.weaponRoot.position.y += this._v4FreeAimY;
  this.weaponRoot.rotation.y -= this._v4FreeAimX * 1.65;
  this.weaponRoot.rotation.x += this._v4FreeAimY * 1.28;
  this.weaponRoot.rotation.z += pulse * .007;
  this.armRoot.rotation.z += pulse * .0035;

  if (worldScene && !this._v4Body) this._v4Body = new TrueBodyRig(worldScene, { mobile });
  if (this._v4Body) {
    const inGame = document.querySelector('#boot')?.classList.contains('hidden');
    this._v4Body.setVisible(Boolean(inGame));
    if (inGame) {
      const eyeHeight = state.slide > 0 ? .98 : state.crouch ? 1.22 : 1.72;
      this._v4Body.update(dt, {
        position: this.worldCamera.position,
        eyeHeight,
        yaw,
        pitch,
        speed,
        sprint: state.sprint,
        crouch: state.crouch,
        slide: state.slide,
        stepPhase: state.stepPhase,
        airborne: state.airborne,
        landImpulse: state.landImpulse
      });
    }
  }

  worldScene?.userData?.v4CyberLighting?.update(state.time || performance.now() * .001);
};

proto.recoil = function (amount = 1) {
  originalRecoil.call(this, amount);
  const origin = this.muzzleWorld(new THREE.Vector3());
  const barrel = this.barrelDirectionWorld(new THREE.Vector3());
  const cameraDirection = this.worldCamera.getWorldDirection(new THREE.Vector3());
  const direction = this.ads ? barrel.clone().lerp(cameraDirection, .72).normalize() : barrel;
  ballisticState = {
    origin,
    direction,
    cameraDirection,
    expires: performance.now() + 120
  };
};

// Stage 3 already owns hit filtering, damage and spread. V4 only moves the
// shot ray to the physical muzzle and rotates the existing spread around the
// physical barrel vector for the immediate fire window.
const intersectObjects = THREE.Raycaster.prototype.intersectObjects;
THREE.Raycaster.prototype.intersectObjects = function (...args) {
  if (ballisticState && performance.now() <= ballisticState.expires) {
    const spreadOffset = this.ray.direction.clone().sub(ballisticState.cameraDirection);
    this.ray.origin.copy(ballisticState.origin);
    this.ray.direction.copy(ballisticState.direction).add(spreadOffset).normalize();
  }
  return intersectObjects.apply(this, args);
};

function publishDiagnostics() {
  const button = document.querySelector('#playBtn');
  if (!button || button.disabled) return false;
  const badge = document.querySelector('#stageBadge');
  if (badge) badge.textContent = 'V4';
  window.__PROJECT_STRIKE_DIAGNOSTICS__ = {
    runtime: 'v4',
    guardedAssetLoads: true,
    trueBody: true,
    barrelBallistics: true,
    weightedJerk: true,
    productionServiceWorker: true
  };
  return true;
}

const diagnosticTimer = setInterval(() => {
  if (publishDiagnostics()) clearInterval(diagnosticTimer);
}, 100);
setTimeout(() => clearInterval(diagnosticTimer), 60_000);
