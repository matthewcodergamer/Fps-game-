import * as THREE from 'three';
import { CCDIKSolver } from 'three/addons/animation/CCDIKSolver.js';

const SIDE_CONFIG = {
  left: {
    upper: 'leftUpper',
    hand: 'leftHand',
    socket: 'leftGrip'
  },
  right: {
    upper: 'rightUpper',
    hand: 'rightHand',
    socket: 'rightGrip'
  }
};

function findSkinnedMesh(root, effector) {
  let match = null;
  root?.traverse(object => {
    if (match || !object.isSkinnedMesh || !object.skeleton) return;
    if (object.skeleton.bones.includes(effector)) match = object;
  });
  return match;
}

function buildLinks(skeleton, effector, upper) {
  const links = [];
  let bone = effector?.parent || null;
  let guard = 0;

  while (bone?.isBone && guard++ < 8) {
    const index = skeleton.bones.indexOf(bone);
    if (index >= 0) links.push({ index });
    if (bone === upper) return links;
    bone = bone.parent;
  }

  return [];
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
    for (const chain of Object.values(this.chains)) {
      chain.target?.removeFromParent();
    }
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

    const groups = new Map();
    const chainDiagnostics = {};

    for (const [side, config] of Object.entries(SIDE_CONFIG)) {
      const upper = bones[config.upper];
      const effector = bones[config.hand];
      const socket = sockets[config.socket];

      if (!upper || !effector || !socket) {
        chainDiagnostics[side] = {
          active: false,
          reason: !socket ? `missing-${config.socket}` : 'missing-arm-bones'
        };
        continue;
      }

      const mesh = findSkinnedMesh(arms, effector);
      if (!mesh) {
        chainDiagnostics[side] = { active: false, reason: 'no-skinned-mesh' };
        continue;
      }

      const skeleton = mesh.skeleton;
      const effectorIndex = skeleton.bones.indexOf(effector);
      const links = buildLinks(skeleton, effector, upper);
      if (effectorIndex < 0 || links.length < 2) {
        chainDiagnostics[side] = {
          active: false,
          reason: 'invalid-bone-chain',
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
        maxAngle: this.mobile ? 0.28 : 0.34,
        blendFactor: 0.9
      };

      if (!groups.has(mesh)) groups.set(mesh, []);
      groups.get(mesh).push(ik);
      this.chains[side] = { mesh, skeleton, ik, target, socketName: config.socket };

      chainDiagnostics[side] = {
        active: true,
        effector: effector.name || config.hand,
        upper: upper.name || config.upper,
        links: links.length,
        socket: config.socket
      };
    }

    for (const [mesh, iks] of groups) {
      this.solvers.push({
        mesh,
        solver: new CCDIKSolver(mesh, iks)
      });
    }

    const activeChains = Object.values(chainDiagnostics).filter(value => value.active).length;
    this.diagnostics = {
      active: activeChains > 0,
      solver: 'Three.js CCDIKSolver',
      activeChains,
      chains: chainDiagnostics,
      reason: activeChains ? 'ready' : 'no-compatible-chains'
    };

    return this.diagnostics;
  }

  update({
    leftWeight = 1,
    rightWeight = 1
  } = {}) {
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
