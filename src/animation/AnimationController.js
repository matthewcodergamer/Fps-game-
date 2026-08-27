import * as THREE from 'three';

export class AnimationController {
  constructor(root) {
    this.root = root;
    this.mixer = new THREE.AnimationMixer(root);
    this.actions = new Map();
    this.activeBase = null;
    this.activeUpper = null;
    this.additive = new Set();
    this.bones = new Map();
    root.traverse((node) => { if (node.isBone) this.bones.set(node.name, node); });
  }

  registerClips(clips = []) {
    for (const clip of clips) {
      const action = this.mixer.clipAction(clip);
      action.enabled = true;
      this.actions.set(clip.name, action);
    }
  }

  playBase(name, fade = 0.18) {
    const next = this.actions.get(name);
    if (!next || next === this.activeBase) return next || null;
    next.reset().setEffectiveWeight(1).setLoop(THREE.LoopRepeat, Infinity).play();
    if (this.activeBase) this.activeBase.crossFadeTo(next, fade, true);
    this.activeBase = next;
    return next;
  }

  playUpper(name, { fade = 0.08, loop = false, timeScale = 1 } = {}) {
    const next = this.actions.get(name);
    if (!next) return null;
    next.reset().setEffectiveWeight(1).setEffectiveTimeScale(timeScale);
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    next.clampWhenFinished = !loop;
    next.play();
    if (this.activeUpper && this.activeUpper !== next) this.activeUpper.fadeOut(fade);
    next.fadeIn(fade);
    this.activeUpper = next;
    return next;
  }

  playAdditive(name, weight = 1) {
    const action = this.actions.get(name);
    if (!action) return null;
    action.reset().setEffectiveWeight(weight).setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = false;
    action.play();
    this.additive.add(action);
    return action;
  }

  setBoneRotation(name, x = 0, y = 0, z = 0, blend = 1) {
    const bone = this.bones.get(name);
    if (!bone) return false;
    const target = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'YXZ'));
    bone.quaternion.slerp(target, THREE.MathUtils.clamp(blend, 0, 1));
    return true;
  }

  aimSpine({ yaw = 0, pitch = 0, names = ['Spine','Spine1','Spine2','Chest'] } = {}) {
    const usable = names.filter((n) => this.bones.has(n));
    if (!usable.length) return;
    const inv = 1 / usable.length;
    usable.forEach((name, i) => this.setBoneRotation(name, pitch * inv, yaw * inv, 0, 0.35 + i * 0.08));
  }

  update(dt) {
    this.mixer.update(dt);
    for (const action of [...this.additive]) {
      if (!action.isRunning()) this.additive.delete(action);
    }
  }
}
