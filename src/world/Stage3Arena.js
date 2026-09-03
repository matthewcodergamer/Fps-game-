import * as THREE from 'three/webgpu';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { ENVIRONMENT_ASSETS } from '../assets/GameAssetCatalog.js';

function dominantAxis(size) {
  if (size.x >= size.y && size.x >= size.z) return 'x';
  if (size.y >= size.x && size.y >= size.z) return 'y';
  return 'z';
}

function fitToGround(root, { height = null, size = null, vertical = 'y' } = {}) {
  root.updateMatrixWorld(true);
  let bounds = new THREE.Box3().setFromObject(root);
  let dimensions = bounds.getSize(new THREE.Vector3());

  if (vertical === 'auto') {
    const axis = dominantAxis(dimensions);
    if (axis === 'z') root.rotation.x -= Math.PI / 2;
    else if (axis === 'x') root.rotation.z += Math.PI / 2;
    root.updateMatrixWorld(true);
    bounds = new THREE.Box3().setFromObject(root);
    dimensions = bounds.getSize(new THREE.Vector3());
  }

  const denominator = height ? dimensions.y : Math.max(dimensions.x, dimensions.y, dimensions.z);
  const scale = (height || size || 1) / Math.max(.0001, denominator);
  root.scale.multiplyScalar(scale);
  root.updateMatrixWorld(true);
  bounds = new THREE.Box3().setFromObject(root);
  const center = bounds.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= bounds.min.y;
  root.updateMatrixWorld(true);
  return root;
}

function findClip(clips, expression) {
  return clips.find(clip => expression.test(clip.name || '')) || null;
}

function playClip(target, expression, { loop = true, fade = .16 } = {}) {
  const mixer = target?.userData?.mixer;
  if (!mixer) return null;
  const clip = expression instanceof RegExp ? findClip(target.userData.clips, expression) : expression;
  if (!clip) return null;
  if (target.userData.action?.getClip() === clip) return target.userData.action;
  const previous = target.userData.action;
  const action = mixer.clipAction(clip);
  action.reset().enabled = true;
  action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
  action.clampWhenFinished = !loop;
  action.fadeIn(fade).play();
  previous?.fadeOut(fade);
  target.userData.action = action;
  return action;
}

function createSky() {
  // WebGPURenderer does not support the old ShaderMaterial sky. V10 uses a
  // vertex-colored sphere so the sky remains GPU-native without a WebGL shader
  // fallback or a large sky texture allocation.
  const geometry = new THREE.SphereGeometry(220, 40, 24);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const top = new THREE.Color(0x030712);
  const mid = new THREE.Color(0x142847);
  const horizon = new THREE.Color(0x7a294d);
  const warm = new THREE.Color(0xc07155);
  const color = new THREE.Color();

  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i) / 220;
    const x = position.getX(i) / 220;
    const z = position.getZ(i) / 220;
    const horizonMix = THREE.MathUtils.smoothstep(y, -.08, .22);
    const topMix = THREE.MathUtils.smoothstep(y, .15, .78);
    color.copy(horizon).lerp(mid, horizonMix).lerp(top, topMix);
    const sunDot = Math.max(0, x * -.72 + y * .25 + z * -.42);
    const halo = Math.pow(sunDot, 24) * .28;
    color.lerp(warm, halo);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: false
  });
  const sky = new THREE.Mesh(geometry, material);
  sky.name = 'V10WebGPUSky';
  sky.renderOrder = -100;
  return sky;
}

