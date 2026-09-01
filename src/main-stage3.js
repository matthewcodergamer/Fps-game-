import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { AssetManager } from './assets/AssetManager.js';
import {
  ANIMATION_PACKS,
  DEFAULT_ARMS,
  GRENADE_ASSETS,
  WEAPON_CATALOG
} from './assets/GameAssetCatalog.js';
import { RepositoryAudio } from './audio/RepositoryAudio.js';
import {
  CombatEffects,
  FootstepController,
  GrenadeController,
  RecoilController,
  ScopeController
} from './gameplay/CombatSystems.js';
import { GamepadInput } from './input/GamepadInput.js';
import { createCinematicPipeline } from './rendering/CinematicPipeline.js';
import { detectDevicePreset } from './rendering/QualityManager.js';
import { mountRoadmap } from './ui/RoadmapUI.js';
import { FPSViewModel } from './weapons/FPSViewModel.js';
import { createStage3Arena } from './world/Stage3Arena.js';

const $ = selector => document.querySelector(selector);
const canvas = $('#game');
const playButton = $('#playBtn');
const renderStatus = $('#renderStatus');
const runtimeError = $('#runtimeError');
const touchDevice = matchMedia('(any-pointer: coarse)').matches;
const preset = detectDevicePreset();

mountRoadmap();
playButton.disabled = true;
playButton.textContent = 'LOADING';

function setBootStatus(message) {
  if (renderStatus) renderStatus.textContent = message;
}

function showRuntimeError(message, { fatal = false } = {}) {
  console.error(message);
  if (!runtimeError) return;
  runtimeError.textContent = fatal
    ? `Startup failed · ${String(message).slice(0, 170)}`
    : `Recovered · ${String(message).slice(0, 150)}`;
  runtimeError.classList.add('show', fatal ? 'fatal' : 'recoverable');
  if (!fatal) setTimeout(() => runtimeError.classList.remove('show'), 5500);
}

addEventListener('error', event => showRuntimeError(event.error?.message || event.message || 'runtime error'));
addEventListener('unhandledrejection', event => showRuntimeError(event.reason?.message || event.reason || 'promise error'));

function createRenderer() {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !touchDevice,
    alpha: false,
    powerPreference: 'high-performance',
    stencil: false,
    depth: true
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = touchDevice ? 1.04 : .84;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = touchDevice ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x080b13, 1);
  return renderer;
}

