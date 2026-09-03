import * as THREE from 'three';

const DOWN = new THREE.Vector3(0, -1, 0);
const REAL_BODY_URL = './game-assets/models/characters/operators/bamen_military_soldier.glb';

const BONE_PATTERNS = {
  hips: /(?:^|:)Hips$/i,
  spine: /(?:^|:)Spine$/i,
  spine1: /(?:^|:)Spine1$/i,
  spine2: /(?:^|:)Spine2$/i,
  leftUpLeg: /(?:^|:)LeftUpLeg$/i,
  leftLeg: /(?:^|:)LeftLeg$/i,
  leftFoot: /(?:^|:)LeftFoot$/i,
  rightUpLeg: /(?:^|:)RightUpLeg$/i,
  rightLeg: /(?:^|:)RightLeg$/i,
  rightFoot: /(?:^|:)RightFoot$/i,
  head: /(?:^|:)Head$/i,
  leftShoulder: /(?:^|:)LeftShoulder$/i,
  leftArm: /(?:^|:)LeftArm$/i,
  rightShoulder: /(?:^|:)RightShoulder$/i,
  rightArm: /(?:^|:)RightArm$/i
};

function dominantAxis(size) {
  if (size.x >= size.y && size.x >= size.z) return 'x';
  if (size.y >= size.x && size.y >= size.z) return 'y';
  return 'z';
}

function normalizeBody(root, targetHeight = 1.78) {
  root.updateMatrixWorld(true);
  let bounds = new THREE.Box3().setFromObject(root);
  let size = bounds.getSize(new THREE.Vector3());
  const axis = dominantAxis(size);
  if (axis === 'z') root.rotation.x -= Math.PI / 2;
  else if (axis === 'x') root.rotation.z += Math.PI / 2;

  root.updateMatrixWorld(true);
  bounds = new THREE.Box3().setFromObject(root);
  size = bounds.getSize(new THREE.Vector3());
  root.scale.multiplyScalar(targetHeight / Math.max(.0001, size.y));
  root.updateMatrixWorld(true);
  bounds = new THREE.Box3().setFromObject(root);
  const center = bounds.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= bounds.min.y;
  root.updateMatrixWorld(true);
}

function rotateFromRest(bone, rest, x = 0, y = 0, z = 0) {
  if (!bone || !rest) return;
  bone.quaternion.copy(rest.quaternion);
  const delta = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ'));
  bone.quaternion.multiply(delta);
}

/**
 * Real skinned true-first-person body.
 *
 * The previous V8 body used boxes/capsules as a memory-safe placeholder. V9
 * loads the repository's smaller rigged BAMEN soldier after gameplay starts,
 * hides head/upper-arm bones to keep the camera and dedicated FPS arms clean,
 * then drives its actual Mixamo leg/spine bones for stride and ground contact.
 * If the real model fails, the body stays hidden instead of showing blocky
 * geometry and pretending that a fallback is production art.
 */
export class TrueBodyRig {
  constructor(scene, { mobile = false, groundMeshes = [] } = {}) {
    this.scene = scene;
    this.mobile = mobile;
    this.root = new THREE.Group();
    this.root.name = 'RealTrueFirstPersonBody';
    scene.add(this.root);

    this.visual = null;
    this.bones = {};
    this.rest = new Map();
    this.ready = false;
    this.failed = false;
    this.visible = true;

    this.raycaster = new THREE.Raycaster();
    this.raycaster.near = 0;
    this.raycaster.far = 1.3;
    this.groundEntries = [];
    this._footOrigin = new THREE.Vector3();
    this._footWorld = new THREE.Vector3();
    this._normal = new THREE.Vector3();
    this._rootQuaternion = new THREE.Quaternion();
    this._inverseRootQuaternion = new THREE.Quaternion();
    this._raycastCandidates = [];
    this._sampleAccumulator = 0;
    this._sampleInterval = mobile ? 1 / 18 : 1 / 24;
    this._footState = {
      left: { height: 0, pitch: 0, roll: 0, hit: false },
      right: { height: 0, pitch: 0, roll: 0, hit: false }
    };
    this.setGroundMeshes(groundMeshes);

    globalThis.__PROJECT_STRIKE_TRUE_BODY__ = {
      realModel: true,
      url: REAL_BODY_URL,
      ready: false,
      proceduralFallback: false,
      state: 'waiting-for-asset-manager'
    };
    this.loadRealBody();
  }

