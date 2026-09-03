import * as THREE from 'three/webgpu';
import { AssetManager } from './assets/AssetManager.js';
import { DEFAULT_ARMS, GRENADE_ASSETS, WEAPON_CATALOG } from './assets/GameAssetCatalog.js';
import { RepositoryAudio } from './audio/RepositoryAudio.js';
import { TrueBodyRig } from './characters/TrueBodyRig.js';
import { GPUWeaponVFX } from './rendering/GPUWeaponVFX.js';
import { FPSViewModelV10 } from './weapons/FPSViewModelV10.js';
import { createRealisticDistrictV10 } from './world/RealisticDistrictV10.js';

const $ = selector => document.querySelector(selector);
const canvas = $('#game');
const playButton = $('#playBtn');
const renderStatus = $('#renderStatus');
const runtimeError = $('#runtimeError');
const loadBar = $('#loadBar');
const loadPercent = $('#loadPercent');
const loadAsset = $('#loadAsset');
const touchDevice = matchMedia('(any-pointer: coarse)').matches;
const iOS = /iPhone|iPad|iPod/i.test(navigator.userAgent || '');

let loadDone = 0;
let loadTotal = 19;

function setStatus(message) {
  if (renderStatus) renderStatus.textContent = message;
}

function updateLoader(label, { advance = false, total = null } = {}) {
  if (total) loadTotal = total;
  if (advance) loadDone++;
  const percent = Math.min(100, Math.round(loadDone / Math.max(1, loadTotal) * 100));
  if (loadBar) loadBar.style.width = `${percent}%`;
  if (loadPercent) loadPercent.textContent = `${percent}%`;
  if (loadAsset) loadAsset.textContent = label;
  setStatus(label);
}

function fatal(error) {
  const message = String(error?.message || error || 'Unknown startup error');
  console.error('Project Strike V10 fatal startup error:', error);
  setStatus(`V10 STARTUP ERROR · ${message.slice(0, 120)}`);
  if (runtimeError) {
    runtimeError.textContent = message;
    runtimeError.classList.add('show', 'fatal');
  }
  if (playButton) {
    playButton.disabled = true;
    playButton.textContent = 'FAILED';
  }
  globalThis.__PROJECT_STRIKE_DIAGNOSTICS__ = {
    ...(globalThis.__PROJECT_STRIKE_DIAGNOSTICS__ || {}),
    fatal: message,
    ready: false
  };
}

function fitModel(root, size = 0.18) {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const dimensions = bounds.getSize(new THREE.Vector3());
  const max = Math.max(dimensions.x, dimensions.y, dimensions.z, 0.0001);
  root.scale.multiplyScalar(size / max);
  root.updateMatrixWorld(true);
  const center = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3());
  root.position.sub(center);
  return root;
}

class StrictGrenades {
  constructor(scene, assets, audio, { mobile = false, flashElement = null } = {}) {
    this.scene = scene;
    this.assets = assets;
    this.audio = audio;
    this.mobile = mobile;
    this.flashElement = flashElement;
    this.templates = new Map();
    this.active = [];
    this.cooldown = 0;
  }

  async loadRequired(type, url) {
    const asset = await this.assets.loadModel(url, { clone: true, world: true, timeoutMs: 20000 });
    const model = fitModel(asset.scene, 0.18);
    model.traverse(node => {
      if (!node.isMesh) return;
      node.castShadow = !this.mobile;
      node.receiveShadow = true;
    });
    this.templates.set(type, model);
    return { type, url, report: asset.report, realRepositoryModel: true };
  }

  cloneRequired(type) {
    const template = this.templates.get(type);
    if (!template) throw new Error(`Required real ${type} grenade model is not loaded.`);
    return template.clone(true);
  }

  throw(type, camera) {
    if (this.cooldown > 0) return false;
    const mesh = this.cloneRequired(type);
    this.cooldown = 0.55;
    const position = new THREE.Vector3(0.18, -0.18, -0.48);
    camera.localToWorld(position);
    mesh.position.copy(position);
    this.scene.add(mesh);
    const direction = camera.getWorldDirection(new THREE.Vector3());
    const velocity = direction.multiplyScalar(type === 'flash' ? 11 : 10);
    velocity.y += 3.2;
    this.active.push({ type, mesh, velocity, life: type === 'flash' ? 1.45 : 2.25 });
    this.audio.playResident('weapons', { gain: 0.075, rate: 1.04 });
    return true;
  }

