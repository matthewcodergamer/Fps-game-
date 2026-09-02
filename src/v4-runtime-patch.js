import * as THREE from 'three';
import { AudioManager } from './audio/AudioManager.js';
import { CharacterIKRig } from './animation/CharacterIKRig.js';
import { TrueBodyRig } from './characters/TrueBodyRig.js';
import { installCyberLighting } from './rendering/CyberLighting.js';
import { AdvancedFPSViewModel } from './weapons/AdvancedFPSViewModel.js';
import { FPSViewModel } from './weapons/FPSViewModel.js';

const mobile = matchMedia('(any-pointer: coarse)').matches;
let worldScene = null;
let ballisticState = null;

function createSocket(parent, name, position) {
  const socket = new THREE.Object3D();
  socket.name = `ProjectStrike_${name}`;
  socket.position.copy(position);
  parent.add(socket);
  return socket;
}

function weaponGripProfile(definition = {}) {
  const length = definition.viewLength || 0.92;
  if (definition.gripSockets) {
    const toVector = (value, fallback) => Array.isArray(value)
      ? new THREE.Vector3(...value)
      : fallback.clone();
    return {
      right: toVector(definition.gripSockets.right, new THREE.Vector3(.03, -.065, length * .08)),
      left: toVector(definition.gripSockets.left, new THREE.Vector3(-.025, -.005, -length * .25)),
      magazine: toVector(definition.gripSockets.magazine, new THREE.Vector3(-.03, -.13, -.055)),
      charging: toVector(definition.gripSockets.charging, new THREE.Vector3(.045, .055, -.18))
    };
  }

  if (definition.class === 'pistol') {
    return {
      right: new THREE.Vector3(.025, -.055, .055),
      left: new THREE.Vector3(-.035, -.055, .015),
      magazine: new THREE.Vector3(-.025, -.145, .035),
      charging: new THREE.Vector3(.03, .035, -.08)
    };
  }

  if (definition.class === 'shotgun') {
    return {
      right: new THREE.Vector3(.035, -.07, length * .1),
      left: new THREE.Vector3(-.03, -.015, -length * .3),
      magazine: new THREE.Vector3(-.02, -.13, -.02),
      charging: new THREE.Vector3(.045, .045, -.22)
    };
  }

  if (definition.class === 'sniper') {
    return {
      right: new THREE.Vector3(.035, -.07, length * .09),
      left: new THREE.Vector3(-.03, -.005, -length * .32),
      magazine: new THREE.Vector3(-.025, -.145, -.065),
      charging: new THREE.Vector3(.055, .055, -.19)
    };
  }

  return {
    right: new THREE.Vector3(.035, -.065, length * .085),
    left: new THREE.Vector3(-.03, -.005, -length * .26),
    magazine: new THREE.Vector3(-.025, -.14, -.055),
    charging: new THREE.Vector3(.05, .05, -.18)
  };
}

function installGripSockets(view) {
  const profile = weaponGripProfile(view.currentDefinition || {});

  view.sockets.rightGrip = createSocket(view.weaponRoot, 'rightGrip', profile.right);
  view.sockets.leftGrip = createSocket(view.weaponRoot, 'leftGrip', profile.left);

  if (view.parts.magazine) {
    view.sockets.magazineGrip = createSocket(
      view.parts.magazine,
      'magazineGrip',
      new THREE.Vector3(0, 0, 0)
    );
  } else {
    view.sockets.magazineGrip = createSocket(view.weaponRoot, 'magazineGrip', profile.magazine);
  }

  if (view.parts.bolt) {
    view.sockets.chargingHandle = createSocket(
      view.parts.bolt,
      'chargingHandle',
      new THREE.Vector3(0, 0, 0)
    );
  } else {
    view.sockets.chargingHandle = createSocket(view.weaponRoot, 'chargingHandle', profile.charging);
  }
}

function ensureWeaponIK(view) {
  view._v4IK ||= new CharacterIKRig({ mobile });
  const diagnostics = view._v4IK.bind({
    arms: view.arms,
    bones: view.bones,
    sockets: view.sockets
  });
  view.diagnostics.ik = diagnostics;
  globalThis.__PROJECT_STRIKE_IK__ = diagnostics;
  return diagnostics;
}

