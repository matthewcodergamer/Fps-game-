import * as THREE from 'three';
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
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x050817) },
      midColor: { value: new THREE.Color(0x182849) },
      horizonColor: { value: new THREE.Color(0x8e365e) },
      sunColor: { value: new THREE.Color(0xffc07b) },
      sunDirection: { value: new THREE.Vector3(-.72, .25, -.42).normalize() }
    },
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 midColor;
      uniform vec3 horizonColor;
      uniform vec3 sunColor;
      uniform vec3 sunDirection;
      varying vec3 vWorld;
      void main() {
        vec3 direction = normalize(vWorld - cameraPosition);
        float heightMix = smoothstep(-0.12, 0.72, direction.y);
        vec3 base = mix(horizonColor, midColor, smoothstep(-0.08, 0.22, direction.y));
        base = mix(base, topColor, heightMix);
        float sun = pow(max(dot(direction, sunDirection), 0.0), 680.0);
        float halo = pow(max(dot(direction, sunDirection), 0.0), 28.0) * 0.22;
        gl_FragColor = vec4(base + sunColor * (sun * 4.2 + halo), 1.0);
      }
    `
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(220, 32, 18), material);
  sky.name = 'CyberTwilightSky';
  sky.renderOrder = -100;
  return sky;
}

function createPlayerShadowProxy() {
  const root = new THREE.Group();
  root.name = 'FirstPersonShadowBody';
  const invisible = new THREE.MeshStandardMaterial({ color: 0x111111 });
  invisible.colorWrite = false;
  invisible.depthWrite = false;
  const add = (geometry, position, rotation = null) => {
    const mesh = new THREE.Mesh(geometry, invisible);
    mesh.position.copy(position);
    if (rotation) mesh.rotation.copy(rotation);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    root.add(mesh);
    return mesh;
  };
  add(new THREE.CapsuleGeometry(.24, .72, 3, 7), new THREE.Vector3(0, 1.02, 0));
  add(new THREE.SphereGeometry(.16, 10, 8), new THREE.Vector3(0, 1.63, 0));
  add(new THREE.CapsuleGeometry(.065, .48, 3, 6), new THREE.Vector3(-.22, 1.24, -.17), new THREE.Euler(.75, 0, -.25));
  add(new THREE.CapsuleGeometry(.065, .48, 3, 6), new THREE.Vector3(.22, 1.24, -.17), new THREE.Euler(.75, 0, .25));
  return root;
}

export async function createStage3Arena(scene, assets, { mobile = false, onProgress = null } = {}) {
  const root = new THREE.Group();
  root.name = 'NeonIndustrialDistrict';
  scene.add(root);
  root.add(createSky());

  const colliders = [];
  const targets = [];
  const surfaceMeshes = [];
  const animatedLights = [];
  const signs = [];

  const asphalt = new THREE.MeshStandardMaterial({ color: 0x252932, roughness: .72, metalness: .08 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0x72757d, roughness: .88, metalness: .02 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x1b1e26, roughness: .48, metalness: .64 });
  const curb = new THREE.MeshStandardMaterial({ color: 0x9b9996, roughness: .9 });

  function surface(mesh, kind = 'concrete') {
    mesh.receiveShadow = true;
    mesh.castShadow = !mobile;
    mesh.userData.surface = kind;
    surfaceMeshes.push(mesh);
    root.add(mesh);
    return mesh;
  }

  function box(x, y, z, width, height, depth, material = concrete, {
    collide = true,
    visible = true,
    kind = 'concrete'
  } = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    mesh.visible = visible;
    surface(mesh, kind);
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

  // A real street grid with raised sidewalks replaces the mirror-like test floor.
  box(-18, .12, 0, 12, .24, 76, concrete, { collide: false });
  box(18, .12, 0, 12, .24, 76, concrete, { collide: false });
  box(0, .12, -18, 24, .24, 12, concrete, { collide: false });
  box(0, .12, 18, 24, .24, 12, concrete, { collide: false });
  for (const x of [-11.8, 11.8]) {
    box(x, .24, 0, .28, .24, 76, curb, { collide: true });
  }
  for (const z of [-11.8, 11.8]) {
    box(0, .24, z, 24, .24, .28, curb, { collide: true });
  }

  const laneMaterial = new THREE.MeshBasicMaterial({ color: 0xe5b65e, transparent: true, opacity: .64 });
  for (let z = -33; z <= 33; z += 6) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(.13, 2.8), laneMaterial);
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, .012, z);
    root.add(line);
  }

  const puddleMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x111c27,
    roughness: .12,
    metalness: .08,
    clearcoat: 1,
    clearcoatRoughness: .06,
    transparent: true,
    opacity: .78,
    depthWrite: false
  });
  const puddleCount = mobile ? 8 : 18;
  for (let i = 0; i < puddleCount; i++) {
    const puddle = new THREE.Mesh(new THREE.CircleGeometry(1, 20), puddleMaterial);
    puddle.rotation.x = -Math.PI / 2;
    puddle.position.set((Math.random() - .5) * 19, .016, (Math.random() - .5) * 68);
    puddle.scale.set(.7 + Math.random() * 2.5, .28 + Math.random() * .85, 1);
    root.add(puddle);
  }

  async function placeModel(url, position, {
    height = null,
    size = null,
    rotation = 0,
    kind = 'concrete',
    collider = false
  } = {}) {
    try {
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
    } catch (error) {
      console.warn('Environment model failed.', url, error);
      return null;
    }
  }

  const buildings = ENVIRONMENT_ASSETS.enterableBuildings;
  const buildingLayout = [
    [buildings[0], -22, -23, Math.PI / 2, 10.5],
    [buildings[1], 22, -23, -Math.PI / 2, 11.5],
    [buildings[2], -22, 23, Math.PI / 2, 12],
    [buildings[3], 22, 23, -Math.PI / 2, 10],
    [buildings[4], -22, 0, Math.PI / 2, 9.5],
    [buildings[5], 22, 0, -Math.PI / 2, 12.5],
    [buildings[6], 0, -38, 0, 12],
    [buildings[7], 0, 38, Math.PI, 11]
  ];
  const jobs = buildingLayout.map(([url, x, z, rotation, height], index) => {
    onProgress?.(`Loading district building ${index + 1}/${buildingLayout.length}`);
    return placeModel(url, new THREE.Vector3(x, .13, z), { height, rotation, kind: 'metal', collider: true });
  });

  const cover = ENVIRONMENT_ASSETS.cover;
  jobs.push(
    placeModel(cover[0], new THREE.Vector3(-7, .13, -7), { size: 4.8, rotation: .22, collider: true }),
    placeModel(cover[0], new THREE.Vector3(7, .13, 8), { size: 4.8, rotation: Math.PI + .15, collider: true }),
    placeModel(cover[1], new THREE.Vector3(-7, .13, 15), { size: 3.2, rotation: -.3, kind: 'wood', collider: true }),
    placeModel(cover[1], new THREE.Vector3(7, .13, -16), { size: 3.2, rotation: .25, kind: 'wood', collider: true }),
    placeModel(ENVIRONMENT_ASSETS.terrain[0], new THREE.Vector3(-30, .13, 30), { size: 5.5, rotation: .7, collider: true })
  );

  // Industrial pipes, rooftop silhouettes, and alley dividers give the map real depth.
  for (const x of [-30, 30]) {
    for (const z of [-30, 0, 30]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(.08, .11, 5.6, 8), darkMetal);
      pole.position.set(x, 2.8, z);
      pole.castShadow = !mobile;
      root.add(pole);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1.2, .08, .08), darkMetal);
      arm.position.set(x + (x < 0 ? .54 : -.54), 5.45, z);
      root.add(arm);
    }
  }

  function neonSign(text, color, position, rotationY = 0) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, 512, 128);
    context.fillStyle = '#080a12';
    context.fillRect(0, 0, 512, 128);
    context.strokeStyle = `#${new THREE.Color(color).getHexString()}`;
    context.lineWidth = 7;
    context.strokeRect(8, 8, 496, 112);
    context.fillStyle = context.strokeStyle;
    context.font = '900 62px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, 256, 67);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({ map: texture, color, toneMapped: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 1.3), material);
    mesh.position.copy(position);
    mesh.rotation.y = rotationY;
    root.add(mesh);
    const light = new THREE.PointLight(color, mobile ? 8 : 20, 13, 2);
    light.position.copy(position);
    light.position.y -= .2;
    light.position.add(new THREE.Vector3(Math.sin(rotationY), 0, Math.cos(rotationY)).multiplyScalar(1.4));
    root.add(light);
    animatedLights.push({ light, base: light.intensity, phase: Math.random() * 10 });
    signs.push(mesh);
  }

  neonSign('NIGHT CITY 07', 0x23d9ff, new THREE.Vector3(-15.8, 5.6, -15.6), Math.PI / 2);
  neonSign('PROJECT STRIKE', 0xff2d9d, new THREE.Vector3(15.8, 6.4, 15.7), -Math.PI / 2);
  neonSign('TACTICAL // LIVE', 0xffa43a, new THREE.Vector3(-15.8, 4.2, 15.8), Math.PI / 2);
  neonSign('SECTOR 12', 0x7d4dff, new THREE.Vector3(15.8, 4.8, -15.8), -Math.PI / 2);

  const practicalColors = [0x22d7ff, 0xff328f, 0xff9f43, 0x8057ff];
  for (let i = 0; i < 8; i++) {
    const side = i % 2 ? 1 : -1;
    const z = -30 + Math.floor(i / 2) * 20;
    const color = practicalColors[i % practicalColors.length];
    const stripMaterial = new THREE.MeshBasicMaterial({ color, toneMapped: false });
    const strip = new THREE.Mesh(new THREE.BoxGeometry(.08, 2.2, .08), stripMaterial);
    strip.position.set(side * 11.45, 1.55, z);
    root.add(strip);
    const light = new THREE.PointLight(color, mobile ? 6 : 14, 9, 2);
    light.position.set(side * 10.8, 2.1, z);
    root.add(light);
    animatedLights.push({ light, base: light.intensity, phase: i * .7 });
  }

  const rainCount = mobile ? 120 : 360;
  const rainGeometry = new THREE.BufferGeometry();
  const rainPositions = new Float32Array(rainCount * 3);
  for (let i = 0; i < rainCount; i++) {
    rainPositions[i * 3] = (Math.random() - .5) * 80;
    rainPositions[i * 3 + 1] = Math.random() * 22;
    rainPositions[i * 3 + 2] = (Math.random() - .5) * 80;
  }
  rainGeometry.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
  const rain = new THREE.Points(
    rainGeometry,
    new THREE.PointsMaterial({ color: 0xaed9ed, size: mobile ? .021 : .029, transparent: true, opacity: .32, depthWrite: false })
  );
  root.add(rain);

  let operatorSource = null;
  let operatorAnimations = [];
  try {
    const operator = await assets.loadModel('./game-assets/models/characters/operators/bamen_military_soldier_animated.glb');
    operatorSource = operator.scene;
    operatorAnimations = operator.animations || [];
  } catch (error) {
    console.warn('Animated operator model unavailable.', error);
  }

  function fallbackTarget() {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(.42, .9, 4, 8), darkMetal);
    const head = new THREE.Mesh(new THREE.SphereGeometry(.27, 14, 10), new THREE.MeshStandardMaterial({ color: 0x806d60, roughness: .8 }));
    body.position.y = 1.05;
    head.position.y = 1.88;
    head.userData.hitZone = 'head';
    group.add(body, head);
    return group;
  }

  const targetLayout = [
    [0, -20, 0, true],
    [-8, 5, 1.2, false],
    [8, -5, -1.1, true],
    [0, 21, Math.PI, false],
    [-8, -11, -.4, true],
    [8, 13, 2.7, false]
  ];
  for (const [x, z, rotation, patrol] of targetLayout) {
    const visual = operatorSource ? skeletonClone(operatorSource) : fallbackTarget();
    if (operatorSource) fitToGround(visual, { height: 1.82, vertical: 'auto' });
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

  const shadowProxy = createPlayerShadowProxy();
  root.add(shadowProxy);
  await Promise.allSettled(jobs);

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

  return {
    root,
    colliders,
    targets,
    surfaceMeshes,
    killTarget,
    respawnTarget,
    updatePlayerShadow(position, yaw, crouch = false) {
      shadowProxy.position.set(position.x, .13, position.z);
      shadowProxy.rotation.y = yaw;
      shadowProxy.scale.y = THREE.MathUtils.damp(shadowProxy.scale.y, crouch ? .72 : 1, 12, 1 / 60);
    },
    update(dt, time = 0) {
      const positions = rain.geometry.attributes.position.array;
      for (let i = 0; i < rainCount; i++) {
        positions[i * 3 + 1] -= (mobile ? 13 : 18) * dt;
        positions[i * 3] += .7 * dt;
        if (positions[i * 3 + 1] < .08) {
          positions[i * 3 + 1] = 17 + Math.random() * 8;
          positions[i * 3] = (Math.random() - .5) * 80;
          positions[i * 3 + 2] = (Math.random() - .5) * 80;
        }
      }
      rain.geometry.attributes.position.needsUpdate = true;
      for (const entry of animatedLights) {
        entry.light.intensity = entry.base * (.92 + Math.sin(time * 2.2 + entry.phase) * .08);
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