export async function createStage3Arena(scene, assets, { mobile = false, onProgress = null } = {}) {
  const root = new THREE.Group();
  root.name = 'V10RealAssetIndustrialDistrict';
  scene.add(root);
  root.add(createSky());

  const colliders = [];
  const targets = [];
  const surfaceMeshes = [];
  const animatedLights = [];

  const asphalt = new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: .82, metalness: .04 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0x63666d, roughness: .91, metalness: .01 });
  const curb = new THREE.MeshStandardMaterial({ color: 0x8c8b88, roughness: .94 });

  function surface(mesh, kind = 'concrete') {
    mesh.receiveShadow = true;
    mesh.castShadow = !mobile;
    mesh.userData.surface = kind;
    surfaceMeshes.push(mesh);
    root.add(mesh);
    return mesh;
  }

  function slab(x, y, z, width, height, depth, material = concrete, { collide = true } = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    surface(mesh, 'concrete');
    if (collide) {
      colliders.push(new THREE.Box3(
        new THREE.Vector3(x - width / 2, y - height / 2, z - depth / 2),
        new THREE.Vector3(x + width / 2, y + height / 2, z + depth / 2)
      ));
    }
    return mesh;
  }

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(86, 86), asphalt);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -.015;
  surface(ground, 'concrete');

  // Only structural surfaces remain procedural. Visible architectural mass and
  // combat cover come from the repository's real GLBs below.
  slab(-18, .12, 0, 12, .24, 76, concrete, { collide: false });
  slab(18, .12, 0, 12, .24, 76, concrete, { collide: false });
  slab(0, .12, -18, 24, .24, 12, concrete, { collide: false });
  slab(0, .12, 18, 24, .24, 12, concrete, { collide: false });
  for (const x of [-11.8, 11.8]) slab(x, .24, 0, .28, .24, 76, curb);
  for (const z of [-11.8, 11.8]) slab(0, .24, z, 24, .24, .28, curb);

  const laneMaterial = new THREE.MeshStandardMaterial({
    color: 0xb88f43,
    roughness: .74,
    metalness: 0
  });
  for (let z = -33; z <= 33; z += 6) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(.13, 2.8), laneMaterial);
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, .012, z);
    root.add(line);
  }

  const puddleMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x0c1720,
    roughness: .1,
    metalness: .05,
    clearcoat: 1,
    clearcoatRoughness: .05,
    transparent: true,
    opacity: .72,
    depthWrite: false
  });
  for (let i = 0; i < (mobile ? 5 : 12); i++) {
    const puddle = new THREE.Mesh(new THREE.CircleGeometry(1, 28), puddleMaterial);
    puddle.rotation.x = -Math.PI / 2;
    puddle.position.set((Math.random() - .5) * 19, .016, (Math.random() - .5) * 68);
    puddle.scale.set(.7 + Math.random() * 2.2, .3 + Math.random() * .7, 1);
    root.add(puddle);
  }

  async function placeRequiredModel(url, position, {
    height = null,
    size = null,
    rotation = 0,
    kind = 'concrete',
    collider = false
  } = {}) {
    onProgress?.(`Loading real model · ${String(url).split('/').pop()}`);
    const asset = await assets.loadModel(url, { clone: true, world: true });
    const holder = new THREE.Group();
    const model = asset.scene;
    fitToGround(model, { height, size });
    model.traverse(node => {
      if (!node.isMesh) return;
      node.castShadow = !mobile;
      node.receiveShadow = true;
      node.userData.surface = kind;
      surfaceMeshes.push(node);
    });
    holder.add(model);
    holder.position.copy(position);
    holder.rotation.y = rotation;
    root.add(holder);
    holder.updateMatrixWorld(true);
    if (collider) {
      const bounds = new THREE.Box3().setFromObject(holder);
      bounds.min.y = 0;
      bounds.max.y = Math.max(bounds.max.y, 3);
      colliders.push(bounds);
    }
    return holder;
  }

  const buildings = ENVIRONMENT_ASSETS.enterableBuildings;
  const buildingLayout = mobile ? [
    [buildings[0], -22, -22, Math.PI / 2, 10.5],
    [buildings[1], 22, -22, -Math.PI / 2, 11.5],
    [buildings[2], -22, 22, Math.PI / 2, 12],
    [buildings[3], 22, 22, -Math.PI / 2, 10],
    [buildings[6], 0, -38, 0, 12],
    [buildings[7], 0, 38, Math.PI, 11]
  ] : [
    [buildings[0], -22, -23, Math.PI / 2, 10.5],
    [buildings[1], 22, -23, -Math.PI / 2, 11.5],
    [buildings[2], -22, 23, Math.PI / 2, 12],
    [buildings[3], 22, 23, -Math.PI / 2, 10],
    [buildings[4], -22, 0, Math.PI / 2, 9.5],
    [buildings[5], 22, 0, -Math.PI / 2, 12.5],
    [buildings[6], 0, -38, 0, 12],
    [buildings[7], 0, 38, Math.PI, 11]
  ];

  // AssetManager serializes decode/upload on iPhone. Promise.all still means
  // the loading screen waits for every required building before Deploy appears.
  const environmentJobs = buildingLayout.map(([url, x, z, rotation, height]) =>
    placeRequiredModel(url, new THREE.Vector3(x, .13, z), {
      height,
      rotation,
      kind: 'metal',
      collider: true
    })
  );

  const cover = ENVIRONMENT_ASSETS.cover;
  environmentJobs.push(
    placeRequiredModel(cover[0], new THREE.Vector3(-7, .13, -7), { size: 4.8, rotation: .22, collider: true }),
    placeRequiredModel(cover[0], new THREE.Vector3(7, .13, 8), { size: 4.8, rotation: Math.PI + .15, collider: true }),
    placeRequiredModel(cover[1], new THREE.Vector3(-7, .13, 15), { size: 3.2, rotation: -.3, kind: 'wood', collider: true }),
    placeRequiredModel(cover[1], new THREE.Vector3(7, .13, -16), { size: 3.2, rotation: .25, kind: 'wood', collider: true }),
    placeRequiredModel(ENVIRONMENT_ASSETS.terrain[0], new THREE.Vector3(-30, .13, 30), { size: 5.5, rotation: .7, collider: true })
  );
  await Promise.all(environmentJobs);

  function neonSign(text, colorValue, position, rotationY = 0) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#070a0f';
    ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = `#${new THREE.Color(colorValue).getHexString()}`;
    ctx.lineWidth = 7;
    ctx.strokeRect(8, 8, 496, 112);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.font = '900 58px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 67);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 1.3), material);
    mesh.position.copy(position);
    mesh.rotation.y = rotationY;
    root.add(mesh);
    const light = new THREE.PointLight(colorValue, mobile ? 5 : 14, 11, 2);
    light.position.copy(position);
    root.add(light);
    animatedLights.push({ light, base: light.intensity, phase: Math.random() * 10 });
  }

  neonSign('SECTOR 07', 0x23d9ff, new THREE.Vector3(-15.8, 5.6, -15.6), Math.PI / 2);
  neonSign('PROJECT STRIKE', 0xff2d9d, new THREE.Vector3(15.8, 6.4, 15.7), -Math.PI / 2);

  onProgress?.('Loading real animated operator…');
  const operator = await assets.loadModel(
    './game-assets/models/characters/operators/bamen_military_soldier_animated.glb'
  );
  if (!operator.scene) throw new Error('Required animated operator GLB contained no scene.');
  const operatorSource = operator.scene;
  const operatorAnimations = operator.animations || [];

  const targetLayout = [
    [0, -20, 0, true],
    [-8, 5, 1.2, false],
    [8, -5, -1.1, true],
    [0, 21, Math.PI, false],
    [-8, -11, -.4, true],
    [8, 13, 2.7, false]
  ];

  for (const [x, z, rotation, patrol] of targetLayout) {
    const visual = skeletonClone(operatorSource);
    fitToGround(visual, { height: 1.82, vertical: 'auto' });
    const target = new THREE.Group();
    target.position.set(x, .13, z);
    target.rotation.y = rotation;
    target.add(visual);
    target.userData = {
      health: 100,
      alive: true,
      respawn: 0,
      mixer: null,
      action: null,
      visual,
      clips: [...operatorAnimations],
      fall: 0,
      fallDirection: new THREE.Vector3(),
      home: new THREE.Vector3(x, .13, z),
      homeRotation: rotation,
      patrol,
      patrolTime: Math.random() * Math.PI * 2
    };
    root.add(target);
    visual.traverse(node => {
      if (!node.isMesh) return;
      node.castShadow = !mobile;
      node.receiveShadow = true;
      node.userData.target = target;
      if (/head|helmet|skull/i.test(node.name || '')) node.userData.hitZone = 'head';
    });
    if (operatorAnimations.length) {
      target.userData.mixer = new THREE.AnimationMixer(visual);
      playClip(target, patrol ? /walk/i : /idle|stand/i, { loop: true, fade: 0 });
    }
    targets.push(target);
  }

  function killTarget(target, direction = new THREE.Vector3(0, 0, 1)) {
    if (!target?.userData?.alive) return;
    target.userData.alive = false;
    target.userData.respawn = 3.5;
    target.userData.fall = 0;
    target.userData.fallDirection.copy(direction);
    playClip(target, /death|die|fall/i, { loop: false, fade: .05 });
  }

  function respawnTarget(target) {
    target.userData.health = 100;
    target.userData.alive = true;
    target.userData.fall = 0;
    target.visible = true;
    target.position.copy(target.userData.home);
    target.rotation.set(0, target.userData.homeRotation, 0);
    playClip(target, target.userData.patrol ? /walk/i : /idle|stand/i, { loop: true, fade: .08 });
  }

  globalThis.__PROJECT_STRIKE_ARENA__ = {
    strictRealModels: true,
    fallbackTargets: false,
    requiredBuildings: buildingLayout.length,
    operator: 'bamen_military_soldier_animated.glb'
  };

  return {
    root,
    colliders,
    targets,
    surfaceMeshes,
    killTarget,
    respawnTarget,
    updatePlayerShadow() {
      // The real local skinned body owns player presentation/shadows in V10.
    },
    update(dt, time = 0) {
      for (const entry of animatedLights) {
        entry.light.intensity = entry.base * (.94 + Math.sin(time * 1.8 + entry.phase) * .06);
      }
      for (const target of targets) {
        target.userData.mixer?.update(dt);
        if (target.userData.alive && target.userData.patrol) {
          target.userData.patrolTime += dt * .55;
          const offset = Math.sin(target.userData.patrolTime) * 3.2;
          const previousZ = target.position.z;
          target.position.z = target.userData.home.z + offset;
          const direction = target.position.z - previousZ;
          if (Math.abs(direction) > .0001) target.rotation.y = direction < 0 ? 0 : Math.PI;
          playClip(target, /walk/i, { loop: true });
        } else if (!target.userData.alive) {
          target.userData.respawn -= dt;
          target.userData.fall += dt;
          if (!findClip(target.userData.clips, /death|die|fall/i)) {
            target.rotation.z = THREE.MathUtils.damp(
              target.rotation.z,
              Math.sign(target.userData.fallDirection.x || 1) * 1.35,
              5,
              dt
            );
            target.position.y = THREE.MathUtils.damp(target.position.y, -.2, 4, dt);
          }
          if (target.userData.respawn <= 0) respawnTarget(target);
        }
      }
    }
  };
}
