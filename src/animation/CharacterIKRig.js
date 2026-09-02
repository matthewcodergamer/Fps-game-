import * as THREE from 'three';
import { CCDIKSolver } from 'three/addons/animation/CCDIKSolver.js';

const SIDE_CONFIG = {
  left: { upper: 'leftUpper', hand: 'leftHand', socket: 'leftGrip' },
  right: { upper: 'rightUpper', hand: 'rightHand', socket: 'rightGrip' }
};

const HAND_HINT = /hand|wrist|palm/i;
const FINGER_HINT = /thumb|index|middle|ring|pinky|pinkie|finger/i;
const ARM_HINT = /fore.?arm|lower.?arm|upper.?arm|arm/i;

function sideFromName(name = '') {
  const value = String(name).toLowerCase();
  if (/left|(^|[_.\- ])l([_.\- ]|$)|\.l$|_l$|-l$/.test(value)) return 'left';
  if (/right|(^|[_.\- ])r([_.\- ]|$)|\.r$|_r$|-r$/.test(value)) return 'right';
  return null;
}

function boneChildren(bone) {
  return bone?.children?.filter(child => child?.isBone) || [];
}

function fingerDescendantCount(bone) {
  let count = 0;
  bone?.traverse?.(node => {
    if (node !== bone && node.isBone && FINGER_HINT.test(node.name || '')) count++;
  });
  return count;
}

function collectSkinnedMeshes(root) {
  const meshes = [];
  root?.traverse(object => {
    if (object.isSkinnedMesh && object.skeleton?.bones?.length) meshes.push(object);
  });
  return meshes;
}

function uniqueBones(meshes) {
  const seen = new Set();
  const entries = [];
  for (const mesh of meshes) {
    for (const bone of mesh.skeleton.bones) {
      if (!bone?.isBone || seen.has(bone)) continue;
      seen.add(bone);
      entries.push({ bone, mesh, skeleton: mesh.skeleton });
    }
  }
  return entries;
}

function candidateScore(bone) {
  const name = bone.name || '';
  const directChildren = boneChildren(bone).length;
  const fingerCount = fingerDescendantCount(bone);
  let score = 0;
  if (HAND_HINT.test(name)) score += 80;
  if (FINGER_HINT.test(name)) score -= 35;
  if (ARM_HINT.test(name) && !HAND_HINT.test(name)) score -= 12;
  score += Math.min(directChildren, 6) * 13;
  score += Math.min(fingerCount, 12) * 5;
  // Hands commonly fan into several finger chains even when every bone is
  // exported as Bone.001/Bone.002 and carries no useful semantic name.
  if (directChildren >= 3) score += 45;
  return score;
}

