import * as THREE from 'three';

const PART_HINTS = {
  slide: /slide/i,
  bolt: /bolt|charging.?handle/i,
  magazine: /(^|[_. -])mag(azine)?([_. -]|$)|clip/i,
  trigger: /trigger/i,
  muzzle: /muzzle|barrel.?end/i,
  ejection: /eject|shell|brass/i,
  optic: /optic|scope.?socket|sight.?socket/i
};

const BONE_HINTS = {
  leftUpper: /Arm_1\.L|upper.?arm.*l|left.?upper.?arm/i,
  leftForearm: /Arm_2\.L|fore.?arm.*l|left.?forearm/i,
  leftHand: /Hand_1\.L|hand.*l|left.?hand/i,
  rightUpper: /Arm_1\.R|upper.?arm.*r|right.?upper.?arm/i,
  rightForearm: /Arm_2\.R|fore.?arm.*r|right.?forearm/i,
  rightHand: /Hand_1\.R|hand.*r|right.?hand/i
};

function clipBy(clips, expression) {
  return clips.find(clip => expression.test(clip.name || '')) || null;
}

function playAction(mixer, clip, { loop = false, fade = .06 } = {}) {
  if (!mixer || !clip) return null;
  const action = mixer.clipAction(clip);
  action.reset().enabled = true;
  action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
  action.clampWhenFinished = !loop;
  action.fadeIn(fade).play();
  return action;
}

function dominantAxis(size) {
  if (size.x >= size.y && size.x >= size.z) return 'x';
  if (size.y >= size.x && size.y >= size.z) return 'y';
  return 'z';
}

function normalizeLongAsset(root, targetLength, { forward = true } = {}) {
  root.updateMatrixWorld(true);
  let bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  const axis = dominantAxis(size);
  if (axis === 'x') root.rotation.y += Math.PI / 2;
  else if (axis === 'y') root.rotation.x -= Math.PI / 2;
  else if (forward) root.rotation.y += Math.PI;

  root.updateMatrixWorld(true);
  bounds = new THREE.Box3().setFromObject(root);
  const orientedSize = bounds.getSize(new THREE.Vector3());
  const length = Math.max(orientedSize.x, orientedSize.y, orientedSize.z, .0001);
  root.scale.multiplyScalar(targetLength / length);
  root.updateMatrixWorld(true);
  bounds = new THREE.Box3().setFromObject(root);
  root.position.sub(bounds.getCenter(new THREE.Vector3()));
  root.updateMatrixWorld(true);
  return { axis, bounds: new THREE.Box3().setFromObject(root) };
}

function disposeGroup(group) {
  while (group.children.length) group.remove(group.children[0]);
}

/**
 * A dedicated first-person render layer.
 *
 * World depth is cleared before this scene is rendered, so repository weapon
 * and arm meshes cannot disappear into walls or be clipped by the map.
 */
export class FPSViewModel {
  constructor(worldCamera, assets) {
    this.worldCamera = worldCamera;
    this.assets = assets;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(worldCamera.fov, worldCamera.aspect, .008, 8);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.root = new THREE.Group();
    this.root.name = 'FirstPersonMotionRoot';
    this.camera.add(this.root);

    this.armRoot = new THREE.Group();
    this.armRoot.name = 'RepositoryArms';
    this.weaponRoot = new THREE.Group();
    this.weaponRoot.name = 'RepositoryWeapon';
    this.attachmentRoot = new THREE.Group();
    this.attachmentRoot.name = 'RepositoryOptic';
    this.root.add(this.armRoot, this.weaponRoot);
    this.weaponRoot.add(this.attachmentRoot);

    const key = new THREE.DirectionalLight(0xffd9c0, 3.1);
    key.position.set(-2, 3, 4);
    const fill = new THREE.DirectionalLight(0x61cfff, 1.45);
    fill.position.set(3, 1, 2);
    this.scene.add(new THREE.HemisphereLight(0xd9edff, 0x191421, 1.8), key, fill);

    this.weapon = null;
    this.arms = null;
    this.parts = {};
    this.partRest = new Map();
    this.bones = {};
    this.boneRest = new Map();
    this.sockets = {};
    this.weaponClips = [];
    this.armClips = [];
    this.weaponMixer = null;
    this.armMixer = null;
    this.diagnostics = { weapon: null, arms: null };

    this.ads = false;
    this.reloading = false;
    this.reloadT = 0;
    this.reloadDuration = 1.62;
    this.reloadEvents = new Set();
    this.onReloadEvent = null;
    this.recoilKick = 0;
    this.recoilYaw = 0;
    this.inertiaX = 0;
    this.inertiaY = 0;
    this.lastYaw = 0;
    this.lastPitch = 0;
    this.baseHip = new THREE.Vector3(.245, -.235, -.46);
    this.baseAds = new THREE.Vector3(0, -.105, -.405);
    this.currentDefinition = null;
    this._socketLocal = new THREE.Vector3();
  }

