import * as THREE from 'three';
import { CombatEffects, GrenadeController } from './gameplay/CombatSystems.js';
import { PhysicalReactionSystem } from './gameplay/PhysicalReactionSystem.js';
import { FPSViewModel } from './weapons/FPSViewModel.js';

const mobile = matchMedia('(any-pointer: coarse)').matches;
const reactions = new PhysicalReactionSystem({ mobile });
let lastBodyHit = null;
let lastWeapon = { class: 'rifle', damage: 30, recoil: 1, direction: new THREE.Vector3(0, 0, -1) };

const restoreReactionTarget = reactions.restore.bind(reactions);
reactions.restore = target => {
  const data = target?.userData || {};
  for (const mesh of data.psHiddenMeshes || []) mesh.visible = true;
  data.psHiddenMeshes?.clear?.();
  data.psDetached?.clear?.();
  return restoreReactionTarget(target);
};

// V4 already owns physical barrel-origin ray adjustment. This wrapper observes
// its final result without changing hit ordering or damage logic.
const intersectObjects = THREE.Raycaster.prototype.intersectObjects;
THREE.Raycaster.prototype.intersectObjects = function (...args) {
  const hits = intersectObjects.apply(this, args);
  const body = hits.find(hit => hit?.object?.userData?.target) || null;
  lastBodyHit = body;
  if (body) lastWeapon.direction = this.ray.direction.clone();
  return hits;
};

const viewProto = FPSViewModel.prototype;
const recoil = viewProto.recoil;
viewProto.recoil = function (amount = 1) {
  lastWeapon = {
    class: this.currentDefinition?.class || 'rifle',
    damage: Number(this.currentDefinition?.damage || 30),
    recoil: Number(this.currentDefinition?.recoil || amount || 1),
    pellets: Number(this.currentDefinition?.pellets || 1),
    direction: this.barrelDirectionWorld?.(new THREE.Vector3()) || this.worldCamera.getWorldDirection(new THREE.Vector3())
  };
  return recoil.call(this, amount);
};

const effectsProto = CombatEffects.prototype;
const impact = effectsProto.impact;
effectsProto.impact = function (point, normal, options = {}) {
  const result = impact.call(this, point, normal, options);
  if (options.kind === 'body' && lastBodyHit?.object?.userData?.target) {
    reactions.hit(lastBodyHit, lastWeapon);
    lastBodyHit = null;
  }
  return result;
};

// Explosion damage remains controlled by the existing grenade system. This
// only layers directional physical response / dismemberment onto nearby NPCs.
const detonate = GrenadeController.prototype.detonate;
GrenadeController.prototype.detonate = function (grenade, arena, playerPos) {
  const point = grenade?.mesh?.position?.clone?.() || new THREE.Vector3();
  const nearby = grenade?.type === 'flash'
    ? []
    : (arena?.targets || []).filter(target => target.userData?.alive && target.position.distanceTo(point) < 7.5)
      .map(target => ({ target, distance: target.position.distanceTo(point) }));

  const result = detonate.call(this, grenade, arena, playerPos);
  for (const entry of nearby) {
    const strength = THREE.MathUtils.clamp(1 - entry.distance / 7.5, 0, 1);
    reactions.explosion(entry.target, point, strength);
  }
  return result;
};

globalThis.__PROJECT_STRIKE_GORE_ENABLED__ = true;
globalThis.__PROJECT_STRIKE_PHYSICAL_REACTIONS__ = {
  system: 'procedural limb-health + directional stagger',
  positionalHitZones: true,
  limbHealth: true,
  stagger: true,
  limp: true,
  heavyWeaponDismemberment: true,
  skinnedBoneHiding: true,
  detachedProxyFallback: true,
  stumpPlugs: true,
  bloodParticles: true,
  mobileDebrisCaps: true,
  respawnRestoration: true,
  euphoriaClaimed: false
};

const diagnosticsTimer = setInterval(() => {
  const diagnostics = globalThis.__PROJECT_STRIKE_DIAGNOSTICS__;
  const button = document.querySelector('#playBtn');
  if (!diagnostics || !button || button.disabled) return;
  diagnostics.runtime = 'v7';
  diagnostics.mobileStability = globalThis.__PROJECT_STRIKE_MOBILE_STABILITY__ || null;
  diagnostics.physicalReactions = true;
  diagnostics.limbDamage = true;
  diagnostics.dismemberment = true;
  diagnostics.largeAssetCacheDisabled = true;
  const badge = document.querySelector('#stageBadge');
  if (badge) badge.textContent = 'V7';
  clearInterval(diagnosticsTimer);
}, 100);
setTimeout(() => clearInterval(diagnosticsTimer), 60_000);