  flashPlayer(position, playerPosition) {
    const distance = position.distanceTo(playerPosition);
    const strength = THREE.MathUtils.clamp(1 - distance / 20, 0, 1);
    if (strength <= 0) return;
    if (this.flashElement) {
      this.flashElement.style.setProperty('--flash-strength', String(strength));
      this.flashElement.classList.remove('active');
      void this.flashElement.offsetWidth;
      this.flashElement.classList.add('active');
      setTimeout(() => this.flashElement.classList.remove('active'), 1500 + strength * 900);
    }
    this.audio.flashRing?.(strength);
    this.audio.setFlashMuffle?.(strength, 1.2 + strength * 1.4);
  }

  detonate(grenade, arena, playerPosition) {
    const position = grenade.mesh.position.clone();
    const light = new THREE.PointLight(grenade.type === 'flash' ? 0xffffff : 0xff8b3a, this.mobile ? 24 : 42, 16, 2);
    light.position.copy(position);
    this.scene.add(light);
    setTimeout(() => this.scene.remove(light), grenade.type === 'flash' ? 100 : 70);
    this.audio.playResident('explosions', { gain: grenade.type === 'flash' ? 0.45 : 0.66, position });
    if (grenade.type === 'flash') this.flashPlayer(position, playerPosition);
    else {
      for (const target of arena.targets) {
        if (!target.userData.alive) continue;
        const distance = target.position.distanceTo(position);
        if (distance >= 7.5) continue;
        target.userData.health -= Math.round((1 - distance / 7.5) * 130);
        if (target.userData.health <= 0) arena.killTarget(target, new THREE.Vector3().subVectors(target.position, position).normalize());
      }
    }
    this.scene.remove(grenade.mesh);
  }

  update(dt, arena, playerPosition) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    for (let i = this.active.length - 1; i >= 0; i--) {
      const grenade = this.active[i];
      grenade.life -= dt;
      grenade.velocity.y -= 9.81 * dt;
      grenade.mesh.position.addScaledVector(grenade.velocity, dt);
      grenade.mesh.rotation.x += 7.5 * dt;
      grenade.mesh.rotation.z += 5.5 * dt;
      if (grenade.mesh.position.y < 0.09) {
        grenade.mesh.position.y = 0.09;
        if (grenade.velocity.y < 0) {
          grenade.velocity.y = Math.abs(grenade.velocity.y) * 0.42;
          grenade.velocity.x *= 0.74;
          grenade.velocity.z *= 0.74;
          this.audio.playResident('collision', { gain: 0.035, position: grenade.mesh.position, rate: 0.9 + Math.random() * 0.2 });
        }
      }
      if (grenade.life <= 0) {
        this.detonate(grenade, arena, playerPosition);
        this.active.splice(i, 1);
      }
    }
  }
}

async function waitForBody(body, timeoutMs = 24000) {
  const startedAt = performance.now();
  while (!body.ready && !body.failed && performance.now() - startedAt < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!body.ready) {
    const detail = globalThis.__PROJECT_STRIKE_TRUE_BODY__?.error || globalThis.__PROJECT_STRIKE_TRUE_BODY__?.state || 'unknown';
    throw new Error(`Required real first-person body did not load: ${detail}`);
  }
  return body;
}