function discoverHands(arms, mappedBones = {}) {
  const meshes = collectSkinnedMeshes(arms);
  const entries = uniqueBones(meshes);
  arms?.updateMatrixWorld(true);

  const result = {
    left: mappedBones.leftHand || null,
    right: mappedBones.rightHand || null
  };

  const diagnostics = entries.map(entry => {
    const position = new THREE.Vector3();
    entry.bone.getWorldPosition(position);
    return {
      ...entry,
      position,
      side: sideFromName(entry.bone.name),
      score: candidateScore(entry.bone)
    };
  });

  // First prefer explicit semantic names when the exporter preserved them.
  for (const side of ['left', 'right']) {
    if (result[side]) continue;
    const semantic = diagnostics
      .filter(entry => entry.side === side && HAND_HINT.test(entry.bone.name || ''))
      .sort((a, b) => b.score - a.score)[0];
    if (semantic) result[side] = semantic.bone;
  }

  // Next prefer the characteristic hand topology: a bone that fans into
  // several finger branches. This works with generic Blender Bone.00x names.
  const already = new Set(Object.values(result).filter(Boolean));
  const handish = diagnostics
    .filter(entry => !already.has(entry.bone) && entry.score >= 45)
    .sort((a, b) => b.score - a.score);

  for (const side of ['left', 'right']) {
    if (result[side]) continue;
    const sideCandidate = handish.find(entry => entry.side === side && !already.has(entry.bone));
    if (sideCandidate) {
      result[side] = sideCandidate.bone;
      already.add(sideCandidate.bone);
    }
  }

  // When names contain no side markers at all, take the two strongest hand
  // candidates and assign them by horizontal position in the normalized rig.
  const missing = ['left', 'right'].filter(side => !result[side]);
  if (missing.length) {
    const pool = handish.filter(entry => !already.has(entry.bone)).slice(0, Math.max(4, missing.length));
    pool.sort((a, b) => a.position.x - b.position.x);
    if (!result.left && pool.length) {
      result.left = pool[0].bone;
      already.add(pool[0].bone);
    }
    const remaining = pool.filter(entry => !already.has(entry.bone));
    if (!result.right && remaining.length) {
      result.right = remaining[remaining.length - 1].bone;
      already.add(result.right);
    }
  }

  return {
    meshes,
    hands: result,
    availableBones: diagnostics
      .sort((a, b) => b.score - a.score)
      .slice(0, 18)
      .map(entry => ({
        name: entry.bone.name || '(unnamed)',
        score: entry.score,
        children: boneChildren(entry.bone).length,
        side: entry.side,
        x: Number(entry.position.x.toFixed(4))
      }))
  };
}

function findSkinnedMesh(meshes, effector) {
  return meshes.find(mesh => mesh.skeleton.bones.includes(effector)) || null;
}

function buildLinks(skeleton, effector, mappedUpper = null) {
  const links = [];
  let bone = effector?.parent || null;
  let guard = 0;

  while (bone?.isBone && guard++ < 10 && links.length < 3) {
    const index = skeleton.bones.indexOf(bone);
    if (index >= 0) {
      links.push({ index });
      if (mappedUpper && bone === mappedUpper) break;
      // If useful names exist, stop after reaching the upper arm. Otherwise
      // three immediate parents is a safe hand→forearm→upper-arm chain.
      if (!mappedUpper && links.length >= 2 && /upper.?arm|arm.?1|shoulder/i.test(bone.name || '')) break;
    }
    bone = bone.parent;
  }

  return links;
}

function attachTargetBone(skeleton, socket, name) {
  const target = new THREE.Bone();
  target.name = name;
  socket.add(target);

  const index = skeleton.bones.length;
  skeleton.bones.push(target);
  skeleton.boneInverses.push(new THREE.Matrix4());

  // If the skeleton already created a bone texture, resize it so the extra
  // target entries are represented. Skin indices never reference these target
  // bones; they exist only so the official CCD solver can read their matrices.
  if (skeleton.boneTexture && typeof skeleton.computeBoneTexture === 'function') {
    skeleton.computeBoneTexture();
  }

  return { target, index };
}

/**
 * Weapon hand IK for the repository first-person rig.
 *
 * The solver is Three.js' official CCDIKSolver. Existing authored/procedural
 * animation runs first; this class only performs a final positional correction
 * so the hands stay locked to weapon grip sockets.
 */
export class CharacterIKRig {
  constructor({ mobile = false } = {}) {
    this.mobile = mobile;
    this.arms = null;
    this.solvers = [];
    this.chains = {};
    this.diagnostics = {
      active: false,
      solver: 'Three.js CCDIKSolver',
      chains: {},
      reason: 'not-bound'
    };
  }

  clear() {
    for (const chain of Object.values(this.chains)) chain.target?.removeFromParent();
    this.solvers.length = 0;
    this.chains = {};
    this.arms = null;
    this.diagnostics = {
      active: false,
      solver: 'Three.js CCDIKSolver',
      chains: {},
      reason: 'cleared'
    };
  }

  retarget(sockets = {}) {
    let moved = 0;
    for (const [side, config] of Object.entries(SIDE_CONFIG)) {
      const chain = this.chains[side];
      const socket = sockets[config.socket];
      if (!chain?.target || !socket) continue;
      socket.add(chain.target);
      chain.target.position.set(0, 0, 0);
      chain.target.quaternion.identity();
      moved++;
    }
    return moved;
  }

