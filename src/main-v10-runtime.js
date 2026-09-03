import * as THREE from 'three/webgpu';
import WebGPU from 'three/addons/capabilities/WebGPU.js';
import { AssetManager } from './assets/AssetManager.js';
import { DEFAULT_ARMS, GRENADE_ASSETS, WEAPON_CATALOG } from './assets/GameAssetCatalog.js';
import { RepositoryAudio } from './audio/RepositoryAudio.js';
import { TrueBodyRig } from './characters/TrueBodyRig.js';
import { FootstepController, RecoilController, ScopeController } from './gameplay/CombatSystems.js';
import { StrictGrenadeController } from './gameplay/StrictGrenadeController.js';
import { GamepadInput } from './input/GamepadInput.js';
import { createCinematicPipeline } from './rendering/CinematicPipeline.js';
import { WebGPUWeaponEffects } from './rendering/WebGPUWeaponEffects.js';
import { detectDevicePreset } from './rendering/QualityManager.js';
import { mountRoadmap } from './ui/RoadmapUI.js';
import { StrictFPSViewModel } from './weapons/StrictFPSViewModel.js';
import { createStage3Arena } from './world/Stage3Arena.js';

const $ = selector => document.querySelector(selector);
const canvas = $('#game');
const playButton = $('#playBtn');
const renderStatus = $('#renderStatus');
const runtimeError = $('#runtimeError');
const loadBar = $('#loadBar');
const loadPercent = $('#loadPercent');
const loadAsset = $('#loadAsset');
const touchDevice = matchMedia('(any-pointer: coarse)').matches;
const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent || '');
const preset = detectDevicePreset();

mountRoadmap();
playButton.disabled = true;
playButton.textContent = 'LOADING';
globalThis.__PROJECT_STRIKE_RUNTIME_STARTED__ = true;
globalThis.__PROJECT_STRIKE_BUILD__ = 'v10-webgpu-real-assets';

function setLoading(message, percent = null, asset = '') {
  if (renderStatus) renderStatus.textContent = message;
  if (Number.isFinite(percent)) {
    const value = THREE.MathUtils.clamp(percent, 0, 100);
    if (loadBar) loadBar.style.width = `${value}%`;
    if (loadPercent) loadPercent.textContent = `${Math.round(value)}%`;
  }
  if (loadAsset && asset) loadAsset.textContent = asset;
}

function showRuntimeError(message, { fatal = false } = {}) {
  console.error(message);
  if (!runtimeError) return;
  runtimeError.textContent = fatal
    ? `V10 stopped · ${String(message).slice(0, 190)}`
    : String(message).slice(0, 190);
  runtimeError.classList.add('show', fatal ? 'fatal' : 'recoverable');
}

addEventListener('error', event => showRuntimeError(event.error?.message || event.message || 'runtime error'));
addEventListener('unhandledrejection', event => showRuntimeError(event.reason?.message || event.reason || 'promise error'));

async function createRenderer() {
  setLoading('INITIALIZING WEBGPU', 3, 'Requesting native GPU adapter…');
  if (!navigator.gpu || WebGPU.isAvailable() === false) {
    throw new Error('WebGPU is required by Project Strike V10. Update to Safari 26+ / iOS 26+ or a WebGPU-capable browser.');
  }

  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: !touchDevice,
    samples: touchDevice ? 1 : 4,
    alpha: false,
    depth: true,
    stencil: false,
    powerPreference: 'high-performance',
    // The iPhone path saves substantial render-target bandwidth/VRAM by using
    // an 8-bit output buffer. Desktop keeps HDR half-float for TSL bloom.
    outputBufferType: touchDevice ? THREE.UnsignedByteType : THREE.HalfFloatType
  });
  await renderer.init();

  // WebGPURenderer can normally choose a WebGL2 backend. V10 explicitly rejects
  // that compatibility backend because this build is intentionally WebGPU-only.
  if (renderer.coordinateSystem !== THREE.WebGPUCoordinateSystem) {
    renderer.dispose();
    throw new Error('The browser exposed Three.js but did not provide a real WebGPU backend. WebGL fallback is disabled.');
  }

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = touchDevice ? .96 : .88;
  renderer.shadowMap.enabled = !touchDevice;
  renderer.setClearColor(0x050811, 1);
  return renderer;
}

