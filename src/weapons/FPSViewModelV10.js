import * as THREE from 'three/webgpu';
import { CharacterIKRig } from '../animation/CharacterIKRig.js';

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
  const oriented = bounds.getSize(new THREE.Vector3());
  const length = Math.max(oriented.x, oriented.y, oriented.z, 0.0001);
  root.scale.multiplyScalar(targetLength / length);
  root.updateMatrixWorld(true);
  bounds = new THREE.Box3().setFromObject(root);
  root.position.sub(bounds.getCenter(new THREE.Vector3()));
  root.updateMatrixWorld(true);
}

function disposeChildren(group) {
  while (group.children.length) group.remove(group.children[0]);
}

function clipBy(clips, expression) {
  return clips.find(clip => expression.test(clip.name || '')) || null;
}

function playAction(mixer, clip, { loop = false, fade = 0.06 } = {}) {
  if (!mixer || !clip) return null;
  const action = mixer.clipAction(clip);
  action.reset().enabled = true;
  action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
  action.clampWhenFinished = !loop;
  action.fadeIn(fade).play();
  return action;
}

function createSocket(parent, name, position) {
  const socket = new THREE.Object3D();
  socket.name = `ProjectStrike_${name}`;
  socket.position.copy(position);
  parent.add(socket);
  return socket;
}

function gripProfile(definition = {}) {
  const length = definition.viewLength || 0.92;
  if (definition.class === 'pistol') {
    return {
      right: new THREE.Vector3(0.025, -0.055, 0.055),
      left: new THREE.Vector3(-0.035, -0.055, 0.015),
      magazine: new THREE.Vector3(-0.025, -0.145, 0.035),
      charging: new THREE.Vector3(0.03, 0.035, -0.08)
    };
  }
  return {
    right: new THREE.Vector3(0.035, -0.065, length * 0.085),
    left: new THREE.Vector3(-0.03, -0.005, -length * 0.26),
    magazine: new THREE.Vector3(-0.025, -0.14, -0.055),
    charging: new THREE.Vector3(0.05, 0.05, -0.18)
  };
}

export class FPSViewModelV10 {
  constructor(worldCamera, assets, { mobile = false } = {}) {
    this.worldCamera = worldCamera;
    this.assets = assets;
    this.mobile = mobile;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(worldCamera.fov, worldCamera.aspect, 0.008, 8);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.root = new THREE.Group();
    this.armRoot = new THREE.Group();
    this.weaponRoot = new THREE.Group();
    this.attachmentRoot = new THREE.Group();
    this.root.name = 'V10FirstPersonRoot';
    this.armRoot.name = 'V10RepositoryArms';
    this.weaponRoot.name = 'V10RepositoryWeapon';
    this.attachmentRoot.name = 'V10RepositoryOptic';
    this.camera.add(this.root);
    this.root.add(this.armRoot, this.weaponRoot);
    this.weaponRoot.add(this.attachmentRoot);

    this.scene.add(
      new THREE.HemisphereLight(0xd9edff, 0x151018, 1.55),
      new THREE.DirectionalLight(0xffdfcc, 2.4),
      new THREE.DirectionalLight(0x67c8ff, 1.0)
    );
    const lights = this.scene.children.filter(o => o.isDirectionalLight);
    lights[0].position.set(-2, 3, 4);
    lights[1].position.set(3, 1, 2);

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
    this.ik = new CharacterIKRig({ mobile });
    this.diagnostics = { weapon: null, arms: null, ik: null };

    this.ads = false;
    this.reloading = false;
    this.reloadT = 0;
    this.reloadDuration = 1.62;
    this.reloadEvents = new Set();
    this.onReloadEvent = null;

    // V10 has one viewmodel recoil owner. These values are finite, clamped
    // offsets that decay to zero; no spring writes cumulative camera rotation.
    this.recoilDepth = 0;
    this.recoilPitch = 0;
    this.recoilRoll = 0;
    this.recoilYaw = 0;

    this.inertiaX = 0;
    this.inertiaY = 0;
    this.lastYaw = 0;
    this.lastPitch = 0;
    this.baseHip = new THREE.Vector3(0.245, -0.235, -0.46);
    this.baseAds = new THREE.Vector3(0, -0.105, -0.405);
    this.currentDefinition = null;
    this._socketLocal = new THREE.Vector3();
    this._socketQuaternion = new THREE.Quaternion();
  }

