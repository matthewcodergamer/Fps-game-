import * as THREE from 'three/webgpu';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { ENVIRONMENT_ASSETS } from '../assets/GameAssetCatalog.js';

const OPERATOR_URL = './game-assets/models/characters/operators/bamen_military_soldier_animated.glb';

function fitToGround(root, { height = null, size = null } = {}) {
  root.updateMatrixWorld(true);
  let bounds = new THREE.Box3().setFromObject(root);
  let dimensions = bounds.getSize(new THREE.Vector3());
  const denominator = height ? dimensions.y : Math.max(dimensions.x, dimensions.y, dimensions.z);
  root.scale.multiplyScalar((height || size || 1) / Math.max(0.0001, denominator));
  root.updateMatrixWorld(true);
  bounds = new THREE.Box3().setFromObject(root);
  const center = bounds.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= bounds.min.y;
  root.updateMatrixWorld(true);
  return root;
}

function makeSkyTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const context = canvas.getContext('2d', { alpha: false });
  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, '#030611');
  gradient.addColorStop(0.48, '#111b31');
  gradient.addColorStop(0.74, '#542238');
  gradient.addColorStop(1, '#aa5a55');
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < 280; i++) {
    const alpha = 0.18 + Math.random() * 0.62;
    const size = Math.random() < 0.94 ? 1 : 2;
    context.fillStyle = `rgba(220,235,255,${alpha.toFixed(3)})`;
    context.fillRect(Math.random() * canvas.width, Math.random() * canvas.height * 0.63, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createSky() {
  const texture = makeSkyTexture();
  const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide, depthWrite: false, fog: false });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(210, 32, 18), material);
  sky.name = 'V10WebGPUSky';
  sky.renderOrder = -100;
  return sky;
}

function firstClip(clips, expression) {
  return clips.find(clip => expression.test(clip.name || '')) || clips[0] || null;
}

