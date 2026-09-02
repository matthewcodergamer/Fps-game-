import * as THREE from 'three';

const DOWN = new THREE.Vector3(0, -1, 0);

function mesh(geometry, material, position) {
  const object = new THREE.Mesh(geometry, material);
  object.position.copy(position);
  object.castShadow = true;
  object.receiveShadow = true;
  object.frustumCulled = false;
  return object;
}

function makeLeg(material, bootMaterial, side) {
  const hip = new THREE.Group();
  hip.position.set(side * .17, .95, .02);
  hip.userData.basePosition = hip.position.clone();

  const thigh = mesh(
    new THREE.CapsuleGeometry(.105, .42, 3, 7),
    material,
    new THREE.Vector3(0, -.24, 0)
  );
  const knee = new THREE.Group();
  knee.position.set(0, -.51, 0);
  const calf = mesh(
    new THREE.CapsuleGeometry(.085, .37, 3, 7),
    material,
    new THREE.Vector3(0, -.215, 0)
  );
  const boot = mesh(
    new THREE.BoxGeometry(.19, .13, .31),
    bootMaterial,
    new THREE.Vector3(0, -.43, -.055)
  );
  boot.rotation.x = -.04;
  boot.userData.baseRotation = boot.rotation.clone();

  knee.add(calf, boot);
  hip.add(thigh, knee);
  hip.userData.knee = knee;
  hip.userData.boot = boot;
  hip.userData.side = side;
  return hip;
}

/**
 * Low-cost true-body presentation for first person.
 *
 * The head is intentionally omitted, so the world camera can sit at the real
 * eye position without rendering the inside of a face. The weapon/arms stay
 * in their dedicated foreground scene while torso/hips/legs remain physical
 * world geometry beneath the camera and cast ordinary world shadows.
 *
 * This body is procedural geometry rather than a skinned character, so terrain
 * IK is implemented as a raycast-driven two-segment correction layer: each
 * foot samples the actual world surface, the hip offsets vertically, the knee
 * adds compression, and the boot aligns to the hit normal.
 */
export class TrueBodyRig {
  constructor(scene, { mobile = false, groundMeshes = [] } = {}) {
    this.scene = scene;
    this.mobile = mobile;
    this.root = new THREE.Group();
    this.root.name = 'TrueFirstPersonBody';
    scene.add(this.root);

    const cloth = new THREE.MeshStandardMaterial({ color: 0x171b23, roughness: .92, metalness: .02 });
    const armor = new THREE.MeshStandardMaterial({ color: 0x252b33, roughness: .68, metalness: .18 });
    const boot = new THREE.MeshStandardMaterial({ color: 0x090b0e, roughness: .82, metalness: .08 });

    this.hips = mesh(new THREE.BoxGeometry(.48, .28, .27), cloth, new THREE.Vector3(0, .98, .035));
    this.torso = mesh(new THREE.BoxGeometry(.58, .62, .31), cloth, new THREE.Vector3(0, 1.38, .07));
    this.torso.rotation.x = -.025;
    this.vest = mesh(new THREE.BoxGeometry(.52, .43, .08), armor, new THREE.Vector3(0, 1.43, -.13));
    this.vest.rotation.x = -.025;

    this.leftLeg = makeLeg(cloth, boot, -1);
    this.rightLeg = makeLeg(cloth, boot, 1);
    this.root.add(this.hips, this.torso, this.vest, this.leftLeg, this.rightLeg);

    this.root.traverse(object => {
      if (!object.isMesh) return;
      object.castShadow = !mobile;
      object.receiveShadow = true;
    });

    this.raycaster = new THREE.Raycaster();
    this.raycaster.near = 0;
    this.raycaster.far = 1.45;
    this.groundMeshes = [];
    this._footOrigin = new THREE.Vector3();
    this._normal = new THREE.Vector3();
    this._rootQuaternion = new THREE.Quaternion();
    this._inverseRootQuaternion = new THREE.Quaternion();
    this._footState = {
      left: { height: 0, pitch: 0, roll: 0, hit: false },
      right: { height: 0, pitch: 0, roll: 0, hit: false }
    };
    this.setGroundMeshes(groundMeshes);

    this.visible = true;
  }

  setGroundMeshes(meshes = []) {
    this.groundMeshes = meshes.filter(object => object?.isMesh);
    this.scene?.updateMatrixWorld(true);
  }

  setVisible(value) {
    this.visible = Boolean(value);
    this.root.visible = this.visible;
  }

