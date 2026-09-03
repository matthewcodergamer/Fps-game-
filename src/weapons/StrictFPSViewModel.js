import * as THREE from 'three';
import { CharacterIKRig } from '../animation/CharacterIKRig.js';
import { FPSViewModel } from './FPSViewModel.js';

const MOBILE = /iPhone|iPad|iPod/i.test(navigator.userAgent || '') || matchMedia('(any-pointer: coarse)').matches;

function ensureSocket(view, name, position) {
  if (view.sockets[name]) return view.sockets[name];
  const socket = new THREE.Object3D();
  socket.name = `V10_${name}`;
  socket.position.copy(position);
  view.weaponRoot.add(socket);
  view.sockets[name] = socket;
  return socket;
}

/**
 * V10 has no procedural weapon/arm fallback. A model failure is a boot/equip
 * failure and is surfaced to the loading UI. The only runtime correction is
 * skeletal IK over the actual repository arm rig.
 */
export class StrictFPSViewModel extends FPSViewModel {
  constructor(worldCamera, assets) {
    super(worldCamera, assets);
    this.ikRig = new CharacterIKRig({ mobile: MOBILE });
    this.ikDiagnostics = { active: false, reason: 'models-not-loaded' };
    this._barrelOrigin = new THREE.Vector3();
    this._barrelTip = new THREE.Vector3();
    this._barrelDirection = new THREE.Vector3(0, 0, -1);
  }

  installInteractionSockets() {
    // Coordinates are in the normalized weapon-root space. These are semantic
    // interaction anchors, not visible fallback geometry.
    ensureSocket(this, 'rightGrip', new THREE.Vector3(.012, -.035, -.035));
    ensureSocket(this, 'leftGrip', new THREE.Vector3(-.006, -.026, -.255));
    ensureSocket(this, 'magazineGrip', new THREE.Vector3(.012, -.098, -.125));
    ensureSocket(this, 'chargingHandle', new THREE.Vector3(.038, .055, -.115));
  }

  bindIK() {
    if (!this.arms || !this.weapon) {
      this.ikDiagnostics = { active: false, reason: 'models-not-loaded' };
      return this.ikDiagnostics;
    }
    this.installInteractionSockets();
    this.ikDiagnostics = this.ikRig.bind({
      arms: this.arms,
      bones: this.bones,
      sockets: this.sockets
    });
    return this.ikDiagnostics;
  }

  async loadArms(url) {
    const ready = await super.loadArms(url);
    if (!ready || !this.arms) {
      throw new Error(`Required first-person arm model failed: ${url}`);
    }
    if (this.weapon) this.bindIK();
    return true;
  }

  async loadWeapon(definition) {
    const ready = await super.loadWeapon(definition);
    if (!ready || !this.weapon) {
      throw new Error(`Required weapon model failed: ${definition?.model || definition?.name || 'unknown'}`);
    }
    this.installInteractionSockets();
    if (this.arms) this.bindIK();
    return true;
  }

  requireIK() {
    const diagnostics = this.bindIK();
    if (!diagnostics.active || (diagnostics.activeChains || 0) < 1) {
      throw new Error(`Required weapon IK could not bind: ${diagnostics.reason || 'no compatible arm chain'}`);
    }
    return diagnostics;
  }

  barrelDirectionWorld(out = new THREE.Vector3()) {
    this.scene.updateMatrixWorld(true);
    const muzzle = this.sockets.muzzle;
    if (!muzzle) {
      this.worldCamera.getWorldDirection(out);
      return out.normalize();
    }

    muzzle.getWorldPosition(this._barrelOrigin);
    this._barrelTip.set(0, 0, -.14);
    muzzle.localToWorld(this._barrelTip);
    out.subVectors(this._barrelTip, this._barrelOrigin);
    if (out.lengthSq() < 1e-8) this.worldCamera.getWorldDirection(out);
    return out.normalize();
  }

  update(dt, state = {}) {
    super.update(dt, state);

    // The base animation/procedural pose runs first. CCD is a final correction
    // that locks real hand bones to the real weapon interaction sockets.
    if (this.ikDiagnostics.active) {
      this.ikRig.retarget(this.sockets);
      this.ikRig.update({
        leftWeight: this.reloading ? .42 : 1,
        rightWeight: 1
      });
    }
  }
}