async function startRuntime() {
  globalThis.__PROJECT_STRIKE_RUNTIME_STARTED__ = true;
  if (globalThis.__PROJECT_STRIKE_BOOT__) globalThis.__PROJECT_STRIKE_BOOT__.phase = 'v10-runtime';

  updateLoader('Checking Safari WebGPU support…');
  if (!navigator.gpu) {
    throw new Error('WebGPU is required for Project Strike V10. Use Safari 26+ or another browser with WebGPU enabled.');
  }

  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: !touchDevice,
    alpha: false,
    depth: true,
    stencil: false,
    powerPreference: 'high-performance',
    forceWebGL: false,
    outputBufferType: iOS ? THREE.UnsignedByteType : THREE.HalfFloatType
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = iOS ? 1.28 : touchDevice ? 1.16 : 1.0;
  renderer.shadowMap.enabled = !touchDevice;
  updateLoader('Initializing real WebGPU renderer…');
  await renderer.init();
  if (!renderer.backend?.isWebGPUBackend) {
    throw new Error('The browser did not provide a WebGPU backend. V10 does not silently fall back to WebGL.');
  }
  updateLoader('WebGPU device ready', { advance: true });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050711);
  scene.fog = new THREE.FogExp2(0x0c111c, touchDevice ? 0.008 : 0.0065);
  const camera = new THREE.PerspectiveCamera(74, 1, 0.035, 240);
  camera.rotation.order = 'YXZ';

  const renderScale = iOS ? 0.82 : touchDevice ? 0.92 : 1.15;
  const audio = new RepositoryAudio();
  const clock = new THREE.Clock();
  const assets = new AssetManager(renderer, {
    timeoutMs: iOS ? 20000 : 24000,
    onProgress(event) {
      if (event.state !== 'loading') return;
      const file = String(event.url || '').split('/').pop() || 'asset';
      if (event.total) {
        const pct = Math.round(event.loaded / event.total * 100);
        updateLoader(`Loading real ${file} · ${pct}%`);
      } else updateLoader(`Loading real ${file}…`);
    }
  });
  globalThis.__PROJECT_STRIKE_ASSET_MANAGER__ = assets;

  updateLoader('Loading real industrial district…');
  const arena = await createRealisticDistrictV10(scene, assets, {
    mobile: touchDevice,
    onProgress(event) {
      if (event.state === 'ready') updateLoader(`Loaded ${event.label}`, { advance: true });
      else updateLoader(`Loading ${event.label}…`);
    }
  });

  const view = new FPSViewModelV10(camera, assets, { mobile: touchDevice });
  updateLoader('Loading rigged first-person arms…');
  await view.loadArms(DEFAULT_ARMS);
  updateLoader('Rigged first-person arms ready', { advance: true });

  const weaponStates = WEAPON_CATALOG.map(definition => ({
    ...definition,
    ammo: definition.mag,
    currentReserve: definition.reserve
  }));
  let weaponIndex = 0;
  let current = weaponStates[weaponIndex];
  updateLoader(`Loading real ${current.name} model and optic…`);
  await view.loadWeapon(current);
  updateLoader(`Real ${current.name} ready`, { advance: true });
  if (!view.diagnostics.ik?.active) throw new Error(`Weapon IK failed to bind: ${view.diagnostics.ik?.reason || 'unknown IK error'}`);
  updateLoader(`CCD hand IK ready · ${view.diagnostics.ik.activeChains} chain(s)`, { advance: true });

  const grenades = new StrictGrenades(scene, assets, audio, {
    mobile: touchDevice,
    flashElement: $('#flashOverlay')
  });
  updateLoader('Loading real frag grenade…');
  const fragReport = await grenades.loadRequired('frag', GRENADE_ASSETS.frag);
  updateLoader('Real frag grenade ready', { advance: true });
  updateLoader('Loading real flashbang…');
  const flashReport = await grenades.loadRequired('flash', GRENADE_ASSETS.flash);
  updateLoader('Real flashbang ready', { advance: true });

  updateLoader('Loading real skinned local body…');
  const body = new TrueBodyRig(scene, { mobile: touchDevice, groundMeshes: arena.surfaceMeshes });
  body.setVisible(false);
  await waitForBody(body);
  updateLoader('Real skinned local body ready', { advance: true });

  const vfx = new GPUWeaponVFX(renderer, scene, { mobile: touchDevice });
  updateLoader('Allocating WebGPU smoke and spark buffers…');
  await vfx.init();
  updateLoader('WebGPU compute weapon VFX ready', { advance: true });

  updateLoader('Indexing repository gunshot audio…');
  await audio.loadPermanent();
  updateLoader(`Indexed ${audio.indexedFiles} repository audio files`, { advance: true });

  // Compile the real world and foreground before Deploy so the first shot does
  // not trigger a large shader compilation hitch on the iPhone.
  updateLoader('Precompiling real WebGPU world shaders…');
  if (typeof renderer.compileAsync === 'function') {
    await renderer.compileAsync(scene, camera);
    await renderer.compileAsync(view.scene, view.camera);
  } else if (typeof renderer.compile === 'function') {
    await renderer.compile(scene, camera);
    await renderer.compile(view.scene, view.camera);
  }
  updateLoader('WebGPU shader compilation complete', { advance: true });

  const player = {
    pos: new THREE.Vector3(0, 1.85, 12),
    velocity: new THREE.Vector3(),
    moveVelocity: new THREE.Vector3(),
    slideVelocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eyeHeight: 1.72,
    crouch: false,
    slide: 0,
    grounded: true,
    reloading: false,
    ads: false,
    cooldown: 0,
    stepPhase: 0,
    recoilIndex: 0
  };
  const keys = {};
  const touch = {
    joy: { x: 0, y: 0 },
    joyPointer: null,
    lookPointer: null,
    lookX: 0,
    lookY: 0
  };
  let started = false;
  let firing = false;
  let switchingWeapon = false;
  let pointerADS = false;
  let fpsFrames = 0;
  let fpsElapsed = 0;

  function updateHUD() {
    $('#ammo').textContent = current.ammo;
    document.querySelector('.ammo span').textContent = `/ ${current.currentReserve}`;
    $('#weaponName').textContent = current.name;
    const nextButton = $('#switchBtn');
    if (nextButton) {
      let nextIndex = (weaponIndex + 1) % weaponStates.length;
      if (iOS && weaponStates[nextIndex]?.mobileHeavy) nextIndex = (nextIndex + 1) % weaponStates.length;
      nextButton.textContent = weaponStates[nextIndex]?.name || 'SWAP';
      nextButton.title = 'Switch to next real repository weapon';
    }
  }
  updateHUD();

  function collides(position) {
    const radius = 0.31;
    const feet = position.y - player.eyeHeight;
    const bounds = new THREE.Box3(
      new THREE.Vector3(position.x - radius, feet + 0.05, position.z - radius),
      new THREE.Vector3(position.x + radius, position.y + 0.08, position.z + radius)
    );
    return arena.colliders.some(collider => collider.intersectsBox(bounds));
  }

  function jump() {
    if (!player.grounded || player.crouch || player.slide > 0) return;
    player.grounded = false;
    player.velocity.y = 6.2;
  }

  function movementAxes() {
    const bridge = globalThis.__PROJECT_STRIKE_MOBILE_INPUT_BRIDGE__;
    const bridgeReady = Boolean(touchDevice && bridge?.analogAuthoritative);
    const x = bridgeReady && Number.isFinite(bridge?.x) ? bridge.x : touch.joy.x;
    const y = bridgeReady && Number.isFinite(bridge?.y) ? bridge.y : touch.joy.y;
    return { x, y, source: bridgeReady ? 'authoritative-mobile-bridge' : touch.joyPointer != null ? 'direct-pointer' : 'keyboard' };
  }

  function slideOrCrouch() {
    const movement = movementAxes();
    const moving = player.moveVelocity.length() > 1.1 || Math.hypot(movement.x, movement.y) > 0.62 || keys.KeyW;
    if (moving && !player.crouch && player.grounded) {
      player.slide = 0.62;
      player.crouch = true;
      player.slideVelocity.copy(player.moveVelocity);
      if (player.slideVelocity.length() < 3) {
        player.slideVelocity.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw)).multiplyScalar(7.4);
      }
      return;
    }
    player.crouch = !player.crouch;
  }

  function setFiring(value) {
    const next = Boolean(value);
    if (next === firing) return;
    firing = next;
    if (!started) return;
    audio.playWeaponMechanical(current.bank, {
      gain: next ? 0.055 : 0.085,
      rate: next ? 1.045 : 0.94
    });
  }

  async function switchWeapon(step = 1) {
    if (switchingWeapon || player.reloading) return false;
    switchingWeapon = true;
    setFiring(false);
    pointerADS = false;
    $('#statusText').textContent = 'SWITCHING WEAPON';
    const originalIndex = weaponIndex;
    const originalCurrent = current;
    let loaded = false;
    let lastError = null;
    for (let attempt = 1; attempt <= weaponStates.length; attempt++) {
      const candidateIndex = (originalIndex + step * attempt + weaponStates.length * 4) % weaponStates.length;
      const candidate = weaponStates[candidateIndex];
      if (iOS && candidate.mobileHeavy) continue;
      try {
        await view.loadWeapon(candidate);
        if (!view.diagnostics.ik?.active) throw new Error('IK did not bind after weapon switch');
        if (typeof renderer.compileAsync === 'function') await renderer.compileAsync(view.scene, view.camera);
        else await renderer.compile(view.scene, view.camera);
        weaponIndex = candidateIndex;
        current = candidate;
        player.recoilIndex = 0;
        loaded = true;
        audio.prewarm(current.bank).catch(() => {});
        updateHUD();
        $('#statusText').textContent = current.name;
        setTimeout(() => { if (started && !player.reloading) $('#statusText').textContent = 'READY'; }, 520);
        break;
      } catch (error) {
        lastError = error;
        console.warn('Real weapon switch candidate failed; trying next repository model.', candidate?.name, error);
      }
    }
    if (!loaded) {
      weaponIndex = originalIndex;
      current = originalCurrent;
      updateHUD();
      $('#statusText').textContent = 'WEAPON LOAD FAILED';
      console.error('No next repository weapon could be loaded.', lastError);
      setTimeout(() => { if (started) $('#statusText').textContent = 'READY'; }, 900);
    }
    switchingWeapon = false;
    return loaded;
  }

  function reload() {
    if (player.reloading || current.ammo === current.mag || current.currentReserve <= 0) return;
    player.reloading = true;
    $('#statusText').textContent = 'RELOADING';
    view.reload(event => {
      if (event === 'magOut' || event === 'magIn' || event === 'bolt') {
        audio.playWeaponMechanical(current.bank, { gain: event === 'bolt' ? 0.26 : 0.18 });
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

  function throwGrenade(type) {
    if (!started) return;
    view.playAuthored(/grenade|throw/i);
    grenades.throw(type, camera);
  }

  function hitmarker(head = false) {
    const marker = $('#hitmarker');
    marker.textContent = head ? '✕' : '×';
    marker.classList.add('show');
    setTimeout(() => marker.classList.remove('show'), 95);
  }

  function shotDirection(spread = 0) {
    const direction = view.barrelDirectionWorld(new THREE.Vector3());
    const cameraDirection = camera.getWorldDirection(new THREE.Vector3());
    // The real barrel is authoritative. ADS converges it almost exactly with
    // the camera sightline; hip fire retains physical weapon/free-aim offset.
    direction.lerp(cameraDirection, player.ads ? 0.9 : 0.3).normalize();
    if (spread > 0) {
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      direction.addScaledVector(right, (Math.random() - 0.5) * spread);
      direction.addScaledVector(up, (Math.random() - 0.5) * spread);
      direction.normalize();
    }
    return direction;
  }

  function applyAimRecoil() {
    const pattern = current.pattern?.[player.recoilIndex % current.pattern.length] || [1, 0];
    player.recoilIndex++;
    const strength = current.recoil || 1;
    // This is the only camera/aim recoil owner in V10. It changes the player's
    // intended aim by a small deterministic amount; no presentation system
    // adds cumulative camera Euler rotations afterward.
    player.pitch = THREE.MathUtils.clamp(player.pitch - 0.0058 * strength * pattern[0], -1.43, 1.43);
    player.yaw -= 0.0042 * strength * pattern[1];
  }

  function shoot() {
    if (!started || player.reloading || player.cooldown > 0 || current.ammo <= 0) return;
    player.cooldown = 60 / current.fireRate;
    current.ammo--;
    updateHUD();
    applyAimRecoil();
    view.recoil(current.recoil);
    audio.playWeaponShot(current.bank, { gain: current.suppressed ? 0.58 : 0.82 });
    setTimeout(() => {
      if (started) audio.playWeaponMechanical(current.bank, { gain: current.class === 'pistol' ? 0.085 : 0.11, rate: 0.96 + Math.random() * 0.05 });
    }, current.class === 'pistol' ? 22 : 34);

    const muzzle = view.muzzleWorld(new THREE.Vector3());
    const baseDirection = shotDirection(0);
    vfx.fire(muzzle, baseDirection, current.recoil || 1);

    const pellets = current.pellets || 1;
    const spread = current.class === 'shotgun' ? 0.05 : player.ads ? 0.0014 : 0.004;
    let confirmedTarget = null;
    let headshot = false;
    for (let i = 0; i < pellets; i++) {
      const direction = shotDirection(spread);
      const ray = new THREE.Raycaster(muzzle, direction, 0.02, 220);
      const living = arena.targets.filter(target => target.userData.alive);
      const hit = ray.intersectObjects([...arena.surfaceMeshes, ...living], true)[0];
      if (!hit) continue;
      const target = hit.object.userData.target;
      if (target?.userData?.alive) {
        const head = hit.object.userData.hitZone === 'head';
        target.userData.health -= head ? Math.max(100, current.damage * 2.2) : current.damage;
        confirmedTarget = target;
        headshot ||= head;
        if (target.userData.health <= 0) arena.killTarget(target, direction);
      }
    }
    if (confirmedTarget) {
      hitmarker(headshot);
      $('#statusText').textContent = headshot ? 'HEADSHOT' : confirmedTarget.userData.alive ? 'HIT' : 'TARGET DOWN';
      setTimeout(() => {
        if (started && !player.reloading) $('#statusText').textContent = 'READY';
      }, 420);
    }
  }

  function bindInput() {
    addEventListener('keydown', event => {
      keys[event.code] = true;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
      if (event.code === 'Space') jump();
      if (event.code === 'KeyR') reload();
      if (event.code === 'KeyC' || event.code === 'ControlLeft') slideOrCrouch();
      if (event.code === 'KeyG') throwGrenade('frag');
      if (event.code === 'KeyV') throwGrenade('flash');
      if (event.code === 'KeyQ') switchWeapon(1).catch(error => console.error('Weapon switch failed.', error));
    });
    addEventListener('keyup', event => { keys[event.code] = false; });
    addEventListener('mousemove', event => {
      if (document.pointerLockElement !== canvas) return;
      player.yaw -= event.movementX * 0.00205;
      player.pitch = THREE.MathUtils.clamp(player.pitch - event.movementY * 0.00205, -1.43, 1.43);
    });
    addEventListener('mousedown', event => {
      if (event.button === 0) setFiring(true);
      if (event.button === 2) pointerADS = true;
    });
    addEventListener('mouseup', event => {
      if (event.button === 0) setFiring(false);
      if (event.button === 2) pointerADS = false;
    });
    addEventListener('contextmenu', event => event.preventDefault());

    const pad = $('#leftPad');
    const stick = pad.querySelector('.stick');
    const resetPad = pointerId => {
      if (pointerId != null && touch.joyPointer !== pointerId) return;
      touch.joyPointer = null;
      touch.joy = { x: 0, y: 0 };
      stick.style.transform = 'translate3d(0,0,0)';
    };
    pad.addEventListener('pointerdown', event => {
      if (touch.joyPointer != null) return;
      touch.joyPointer = event.pointerId;
      try { pad.setPointerCapture?.(event.pointerId); } catch {}
      event.preventDefault();
    });
    pad.addEventListener('pointermove', event => {
      if (event.pointerId !== touch.joyPointer) return;
      event.preventDefault();
      const rect = pad.getBoundingClientRect();
      const dx = event.clientX - (rect.left + rect.width / 2);
      const dy = event.clientY - (rect.top + rect.height / 2);
      const radius = Math.max(30, Math.min(rect.width, rect.height) * 0.32);
      const distance = Math.min(radius, Math.hypot(dx, dy));
      const angle = Math.atan2(dy, dx);
      touch.joy = { x: Math.cos(angle) * distance / radius, y: Math.sin(angle) * distance / radius };
      stick.style.transform = `translate3d(${touch.joy.x * radius}px,${touch.joy.y * radius}px,0)`;
    });
    pad.addEventListener('pointerup', event => resetPad(event.pointerId));
    pad.addEventListener('pointercancel', event => resetPad(event.pointerId));
    pad.addEventListener('lostpointercapture', event => resetPad(event.pointerId));

    const lookZone = $('#lookZone');
    lookZone.addEventListener('pointerdown', event => {
      if (touch.lookPointer != null) return;
      touch.lookPointer = event.pointerId;
      touch.lookX = event.clientX;
      touch.lookY = event.clientY;
      try { lookZone.setPointerCapture?.(event.pointerId); } catch {}
      event.preventDefault();
    });
    lookZone.addEventListener('pointermove', event => {
      if (event.pointerId !== touch.lookPointer) return;
      event.preventDefault();
      const dx = event.clientX - touch.lookX;
      const dy = event.clientY - touch.lookY;
      touch.lookX = event.clientX;
      touch.lookY = event.clientY;
      player.yaw -= dx * 0.004;
      player.pitch = THREE.MathUtils.clamp(player.pitch - dy * 0.004, -1.43, 1.43);
    });
    const resetLook = event => {
      if (event.pointerId !== touch.lookPointer) return;
      touch.lookPointer = null;
    };
    lookZone.addEventListener('pointerup', resetLook);
    lookZone.addEventListener('pointercancel', resetLook);
    lookZone.addEventListener('lostpointercapture', resetLook);

    const hold = (element, on, off) => {
      element.addEventListener('pointerdown', event => {
        event.preventDefault();
        try { element.setPointerCapture?.(event.pointerId); } catch {}
        on();
      });
      element.addEventListener('pointerup', event => {
        event.preventDefault();
        off?.();
      });
      element.addEventListener('pointercancel', () => off?.());
      element.addEventListener('lostpointercapture', () => off?.());
    };
    hold($('#fireBtn'), () => setFiring(true), () => setFiring(false));
    hold($('#adsBtn'), () => { pointerADS = true; }, () => { pointerADS = false; });
    $('#reloadBtn').onclick = reload;
    $('#jumpBtn').onclick = jump;
    $('#slideBtn').onclick = slideOrCrouch;
    $('#fragBtn').onclick = () => throwGrenade('frag');
    $('#flashBtn').onclick = () => throwGrenade('flash');
    $('#switchBtn').onclick = () => { switchWeapon(1).catch(error => console.error('Weapon switch failed.', error)); };

    canvas.addEventListener('click', () => {
      if (started && matchMedia('(pointer:fine)').matches && document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
    });
  }

  function updatePlayer(dt) {
    player.ads = pointerADS;
    const forward = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    const right = new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
    const movement = movementAxes();
    let x = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + movement.x;
    let y = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) - movement.y;
    const inputLength = Math.hypot(x, y);
    if (inputLength > 1) {
      x /= inputLength;
      y /= inputLength;
    }
    const direction = right.clone().multiplyScalar(x).add(forward.clone().multiplyScalar(y));
    const sprint = Boolean((keys.ShiftLeft || keys.ShiftRight || inputLength > 0.93) && y > 0.15 && !player.ads && player.slide <= 0);
    const speed = player.crouch ? 2.45 : sprint ? 7.05 : 4.55;
    let desired = direction.multiplyScalar(speed);

    if (player.slide > 0) {
      player.slide = Math.max(0, player.slide - dt);
      desired = player.slideVelocity.clone();
      player.slideVelocity.multiplyScalar(Math.exp(-2.8 * dt));
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

    if (!player.grounded) {
      player.velocity.y -= 18.5 * dt;
      player.pos.y += player.velocity.y * dt;
      const floorHeight = player.eyeHeight + 0.13;
      if (player.pos.y <= floorHeight) {
        player.pos.y = floorHeight;
        player.velocity.y = 0;
        player.grounded = true;
      }
    }

    const targetHeight = player.slide > 0 ? 0.98 : player.crouch ? 1.22 : 1.72;
    player.eyeHeight = THREE.MathUtils.damp(player.eyeHeight, targetHeight, player.slide > 0 ? 18 : 12, dt);
    if (player.grounded) player.pos.y = player.eyeHeight + 0.13;

    const horizontalSpeed = player.moveVelocity.length();
    if (player.grounded && horizontalSpeed > 0.32) {
      const cadence = sprint ? 2.35 : player.crouch ? 1.35 : 1.82;
      player.stepPhase += horizontalSpeed * cadence * dt;
    }
    const moveBlend = THREE.MathUtils.clamp(horizontalSpeed / 5.3, 0, 1);
    const step = Math.sin(player.stepPhase);
    const lateral = Math.sin(player.stepPhase * 0.5);
    const bobY = horizontalSpeed > 0.32 ? (Math.abs(step) - 0.45) * 0.018 * moveBlend : 0;
    const bobX = horizontalSpeed > 0.32 ? lateral * 0.009 * moveBlend : 0;

    camera.position.copy(player.pos).addScaledVector(right, bobX);
    camera.position.y += bobY;
    // V10 rewrites all Euler components from authoritative player state every
    // frame. There is no += recoil/shake path that can accumulate a rotation.
    camera.rotation.set(player.pitch, player.yaw, player.slide > 0 ? -0.055 * (player.slide / 0.62) : 0, 'YXZ');
    const targetFov = player.ads ? 56 : sprint ? 79 : 74;
    camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 11, dt);
    camera.updateProjectionMatrix();

    view.setADS(player.ads);
    view.update(dt, {
      time: performance.now() * 0.001,
      speed: horizontalSpeed,
      sprint,
      crouch: player.crouch,
      slide: player.slide,
      yaw: player.yaw,
      pitch: player.pitch,
      stepPhase: player.stepPhase,
      airborne: !player.grounded
    });
    body.setVisible(true);
    body.update(dt, {
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
      landImpulse: 0
    });

    globalThis.__PROJECT_STRIKE_PLAYER_STATE__ = {
      position: player.pos.toArray(),
      velocity: player.moveVelocity.toArray(),
      joy: { x: movement.x, y: movement.y },
      movementSource: movement.source,
      yaw: player.yaw,
      pitch: player.pitch,
      moving: horizontalSpeed > 0.12,
      movementInputActive: inputLength > 0.05
    };
  }

  function resize() {
    const viewport = window.visualViewport;
    const width = Math.max(1, Math.round(viewport?.width || document.documentElement.clientWidth || innerWidth));
    const height = Math.max(1, Math.round(viewport?.height || document.documentElement.clientHeight || innerHeight));
    renderer.setPixelRatio(renderScale);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    document.documentElement.style.setProperty('--app-height', `${height}px`);
  }

  bindInput();
  resize();
  addEventListener('resize', resize, { passive: true });
  addEventListener('orientationchange', () => setTimeout(resize, 100), { passive: true });
  window.visualViewport?.addEventListener('resize', resize, { passive: true });

  loadDone = loadTotal;
  updateLoader('ALL REQUIRED REAL ASSETS READY · WEBGPU READY');
  if (loadBar) loadBar.style.width = '100%';
  if (loadPercent) loadPercent.textContent = '100%';
  if (loadAsset) loadAsset.textContent = 'Real models, IK, grenades and WebGPU shaders are resident';

  globalThis.__PROJECT_STRIKE_DIAGNOSTICS__ = {
    runtime: 'v10.1',
    ready: true,
    renderer: 'WebGPU',
    webGPUBackend: true,
    noRenderingFallback: true,
    noProceduralAssetFallbacks: true,
    recoilOwner: 'deterministic-player-aim + bounded-viewmodel-kick',
    cumulativeCameraShake: false,
    mobilePointerMovement: 'authoritative-analog-bridge',
    frameDriver: 'requestAnimationFrame-after-webgpu-init',
    simulationDriver: 'fixed-timer-independent-of-render',
    realRepositoryModels: true,
    requiredWorldModels: arena.required,
    worldVisible: true,
    worldLighting: arena.lighting,
    weaponSwitching: 'real-repository-models',
    audioEnvironment: 'industrial-convolution',
    arms: view.diagnostics.arms,
    weapon: view.diagnostics.weapon,
    ik: view.diagnostics.ik,
    frag: fragReport,
    flash: flashReport,
    trueBody: globalThis.__PROJECT_STRIKE_TRUE_BODY__,
    gpuVfx: globalThis.__PROJECT_STRIKE_GPU_VFX__,
    renderScale,
    iOS
  };
  $('#stageBadge').textContent = 'V10.1';
  playButton.disabled = false;
  playButton.textContent = 'DEPLOY';
  setStatus('READY · WEBGPU · REAL ASSETS');

  let simulationLast = performance.now();
  let simulationTicks = 0;
  function simulationTick() {
    const now = performance.now();
    const dt = Math.min(1 / 30, Math.max(1 / 240, (now - simulationLast) / 1000));
    simulationLast = now;
    if (started) {
      updatePlayer(dt);
      player.cooldown = Math.max(0, player.cooldown - dt);
      if (firing) shoot();
      grenades.update(dt, arena, player.pos);
      simulationTicks++;
      if (globalThis.__PROJECT_STRIKE_DIAGNOSTICS__) {
        globalThis.__PROJECT_STRIKE_DIAGNOSTICS__.simulationTicks = simulationTicks;
        globalThis.__PROJECT_STRIKE_DIAGNOSTICS__.lastSimulationAt = now;
      }
    }
  }
  const simulationTimer = setInterval(simulationTick, 1000 / 60);
  addEventListener('pagehide', () => clearInterval(simulationTimer), { once: true });

  playButton.onclick = async () => {
    await audio.unlock();
    audio.setEnvironment?.('industrial');
    audio.prewarm(current.bank).catch(() => {});
    started = true;
    player.recoilIndex = 0;
    $('#boot').classList.add('hidden');
    $('#hud').classList.remove('hidden');
    $('#statusText').textContent = 'READY';
    body.setVisible(true);
    if (matchMedia('(pointer:fine)').matches) canvas.requestPointerLock?.();
  };

  let frameHandle = 0;
  let frameFatal = false;
  function frame() {
    if (frameFatal) return;
    // renderer.init() completed above, so Three.js supports an ordinary rAF
    // driver here. Schedule the successor before WebGPU work so gameplay input
    // cannot silently stop at the loading -> Deploy transition.
    frameHandle = requestAnimationFrame(frame);
    const dt = Math.min(1 / 30, clock.getDelta());
    if (!started) {
      camera.position.set(0, 2.05, 13);
      camera.rotation.set(-0.025, 0, 0, 'YXZ');
      view.update(dt, { time: performance.now() * 0.001, speed: 0, stepPhase: 0 });
    }
    arena.update(dt, performance.now() * 0.001);
    vfx.update(dt);

    try {
      renderer.autoClear = true;
      renderer.render(scene, camera);
      renderer.autoClear = false;
      renderer.clearDepth();
      if (!switchingWeapon) view.render(renderer);
      renderer.autoClear = true;
    } catch (error) {
      frameFatal = true;
      cancelAnimationFrame(frameHandle);
      fatal(error);
      return;
    }

    fpsFrames++;
    fpsElapsed += dt;
    if (fpsElapsed >= 0.5) {
      $('#fps').textContent = `${Math.round(fpsFrames / fpsElapsed)} FPS`;
      fpsFrames = 0;
      fpsElapsed = 0;
    }
  }
  frame();
}

startRuntime().catch(fatal);
