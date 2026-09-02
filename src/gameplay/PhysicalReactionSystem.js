import * as THREE from 'three';

const ZONES = ['head', 'torso', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];
const SEMANTIC_BONES = {
  head: /head|skull|neck/i,
  leftArm: /left.*(?:arm|hand)|(?:arm|hand).*left|(?:^|[_. -])l(?:[_. -].*)?(?:arm|hand)/i,
  rightArm: /right.*(?:arm|hand)|(?:arm|hand).*right|(?:^|[_. -])r(?:[_. -].*)?(?:arm|hand)/i,
  leftLeg: /left.*(?:leg|thigh|calf|foot)|(?:leg|thigh|calf|foot).*left/i,
  rightLeg: /right.*(?:leg|thigh|calf|foot)|(?:leg|thigh|calf|foot).*right/i
};

function freshHealth() {
  return { head: 80, torso: 150, leftArm: 75, rightArm: 75, leftLeg: 90, rightLeg: 90 };
}

function targetLocal(target, worldPoint) {
  target.updateMatrixWorld(true);
  return target.worldToLocal(worldPoint.clone());
}

function classifyZone(target, hit) {
  const explicit = hit?.object?.userData?.hitZone;
  if (explicit === 'head') return 'head';
  const name = String(hit?.object?.name || '');
  if (/head|helmet|skull/i.test(name)) return 'head';
  if (/left.*(?:arm|hand)|(?:arm|hand).*left/i.test(name)) return 'leftArm';
  if (/right.*(?:arm|hand)|(?:arm|hand).*right/i.test(name)) return 'rightArm';
  if (/left.*(?:leg|thigh|calf|foot)|(?:leg|thigh|calf|foot).*left/i.test(name)) return 'leftLeg';
  if (/right.*(?:leg|thigh|calf|foot)|(?:leg|thigh|calf|foot).*right/i.test(name)) return 'rightLeg';

  const p = targetLocal(target, hit.point);
  if (p.y > 1.52) return 'head';
  if (p.y < .82) return p.x < 0 ? 'leftLeg' : 'rightLeg';
  if (p.y > .95 && Math.abs(p.x) > .28) return p.x < 0 ? 'leftArm' : 'rightArm';
  return 'torso';
}

function collectBones(target) {
  const bones = [];
  target?.userData?.visual?.traverse?.(node => {
    if (node.isBone) bones.push(node);
  });
  return bones;
}

function boneScore(bone, point, zone) {
  const p = new THREE.Vector3();
  bone.getWorldPosition(p);
  let score = p.distanceTo(point);
  if (zone === 'head') score -= p.y * .22;
  if (zone.includes('Leg') && p.y > point.y + .75) score += 1.5;
  if (zone.includes('Arm') && p.y < point.y - .7) score += 1.2;
  if (zone.startsWith('left') && p.x > point.x + .28) score += .8;
  if (zone.startsWith('right') && p.x < point.x - .28) score += .8;
  return score;
}

function findDetachBone(target, point, zone) {
  const bones = collectBones(target);
  const semantic = SEMANTIC_BONES[zone];
  if (semantic) {
    const named = bones.filter(bone => semantic.test(bone.name || ''));
    if (named.length) return named.sort((a, b) => boneScore(a, point, zone) - boneScore(b, point, zone))[0];
  }
  const candidates = bones.filter(bone => bone.parent?.isBone);
  return candidates.sort((a, b) => boneScore(a, point, zone) - boneScore(b, point, zone))[0] || null;
}

export class PhysicalReactionSystem {
  constructor({ mobile = false } = {}) {
    this.mobile = mobile;
    this.targets = new Set();
    this.debris = [];
    this.particles = [];
    this.last = performance.now();
    this._running = true;
    requestAnimationFrame(time => this.tick(time));
  }

  ensure(target) {
    const data = target.userData;
    data.psLimbHealth ||= freshHealth();
    data.psDetachedBones ||= new Map();
    data.psGoreNodes ||= [];
    data.psReaction ||= { pitch: 0, roll: 0, yaw: 0, kick: 0, limp: 0, zone: 'torso' };
    data.psWasAlive ??= data.alive;
    this.targets.add(target);
    return data;
  }

  restore(target) {
    const data = target.userData;
    for (const [bone, scale] of data.psDetachedBones || []) bone.scale.copy(scale);
    data.psDetachedBones?.clear?.();
    for (const node of data.psGoreNodes || []) {
      node.removeFromParent();
      node.geometry?.dispose?.();
      node.material?.dispose?.();
    }
    data.psGoreNodes = [];
    data.psLimbHealth = freshHealth();
    data.psReaction = { pitch: 0, roll: 0, yaw: 0, kick: 0, limp: 0, zone: 'torso' };
    target.rotation.x = 0;
    target.rotation.z = 0;
  }

