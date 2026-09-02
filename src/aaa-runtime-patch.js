import * as THREE from 'three';
import { AudioManager } from './audio/AudioManager.js';
import { AAAFeelSystem } from './gameplay/AAAFeelSystem.js';
import { CombatEffects } from './gameplay/CombatSystems.js';
import { FPSViewModel } from './weapons/FPSViewModel.js';

const mobile = matchMedia('(any-pointer: coarse)').matches;
const feelByView = new WeakMap();
let activeAudio = null;

function feel(view) {
  if (!feelByView.has(view)) feelByView.set(view, new AAAFeelSystem(view, { mobile }));
  return feelByView.get(view);
}

function moveIKTarget(view, socketName) {
  const chain = view._v4IK?.chains?.left;
  const socket = view.sockets?.[socketName];
  if (!chain?.target || !socket) return false;
  if (chain.target.parent !== socket) socket.add(chain.target);
  chain.target.position.set(0, 0, 0);
  chain.target.quaternion.identity();
  chain.target.updateWorldMatrix(true, false);
  return true;
}

function routeReloadIK(view) {
  if (!view._v4IK?.chains?.left) return;
  if (!view.reloading) {
    moveIKTarget(view, 'leftGrip');
    return;
  }

  const t = THREE.MathUtils.clamp(view.reloadT / Math.max(view.reloadDuration, .001), 0, 1);
  const mode = view._aaaReloadMode || 'tactical';
  if (t >= .12 && t <= .67) {
    moveIKTarget(view, 'magazineGrip');
  } else if (mode === 'empty' && t >= .72 && t <= .94) {
    moveIKTarget(view, 'chargingHandle');
  } else {
    moveIKTarget(view, 'leftGrip');
  }
}

const audioUnlock = AudioManager.prototype.unlock;
AudioManager.prototype.unlock = async function (...args) {
  const result = await audioUnlock.apply(this, args);
  activeAudio = this;
  return result;
};

const proto = FPSViewModel.prototype;
const baseUpdate = proto.update;
const baseRecoil = proto.recoil;
const baseReload = proto.reload;
const baseEmitReload = proto.emitReload;
const baseLoadWeapon = proto.loadWeapon;

proto.loadWeapon = async function (definition) {
  const ready = await baseLoadWeapon.call(this, definition);
  feel(this);
  return ready;
};

proto.reload = function (onEvent) {
  const ammo = Number(this.currentDefinition?.ammo ?? 1);
  this._aaaReloadMode = ammo <= 0 ? 'empty' : 'tactical';
  const started = baseReload.call(this, onEvent);
  if (!started) return false;

  const clip = this._aaaReloadMode === 'empty'
    ? this.playAuthored(/empty.?reload|reload.?empty|rack|charging|bolt/i)
    : this.playAuthored(/tactical|reload|mag.?change|magazine/i);
  const authored = clip?.duration || 0;
  const scaled = this._aaaReloadMode === 'empty'
    ? Math.max(this.reloadDuration, authored) * 1.1
    : Math.max(.9, Math.max(this.reloadDuration, authored) * .92);
  this.reloadDuration = THREE.MathUtils.clamp(scaled, .82, 3.7);
  return true;
};

proto.emitReload = function (name) {
  // A retained round does not require a bolt/charging-handle cycle. Empty
  // reloads keep the bolt event and route the left-hand IK target to it.
  if (name === 'bolt' && this._aaaReloadMode === 'tactical') return;
  return baseEmitReload.call(this, name);
};

proto.recoil = function (amount = 1) {
  baseRecoil.call(this, amount);
  feel(this).shot(amount, this.currentDefinition || {});
};

proto.update = function (dt, state = {}) {
  // Reload IK is retargeted before the V4 CCD pass, making the hand travel to
  // magazine/charging sockets rather than simply fading IK out.
  routeReloadIK(this);
  baseUpdate.call(this, dt, state);
  feel(this).update(dt, state);
};

const MATERIAL_AUDIO = {
  concrete: { gain: .075, rate: .78 },
  metal: { gain: .09, rate: 1.22 },
  wood: { gain: .07, rate: .91 },
  glass: { gain: .085, rate: 1.45 },
  body: { gain: .045, rate: .7 }
};

const effectsProto = CombatEffects.prototype;
const baseImpact = effectsProto.impact;
effectsProto.impact = function (point, normal, options = {}) {
  baseImpact.call(this, point, normal, options);
  const kind = options.kind || 'concrete';
  const sound = MATERIAL_AUDIO[kind] || MATERIAL_AUDIO.concrete;
  activeAudio?.playResident?.('collision', {
    gain: sound.gain,
    rate: sound.rate * (.94 + Math.random() * .12),
    position: point
  });

  const count = this.mobile ? 2 : 5;
  this._aaaChipGeo ||= new THREE.IcosahedronGeometry(.012, 0);
  this._aaaSplinterGeo ||= new THREE.BoxGeometry(.008, .008, .065);
  this._aaaGlassGeo ||= new THREE.TetrahedronGeometry(.022, 0);

  for (let i = 0; i < count; i++) {
    let geometry = this._aaaChipGeo;
    let color = 0xb9b3a8;
    let opacity = .88;
    if (kind === 'wood') {
      geometry = this._aaaSplinterGeo;
      color = 0xb67d45;
    } else if (kind === 'metal') {
      geometry = this._aaaSplinterGeo;
      color = 0xffd278;
    } else if (kind === 'glass') {
      geometry = this._aaaGlassGeo;
      color = 0xbdeaff;
      opacity = .54;
    }

    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: opacity < 1,
      opacity,
      depthWrite: kind !== 'glass'
    });
    const chip = new THREE.Mesh(geometry, material);
    chip.position.copy(point).addScaledVector(normal, .018);
    chip.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    const tangent = new THREE.Vector3(Math.random() - .5, Math.random() * .55, Math.random() - .5)
      .normalize()
      .multiplyScalar(.45 + Math.random() * 1.9)
      .addScaledVector(normal, .35 + Math.random() * .85);
    this.add(chip, {
      life: kind === 'metal' ? .11 + Math.random() * .1 : .22 + Math.random() * .3,
      vel: tangent,
      gravity: kind === 'glass' ? 5.2 : 7.4,
      fade: true
    });
  }
};

globalThis.__PROJECT_STRIKE_AAA__ = {
  weaponSprings: true,
  splitCameraAndGunRecoil: true,
  freeAimBox: true,
  scopeParallax: true,
  tacticalReload: true,
  emptyReload: true,
  reloadIKRetargeting: true,
  materialImpactDebris: true,
  materialImpactAudio: true
};