  async loadRealBody(attempt = 0) {
    const assets = globalThis.__PROJECT_STRIKE_ASSET_MANAGER__;
    if (!assets) {
      if (attempt < 30) setTimeout(() => this.loadRealBody(attempt + 1), 100);
      else {
        this.failed = true;
        globalThis.__PROJECT_STRIKE_TRUE_BODY__.state = 'asset-manager-unavailable';
      }
      return;
    }

    globalThis.__PROJECT_STRIKE_TRUE_BODY__.state = 'loading-real-model';
    try {
      const asset = await assets.loadModel(REAL_BODY_URL, {
        clone: true,
        world: true,
        timeoutMs: 12_000
      });
      const visual = asset.scene;
      normalizeBody(visual, 1.78);
      visual.traverse(node => {
        if (node.isBone) {
          for (const [key, expression] of Object.entries(BONE_PATTERNS)) {
            if (!this.bones[key] && expression.test(node.name || '')) {
              this.bones[key] = node;
              this.rest.set(node, {
                quaternion: node.quaternion.clone(),
                position: node.position.clone(),
                scale: node.scale.clone()
              });
            }
          }
        }
        if (!node.isMesh) return;
        node.castShadow = !this.mobile;
        node.receiveShadow = true;
        node.frustumCulled = false;
      });

      // The dedicated FPS rig supplies the visible arms/hands. Shrinking these
      // branches prevents seeing inside the local head or a duplicate arm when
      // looking down, while torso/hips/legs remain the real skinned mesh.
      for (const key of ['head', 'leftShoulder', 'leftArm', 'rightShoulder', 'rightArm']) {
        const bone = this.bones[key];
        if (bone) bone.scale.setScalar(.001);
      }

      this.visual = visual;
      this.root.add(visual);
      this.ready = true;
      this.root.visible = this.visible;
      globalThis.__PROJECT_STRIKE_TRUE_BODY__ = {
        realModel: true,
        url: REAL_BODY_URL,
        ready: true,
        proceduralFallback: false,
        state: 'ready',
        report: asset.report,
        mappedBones: Object.keys(this.bones)
      };
    } catch (error) {
      this.failed = true;
      this.root.visible = false;
      globalThis.__PROJECT_STRIKE_TRUE_BODY__ = {
        realModel: true,
        url: REAL_BODY_URL,
        ready: false,
        proceduralFallback: false,
        state: 'error',
        error: error.message
      };
      console.info('Real first-person body model unavailable; block fallback suppressed.', error);
    }
  }

  setGroundMeshes(meshes = []) {
    this.scene?.updateMatrixWorld(true);
    this.groundEntries = meshes
      .filter(object => object?.isMesh)
      .map(object => ({ object, bounds: new THREE.Box3().setFromObject(object) }))
      .filter(entry => !entry.bounds.isEmpty());
  }

  setVisible(value) {
    this.visible = Boolean(value);
    this.root.visible = this.visible && this.ready;
  }

  nearbyGround(origin) {
    this._raycastCandidates.length = 0;
    const margin = .34;
    const minY = origin.y - this.raycaster.far - .08;
    const maxY = origin.y + .16;
    for (const entry of this.groundEntries) {
      const bounds = entry.bounds;
      if (origin.x < bounds.min.x - margin || origin.x > bounds.max.x + margin) continue;
      if (origin.z < bounds.min.z - margin || origin.z > bounds.max.z + margin) continue;
      if (bounds.max.y < minY || bounds.min.y > maxY) continue;
      this._raycastCandidates.push(entry.object);
    }
    return this._raycastCandidates;
  }

  sampleFoot(sideName, footBone) {
    const state = this._footState[sideName];
    if (!footBone || !this.groundEntries.length) {
      state.hit = false;
      return state;
    }

    footBone.getWorldPosition(this._footWorld);
    this._footOrigin.copy(this._footWorld);
    this._footOrigin.y += .42;
    const candidates = this.nearbyGround(this._footOrigin);
    if (!candidates.length) {
      state.hit = false;
      return state;
    }

    this.raycaster.set(this._footOrigin, DOWN);
    const hit = this.raycaster.intersectObjects(candidates, false)[0];
    if (!hit) {
      state.hit = false;
      return state;
    }

    state.height = THREE.MathUtils.clamp(hit.point.y - this._footWorld.y, -.12, .22);
    if (hit.face) {
      this._normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
      this.root.getWorldQuaternion(this._rootQuaternion);
      this._inverseRootQuaternion.copy(this._rootQuaternion).invert();
      this._normal.applyQuaternion(this._inverseRootQuaternion).normalize();
      state.pitch = THREE.MathUtils.clamp(-Math.atan2(this._normal.z, Math.max(.15, this._normal.y)), -.36, .36);
      state.roll = THREE.MathUtils.clamp(Math.atan2(this._normal.x, Math.max(.15, this._normal.y)), -.36, .36);
    } else {
      state.pitch = 0;
      state.roll = 0;
    }
    state.hit = true;
    return state;
  }

