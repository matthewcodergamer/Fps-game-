import * as THREE from 'three';
import { FPSViewModel } from './FPSViewModel.js';

function clearGroup(group) {
  while (group.children.length) group.remove(group.children[0]);
}

function addBox(group, size, position, material, rotation = null) {
  const object = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
  object.position.copy(position);
  if (rotation) object.rotation.copy(rotation);
  group.add(object);
  return object;
}

/**
 * Recovery + tactility layer on top of the existing FPSViewModel.
 *
 * The base class remains the authoritative repository-asset implementation.
 * This subclass adds bounded fallback geometry, barrel-origin ballistics and a
 * small free-aim / jerk response without replacing the existing architecture.
 */
export class AdvancedFPSViewModel extends FPSViewModel {
  constructor(worldCamera, assets) {
    super(worldCamera, assets);
    this.freeAimX = 0;
    this.freeAimY = 0;
    this._advancedLastYaw = 0;
    this._advancedLastPitch = 0;
    this._socketQuaternion = new THREE.Quaternion();
  }

  installFallbackArms() {
    clearGroup(this.armRoot);
    const cloth = new THREE.MeshStandardMaterial({ color: 0x202630, roughness: .78, metalness: .08 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x0c0f13, roughness: .88, metalness: .02 });
    const group = new THREE.Group();
    group.name = 'FallbackFirstPersonArms';

    const makeArm = side => {
      const arm = new THREE.Group();
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(.055, .28, 3, 6), cloth);
      upper.rotation.z = side * .34;
      upper.rotation.x = 1.12;
      upper.position.set(side * .19, -.02, -.1);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(.09, .075, .13), glove);
      hand.position.set(side * .23, -.11, -.28);
      hand.rotation.set(.14, side * .08, side * .08);
      arm.add(upper, hand);
      return arm;
    };

    group.add(makeArm(-1), makeArm(1));
    this.prepareViewMeshes(group);
    this.arms = group;
    this.armRoot.position.set(.18, -.34, -.31);
    this.armRoot.rotation.set(.02, 0, .015);
    this.armRoot.add(group);
    this.armClips = [];
    this.armMixer = null;
    this.bones = {};
    this.diagnostics.arms = { fallback: true, meshes: 4, animations: 0 };
  }

  installFallbackWeapon(definition = {}) {
    clearGroup(this.weaponRoot);
    this.weaponRoot.add(this.attachmentRoot);
    clearGroup(this.attachmentRoot);

    const metal = new THREE.MeshStandardMaterial({ color: 0x171b20, roughness: .32, metalness: .82 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x080a0d, roughness: .55, metalness: .42 });
    const accent = new THREE.MeshStandardMaterial({ color: 0x2b3138, roughness: .48, metalness: .65 });
    const group = new THREE.Group();
    group.name = `FallbackWeapon_${definition.id || 'rifle'}`;

    const pistol = definition.class === 'pistol';
    const shotgun = definition.class === 'shotgun';
    const sniper = definition.class === 'sniper';
    const length = pistol ? .42 : sniper ? .96 : shotgun ? .9 : .78;

    addBox(group, new THREE.Vector3(.095, .12, length * .56), new THREE.Vector3(0, .015, -.12), metal);
    addBox(group, new THREE.Vector3(.05, .055, length * .5), new THREE.Vector3(0, .045, -.48), dark);
    if (!pistol) addBox(group, new THREE.Vector3(.095, .12, .22), new THREE.Vector3(0, .02, .25), accent);
    const mag = addBox(group, new THREE.Vector3(.075, pistol ? .16 : .22, .09), new THREE.Vector3(0, -.11, -.06), dark);
    mag.rotation.x = -.16;
    mag.name = 'FallbackMagazine';
    const trigger = addBox(group, new THREE.Vector3(.04, .055, .055), new THREE.Vector3(0, -.045, .045), accent);
    trigger.name = 'FallbackTrigger';

    this.prepareViewMeshes(group);
    this.weapon = group;
    this.weaponRoot.add(group, this.attachmentRoot);
    this.weaponRoot.position.copy(this.baseHip);
    this.weaponRoot.rotation.set(.012, -.025, -.012);
    this.weaponClips = [];
    this.weaponMixer = null;
    this.parts = { magazine: mag, trigger };
    this.partRest.clear();
    for (const part of Object.values(this.parts)) {
      this.partRest.set(part, { position: part.position.clone(), quaternion: part.quaternion.clone() });
    }
    this.sockets = {};
    this.buildSockets();
    this.diagnostics.weapon = {
      fallback: true,
      meshes: group.children.length,
      animations: 0,
      url: definition.model || null,
      format: 'procedural-recovery'
    };
  }

  async loadArms(url) {
    const ready = await super.loadArms(url);
    if (!ready) this.installFallbackArms();
    return ready;
  }

  async loadWeapon(definition) {
    const ready = await super.loadWeapon(definition);
    if (!ready) this.installFallbackWeapon(definition);
    return ready;
  }

  barrelDirectionWorld(out = new THREE.Vector3()) {
    this.scene.updateMatrixWorld(true);
    const socket = this.sockets.muzzle;
    if (!socket) return this.worldCamera.getWorldDirection(out);
    socket.getWorldQuaternion(this._socketQuaternion);
    out.set(0, 0, -1)
      .applyQuaternion(this._socketQuaternion)
      .applyQuaternion(this.worldCamera.quaternion)
      .normalize();
    return out;
  }

  update(dt, state = {}) {
    const yaw = state.yaw || 0;
    const pitch = state.pitch || 0;
    const yawDelta = THREE.MathUtils.clamp(yaw - this._advancedLastYaw, -.09, .09);
    const pitchDelta = THREE.MathUtils.clamp(pitch - this._advancedLastPitch, -.09, .09);
    this._advancedLastYaw = yaw;
    this._advancedLastPitch = pitch;

    const ads = Boolean(this.ads);
    this.freeAimX = THREE.MathUtils.clamp(this.freeAimX - yawDelta * .52, -.044, .044);
    this.freeAimY = THREE.MathUtils.clamp(this.freeAimY + pitchDelta * .38, -.03, .03);
    this.freeAimX = THREE.MathUtils.damp(this.freeAimX, 0, ads ? 25 : 7.5, dt);
    this.freeAimY = THREE.MathUtils.damp(this.freeAimY, 0, ads ? 25 : 8.5, dt);

    super.update(dt, state);

    const jerkWeight = THREE.MathUtils.clamp((state.jerk || 0) / 70, 0, 1);
    const pulse = Math.sin((state.time || 0) * 43) * jerkWeight;
    this.weaponRoot.position.x += this.freeAimX;
    this.weaponRoot.position.y += this.freeAimY;
    this.weaponRoot.rotation.y -= this.freeAimX * 1.65;
    this.weaponRoot.rotation.x += this.freeAimY * 1.28;
    this.weaponRoot.rotation.z += pulse * .007;
    this.armRoot.rotation.z += pulse * .0035;
  }
}