  spawnBlood(target, point, normal, count = 6) {
    const parent = target.parent;
    if (!parent) return;
    const max = this.mobile ? 18 : 42;
    for (let i = 0; i < count && this.particles.length < max; i++) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(.012 + Math.random() * .012, 4, 3),
        new THREE.MeshBasicMaterial({ color: 0x6b0d12, transparent: true, opacity: .82 })
      );
      mesh.position.copy(point);
      parent.add(mesh);
      const velocity = normal.clone().multiplyScalar(.35 + Math.random() * 1.5)
        .add(new THREE.Vector3((Math.random() - .5) * 1.2, .2 + Math.random() * 1.6, (Math.random() - .5) * 1.2));
      this.particles.push({ mesh, velocity, life: .45 + Math.random() * .55 });
    }
  }

  spawnDetachedProxy(target, point, zone, direction) {
    const parent = target.parent;
    if (!parent) return;
    while (this.debris.length >= (this.mobile ? 6 : 16)) {
      const old = this.debris.shift();
      old.mesh.removeFromParent();
      old.mesh.geometry?.dispose?.();
      old.mesh.material?.dispose?.();
    }

    const head = zone === 'head';
    const limb = zone.includes('Arm') || zone.includes('Leg');
    const geometry = head
      ? new THREE.SphereGeometry(.18, 8, 6)
      : limb
        ? new THREE.CapsuleGeometry(.09, .28, 3, 6)
        : new THREE.BoxGeometry(.22, .28, .18);
    const material = new THREE.MeshStandardMaterial({ color: 0x4d2020, roughness: .78, metalness: 0 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(point);
    parent.add(mesh);
    const velocity = direction.clone().normalize().multiplyScalar(1.8 + Math.random() * 1.7);
    velocity.y += 1.4 + Math.random() * 1.2;
    this.debris.push({ mesh, velocity, life: this.mobile ? 2.5 : 4.2, spin: new THREE.Vector3(Math.random(), Math.random(), Math.random()).multiplyScalar(8) });
  }

  addStump(target, point, zone) {
    const local = targetLocal(target, point);
    const geometry = new THREE.CylinderGeometry(.075, .095, .06, 8);
    const material = new THREE.MeshStandardMaterial({ color: 0x4b1014, roughness: .92 });
    const plug = new THREE.Mesh(geometry, material);
    plug.position.copy(local);
    plug.rotation.x = Math.PI / 2;
    target.add(plug);
    target.userData.psGoreNodes.push(plug);
  }

  detach(target, hit, zone, direction) {
    const data = this.ensure(target);
    if (data.psDetached?.has?.(zone)) return false;
    data.psDetached ||= new Set();
    if (data.psDetached.has(zone)) return false;
    data.psDetached.add(zone);

    const point = hit.point.clone();
    const bone = findDetachBone(target, point, zone);
    if (bone && !data.psDetachedBones.has(bone)) {
      data.psDetachedBones.set(bone, bone.scale.clone());
      bone.scale.setScalar(.001);
    } else if (hit.object && !hit.object.isSkinnedMesh && hit.object !== target) {
      hit.object.visible = false;
      data.psHiddenMeshes ||= new Set();
      data.psHiddenMeshes.add(hit.object);
    }

    this.addStump(target, point, zone);
    this.spawnDetachedProxy(target, point, zone, direction);
    this.spawnBlood(target, point, direction.clone().normalize(), this.mobile ? 6 : 12);
    return true;
  }

  hit(hit, weapon = {}) {
    const target = hit?.object?.userData?.target;
    if (!target?.userData?.alive) return null;
    const data = this.ensure(target);
    const zone = classifyZone(target, hit);
    const baseDamage = Number(weapon.damage || 24);
    const damage = baseDamage * (zone === 'head' ? 1.25 : 1);
    data.psLimbHealth[zone] = Math.max(0, (data.psLimbHealth[zone] ?? 100) - damage);

    const direction = (weapon.direction || new THREE.Vector3(0, 0, -1)).clone().normalize();
    const side = zone.startsWith('left') ? -1 : zone.startsWith('right') ? 1 : Math.sign(direction.x || 1);
    const magnitude = THREE.MathUtils.clamp((weapon.recoil || 1) * .12 + damage / 180, .12, .72);
    data.psReaction.pitch += direction.z * magnitude * .42;
    data.psReaction.roll += side * magnitude * .62;
    data.psReaction.yaw += direction.x * magnitude * .28;
    data.psReaction.kick = Math.min(1, data.psReaction.kick + magnitude);
    data.psReaction.zone = zone;
    if (zone.includes('Leg')) data.psReaction.limp = Math.max(data.psReaction.limp, data.psLimbHealth[zone] < 45 ? .72 : .32);

    const normal = hit.face?.normal?.clone()?.transformDirection(hit.object.matrixWorld) || direction.clone().negate();
    this.spawnBlood(target, hit.point, normal, this.mobile ? 3 : 6);

    const heavy = ['shotgun', 'sniper'].includes(weapon.class) || Number(weapon.damage || 0) >= 90;
    const severed = heavy && zone !== 'torso' && (data.psLimbHealth[zone] <= 0 || zone === 'head' || weapon.class === 'shotgun');
    if (severed) this.detach(target, hit, zone, direction);

    return { target, zone, severed, limbHealth: data.psLimbHealth[zone] };
  }

  explosion(target, point, strength = 1) {
    if (!target?.userData?.alive) return;
    const direction = new THREE.Vector3().subVectors(target.position, point).normalize();
    const hit = {
      object: { userData: { target }, name: '' },
      point: target.position.clone().add(new THREE.Vector3(0, 1.1, 0)),
      face: null
    };
    const zone = strength > .75 ? (Math.random() > .5 ? 'leftLeg' : 'rightArm') : 'torso';
    hit.object.userData.hitZone = zone === 'head' ? 'head' : undefined;
    const weapon = { class: 'explosive', damage: 120 * strength, recoil: 2.4, direction };
    const data = this.ensure(target);
    data.psReaction.roll += (Math.random() - .5) * 1.4 * strength;
    data.psReaction.pitch -= .6 * strength;
    if (strength > .72) this.detach(target, hit, zone, direction);
    this.spawnBlood(target, hit.point, direction, this.mobile ? 5 : 10);
    return weapon;
  }

  tick(time) {
    if (!this._running) return;
    const dt = Math.min(.033, Math.max(.001, (time - this.last) / 1000 || .016));
    this.last = time;

    for (const target of this.targets) {
      const data = target.userData;
      if (data.psWasAlive === false && data.alive) this.restore(target);
      data.psWasAlive = data.alive;
      if (!data.alive) continue;
      const reaction = data.psReaction;
      if (!reaction) continue;
      target.rotation.x = THREE.MathUtils.damp(target.rotation.x, reaction.pitch, 18, dt);
      target.rotation.z = THREE.MathUtils.damp(target.rotation.z, reaction.roll, 16, dt);
      reaction.pitch = THREE.MathUtils.damp(reaction.pitch, 0, 7.5, dt);
      reaction.roll = THREE.MathUtils.damp(reaction.roll, 0, 6.5, dt);
      reaction.yaw = THREE.MathUtils.damp(reaction.yaw, 0, 7, dt);
      reaction.kick = THREE.MathUtils.damp(reaction.kick, 0, 5.5, dt);
      reaction.limp = THREE.MathUtils.damp(reaction.limp, 0, .7, dt);
      if (data.patrol && reaction.limp > .05) data.patrolTime -= dt * .26 * reaction.limp;
    }

    for (let i = this.debris.length - 1; i >= 0; i--) {
      const item = this.debris[i];
      item.life -= dt;
      item.velocity.y -= 9.81 * dt;
      item.mesh.position.addScaledVector(item.velocity, dt);
      item.mesh.rotation.x += item.spin.x * dt;
      item.mesh.rotation.y += item.spin.y * dt;
      item.mesh.rotation.z += item.spin.z * dt;
      if (item.mesh.position.y < .05) {
        item.mesh.position.y = .05;
        item.velocity.y = Math.abs(item.velocity.y) * .2;
        item.velocity.x *= .65;
        item.velocity.z *= .65;
      }
      if (item.life <= 0) {
        item.mesh.removeFromParent();
        item.mesh.geometry?.dispose?.();
        item.mesh.material?.dispose?.();
        this.debris.splice(i, 1);
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const item = this.particles[i];
      item.life -= dt;
      item.velocity.y -= 7.5 * dt;
      item.mesh.position.addScaledVector(item.velocity, dt);
      item.mesh.material.opacity = Math.max(0, item.life * 1.4);
      if (item.life <= 0) {
        item.mesh.removeFromParent();
        item.mesh.geometry?.dispose?.();
        item.mesh.material?.dispose?.();
        this.particles.splice(i, 1);
      }
    }

    requestAnimationFrame(next => this.tick(next));
  }
}

export const LIMB_ZONES = ZONES;