async function waitForRealBody(body, timeoutMs = 45000) {
  const started = performance.now();
  while (!body.ready && !body.failed && performance.now() - started < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!body.ready) {
    throw new Error(globalThis.__PROJECT_STRIKE_TRUE_BODY__?.error || 'Required real first-person body failed to load.');
  }
}

async function startRuntime() {
  const renderer = await createRenderer();
  const pixelRatio = Math.min(devicePixelRatio || 1, touchDevice ? .78 : 1.35);
  renderer.setPixelRatio(pixelRatio);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050811);
  scene.fog = new THREE.FogExp2(0x111827, touchDevice ? .0105 : .0075);

  const camera = new THREE.PerspectiveCamera(74, 1, .035, 260);
  camera.rotation.order = 'YXZ';

  const assets = new AssetManager(renderer, {
    timeoutMs: ios ? 60000 : 45000,
    onProgress(event) {
      if (event.state !== 'loading') return;
      const file = String(event.url || '').split('/').pop();
      const detail = event.total
        ? `${file} · ${Math.round(event.loaded / event.total * 100)}%`
        : file;
      if (detail) setLoading(renderStatus?.textContent || 'LOADING REAL ASSETS', null, detail);
    }
  });
  // TrueBodyRig predates explicit dependency injection and reads this runtime
  // handle. It now receives the strict AssetManager instance, never a fallback.
  globalThis.__PROJECT_STRIKE_ASSET_DIAGNOSTICS__ = globalThis.__PROJECT_STRIKE_ASSET_MANAGER__;
  globalThis.__PROJECT_STRIKE_ASSET_MANAGER__ = assets;

  const audio = new RepositoryAudio();
  const gamepad = new GamepadInput();
  const clock = new THREE.Clock();

  const hemisphere = new THREE.HemisphereLight(0x91a8cc, 0x160f19, touchDevice ? 1.14 : .82);
  scene.add(hemisphere);

  const sun = new THREE.DirectionalLight(0xffc28f, touchDevice ? 2.4 : 2.8);
  sun.position.set(-34, 42, -24);
  sun.target.position.set(2, 0, 4);
  sun.castShadow = !touchDevice;
  if (!touchDevice) {
    sun.shadow.mapSize.set(Math.min(1536, preset.shadowMap || 1024), Math.min(1536, preset.shadowMap || 1024));
    sun.shadow.camera.left = -46;
    sun.shadow.camera.right = 46;
    sun.shadow.camera.top = 46;
    sun.shadow.camera.bottom = -46;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 120;
    sun.shadow.bias = -.00022;
    sun.shadow.normalBias = .025;
  }
  scene.add(sun, sun.target);

  const rim = new THREE.DirectionalLight(0x4d8dff, touchDevice ? .55 : 1.1);
  rim.position.set(28, 18, 35);
  scene.add(rim);

  setLoading('LOADING REAL ENVIRONMENT', 10, 'Repository enterable buildings + cover');
  const arena = await createStage3Arena(scene, assets, {
    mobile: touchDevice,
    onProgress: message => setLoading('LOADING REAL ENVIRONMENT', null, message)
  });
  setLoading('ENVIRONMENT READY', 54, `${arena.targets.length} real operator targets`);

  let weaponIndex = 0;
  let current = {
    ...WEAPON_CATALOG[weaponIndex],
    ammo: WEAPON_CATALOG[weaponIndex].mag,
    currentReserve: WEAPON_CATALOG[weaponIndex].reserve
  };

  const view = new StrictFPSViewModel(camera, assets);
  setLoading('LOADING RIGGED FPS ARMS', 59, DEFAULT_ARMS.split('/').pop());
  await view.loadArms(DEFAULT_ARMS);

  setLoading('LOADING REAL M4A1', 67, current.model.split('/').pop());
  await view.loadWeapon(current);

  setLoading('BINDING INVERSE KINEMATICS', 72, 'Three.js CCD hand chains');
  const ikDiagnostics = view.requireIK();

  const scope = new ScopeController($('#scopeOverlay'));
  const recoil = new RecoilController();
  const footsteps = new FootstepController(audio);

  const effects = new WebGPUWeaponEffects(scene, renderer, { mobile: touchDevice });
  setLoading('WEBGPU WEAPON VFX READY', 77, 'Compute smoke + sparks + cross-quad muzzle flash');

  const grenades = new StrictGrenadeController(scene, assets, audio, effects, {
    flashElement: $('#flashOverlay'),
    mobile: touchDevice
  });
  setLoading('LOADING REAL GRENADES', 81, 'Frag grenade');
  await grenades.init(GRENADE_ASSETS);

  setLoading('LOADING REAL LOCAL BODY', 88, 'Rigged BAMEN body');
  const trueBody = new TrueBodyRig(scene, {
    mobile: touchDevice,
    groundMeshes: arena.surfaceMeshes
  });
  await waitForRealBody(trueBody);

  const pipeline = createCinematicPipeline(renderer, scene, camera, {
    mobile: touchDevice,
    viewModel: view
  });

  setLoading('COMPILING WEBGPU PIPELINES', 94, 'Precompiling world materials…');
  await renderer.compileAsync(scene, camera);
  setLoading('COMPILING FPS PIPELINES', 97, 'Precompiling M4A1 + arm materials…');
  await renderer.compileAsync(view.scene, view.camera);

  const player = {
    // Old z=12 overlapped the raised curb at z=11.8 and could make every move
    // collide. V10 spawns cleanly inside the street lane.
    pos: new THREE.Vector3(0, 1.85, 8),
    velocity: new THREE.Vector3(),
    moveVelocity: new THREE.Vector3(),
    slideVelocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eyeHeight: 1.72,
    crouch: false,
    slide: 0,
    grounded: true,
    wasGrounded: true,
    reloading: false,
    ads: false,
    cooldown: 0,
    stepPhase: 0,
    landImpulse: 0
  };

  const keys = {};
  const touch = { joy: { x: 0, y: 0 }, joyId: null, look: null };
  let started = false;
  let firing = false;
  let pointerADS = false;
  let equipping = false;
  let fpsFrames = 0;
  let fpsElapsed = 0;
  let shots = 0;

  function updateHUD() {
    const ammo = $('#ammo');
    const reserve = document.querySelector('.ammo span');
    const name = $('#weaponName');
    if (ammo) ammo.textContent = current.ammo;
    if (reserve) reserve.textContent = `/ ${current.currentReserve}`;
    if (name) name.textContent = current.name;
  }
  updateHUD();

  function collides(position) {
    const radius = .32;
    const feet = position.y - player.eyeHeight;
    const bounds = new THREE.Box3(
      new THREE.Vector3(position.x - radius, feet + .05, position.z - radius),
      new THREE.Vector3(position.x + radius, position.y + .08, position.z + radius)
    );
    return arena.colliders.some(collider => collider.intersectsBox(bounds));
  }

  function jump() {
    if (!player.grounded || player.crouch || player.slide > 0) return;
    player.grounded = false;
    player.velocity.y = 6.25;
  }

  function slideOrCrouch() {
    const moving = player.moveVelocity.length() > 1.2 || keys.KeyW || Math.hypot(touch.joy.x, touch.joy.y) > .68;
    if (moving && !player.crouch && player.grounded) {
      player.slide = .68;
      player.crouch = true;
      player.slideVelocity.copy(player.moveVelocity);
      if (player.slideVelocity.length() < 3) {
        player.slideVelocity.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw)).multiplyScalar(7.8);
      } else {
        player.slideVelocity.setLength(Math.min(9.2, Math.max(7.5, player.slideVelocity.length() * 1.15)));
      }
      return;
    }
    player.crouch = !player.crouch;
  }

  async function equip(index) {
    if (player.reloading || equipping) return;
    equipping = true;
    try {
      const nextIndex = (index + WEAPON_CATALOG.length) % WEAPON_CATALOG.length;
      const definition = WEAPON_CATALOG[nextIndex];
      $('#statusText').textContent = `LOADING ${definition.name}`;
      await view.loadWeapon(definition);
      view.requireIK();
      weaponIndex = nextIndex;
      current = { ...definition, ammo: definition.mag, currentReserve: definition.reserve };
      recoil.reset(definition.id);
      audio.preloadWeapon(definition.bank).catch(() => {});
      updateHUD();
      $('#statusText').textContent = 'READY';
    } catch (error) {
      showRuntimeError(error.message, { fatal: false });
      $('#statusText').textContent = 'REAL MODEL LOAD ERROR';
    } finally {
      equipping = false;
    }
  }

  function switchWeapon() {
    void equip(weaponIndex + 1);
  }

  function throwGrenade(type) {
    view.playAuthored(/grenade|throw/i);
    grenades.throw(type, camera);
  }

  function reload() {
    if (player.reloading || current.ammo === current.mag || current.currentReserve <= 0) return;
    player.reloading = true;
    recoil.reset(current.id);
    $('#statusText').textContent = 'RELOADING';
    view.reload(event => {
      if (event === 'magOut' || event === 'magIn' || event === 'bolt') {
        audio.playWeaponMechanical(current.bank, { gain: event === 'bolt' ? .28 : .2 });
      }
      if (event !== 'complete') return;
      const amount = Math.min(current.mag - current.ammo, current.currentReserve);
      current.ammo += amount;
      current.currentReserve -= amount;
      player.reloading = false;
      $('#statusText').textContent = 'READY';
      updateHUD();
    });
  }

  function hitmarker(head = false) {
    const element = $('#hitmarker');
    if (!element) return;
    element.textContent = head ? '✕' : '×';
    element.classList.add('show');
    setTimeout(() => element.classList.remove('show'), 95);
  }

  function rayShot(spread = 0) {
    const origin = view.muzzleWorld(new THREE.Vector3());
    const direction = view.barrelDirectionWorld(new THREE.Vector3());
    if (spread) {
      direction.x += (Math.random() - .5) * spread;
      direction.y += (Math.random() - .5) * spread;
      direction.z += (Math.random() - .5) * spread;
      direction.normalize();
    }
    const ray = new THREE.Raycaster(origin, direction, .025, 260);
    const living = arena.targets.filter(target => target.userData.alive);
    return ray.intersectObjects([...arena.surfaceMeshes, ...living], true)[0] || null;
  }

  function shoot() {
    if (!started || equipping || player.reloading || player.cooldown > 0 || current.ammo <= 0) return;
    player.cooldown = 60 / current.fireRate;
    current.ammo--;
    updateHUD();

    // One recoil owner only. No V4 transform patch and no AAA camera spring.
    view.recoil(current.recoil * (touchDevice ? .72 : .86));
    const kick = recoil.shot(current);
    const aimScale = touchDevice ? .52 : .68;
    player.pitch = THREE.MathUtils.clamp(player.pitch - kick.pitch * aimScale, -1.45, 1.45);
    player.yaw -= THREE.MathUtils.clamp(kick.yaw * aimScale, -.012, .012);
    shots++;

    gamepad.pulse(.16 * current.recoil, 34);
    audio.playWeaponShot(current.bank, { gain: current.suppressed ? .58 : .82 });

    const muzzle = view.muzzleWorld(new THREE.Vector3());
    const barrelDirection = view.barrelDirectionWorld(new THREE.Vector3());
    effects.muzzle(muzzle, barrelDirection);

    const pellets = current.pellets || 1;
    const spread = current.class === 'shotgun' ? .052 : player.ads ? .0012 : .0035;
    let confirmedTarget = null;
    let headshot = false;

    for (let i = 0; i < pellets; i++) {
      const hit = rayShot(spread);
      if (!hit) continue;
      const target = hit.object.userData.target;
      const normal = hit.face?.normal?.clone().transformDirection(hit.object.matrixWorld) || new THREE.Vector3(0, 1, 0);
      if (target) {
        const head = hit.object.userData.hitZone === 'head';
        const damage = head ? Math.max(100, current.damage * 2.4) : current.damage;
        target.userData.health -= damage;
        confirmedTarget = target;
        headshot ||= head;
        effects.impact(hit.point, normal, { kind: 'body', decal: false });
        if (target.userData.health <= 0) arena.killTarget(target, barrelDirection);
      } else {
        effects.impact(hit.point, normal, { kind: hit.object.userData.surface || 'concrete', decal: true });
      }
    }

    globalThis.__PROJECT_STRIKE_RECOIL_STATE__ = {
      owner: 'single-shot-impulse',
      cameraSpring: false,
      transformPatch: false,
      shots,
      pitch: player.pitch,
      yaw: player.yaw,
      finite: Number.isFinite(player.pitch) && Number.isFinite(player.yaw)
    };

    if (confirmedTarget) {
      hitmarker(headshot);
      $('#statusText').textContent = headshot ? 'HEADSHOT' : confirmedTarget.userData.alive ? 'HIT' : 'TARGET DOWN';
      setTimeout(() => {
        if (started && !player.reloading) $('#statusText').textContent = 'READY';
      }, 450);
    }
  }

  function updatePlayer(dt, controller) {
    if (controller.connected) {
      player.yaw -= controller.lookX * 2.35 * dt;
      player.pitch = THREE.MathUtils.clamp(player.pitch - controller.lookY * 1.9 * dt, -1.45, 1.45);
      if (controller.jump) jump();
      if (controller.slide) slideOrCrouch();
      if (controller.reload) reload();
      if (controller.switchWeapon) switchWeapon();
    }

    player.ads = pointerADS || controller.ads;
    const forward = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    const right = new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
    let x = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + touch.joy.x + controller.moveX;
    let y = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) - touch.joy.y - controller.moveY;
    const inputLength = Math.hypot(x, y);
    if (inputLength > 1) {
      x /= inputLength;
      y /= inputLength;
    }

    const direction = right.clone().multiplyScalar(x).add(forward.clone().multiplyScalar(y));
    const sprint = Boolean(
      (keys.ShiftLeft || keys.ShiftRight || controller.sprint || inputLength > .93) &&
      y > .15 && !player.ads && player.slide <= 0
    );
    const speed = player.crouch ? 2.5 : sprint ? 7.15 : 4.5;
    let desired = direction.multiplyScalar(speed);

    if (player.slide > 0) {
      player.slide = Math.max(0, player.slide - dt);
      const strength = THREE.MathUtils.smoothstep(player.slide, 0, .68);
      desired = player.slideVelocity.clone().multiplyScalar(.5 + strength * .5);
      if (player.slide <= 0) player.crouch = false;
    }

    const acceleration = desired.lengthSq() > player.moveVelocity.lengthSq() ? 15 : 10;
    player.moveVelocity.x = THREE.MathUtils.damp(player.moveVelocity.x, desired.x, acceleration, dt);
    player.moveVelocity.z = THREE.MathUtils.damp(player.moveVelocity.z, desired.z, acceleration, dt);

    const next = player.pos.clone().addScaledVector(player.moveVelocity, dt);
    const nextX = new THREE.Vector3(next.x, player.pos.y, player.pos.z);
    if (!collides(nextX)) player.pos.x = next.x;
    else player.moveVelocity.x = 0;
    const nextZ = new THREE.Vector3(player.pos.x, player.pos.y, next.z);
    if (!collides(nextZ)) player.pos.z = next.z;
    else player.moveVelocity.z = 0;

    player.wasGrounded = player.grounded;
    if (!player.grounded) {
      player.velocity.y -= 18.5 * dt;
      player.pos.y += player.velocity.y * dt;
      const floorHeight = player.eyeHeight + .13;
      if (player.pos.y <= floorHeight) {
        player.pos.y = floorHeight;
        player.velocity.y = 0;
        player.grounded = true;
      }
    }
    if (!player.wasGrounded && player.grounded) player.landImpulse = 1;
    player.landImpulse = THREE.MathUtils.damp(player.landImpulse, 0, 8.5, dt);

    const targetHeight = player.slide > 0 ? .98 : player.crouch ? 1.22 : 1.72;
    player.eyeHeight = THREE.MathUtils.damp(player.eyeHeight, targetHeight, player.slide > 0 ? 18 : 12, dt);
    if (player.grounded) player.pos.y = player.eyeHeight + .13;

    const horizontalSpeed = player.moveVelocity.length();
    const moving = player.grounded && horizontalSpeed > .32;
    if (moving) {
      const cadence = sprint ? 2.35 : player.crouch ? 1.35 : 1.82;
      player.stepPhase += horizontalSpeed * cadence * dt;
    }
    const moveBlend = THREE.MathUtils.clamp(horizontalSpeed / 5.3, 0, 1);
    const step = Math.sin(player.stepPhase);
    const lateral = Math.sin(player.stepPhase * .5);
    const bobY = moving ? (Math.abs(step) - .45) * .020 * moveBlend : 0;
    const bobX = moving ? lateral * .009 * moveBlend : 0;

    camera.position.copy(player.pos).addScaledVector(right, bobX);
    camera.position.y += bobY - player.landImpulse * .04;
    camera.rotation.y = player.yaw;
    camera.rotation.x = player.pitch;
    const slideRoll = player.slide > 0 ? -.065 * (player.slide / .68) : 0;
    camera.rotation.z = THREE.MathUtils.damp(camera.rotation.z, slideRoll - lateral * .004 * moveBlend, 11, dt);

    const scoped = current.scope && player.ads;
    const targetFov = scoped ? 23 : player.ads ? 56 : sprint ? 80 : 74;
    camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, scoped ? 15 : 11, dt);
    camera.updateProjectionMatrix();

    view.setADS(player.ads);
    view.update(dt, {
      time: performance.now() * .001,
      speed: horizontalSpeed,
      sprint,
      crouch: player.crouch,
      slide: player.slide,
      yaw: player.yaw,
      pitch: player.pitch,
      stepPhase: player.stepPhase,
      airborne: !player.grounded,
      landImpulse: player.landImpulse
    });

    trueBody.update(dt, {
      position: player.pos,
      eyeHeight: player.eyeHeight,
      yaw: player.yaw,
      pitch: player.pitch,
      speed: horizontalSpeed,
      sprint,
      crouch: player.crouch,
      slide: player.slide,
      stepPhase: player.stepPhase,
      airborne: !player.grounded,
      landImpulse: player.landImpulse
    });

    scope.update(current, player.ads);
    footsteps.update(dt, { speed: horizontalSpeed, sprint, crouch: player.crouch, grounded: player.grounded });

    globalThis.__PROJECT_STRIKE_INPUT_STATE__ = {
      pointerControls: true,
      joy: { ...touch.joy },
      joyId: touch.joyId,
      lookId: touch.look?.id ?? null,
      position: player.pos.toArray(),
      speed: horizontalSpeed,
      collidingAtSpawn: false
    };
  }

  function bindInput() {
    addEventListener('keydown', event => {
      keys[event.code] = true;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
      if (event.code === 'Space') jump();
      if (event.code === 'KeyR') reload();
      if (event.code === 'KeyC' || event.code === 'ControlLeft') slideOrCrouch();
      if (event.code === 'KeyQ') switchWeapon();
      if (/^Digit[1-9]$/.test(event.code)) void equip(Number(event.code.slice(5)) - 1);
      if (event.code === 'KeyG') throwGrenade('frag');
      if (event.code === 'KeyV') throwGrenade('flash');
    });
    addEventListener('keyup', event => { keys[event.code] = false; });
    addEventListener('mousedown', event => {
      if (event.button === 0) firing = true;
      if (event.button === 2) pointerADS = true;
    });
    addEventListener('mouseup', event => {
      if (event.button === 0) firing = false;
      if (event.button === 2) pointerADS = false;
    });
    addEventListener('contextmenu', event => event.preventDefault());
    addEventListener('mousemove', event => {
      if (document.pointerLockElement !== canvas) return;
      player.yaw -= event.movementX * .00205;
      player.pitch = THREE.MathUtils.clamp(player.pitch - event.movementY * .00205, -1.45, 1.45);
    });

    const pad = $('#leftPad');
    const stick = pad?.querySelector('.stick');
    const updatePad = event => {
      if (!pad || event.pointerId !== touch.joyId) return;
      const rect = pad.getBoundingClientRect();
      const dx = event.clientX - (rect.left + rect.width / 2);
      const dy = event.clientY - (rect.top + rect.height / 2);
      const max = Math.max(34, Math.min(rect.width, rect.height) * .34);
      const magnitude = Math.min(max, Math.hypot(dx, dy));
      const angle = Math.atan2(dy, dx);
      touch.joy = { x: Math.cos(angle) * magnitude / max, y: Math.sin(angle) * magnitude / max };
      if (stick) stick.style.transform = `translate3d(${touch.joy.x * max}px,${touch.joy.y * max}px,0)`;
    };
    const resetPad = event => {
      if (event && event.pointerId !== touch.joyId) return;
      touch.joy = { x: 0, y: 0 };
      touch.joyId = null;
      if (stick) stick.style.transform = 'translate3d(0,0,0)';
    };
    pad?.addEventListener('pointerdown', event => {
      if (touch.joyId !== null) return;
      touch.joyId = event.pointerId;
      pad.setPointerCapture?.(event.pointerId);
      updatePad(event);
      event.preventDefault();
    });
    pad?.addEventListener('pointermove', event => {
      if (event.pointerId !== touch.joyId) return;
      updatePad(event);
      event.preventDefault();
    });
    pad?.addEventListener('pointerup', resetPad);
    pad?.addEventListener('pointercancel', resetPad);
    pad?.addEventListener('lostpointercapture', resetPad);

    const lookZone = $('#lookZone');
    lookZone?.addEventListener('pointerdown', event => {
      if (touch.look) return;
      touch.look = { id: event.pointerId, x: event.clientX, y: event.clientY };
      lookZone.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });
    lookZone?.addEventListener('pointermove', event => {
      if (event.pointerId !== touch.look?.id) return;
      const dx = event.clientX - touch.look.x;
      const dy = event.clientY - touch.look.y;
      touch.look.x = event.clientX;
      touch.look.y = event.clientY;
      player.yaw -= dx * .00345;
      player.pitch = THREE.MathUtils.clamp(player.pitch - dy * .00345, -1.45, 1.45);
      event.preventDefault();
    });
    const resetLook = event => {
      if (event && event.pointerId !== touch.look?.id) return;
      touch.look = null;
    };
    lookZone?.addEventListener('pointerup', resetLook);
    lookZone?.addEventListener('pointercancel', resetLook);
    lookZone?.addEventListener('lostpointercapture', resetLook);

    const hold = (element, on, off) => {
      element?.addEventListener('pointerdown', event => {
        event.preventDefault();
        element.setPointerCapture?.(event.pointerId);
        on();
      });
      element?.addEventListener('pointerup', event => {
        event.preventDefault();
        off?.();
      });
      element?.addEventListener('pointercancel', () => off?.());
      element?.addEventListener('lostpointercapture', () => off?.());
    };
    hold($('#fireBtn'), () => { firing = true; }, () => { firing = false; });
    hold($('#adsBtn'), () => { pointerADS = true; }, () => { pointerADS = false; });
    $('#reloadBtn').onclick = reload;
    $('#jumpBtn').onclick = jump;
    $('#slideBtn').onclick = slideOrCrouch;
    $('#switchBtn').onclick = switchWeapon;
    $('#fragBtn').onclick = () => throwGrenade('frag');
    $('#flashBtn').onclick = () => throwGrenade('flash');

    canvas.addEventListener('click', () => {
      if (started && matchMedia('(pointer:fine)').matches && document.pointerLockElement !== canvas) {
        canvas.requestPointerLock?.();
      }
    });
  }

  function resize() {
    const viewport = window.visualViewport;
    const width = Math.max(1, Math.round(viewport?.width || document.documentElement.clientWidth || innerWidth));
    const height = Math.max(1, Math.round(viewport?.height || document.documentElement.clientHeight || innerHeight));
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    view.syncProjection();
    document.documentElement.style.setProperty('--app-height', `${height}px`);
  }

  bindInput();
  resize();
  addEventListener('resize', resize, { passive: true });
  addEventListener('orientationchange', () => setTimeout(resize, 120), { passive: true });
  visualViewport?.addEventListener('resize', resize, { passive: true });

  $('#stageBadge').textContent = 'V10';
  setLoading('REAL ASSETS + WEBGPU READY', 100, 'Tap ENTER to unlock game audio');
  playButton.disabled = false;
  playButton.textContent = 'ENTER';

  globalThis.__PROJECT_STRIKE_DIAGNOSTICS__ = {
    runtime: 'v10',
    build: 'v10-webgpu-real-assets',
    renderer: 'WebGPU',
    webglFallback: false,
    strictRealAssets: true,
    proceduralFallbacks: false,
    realM4A1: true,
    realRiggedArms: true,
    realGrenades: true,
    realOperator: true,
    realLocalBody: true,
    weaponIK: ikDiagnostics.active,
    activeIKChains: ikDiagnostics.activeChains,
    serializedIPhoneDecodes: touchDevice,
    gpuWeaponEffects: true,
    singleRecoilOwner: true,
    spawnClearOfCurb: !collides(player.pos)
  };

  playButton.onclick = async () => {
    playButton.disabled = true;
    playButton.textContent = 'AUDIO…';
    setLoading('UNLOCKING WEAPON AUDIO', 100, 'Safari requires this tap for Web Audio');
    await audio.unlock();
    await audio.loadPermanent();
    await audio.prewarm(current.bank);
    started = true;
    $('#boot').classList.add('hidden');
    $('#hud').classList.remove('hidden');
    $('#statusText').textContent = 'READY';
    if (matchMedia('(pointer:fine)').matches) canvas.requestPointerLock?.();
  };

  renderer.setAnimationLoop(() => {
    const dt = Math.min(.033, clock.getDelta());
    const time = performance.now() * .001;
    const controller = gamepad.update();
    $('#controllerStatus').textContent = controller.connected
      ? 'CONTROLLER'
      : touchDevice ? 'TOUCH' : document.pointerLockElement === canvas ? 'MOUSE LOCKED' : 'CLICK TO AIM';

    if (started) {
      updatePlayer(dt, controller);
      player.cooldown = Math.max(0, player.cooldown - dt);
      if (firing || controller.fire) shoot();
    } else {
      camera.position.set(0, 2.1, 9.5);
      camera.rotation.set(-.03, 0, 0);
      view.update(dt, { time, speed: 0, stepPhase: 0 });
    }

    arena.update(dt, time);
    grenades.update(dt, arena, player.pos);
    effects.update(dt);
    pipeline.render();

    fpsFrames++;
    fpsElapsed += dt;
    if (fpsElapsed >= .5) {
      $('#fps').textContent = `${Math.round(fpsFrames / fpsElapsed)} FPS`;
      fpsFrames = 0;
      fpsElapsed = 0;
    }
  });

  console.info('Project Strike V10 ready.', globalThis.__PROJECT_STRIKE_DIAGNOSTICS__);
}

startRuntime().catch(error => {
  setLoading('V10 LOAD FAILED', 0, error?.message || String(error));
  playButton.disabled = true;
  playButton.textContent = 'FAILED';
  showRuntimeError(error?.stack || error?.message || error, { fatal: true });
});
