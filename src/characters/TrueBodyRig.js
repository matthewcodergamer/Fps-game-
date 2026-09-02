import * as THREE from 'three';

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

  const thigh = mesh(new THREE.CapsuleGeometry(.105, .42, 3, 7), material, new THREE.Vector3(0, -.24, 0));
  const knee = new THREE.Group();
  knee.position.set(0, -.51, 0);
  const calf = mesh(new THREE.CapsuleGeometry(.085, .37, 3, 7), material, new THREE.Vector3(0, -.215, 0));
  const boot = mesh(new THREE.BoxGeometry(.19, .13, .31), bootMaterial, new THREE.Vector3(0, -.43, -.055));
  boot.rotation.x = -.04;
  knee.add(calf, boot);
  hip.add(thigh, knee);
  hip.userData.knee = knee;
  return hip;
}

/**
 * Low-cost true-body presentation for first person.
 *
 * The head is intentionally omitted, so the world camera can sit at the real
 * eye position without rendering the inside of a face. The weapon/arms stay
 * in their dedicated foreground scene while torso/hips/legs remain physical
 * world geometry beneath the camera and cast ordinary world shadows.
 */
export class TrueBodyRig {
  constructor(scene, { mobile = false } = {}) {
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

    this.visible = true;
  }

  setVisible(value) {
    this.visible = Boolean(value);
    this.root.visible = this.visible;
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
    this.leftLeg.userData.knee.rotation.x = THREE.MathUtils.damp(
      this.leftLeg.userData.knee.rotation.x,
      Math.max(0, -stride) * .48 + slideWeight * .62,
      17,
      dt
    );
    this.rightLeg.userData.knee.rotation.x = THREE.MathUtils.damp(
      this.rightLeg.userData.knee.rotation.x,
      Math.max(0, -opposite) * .48 + slideWeight * .2,
      17,
      dt
    );

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