  update(dt, {
    position,
    eyeHeight = 1.72,
    yaw = 0,
    pitch = 0,
    speed = 0,
    sprint = false,
    crouch = false,
    slide = 0,
    stepPhase = 0,
    airborne = false,
    landImpulse = 0
  } = {}) {
    if (!position || !this.visible || !this.ready) return;

    const safeDt = THREE.MathUtils.clamp(dt || 0, 0, 1 / 30);
    const feetY = position.y - eyeHeight;
    this.root.position.set(position.x, feetY, position.z);
    this.root.rotation.y = yaw;

    const moveBlend = THREE.MathUtils.clamp(speed / 5.4, 0, 1);
    const stride = Math.sin(stepPhase) * moveBlend;
    const opposite = Math.sin(stepPhase + Math.PI) * moveBlend;
    const crouchDrop = crouch ? .23 : 0;
    const slideWeight = THREE.MathUtils.clamp(slide / .68, 0, 1);
    const lookDown = THREE.MathUtils.clamp(-pitch / 1.2, 0, 1);
    this.root.position.y -= crouchDrop + landImpulse * .03;
    this.root.position.z += slideWeight * .08;
    this.root.rotation.x = THREE.MathUtils.damp(this.root.rotation.x, slideWeight * .16, 14, safeDt);

    const strideScale = sprint ? .62 : crouch ? .26 : .44;
    const leftUpper = this.bones.leftUpLeg;
    const rightUpper = this.bones.rightUpLeg;
    const leftLower = this.bones.leftLeg;
    const rightLower = this.bones.rightLeg;
    const leftFoot = this.bones.leftFoot;
    const rightFoot = this.bones.rightFoot;

    const leftUpperRest = this.rest.get(leftUpper);
    const rightUpperRest = this.rest.get(rightUpper);
    const leftLowerRest = this.rest.get(leftLower);
    const rightLowerRest = this.rest.get(rightLower);
    const leftFootRest = this.rest.get(leftFoot);
    const rightFootRest = this.rest.get(rightFoot);

    const leftStride = airborne ? -.1 : stride * strideScale - slideWeight * .72;
    const rightStride = airborne ? .08 : opposite * strideScale + slideWeight * .28;
    rotateFromRest(leftUpper, leftUpperRest, leftStride);
    rotateFromRest(rightUpper, rightUpperRest, rightStride);

    this._sampleAccumulator += safeDt;
    if (!airborne && this._sampleAccumulator >= this._sampleInterval) {
      this._sampleAccumulator %= this._sampleInterval;
      this.root.updateMatrixWorld(true);
      this.sampleFoot('left', leftFoot);
      this.sampleFoot('right', rightFoot);
    } else if (airborne) {
      this._footState.left.hit = false;
      this._footState.right.hit = false;
    }

    const plantedWeight = airborne
      ? 0
      : THREE.MathUtils.clamp(1 - moveBlend * (sprint ? .7 : .45), .3, 1);
    const leftState = this._footState.left;
    const rightState = this._footState.right;
    const leftKnee = Math.max(0, -stride) * .48 + slideWeight * .58 + Math.max(0, leftState.height) * .7;
    const rightKnee = Math.max(0, -opposite) * .48 + slideWeight * .18 + Math.max(0, rightState.height) * .7;
    rotateFromRest(leftLower, leftLowerRest, leftKnee);
    rotateFromRest(rightLower, rightLowerRest, rightKnee);
    rotateFromRest(
      leftFoot,
      leftFootRest,
      leftState.hit ? leftState.pitch * plantedWeight : 0,
      0,
      leftState.hit ? leftState.roll * plantedWeight : 0
    );
    rotateFromRest(
      rightFoot,
      rightFootRest,
      rightState.hit ? rightState.pitch * plantedWeight : 0,
      0,
      rightState.hit ? rightState.roll * plantedWeight : 0
    );

    const hips = this.bones.hips;
    const hipsRest = this.rest.get(hips);
    rotateFromRest(hips, hipsRest, 0, 0, stride * .025);
    const spine = this.bones.spine;
    const spineRest = this.rest.get(spine);
    rotateFromRest(
      spine,
      spineRest,
      (sprint ? .04 : 0) + slideWeight * .14 - lookDown * .025,
      0,
      -stride * .018
    );
  }
}