  sampleFoot(sideName, leg) {
    const state = this._footState[sideName];
    if (!this.groundMeshes.length) {
      state.hit = false;
      return state;
    }

    const side = leg.userData.side || (sideName === 'left' ? -1 : 1);
    this._footOrigin.set(side * .17, .62, -.035);
    this.root.localToWorld(this._footOrigin);
    this._footOrigin.y += .42;

    this.raycaster.set(this._footOrigin, DOWN);
    const hit = this.raycaster.intersectObjects(this.groundMeshes, false)[0];
    if (!hit) {
      state.hit = false;
      return state;
    }

    const expectedFootY = this.root.position.y - .055;
    state.height = THREE.MathUtils.clamp(hit.point.y - expectedFootY, -.14, .34);

    if (hit.face) {
      this._normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
      this.root.getWorldQuaternion(this._rootQuaternion);
      this._inverseRootQuaternion.copy(this._rootQuaternion).invert();
      this._normal.applyQuaternion(this._inverseRootQuaternion).normalize();
      state.pitch = THREE.MathUtils.clamp(
        -Math.atan2(this._normal.z, Math.max(.15, this._normal.y)),
        -.42,
        .42
      );
      state.roll = THREE.MathUtils.clamp(
        Math.atan2(this._normal.x, Math.max(.15, this._normal.y)),
        -.42,
        .42
      );
    } else {
      state.pitch = 0;
      state.roll = 0;
    }

    state.hit = true;
    return state;
  }

  applyFootIK(dt, leg, state, {
    weight = 1,
    baseKnee = 0
  } = {}) {
    const base = leg.userData.basePosition;
    const knee = leg.userData.knee;
    const boot = leg.userData.boot;
    const bootBase = boot.userData.baseRotation;

    const height = state.hit ? state.height * weight : 0;
    leg.position.y = THREE.MathUtils.damp(
      leg.position.y,
      base.y + height,
      this.mobile ? 14 : 18,
      dt
    );

    const compression = Math.max(0, height) * 1.15;
    knee.rotation.x = THREE.MathUtils.damp(
      knee.rotation.x,
      baseKnee + compression,
      17,
      dt
    );

    const pitch = state.hit ? state.pitch * weight : 0;
    const roll = state.hit ? state.roll * weight : 0;
    boot.rotation.x = THREE.MathUtils.damp(
      boot.rotation.x,
      bootBase.x + pitch,
      18,
      dt
    );
    boot.rotation.z = THREE.MathUtils.damp(
      boot.rotation.z,
      bootBase.z + roll,
      18,
      dt
    );
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
    if (!position || !this.visible) return;

    const feetY = position.y - eyeHeight;
    this.root.position.set(position.x, feetY, position.z);
    this.root.rotation.y = yaw;

    const moveBlend = THREE.MathUtils.clamp(speed / 5.4, 0, 1);
    const stride = Math.sin(stepPhase) * moveBlend;
    const opposite = Math.sin(stepPhase + Math.PI) * moveBlend;
    const crouchDrop = crouch ? .25 : 0;
    const slideWeight = THREE.MathUtils.clamp(slide / .68, 0, 1);
    const lookDown = THREE.MathUtils.clamp(-pitch / 1.2, 0, 1);

    this.root.position.y -= crouchDrop + landImpulse * .035;
    this.root.position.z += slideWeight * .09;
    this.root.rotation.x = THREE.MathUtils.damp(this.root.rotation.x, slideWeight * .18, 14, dt);

    const strideScale = sprint ? .68 : crouch ? .28 : .46;
    this.leftLeg.rotation.x = THREE.MathUtils.damp(
      this.leftLeg.rotation.x,
      airborne ? -.12 : stride * strideScale - slideWeight * .78,
      18,
      dt
    );
    this.rightLeg.rotation.x = THREE.MathUtils.damp(
      this.rightLeg.rotation.x,
      airborne ? .1 : opposite * strideScale + slideWeight * .3,
      18,
      dt
    );

    const leftBaseKnee = Math.max(0, -stride) * .48 + slideWeight * .62;
    const rightBaseKnee = Math.max(0, -opposite) * .48 + slideWeight * .2;

    // Terrain IK remains strongest while planted and blends down during fast
    // locomotion so it corrects foot contact without fighting the stride pose.
    const plantedWeight = airborne
      ? 0
      : THREE.MathUtils.clamp(1 - moveBlend * (sprint ? .72 : .48), .28, 1);

    this.root.updateMatrixWorld(true);
    const leftFoot = this.sampleFoot('left', this.leftLeg);
    const rightFoot = this.sampleFoot('right', this.rightLeg);
    this.applyFootIK(dt, this.leftLeg, leftFoot, {
      weight: plantedWeight,
      baseKnee: leftBaseKnee
    });
    this.applyFootIK(dt, this.rightLeg, rightFoot, {
      weight: plantedWeight,
      baseKnee: rightBaseKnee
    });

    this.torso.rotation.x = THREE.MathUtils.damp(
      this.torso.rotation.x,
      -.025 + (sprint ? .055 : 0) + slideWeight * .18 - lookDown * .035,
      13,
      dt
    );
    this.vest.rotation.x = this.torso.rotation.x;
    this.hips.rotation.z = THREE.MathUtils.damp(this.hips.rotation.z, stride * .035, 14, dt);
  }
}