  prepareViewMeshes(root) {
    root.traverse(node => {
      if (!node.isMesh) return;
      node.castShadow = false;
      node.receiveShadow = false;
      node.frustumCulled = false;
      node.renderOrder = 1000;
      for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
        if (!material) continue;
        material.depthTest = true;
        material.depthWrite = true;
        material.toneMapped = true;
        if ('envMapIntensity' in material) material.envMapIntensity = 1.25;
      }
    });
  }

  mapBones() {
    this.bones = {};
    this.boneRest.clear();
    this.arms?.traverse(node => {
      if (!node.isBone) return;
      for (const [key, expression] of Object.entries(BONE_HINTS)) {
        if (!this.bones[key] && expression.test(node.name || '')) {
          this.bones[key] = node;
          this.boneRest.set(node, node.quaternion.clone());
        }
      }
    });
  }

  poseArms() {
    for (const [name, bone] of Object.entries(this.bones)) {
      const rest = this.boneRest.get(bone);
      if (rest) bone.quaternion.copy(rest);
      if (/Forearm/.test(name)) bone.rotateX(name.startsWith('left') ? -.08 : .06);
      if (/Hand/.test(name)) {
        bone.rotateZ(name.startsWith('left') ? -.09 : .065);
        bone.rotateX(-.04);
      }
    }
  }

  async loadArms(url) {
    try {
      const asset = await this.assets.loadModel(url, { clone: true });
      disposeGroup(this.armRoot);
      this.arms = asset.scene;
      this.prepareViewMeshes(this.arms);
      normalizeLongAsset(this.arms, 1.24, { forward: false });
      this.arms.position.add(new THREE.Vector3(0, -.015, -.015));
      this.armRoot.position.set(.18, -.34, -.31);
      this.armRoot.rotation.set(.02, 0, .015);
      this.armRoot.add(this.arms);
      this.armClips = asset.animations || [];
      this.armMixer = new THREE.AnimationMixer(this.arms);
      this.mapBones();
      this.poseArms();
      const idle = clipBy(this.armClips, /idle|aim|hold/i) || this.armClips[0];
      if (idle) playAction(this.armMixer, idle, { loop: true, fade: 0 });
      this.diagnostics.arms = asset.report;
      return true;
    } catch (error) {
      console.warn('First-person repository arms failed to load.', error);
      this.diagnostics.arms = { error: error.message };
      return false;
    }
  }

  discoverParts() {
    this.parts = {};
    this.partRest.clear();
    this.weapon?.traverse(node => {
      for (const [key, expression] of Object.entries(PART_HINTS)) {
        if (!this.parts[key] && expression.test(node.name || '')) {
          this.parts[key] = node;
          this.partRest.set(node, {
            position: node.position.clone(),
            quaternion: node.quaternion.clone()
          });
        }
      }
    });
  }

  buildSockets() {
    this.sockets = {};
    for (const key of ['muzzle', 'ejection', 'optic']) {
      if (this.parts[key]) this.sockets[key] = this.parts[key];
    }
    const make = (name, position) => {
      const socket = new THREE.Object3D();
      socket.name = `Synthetic${name[0].toUpperCase()}${name.slice(1)}Socket`;
      socket.position.copy(position);
      this.weaponRoot.add(socket);
      this.sockets[name] = socket;
    };
    if (!this.sockets.muzzle) make('muzzle', new THREE.Vector3(0, .015, -.49));
    if (!this.sockets.ejection) make('ejection', new THREE.Vector3(.072, .03, -.12));
    if (!this.sockets.optic) make('optic', new THREE.Vector3(0, .075, -.12));
  }

  async loadAttachment(url) {
    disposeGroup(this.attachmentRoot);
    if (!url) return false;
    try {
      const asset = await this.assets.loadModel(url, { clone: true });
      const object = asset.scene;
      this.prepareViewMeshes(object);
      normalizeLongAsset(object, .16, { forward: false });
      this.attachmentRoot.position.set(0, .082, -.135);
      this.attachmentRoot.rotation.set(0, 0, 0);
      this.attachmentRoot.add(object);
      return true;
    } catch (error) {
      console.info('Optional repository optic was skipped.', error);
      return false;
    }
  }

  async loadWeapon(definition) {
    this.currentDefinition = definition;
    try {
      const asset = await this.assets.loadFirst(
        [definition.model, definition.fbx, definition.fallbackModel],
        { clone: true }
      );
      disposeGroup(this.weaponRoot);
      this.weaponRoot.add(this.attachmentRoot);
      disposeGroup(this.attachmentRoot);
      this.parts = {};
      this.partRest.clear();
      this.sockets = {};

      this.weapon = asset.scene;
      this.prepareViewMeshes(this.weapon);
      normalizeLongAsset(this.weapon, definition.viewLength || .92, { forward: true });
      if (definition.viewRotation) {
        this.weapon.rotation.x += definition.viewRotation[0] || 0;
        this.weapon.rotation.y += definition.viewRotation[1] || 0;
        this.weapon.rotation.z += definition.viewRotation[2] || 0;
      }
      this.weaponRoot.add(this.weapon, this.attachmentRoot);
      this.weaponClips = asset.animations || [];
      this.weaponMixer = new THREE.AnimationMixer(this.weapon);
      this.discoverParts();
      this.buildSockets();
      this.weaponRoot.position.copy(this.baseHip);
      this.weaponRoot.rotation.set(.012, -.025, -.012);
      const idle = clipBy(this.weaponClips, /idle|hold/i);
      if (idle) playAction(this.weaponMixer, idle, { loop: true, fade: 0 });
      await this.loadAttachment(definition.optic);
      this.playAuthored(/equip|draw|raise/i);
      this.diagnostics.weapon = { ...asset.report, url: asset.url, format: asset.format };
      return true;
    } catch (error) {
      console.warn('Repository weapon failed to load.', definition?.model, error);
      this.diagnostics.weapon = { error: error.message, url: definition?.model };
      return false;
    }
  }

  playAuthored(expression) {
    const weaponClip = clipBy(this.weaponClips, expression);
    const armClip = clipBy(this.armClips, expression);
    const weaponAction = playAction(this.weaponMixer, weaponClip);
    const armAction = playAction(this.armMixer, armClip);
    return {
      duration: Math.max(weaponClip?.duration || 0, armClip?.duration || 0),
      weapon: weaponAction,
      arms: armAction,
      found: Boolean(weaponClip || armClip)
    };
  }

  setADS(value) {
    this.ads = Boolean(value);
  }

  recoil(amount = 1) {
    this.recoilKick = Math.min(.15, this.recoilKick + .04 * amount);
    this.recoilYaw += (Math.random() - .5) * .016 * amount;
    const movingPart = this.parts.slide || this.parts.bolt;
    const rest = movingPart && this.partRest.get(movingPart);
    if (movingPart && rest) movingPart.position.z = rest.position.z + .035;
    this.playAuthored(/fire|shoot/i);
  }

  reload(onEvent) {
    if (this.reloading) return false;
    this.reloading = true;
    this.reloadT = 0;
    this.reloadEvents.clear();
    this.onReloadEvent = onEvent || null;
    const authored = this.playAuthored(/reload|mag.?change|magazine/i);
    this.reloadDuration = THREE.MathUtils.clamp(authored.duration || 1.62, .9, 3.4);
    return true;
  }

  emitReload(name) {
    if (this.reloadEvents.has(name)) return;
    this.reloadEvents.add(name);
    this.onReloadEvent?.(name);
  }

  socketWorld(name, out = new THREE.Vector3()) {
    this.scene.updateMatrixWorld(true);
    const socket = this.sockets[name];
    if (!socket) return this.worldCamera.getWorldPosition(out);
    socket.getWorldPosition(this._socketLocal);
    out.copy(this._socketLocal)
      .applyQuaternion(this.worldCamera.quaternion)
      .add(this.worldCamera.position);
    return out;
  }

  muzzleWorld(out = new THREE.Vector3()) {
    return this.socketWorld('muzzle', out);
  }

  ejectionWorld(out = new THREE.Vector3()) {
    return this.socketWorld('ejection', out);
  }

  syncProjection() {
    this.camera.fov = this.worldCamera.fov;
    this.camera.aspect = this.worldCamera.aspect;
    this.camera.updateProjectionMatrix();
  }

  update(dt, {
    time = 0,
    speed = 0,
    sprint = false,
    crouch = false,
    slide = 0,
    yaw = 0,
    pitch = 0,
    stepPhase = 0,
    airborne = false,
    landImpulse = 0
  } = {}) {
    this.weaponMixer?.update(dt);
    this.armMixer?.update(dt);
    this.syncProjection();

    const yawDelta = THREE.MathUtils.clamp(yaw - this.lastYaw, -.08, .08);
    const pitchDelta = THREE.MathUtils.clamp(pitch - this.lastPitch, -.08, .08);
    this.lastYaw = yaw;
    this.lastPitch = pitch;
    this.inertiaX = THREE.MathUtils.damp(this.inertiaX, -yawDelta * 1.25, 13, dt);
    this.inertiaY = THREE.MathUtils.damp(this.inertiaY, pitchDelta * .92, 13, dt);

    const moveBlend = THREE.MathUtils.clamp(speed / 5.5, 0, 1);
    const step = Math.sin(stepPhase);
    const halfStep = Math.sin(stepPhase * .5);
    const bobX = halfStep * .018 * moveBlend;
    const bobY = Math.abs(step) * .019 * moveBlend;
    const sprintWeight = sprint ? 1 : 0;
    const slideWeight = THREE.MathUtils.clamp(slide / .68, 0, 1);
    const target = this.ads ? this.baseAds : this.baseHip;

    this.root.position.x = THREE.MathUtils.damp(this.root.position.x, bobX * .34, 15, dt);
    this.root.position.y = THREE.MathUtils.damp(
      this.root.position.y,
      -bobY - (crouch ? .018 : 0) - landImpulse * .045,
      17,
      dt
    );
    this.root.rotation.z = THREE.MathUtils.damp(
      this.root.rotation.z,
      -halfStep * .008 * moveBlend - slideWeight * .12,
      15,
      dt
    );

    this.weaponRoot.position.x = THREE.MathUtils.damp(
      this.weaponRoot.position.x,
      target.x + bobX + this.inertiaX + sprintWeight * .05,
      17,
      dt
    );
    this.weaponRoot.position.y = THREE.MathUtils.damp(
      this.weaponRoot.position.y,
      target.y - bobY * .72 + this.inertiaY - sprintWeight * .065 - (airborne ? .018 : 0),
      17,
      dt
    );
    this.weaponRoot.position.z = THREE.MathUtils.damp(
      this.weaponRoot.position.z,
      target.z + this.recoilKick + sprintWeight * .07 + slideWeight * .045,
      19,
      dt
    );
    this.weaponRoot.rotation.x = THREE.MathUtils.damp(
      this.weaponRoot.rotation.x,
      .012 - this.recoilKick * .78 + sprintWeight * .14,
      18,
      dt
    );
    this.weaponRoot.rotation.y = THREE.MathUtils.damp(
      this.weaponRoot.rotation.y,
      -.025 + halfStep * .012 * moveBlend + sprintWeight * .2,
      15,
      dt
    );
    this.weaponRoot.rotation.z = THREE.MathUtils.damp(
      this.weaponRoot.rotation.z,
      -.012 + step * .014 * moveBlend + sprintWeight * .2 - slideWeight * .24 + this.recoilYaw,
      15,
      dt
    );

    this.armRoot.position.x = THREE.MathUtils.damp(this.armRoot.position.x, .18 + bobX * .72, 14, dt);
    this.armRoot.position.y = THREE.MathUtils.damp(this.armRoot.position.y, -.34 - bobY * .55, 14, dt);
    this.armRoot.rotation.z = THREE.MathUtils.damp(
      this.armRoot.rotation.z,
      .015 + step * .01 * moveBlend + sprintWeight * .09 - slideWeight * .16,
      14,
      dt
    );

    const movingPart = this.parts.slide || this.parts.bolt;
    const movingRest = movingPart && this.partRest.get(movingPart);
    if (movingPart && movingRest && !this.reloading) {
      movingPart.position.lerp(movingRest.position, 1 - Math.exp(-34 * dt));
    }

    if (this.reloading) {
      this.reloadT += dt;
      const t = THREE.MathUtils.clamp(this.reloadT / this.reloadDuration, 0, 1);
      const lift = Math.sin(t * Math.PI);
      const turn = Math.sin(Math.min(1, t * 1.25) * Math.PI);
      this.weaponRoot.position.x += lift * .07;
      this.weaponRoot.position.y += lift * .055;
      this.weaponRoot.rotation.y += lift * .3;
      this.weaponRoot.rotation.z -= turn * .48;
      this.armRoot.position.x -= lift * .035;
      this.armRoot.rotation.z -= lift * .28;

      const magazine = this.parts.magazine;
      const magazineRest = magazine && this.partRest.get(magazine);
      if (magazine && magazineRest) {
        const drop = t < .47
          ? THREE.MathUtils.smoothstep(t, .13, .43)
          : 1 - THREE.MathUtils.smoothstep(t, .52, .78);
        magazine.position.copy(magazineRest.position);
        magazine.position.y -= drop * .23;
      }

      if (t > .13) this.emitReload('magOut');
      if (t > .53) this.emitReload('magIn');
      if (t > .79) this.emitReload('bolt');
      if (t >= 1) {
        this.reloading = false;
        if (magazine && magazineRest) magazine.position.copy(magazineRest.position);
        this.emitReload('complete');
      }
    }

    this.recoilKick = THREE.MathUtils.damp(this.recoilKick, 0, 23, dt);
    this.recoilYaw = THREE.MathUtils.damp(this.recoilYaw, 0, 19, dt);
  }

  render(renderer) {
    this.syncProjection();
    renderer.render(this.scene, this.camera);
  }
}