  bind({ arms, bones = {}, sockets = {} } = {}) {
    if (!arms) {
      this.diagnostics = {
        active: false,
        solver: 'Three.js CCDIKSolver',
        chains: {},
        reason: 'no-arms'
      };
      return this.diagnostics;
    }

    if (this.arms === arms && this.solvers.length) {
      this.retarget(sockets);
      return this.diagnostics;
    }

    this.clear();
    this.arms = arms;

    const discovery = discoverHands(arms, bones);
    const groups = new Map();
    const chainDiagnostics = {};

    for (const [side, config] of Object.entries(SIDE_CONFIG)) {
      const effector = discovery.hands[side];
      const socket = sockets[config.socket];
      if (!effector || !socket) {
        chainDiagnostics[side] = {
          active: false,
          reason: !socket ? `missing-${config.socket}` : 'no-hand-effector'
        };
        continue;
      }

      const mesh = findSkinnedMesh(discovery.meshes, effector);
      if (!mesh) {
        chainDiagnostics[side] = { active: false, reason: 'no-skinned-mesh' };
        continue;
      }

      const skeleton = mesh.skeleton;
      const effectorIndex = skeleton.bones.indexOf(effector);
      const mappedUpper = bones[config.upper] && skeleton.bones.includes(bones[config.upper])
        ? bones[config.upper]
        : null;
      const links = buildLinks(skeleton, effector, mappedUpper);

      if (effectorIndex < 0 || links.length < 2) {
        chainDiagnostics[side] = {
          active: false,
          reason: 'invalid-bone-chain',
          effector: effector.name || '(unnamed)',
          links: links.length
        };
        continue;
      }

      const { target, index: targetIndex } = attachTargetBone(
        skeleton,
        socket,
        `ProjectStrike_${side}_weapon_ik_target`
      );

      const ik = {
        target: targetIndex,
        effector: effectorIndex,
        links,
        iteration: this.mobile ? 2 : 4,
        minAngle: 0.0005,
        maxAngle: this.mobile ? 0.24 : 0.32,
        blendFactor: 0.9
      };

      if (!groups.has(mesh)) groups.set(mesh, []);
      groups.get(mesh).push(ik);
      this.chains[side] = { mesh, skeleton, ik, target, socketName: config.socket };

      chainDiagnostics[side] = {
        active: true,
        effector: effector.name || '(unnamed)',
        links: links.map(link => skeleton.bones[link.index]?.name || `(bone ${link.index})`),
        socket: config.socket,
        discovered: !bones[config.hand]
      };
    }

    for (const [mesh, iks] of groups) {
      this.solvers.push({ mesh, solver: new CCDIKSolver(mesh, iks) });
    }

    const activeChains = Object.values(chainDiagnostics).filter(value => value.active).length;
    this.diagnostics = {
      active: activeChains > 0,
      solver: 'Three.js CCDIKSolver',
      activeChains,
      chains: chainDiagnostics,
      availableBones: discovery.availableBones,
      reason: activeChains ? 'ready' : 'no-compatible-chains'
    };

    return this.diagnostics;
  }

  update({ leftWeight = 1, rightWeight = 1 } = {}) {
    if (!this.solvers.length) return false;

    const weights = {
      left: THREE.MathUtils.clamp(leftWeight, 0, 1),
      right: THREE.MathUtils.clamp(rightWeight, 0, 1)
    };

    for (const [side, chain] of Object.entries(this.chains)) {
      chain.ik.blendFactor = weights[side] ?? 1;
      chain.target.updateWorldMatrix(true, false);
    }

    // CCDIKSolver expects current target/effector/link matrices.
    this.arms?.updateMatrixWorld(true);
    for (const entry of this.solvers) {
      entry.mesh.updateMatrixWorld(true);
      entry.solver.update(1);
    }

    return true;
  }
}