async function startRuntime() {
  setBootStatus('Starting stable WebGL renderer…');
  const renderer = createRenderer();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x080b13);
  scene.fog = new THREE.FogExp2(0x12182a, touchDevice ? .0095 : .0075);

  const camera = new THREE.PerspectiveCamera(74, 1, .035, 260);
  camera.rotation.order = 'YXZ';

  const pixelRatio = Math.min(devicePixelRatio || 1, touchDevice ? 1.05 : 1.4);
  const assets = new AssetManager(renderer, {
    onProgress(event) {
      if (event.state !== 'loading' || !event.total) return;
      const percent = Math.round(event.loaded / event.total * 100);
      const name = String(event.url).split('/').pop();
      setBootStatus(`Loading ${name} · ${percent}%`);
    }
  });
  const audio = new RepositoryAudio();
  const gamepad = new GamepadInput();
  const clock = new THREE.Clock();

  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = new RoomEnvironment();
    scene.environment = pmrem.fromScene(environment, .035).texture;
    scene.environmentIntensity = touchDevice ? .52 : .66;
    environment.dispose();
    pmrem.dispose();
  } catch (error) {
    console.info('Environment reflections unavailable; direct lighting remains active.', error);
  }

  const hemisphere = new THREE.HemisphereLight(0x7f9ed0, 0x180f22, touchDevice ? 1.05 : .72);
  scene.add(hemisphere);

  const sun = new THREE.DirectionalLight(0xffbd8a, touchDevice ? 2.8 : 2.65);
  sun.position.set(-34, 42, -24);
  sun.target.position.set(2, 0, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(preset.shadowMap, preset.shadowMap);
  sun.shadow.camera.left = -46;
  sun.shadow.camera.right = 46;
  sun.shadow.camera.top = 46;
  sun.shadow.camera.bottom = -46;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 120;
  sun.shadow.bias = -.00022;
  sun.shadow.normalBias = .025;
  scene.add(sun, sun.target);

  const moonRim = new THREE.DirectionalLight(0x4d8dff, touchDevice ? .75 : 1.25);
  moonRim.position.set(28, 18, 35);
  scene.add(moonRim);

  setBootStatus('Building the neon industrial district…');
  const arena = await createStage3Arena(scene, assets, {
    mobile: touchDevice,
    onProgress: setBootStatus
  });

  setBootStatus('Mounting repository weapon and first-person arms…');
  const view = new FPSViewModel(camera, assets);
  let weaponIndex = 0;
  let current = {
    ...WEAPON_CATALOG[weaponIndex],
    ammo: WEAPON_CATALOG[weaponIndex].mag,
    currentReserve: WEAPON_CATALOG[weaponIndex].reserve
  };
  const [armsReady, weaponReady] = await Promise.all([
    view.loadArms(DEFAULT_ARMS),
    view.loadWeapon(current)
  ]);

  if (!armsReady || !weaponReady) {
    showRuntimeError(`Asset fallback active · arms ${armsReady ? 'ready' : 'failed'} · weapon ${weaponReady ? 'ready' : 'failed'}`);
  }

  const pipeline = createCinematicPipeline(renderer, scene, camera, {
    mobile: touchDevice,
    viewModel: view,
    onFallback: error => showRuntimeError(error?.message || 'post-processing fallback')
  });
  const scope = new ScopeController($('#scopeOverlay'));
  const effects = new CombatEffects(scene, { mobile: touchDevice });
  const recoil = new RecoilController();
  const footsteps = new FootstepController(audio);
  const grenades = new GrenadeController(scene, assets, audio, effects, {
    flashElement: $('#flashOverlay'),
    mobile: touchDevice
  });
  await grenades.init(GRENADE_ASSETS);

  $('#stageBadge').textContent = 'REWORK';
  setBootStatus(`WebGL2 stable · ${pipeline.mode} · ${preset.preset}`);

  const player = {
    pos: new THREE.Vector3(0, 1.72, 12),
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
  const casings = [];
  let started = false;
  let firing = false;
  let pointerADS = false;
  let authoredPacksStarted = false;
  let fpsFrames = 0;
  let fpsElapsed = 0;

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
        player.slideVelocity.setLength(Math.min(9.4, Math.max(7.8, player.slideVelocity.length() * 1.18)));
      }
      return;
    }
    player.crouch = !player.crouch;
  }

  async function equip(index) {
    if (player.reloading) return;
    weaponIndex = (index + WEAPON_CATALOG.length) % WEAPON_CATALOG.length;
    const next = WEAPON_CATALOG[weaponIndex];
    current = { ...next, ammo: next.mag, currentReserve: next.reserve };
    recoil.reset(next.id);
    $('#statusText').textContent = `EQUIP ${next.name}`;
    const ready = await view.loadWeapon(current);
    $('#statusText').textContent = ready ? 'READY' : 'MODEL ERROR';
    if (!ready) showRuntimeError(`Could not render ${next.name}: ${view.diagnostics.weapon?.error || 'unknown model error'}`);
    audio.preloadWeapon(next.bank).catch(() => {});
    updateHUD();
  }

  function switchWeapon() {
    equip(weaponIndex + 1);
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
    element.textContent = head ? '✕' : '×';
    element.classList.add('show');
    setTimeout(() => element.classList.remove('show'), 95);
  }

  function ejectCasing() {
    const casing = new THREE.Mesh(
      new THREE.CylinderGeometry(.012, .012, .045, 7),
      new THREE.MeshStandardMaterial({ color: 0xc29243, roughness: .28, metalness: .92 })
    );
    casing.rotation.z = Math.PI / 2;
    casing.position.copy(view.ejectionWorld(new THREE.Vector3()));
    scene.add(casing);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    casings.push({
      mesh: casing,
      life: 2,
      velocity: right.multiplyScalar(1 + Math.random() * .55).add(new THREE.Vector3(0, .7 + Math.random() * .45, 0))
    });
  }

  function rayShot(spread = 0) {
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    if (spread) {
      direction.x += (Math.random() - .5) * spread;
      direction.y += (Math.random() - .5) * spread;
      direction.z += (Math.random() - .5) * spread;
      direction.normalize();
    }
    const ray = new THREE.Raycaster(camera.position, direction, .02, 260);
    const living = arena.targets.filter(target => target.userData.alive);
    return ray.intersectObjects([...arena.surfaceMeshes, ...living], true)[0] || null;
  }

  function shoot() {
    if (!started || player.reloading || player.cooldown > 0 || current.ammo <= 0) return;
    player.cooldown = 60 / current.fireRate;
    current.ammo--;
    updateHUD();
    view.recoil(current.recoil);
    gamepad.pulse(.2 * current.recoil, 38);
    audio.playWeaponShot(current.bank, { gain: current.suppressed ? .58 : .82 });

    const kick = recoil.shot(current);
    player.pitch = Math.max(-1.45, player.pitch - kick.pitch);
    player.yaw -= kick.yaw;
    const muzzle = view.muzzleWorld(new THREE.Vector3());
    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);
    effects.muzzle(muzzle, cameraDirection);
    ejectCasing();

    const pellets = current.pellets || 1;
    const spread = current.class === 'shotgun' ? .055 : player.ads ? .0015 : .004;
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
        effects.impact(hit.point, normal, { kind: 'body', decal: true });
        if (target.userData.health <= 0) arena.killTarget(target, cameraDirection);
      } else {
        effects.impact(hit.point, normal, { kind: hit.object.userData.surface || 'concrete', decal: true });
      }
    }

    if (confirmedTarget) {
      hitmarker(headshot);
      $('#statusText').textContent = headshot ? 'HEADSHOT' : confirmedTarget.userData.alive ? 'HIT' : 'TARGET DOWN';
      setTimeout(() => {
        if (started && !player.reloading) $('#statusText').textContent = 'READY';
      }, 450);
    }
  }

  function startAnimationPacks() {
    // Operator clips are already embedded in the animated soldier GLB. The arm
    // asset has its own skeleton and uses the procedural FPS motion layer.
    if (authoredPacksStarted) return;
    authoredPacksStarted = true;
    console.info('Available external animation libraries:', ANIMATION_PACKS);
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
      y > .15 &&
      !player.ads &&
      player.slide <= 0
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
    const bobY = moving ? (Math.abs(step) - .45) * .026 * moveBlend : 0;
    const bobX = moving ? lateral * .012 * moveBlend : 0;

    camera.position.copy(player.pos).addScaledVector(right, bobX);
    camera.position.y += bobY - player.landImpulse * .055;
    camera.rotation.y = player.yaw;
    camera.rotation.x = player.pitch;
    const slideRoll = player.slide > 0 ? -.075 * (player.slide / .68) : 0;
    camera.rotation.z = THREE.MathUtils.damp(camera.rotation.z, slideRoll - lateral * .006 * moveBlend, 11, dt);

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
    scope.update(current, player.ads);
    footsteps.update(dt, {
      speed: horizontalSpeed,
      sprint,
      crouch: player.crouch,
      grounded: player.grounded
    });
    arena.updatePlayerShadow(player.pos, player.yaw, player.crouch);
  }

  function bindInput() {
    addEventListener('keydown', event => {
      keys[event.code] = true;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
      if (event.code === 'Space') jump();
      if (event.code === 'KeyR') reload();
      if (event.code === 'KeyC' || event.code === 'ControlLeft') slideOrCrouch();
      if (event.code === 'KeyQ') switchWeapon();
      if (/^Digit[1-9]$/.test(event.code)) equip(Number(event.code.slice(5)) - 1);
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
    const stick = pad.querySelector('.stick');
    const resetStick = () => {
      touch.joy = { x: 0, y: 0 };
      touch.joyId = null;
      stick.style.transform = 'translate3d(0,0,0)';
    };
    pad.addEventListener('touchstart', event => {
      touch.joyId = event.changedTouches[0].identifier;
      event.preventDefault();
    }, { passive: false });
    pad.addEventListener('touchmove', event => {
      event.preventDefault();
      const point = [...event.changedTouches].find(value => value.identifier === touch.joyId);
      if (!point) return;
      const rect = pad.getBoundingClientRect();
      const dx = point.clientX - (rect.left + rect.width / 2);
      const dy = point.clientY - (rect.top + rect.height / 2);
      const magnitude = Math.min(44, Math.hypot(dx, dy));
      const angle = Math.atan2(dy, dx);
      touch.joy = { x: Math.cos(angle) * magnitude / 44, y: Math.sin(angle) * magnitude / 44 };
      stick.style.transform = `translate3d(${touch.joy.x * 44}px,${touch.joy.y * 44}px,0)`;
    }, { passive: false });
    pad.addEventListener('touchend', resetStick);
    pad.addEventListener('touchcancel', resetStick);

    const lookZone = $('#lookZone');
    lookZone.addEventListener('touchstart', event => {
      const point = event.changedTouches[0];
      touch.look = { id: point.identifier, x: point.clientX, y: point.clientY };
      event.preventDefault();
    }, { passive: false });
    lookZone.addEventListener('touchmove', event => {
      event.preventDefault();
      const point = [...event.changedTouches].find(value => value.identifier === touch.look?.id);
      if (!point) return;
      const dx = point.clientX - touch.look.x;
      const dy = point.clientY - touch.look.y;
      touch.look.x = point.clientX;
      touch.look.y = point.clientY;
      player.yaw -= dx * .00405;
      player.pitch = THREE.MathUtils.clamp(player.pitch - dy * .00405, -1.45, 1.45);
    }, { passive: false });
    lookZone.addEventListener('touchend', () => { touch.look = null; });
    lookZone.addEventListener('touchcancel', () => { touch.look = null; });

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
    pipeline.resize(width, height, pixelRatio);
    document.documentElement.style.setProperty('--app-height', `${height}px`);
  }

  bindInput();
  resize();
  addEventListener('resize', resize, { passive: true });
  addEventListener('orientationchange', () => setTimeout(resize, 120), { passive: true });
  visualViewport?.addEventListener('resize', resize, { passive: true });

  playButton.disabled = false;
  playButton.textContent = 'DEPLOY';
  playButton.onclick = async () => {
    started = true;
    $('#boot').classList.add('hidden');
    $('#hud').classList.remove('hidden');
    $('#statusText').textContent = 'AUDIO LINK';
    await audio.unlock();
    await audio.loadPermanent();
    const readySounds = await audio.prewarm(current.bank);
    $('#statusText').textContent = readySounds?.weapon ? 'READY' : 'READY · AUDIO WARMING';
    startAnimationPacks();
    if (matchMedia('(pointer:fine)').matches) canvas.requestPointerLock?.();
  };

  function frame() {
    requestAnimationFrame(frame);
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
      camera.position.set(0, 2.1, 13);
      camera.rotation.set(-.03, 0, 0);
      view.update(dt, { time, speed: 0, stepPhase: 0 });
    }

    arena.update(dt, time);
    grenades.update(dt, arena, player.pos);
    effects.update(dt);
    for (let i = casings.length - 1; i >= 0; i--) {
      const item = casings[i];
      item.life -= dt;
      item.velocity.y -= 9.81 * dt;
      item.mesh.position.addScaledVector(item.velocity, dt);
      item.mesh.rotation.x += 8 * dt;
      if (item.mesh.position.y < .04) {
        item.mesh.position.y = .04;
        item.velocity.y = Math.abs(item.velocity.y) * .25;
        item.velocity.x *= .7;
        item.velocity.z *= .7;
      }
      if (item.life <= 0) {
        scene.remove(item.mesh);
        item.mesh.geometry.dispose();
        item.mesh.material.dispose();
        casings.splice(i, 1);
      }
    }

    pipeline.render();
    fpsFrames++;
    fpsElapsed += dt;
    if (fpsElapsed >= .5) {
      $('#fps').textContent = `${Math.round(fpsFrames / fpsElapsed)} FPS`;
      fpsFrames = 0;
      fpsElapsed = 0;
    }
  }
  frame();

  console.info('Project Strike runtime ready.', {
    renderer: 'WebGL2',
    pipeline: pipeline.mode,
    weapon: view.diagnostics.weapon,
    arms: view.diagnostics.arms,
    audioFilesExpected: 1990
  });
}

startRuntime().catch(error => {
  setBootStatus('STARTUP ERROR');
  playButton.disabled = true;
  playButton.textContent = 'FAILED';
  showRuntimeError(error?.stack || error?.message || error, { fatal: true });
});