  prepareViewMeshes(root) {
    root.traverse(node => {
      if (!node.isMesh) return;
      node.castShadow = false;
      node.receiveShadow = false;
      node.frustumCulled = false;
      node.renderOrder = 1000;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        if (!material) continue;
        material.depthTest = true;
        material.depthWrite = true;
        material.toneMapped = true;
        if ('envMapIntensity' in material) material.envMapIntensity = 1.1;
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
      if (/Forearm/.test(name)) bone.rotateX(name.startsWith('left') ? -0.08 : 0.06);
      if (/Hand/.test(name)) {
        bone.rotateZ(name.startsWith('left') ? -0.09 : 0.065);
        bone.rotateX(-0.04);
      }
    }
  }

  async loadArms(url) {
    const asset = await this.assets.loadModel(url, { clone: true, timeoutMs: 20000 });
    disposeChildren(this.armRoot);
    this.arms = asset.scene;
    this.prepareViewMeshes(this.arms);
    normalizeLongAsset(this.arms, 1.24, { forward: false });
    this.arms.position.add(new THREE.Vector3(0, -0.015, -0.015));
    this.armRoot.position.set(0.18, -0.34, -0.31);
    this.armRoot.rotation.set(0.02, 0, 0.015);
    this.armRoot.add(this.arms);
    this.armClips = asset.animations || [];
    this.armMixer = new THREE.AnimationMixer(this.arms);
    this.mapBones();
    this.poseArms();
    const idle = clipBy(this.armClips, /idle|aim|hold/i) || this.armClips[0];
    if (idle) playAction(this.armMixer, idle, { loop: true, fade: 0 });
    this.diagnostics.arms = { ...asset.report, url: asset.url, realRepositoryModel: true };
    this.bindIK();
    return this.diagnostics.arms;
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
    if (!this.sockets.muzzle) this.sockets.muzzle = createSocket(this.weaponRoot, 'muzzle', new THREE.Vector3(0, 0.015, -0.49));
    if (!this.sockets.ejection) this.sockets.ejection = createSocket(this.weaponRoot, 'ejection', new THREE.Vector3(0.072, 0.03, -0.12));
    if (!this.sockets.optic) this.sockets.optic = createSocket(this.weaponRoot, 'optic', new THREE.Vector3(0, 0.075, -0.12));

    const profile = gripProfile(this.currentDefinition || {});
    this.sockets.rightGrip = createSocket(this.weaponRoot, 'rightGrip', profile.right);
    this.sockets.leftGrip = createSocket(this.weaponRoot, 'leftGrip', profile.left);
    this.sockets.magazineGrip = this.parts.magazine
      ? createSocket(this.parts.magazine, 'magazineGrip', new THREE.Vector3())
      : createSocket(this.weaponRoot, 'magazineGrip', profile.magazine);
    this.sockets.chargingHandle = this.parts.bolt
      ? createSocket(this.parts.bolt, 'chargingHandle', new THREE.Vector3())
      : createSocket(this.weaponRoot, 'chargingHandle', profile.charging);
  }

  async loadAttachmentRequired(url) {
    disposeChildren(this.attachmentRoot);
    if (!url) return null;
    const asset = await this.assets.loadModel(url, { clone: true, timeoutMs: 20000 });
    const object = asset.scene;
    this.prepareViewMeshes(object);
    normalizeLongAsset(object, 0.16, { forward: false });
    this.attachmentRoot.position.set(0, 0.082, -0.135);
    this.attachmentRoot.rotation.set(0, 0, 0);
    this.attachmentRoot.add(object);
    return { ...asset.report, url: asset.url, realRepositoryModel: true };
  }

  async loadWeapon(definition) {
    this.currentDefinition = definition;
    // No definition.fbx and no fallbackModel are considered in V10. If the
    // required production model cannot load, the loading gate remains locked.
    const asset = await this.assets.loadModel(definition.model, {
      clone: true,
      timeoutMs: 20000
    });

    disposeChildren(this.weaponRoot);
    this.weaponRoot.add(this.attachmentRoot);
    disposeChildren(this.attachmentRoot);
    this.weapon = asset.scene;
    this.prepareViewMeshes(this.weapon);
    normalizeLongAsset(this.weapon, definition.viewLength || 0.92, { forward: true });
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
    this.weaponRoot.rotation.set(0.012, -0.025, -0.012);
    const idle = clipBy(this.weaponClips, /idle|hold/i);
    if (idle) playAction(this.weaponMixer, idle, { loop: true, fade: 0 });
    const optic = await this.loadAttachmentRequired(definition.optic);
    this.playAuthored(/equip|draw|raise/i);
    this.diagnostics.weapon = {
      ...asset.report,
      url: asset.url,
      format: asset.format,
      realRepositoryModel: true,
      optic
    };
    this.bindIK();
    return this.diagnostics.weapon;
  }

  bindIK() {
    if (!this.arms || !this.weapon || !this.sockets.leftGrip || !this.sockets.rightGrip) return null;
    this.diagnostics.ik = this.ik.bind({ arms: this.arms, bones: this.bones, sockets: this.sockets });
    globalThis.__PROJECT_STRIKE_IK__ = this.diagnostics.ik;
    return this.diagnostics.ik;
  }

  playAuthored(expression) {
    const weaponClip = clipBy(this.weaponClips, expression);
    const armClip = clipBy(this.armClips, expression);
    const weaponAction = playAction(this.weaponMixer, weaponClip);
    const armAction = playAction(this.armMixer, armClip);
    return {
      duration: Math.max(weaponClip?.duration || 0, armClip?.duration || 0),
      found: Boolean(weaponClip || armClip),
      weapon: weaponAction,
      arms: armAction
    };
  }

  setADS(value) {
    this.ads = Boolean(value);
  }

  recoil(amount = 1) {
    const strength = THREE.MathUtils.clamp(Number(amount) || 1, 0.4, 2.8);
    this.recoilDepth = THREE.MathUtils.clamp(this.recoilDepth + 0.026 * strength, 0, 0.075);
    this.recoilPitch = THREE.MathUtils.clamp(this.recoilPitch + 0.018 * strength, 0, 0.065);
    this.recoilYaw = THREE.MathUtils.clamp(this.recoilYaw + (Math.random() - 0.5) * 0.008 * strength, -0.022, 0.022);
    this.recoilRoll = THREE.MathUtils.clamp(this.recoilRoll + (Math.random() - 0.5) * 0.012 * strength, -0.03, 0.03);
    const movingPart = this.parts.slide || this.parts.bolt;
    const rest = movingPart && this.partRest.get(movingPart);
    if (movingPart && rest) movingPart.position.z = rest.position.z + 0.035;
    this.playAuthored(/fire|shoot/i);
  }

  reload(onEvent) {
    if (this.reloading) return false;
    this.reloading = true;
    this.reloadT = 0;
    this.reloadEvents.clear();
    this.onReloadEvent = onEvent || null;
    const authored = this.playAuthored(/reload|mag.?change|magazine/i);
    this.reloadDuration = THREE.MathUtils.clamp(authored.duration || 1.62, 0.9, 3.4);
    return true;
  }

  emitReload(name) {
    if (this.reloadEvents.has(name)) return;
    this.reloadEvents.add(name);
    this.onReloadEvent?.(name);
  }

  routeReloadIK() {
    const chain = this.ik.chains?.left;
    if (!chain?.target) return;
    let socket = this.sockets.leftGrip;
    if (this.reloading) {
      const t = THREE.MathUtils.clamp(this.reloadT / Math.max(this.reloadDuration, 0.001), 0, 1);
      if (t >= 0.12 && t <= 0.67) socket = this.sockets.magazineGrip || socket;
      else if (t >= 0.74 && t <= 0.93) socket = this.sockets.chargingHandle || socket;
    }
    if (socket && chain.target.parent !== socket) socket.add(chain.target);
    chain.target.position.set(0, 0, 0);
    chain.target.quaternion.identity();
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

  barrelDirectionWorld(out = new THREE.Vector3()) {
    this.scene.updateMatrixWorld(true);
    const socket = this.sockets.muzzle;
    if (!socket) return this.worldCamera.getWorldDirection(out);
    socket.getWorldQuaternion(this._socketQuaternion);
    out.set(0, 0, -1)
      .applyQuaternion(this._socketQuaternion)
      .applyQuaternion(this.worldCamera.quaternion)
      .normalize();
    return out;
  }

  syncProjection() {
    this.camera.fov = this.worldCamera.fov;
    this.camera.aspect = this.worldCamera.aspect;
    this.camera.updateProjectionMatrix();
  }

  update(dt, state = {}) {
    const safeDt = THREE.MathUtils.clamp(Number(dt) || 0, 0, 1 / 30);
    this.weaponMixer?.update(safeDt);
    this.armMixer?.update(safeDt);
    this.syncProjection();

    const yaw = state.yaw || 0;
    const pitch = state.pitch || 0;
    const yawDelta = THREE.MathUtils.clamp(yaw - this.lastYaw, -0.07, 0.07);
    const pitchDelta = THREE.MathUtils.clamp(pitch - this.lastPitch, -0.07, 0.07);
    this.lastYaw = yaw;
    this.lastPitch = pitch;
    this.inertiaX = THREE.MathUtils.damp(this.inertiaX, -yawDelta * 0.55, 14, safeDt);
    this.inertiaY = THREE.MathUtils.damp(this.inertiaY, pitchDelta * 0.42, 14, safeDt);

    const speed = state.speed || 0;
    const moveBlend = THREE.MathUtils.clamp(speed / 5.5, 0, 1);
    const step = Math.sin(state.stepPhase || 0);
    const halfStep = Math.sin((state.stepPhase || 0) * 0.5);
    const bobX = halfStep * 0.012 * moveBlend;
    const bobY = Math.abs(step) * 0.012 * moveBlend;
    const sprintWeight = state.sprint ? 1 : 0;
    const slideWeight = THREE.MathUtils.clamp((state.slide || 0) / 0.68, 0, 1);
    const target = this.ads ? this.baseAds : this.baseHip;

    this.root.position.x = THREE.MathUtils.damp(this.root.position.x, bobX * 0.3, 15, safeDt);
    this.root.position.y = THREE.MathUtils.damp(this.root.position.y, -bobY - (state.crouch ? 0.012 : 0), 16, safeDt);
    this.root.rotation.z = THREE.MathUtils.damp(this.root.rotation.z, -halfStep * 0.006 * moveBlend - slideWeight * 0.08, 14, safeDt);

    this.weaponRoot.position.x = THREE.MathUtils.damp(
      this.weaponRoot.position.x,
      target.x + bobX + this.inertiaX + sprintWeight * 0.045,
      18,
      safeDt
    );
    this.weaponRoot.position.y = THREE.MathUtils.damp(
      this.weaponRoot.position.y,
      target.y - bobY * 0.6 + this.inertiaY - sprintWeight * 0.055,
      18,
      safeDt
    );
    this.weaponRoot.position.z = THREE.MathUtils.damp(
      this.weaponRoot.position.z,
      target.z + this.recoilDepth + sprintWeight * 0.055,
      20,
      safeDt
    );
    this.weaponRoot.rotation.x = THREE.MathUtils.damp(
      this.weaponRoot.rotation.x,
      0.012 - this.recoilPitch + sprintWeight * 0.11,
      20,
      safeDt
    );
    this.weaponRoot.rotation.y = THREE.MathUtils.damp(
      this.weaponRoot.rotation.y,
      -0.025 + halfStep * 0.008 * moveBlend + sprintWeight * 0.14 + this.recoilYaw,
      17,
      safeDt
    );
    this.weaponRoot.rotation.z = THREE.MathUtils.damp(
      this.weaponRoot.rotation.z,
      -0.012 + step * 0.009 * moveBlend + sprintWeight * 0.13 - slideWeight * 0.16 + this.recoilRoll,
      17,
      safeDt
    );

    this.armRoot.position.x = THREE.MathUtils.damp(this.armRoot.position.x, 0.18 + bobX * 0.55, 15, safeDt);
    this.armRoot.position.y = THREE.MathUtils.damp(this.armRoot.position.y, -0.34 - bobY * 0.45, 15, safeDt);
    this.armRoot.rotation.z = THREE.MathUtils.damp(this.armRoot.rotation.z, 0.015 + step * 0.007 * moveBlend, 15, safeDt);

    const movingPart = this.parts.slide || this.parts.bolt;
    const movingRest = movingPart && this.partRest.get(movingPart);
    if (movingPart && movingRest && !this.reloading) {
      movingPart.position.lerp(movingRest.position, 1 - Math.exp(-34 * safeDt));
    }

    if (this.reloading) {
      this.reloadT += safeDt;
      const t = THREE.MathUtils.clamp(this.reloadT / this.reloadDuration, 0, 1);
      const lift = Math.sin(t * Math.PI);
      this.weaponRoot.position.x += lift * 0.06;
      this.weaponRoot.position.y += lift * 0.05;
      this.weaponRoot.rotation.y += lift * 0.26;
      this.weaponRoot.rotation.z -= lift * 0.36;
      if (t > 0.14) this.emitReload('magOut');
      if (t > 0.54) this.emitReload('magIn');
      if (t > 0.8) this.emitReload('bolt');
      if (t >= 1) {
        this.reloading = false;
        this.emitReload('complete');
      }
    }

    this.recoilDepth = THREE.MathUtils.damp(this.recoilDepth, 0, 22, safeDt);
    this.recoilPitch = THREE.MathUtils.damp(this.recoilPitch, 0, 24, safeDt);
    this.recoilYaw = THREE.MathUtils.damp(this.recoilYaw, 0, 22, safeDt);
    this.recoilRoll = THREE.MathUtils.damp(this.recoilRoll, 0, 22, safeDt);

    this.routeReloadIK();
    this.scene.updateMatrixWorld(true);
    const leftWeight = state.sprint ? 0.72 : state.slide > 0 ? 0.62 : 1;
    const rightWeight = state.sprint ? 0.84 : state.slide > 0 ? 0.76 : 1;
    this.ik.update({ leftWeight, rightWeight });
  }

  render(renderer) {
    this.syncProjection();
    renderer.render(this.scene, this.camera);
  }
}