export async function createRealisticDistrictV10(scene, assets, {
  mobile = false,
  onProgress = () => {}
} = {}) {
  const root = new THREE.Group();
  root.name = 'V10RealAssetIndustrialDistrict';
  scene.add(root);
  root.add(createSky());

  const colliders = [];
  const surfaceMeshes = [];
  const targets = [];
  const mixers = [];
  const required = [];

  const asphalt = new THREE.MeshStandardMaterial({ color: 0x2a2b2d, roughness: 0.91, metalness: 0.02 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0x67696d, roughness: 0.89, metalness: 0.03 });
  const paint = new THREE.MeshStandardMaterial({ color: 0xd9b565, roughness: 0.73, metalness: 0.01 });

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(84, 92, 1, 1), asphalt);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  ground.receiveShadow = true;
  ground.userData.surface = 'asphalt';
  root.add(ground);
  surfaceMeshes.push(ground);

  // Real asset buildings are the dominant geometry. The simple road plane and
  // markings are legitimate level geometry, never substitutes for a failed GLB.
  for (let z = -38; z <= 38; z += 6) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 2.55), paint);
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(0, 0.012, z);
    root.add(stripe);
  }

  const pavementLeft = new THREE.Mesh(new THREE.PlaneGeometry(13, 84), concrete);
  pavementLeft.rotation.x = -Math.PI / 2;
  pavementLeft.position.set(-17.5, 0.018, 0);
  pavementLeft.userData.surface = 'concrete';
  root.add(pavementLeft);
  surfaceMeshes.push(pavementLeft);
  const pavementRight = pavementLeft.clone();
  pavementRight.material = concrete;
  pavementRight.position.x = 17.5;
  root.add(pavementRight);
  surfaceMeshes.push(pavementRight);

  async function loadModel(url, position, {
    height = null,
    size = null,
    rotation = 0,
    surface = 'concrete',
    collider = true,
    label = url.split('/').pop()
  } = {}) {
    onProgress({ label, url, state: 'loading' });
    const asset = await assets.loadModel(url, { clone: true, world: true, timeoutMs: 24000 });
    const holder = new THREE.Group();
    holder.name = `Required_${label}`;
    const model = fitToGround(asset.scene, { height, size });
    model.traverse(node => {
      if (!node.isMesh) return;
      node.castShadow = !mobile;
      node.receiveShadow = true;
      node.userData.surface = surface;
      surfaceMeshes.push(node);
    });
    holder.add(model);
    holder.position.copy(position);
    holder.rotation.y = rotation;
    root.add(holder);
    holder.updateMatrixWorld(true);
    if (collider) {
      const bounds = new THREE.Box3().setFromObject(holder);
      bounds.min.y = Math.min(bounds.min.y, 0);
      colliders.push(bounds);
    }
    required.push({ label, url, report: asset.report });
    onProgress({ label, url, state: 'ready', report: asset.report });
    return holder;
  }

  const buildings = ENVIRONMENT_ASSETS.enterableBuildings;
  const layout = [
    [buildings[0], -22, -25, Math.PI / 2, 10.5],
    [buildings[1], 22, -24, -Math.PI / 2, 11.5],
    [buildings[2], -22, 20, Math.PI / 2, 11.5],
    [buildings[3], 22, 21, -Math.PI / 2, 10.5],
    [buildings[5], 0, -40, 0, 11.5]
  ];

  for (let i = 0; i < layout.length; i++) {
    const [url, x, z, rotation, height] = layout[i];
    await loadModel(url, new THREE.Vector3(x, 0.12, z), {
      height,
      rotation,
      surface: 'metal',
      collider: true,
      label: `district building ${i + 1}/${layout.length}`
    });
  }

  await loadModel(ENVIRONMENT_ASSETS.cover[0], new THREE.Vector3(-6.5, 0.1, -8), {
    size: 4.2,
    rotation: 0.18,
    surface: 'concrete',
    label: 'real concrete road barrier'
  });
  await loadModel(ENVIRONMENT_ASSETS.cover[1], new THREE.Vector3(7, 0.1, 12), {
    size: 3.0,
    rotation: -0.24,
    surface: 'wood',
    label: 'real military crate'
  });
  await loadModel(ENVIRONMENT_ASSETS.terrain[0], new THREE.Vector3(-29, 0.1, 30), {
    size: 4.8,
    rotation: 0.6,
    surface: 'rock',
    label: 'real boulder'
  });

  onProgress({ label: 'animated BAMEN operator', url: OPERATOR_URL, state: 'loading' });
  const operatorAsset = await assets.loadModel(OPERATOR_URL, { clone: true, world: true, timeoutMs: 24000 });
  const operatorTemplate = fitToGround(operatorAsset.scene, { height: 1.78 });
  operatorTemplate.traverse(node => {
    if (!node.isMesh) return;
    node.castShadow = !mobile;
    node.receiveShadow = true;
  });
  required.push({ label: 'animated BAMEN operator', url: OPERATOR_URL, report: operatorAsset.report });
  onProgress({ label: 'animated BAMEN operator', url: OPERATOR_URL, state: 'ready', report: operatorAsset.report });

  const operatorPositions = [
    new THREE.Vector3(0, 0.12, -14),
    new THREE.Vector3(-9, 0.12, -26)
  ];

  // Clone every skinned operator from a pristine template BEFORE attaching
  // target Object3D references to mesh.userData. Three.js deep-copies userData
  // with JSON serialization during Object3D clone; cloning after target links
  // were attached created a circular structure and killed V10 startup at 53%.
  const operatorModels = operatorPositions.map(() => skeletonClone(operatorTemplate));
  for (let i = 0; i < operatorPositions.length; i++) {
    const model = operatorModels[i];
    const target = new THREE.Group();
    target.name = `RealOperator_${i + 1}`;
    target.position.copy(operatorPositions[i]);
    target.rotation.y = i ? 0.25 : Math.PI;
    target.userData.health = 100;
    target.userData.alive = true;
    target.userData.realModel = true;
    target.add(model);
    model.traverse(node => {
      if (!node.isMesh) return;
      node.userData.target = target;
      node.userData.hitZone = /head/i.test(node.name || '') ? 'head' : 'body';
      node.userData.surface = 'body';
    });
    const mixer = new THREE.AnimationMixer(model);
    const idle = firstClip(operatorAsset.animations || [], /idle|stand|breath/i);
    if (idle) mixer.clipAction(idle).reset().setLoop(THREE.LoopRepeat, Infinity).play();
    target.userData.mixer = mixer;
    targets.push(target);
    mixers.push(mixer);
    root.add(target);
  }

  const practicals = [
    [0x20dcff, -11.5, -5],
    [0xff2f9a, 11.5, 8],
    [0xffa44f, -11.5, 22]
  ];
  for (const [color, x, z] of practicals) {
    const light = new THREE.PointLight(color, mobile ? 4.8 : 8.5, 12, 2);
    light.position.set(x, 3.4, z);
    light.castShadow = false;
    root.add(light);
  }

  const sun = new THREE.DirectionalLight(0xffbd91, mobile ? 2.1 : 2.6);
  sun.position.set(-28, 40, -25);
  sun.castShadow = !mobile;
  if (!mobile) {
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -44;
    sun.shadow.camera.right = 44;
    sun.shadow.camera.top = 44;
    sun.shadow.camera.bottom = -44;
    sun.shadow.camera.far = 100;
  }
  root.add(sun, new THREE.HemisphereLight(0x7f9ed0, 0x160e1a, mobile ? 0.95 : 0.72));

  function killTarget(target, direction = new THREE.Vector3()) {
    if (!target?.userData?.alive) return;
    target.userData.alive = false;
    target.userData.health = 0;
    target.userData.mixer?.stopAllAction?.();
    target.rotation.z = THREE.MathUtils.clamp(direction.x * 0.16, -0.18, 0.18);
    target.rotation.x = -1.38;
    target.position.y = 0.08;
  }

  function update(dt) {
    for (const mixer of mixers) mixer.update(dt);
  }

  return {
    root,
    colliders,
    surfaceMeshes,
    targets,
    required,
    update,
    killTarget,
    updatePlayerShadow() {},
    operatorUrl: OPERATOR_URL
  };
}