function collectGroundMeshes(scene) {
  const meshes = [];
  scene?.traverse(object => {
    if (!object.isMesh) return;
    if (!object.userData?.surface) return;
    if (object.userData?.target) return;
    meshes.push(object);
  });
  return meshes;
}

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
const originalMapBones = proto.mapBones;
const originalBuildSockets = proto.buildSockets;
const originalUpdate = proto.update;
const originalRecoil = proto.recoil;

proto.mapBones = function () {
  originalMapBones.call(this);
  ensureWeaponIK(this);
};

proto.buildSockets = function () {
  originalBuildSockets.call(this);
  installGripSockets(this);
  ensureWeaponIK(this);
};

proto.loadArms = async function (url) {
  const ready = await originalLoadArms.call(this, url);
  if (!ready) AdvancedFPSViewModel.prototype.installFallbackArms.call(this);
  ensureWeaponIK(this);
  return ready;
};

proto.loadWeapon = async function (definition) {
  const ready = await originalLoadWeapon.call(this, definition);
  if (!ready) AdvancedFPSViewModel.prototype.installFallbackWeapon.call(this, definition);
  ensureWeaponIK(this);
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

  // Existing animation/procedural pose is the base layer.
  originalUpdate.call(this, dt, state);

  // Weapon inertia/jerk remains a procedural layer before IK.
  const jerkWeight = THREE.MathUtils.clamp(this._v4Jerk / 70, 0, 1);
  const pulse = Math.sin((state.time || performance.now() * .001) * 43) * jerkWeight;
  this.weaponRoot.position.x += this._v4FreeAimX;
  this.weaponRoot.position.y += this._v4FreeAimY;
  this.weaponRoot.rotation.y -= this._v4FreeAimX * 1.65;
  this.weaponRoot.rotation.x += this._v4FreeAimY * 1.28;
  this.weaponRoot.rotation.z += pulse * .007;
  this.armRoot.rotation.z += pulse * .0035;

  // Final correction layer: real Three.js CCD IK locks each hand to the
  // physical weapon grip after animation, recoil, sprint/slide motion and sway.
  let leftWeight = this.ads ? 1 : .92;
  let rightWeight = this.ads ? 1 : .97;
  if (state.sprint) {
    leftWeight *= .68;
    rightWeight *= .82;
  }
  if (state.slide > 0) {
    leftWeight *= .56;
    rightWeight *= .72;
  }
  if (state.airborne) {
    leftWeight *= .72;
    rightWeight *= .84;
  }
  if (this.reloading) {
    const reloadProgress = THREE.MathUtils.clamp(
      this.reloadT / Math.max(this.reloadDuration, .001),
      0,
      1
    );
    const release = Math.sin(reloadProgress * Math.PI);
    leftWeight = THREE.MathUtils.lerp(.46, .035, release);
    rightWeight = THREE.MathUtils.lerp(.72, .5, release);
  }

  this.scene.updateMatrixWorld(true);
  ensureWeaponIK(this);
  this._v4IK?.update({ leftWeight, rightWeight });

  if (worldScene && !this._v4Body) {
    this._v4Body = new TrueBodyRig(worldScene, {
      mobile,
      groundMeshes: collectGroundMeshes(worldScene)
    });
  }
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
  globalThis.__PROJECT_STRIKE_DIAGNOSTICS__ = {
    runtime: 'v4',
    guardedAssetLoads: true,
    trueBody: true,
    barrelBallistics: true,
    weightedJerk: true,
    productionServiceWorker: true,
    weaponIK: true,
    footIK: true,
    ikSolver: 'Three.js CCDIKSolver',
    ik: globalThis.__PROJECT_STRIKE_IK__ || null
  };
  return true;
}

const diagnosticTimer = setInterval(() => {
  if (publishDiagnostics()) clearInterval(diagnosticTimer);
}, 100);
setTimeout(() => clearInterval(diagnosticTimer), 60_000);
