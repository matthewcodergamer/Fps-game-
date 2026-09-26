import { Scene } from '@babylonjs/core/scene.js';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import '@babylonjs/core/Physics/physicsEngineComponent.js';
import { loadSettings, saveSettings, LIGHTING_PRESETS } from './core/Settings.js';
import { detectDeviceProfile, describeProfile } from './core/DeviceProfile.js';
import { createStrikeEngine } from './core/createEngine.js';
import { PerformanceGovernor } from './core/PerformanceGovernor.js';
import { enableHavok } from './physics/HavokWorld.js';
import { InputRouter } from './player/InputRouter.js';
import { StrikeCharacterController } from './player/StrikeCharacterController.js';
import { CameraRig } from './player/CameraRig.js';
import { MaterialLibrary } from './render/MaterialLibrary.js';
import { PostFXStack } from './render/PostFXStack.js';
import { LightingDirector } from './lighting/LightingDirector.js';
import { createVerticalSlice } from './world/createVerticalSlice.js';
import { createM4Prototype } from './weapons/createM4Prototype.js';
import { CombatVFX } from './vfx/CombatVFX.js';
import { RifleSystem } from './weapons/RifleSystem.js';
import { EnemyAgent } from './ai/EnemyAgent.js';
import { GrenadeSystem } from './physics/GrenadeSystem.js';
import { HUD } from './ui/HUD.js';
import { validateWeaponContract } from './assets/AssetContract.js';

const VERSION = '11.1.0';
const hud = new HUD();
window.__PROJECT_STRIKE_BOOT_STAGE__ = 'module-loaded';

const stage = (percent, text) => { window.__PROJECT_STRIKE_BOOT_STAGE__ = text; hud.progress(percent, text); };
// Let the browser paint the progress bar between heavy synchronous steps (world build, material generation).
const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));

// Minimal bodycam feed overlay (REC + timestamp) until the full Cyberpunk HUD lands.
function ensureBodycamOverlay() {
  let el = document.querySelector('#bodycamOverlay');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'bodycamOverlay';
  el.className = 'hidden';
  el.style.cssText = 'position:absolute;top:calc(var(--safe-t) + 44px);right:18px;font:600 12px/1.4 ui-monospace,Menlo,monospace;color:#f2f2f2;text-align:right;text-shadow:0 1px 3px #000;letter-spacing:.06em;pointer-events:none';
  el.innerHTML = '<div><span style="color:#ff3b30">●</span> REC</div><div data-clock></div><div>BODYCAM · UNIT 07</div>';
  document.querySelector('#hud')?.appendChild(el);
  return el;
}

async function boot() {
  await window.__PROJECT_STRIKE_PREBOOT__;
  const canvas = document.querySelector('#game');
  const settings = loadSettings();
  stage(6, 'Detecting GPU and device class…');
  const profile = await detectDeviceProfile(settings);
  hud.capability(profile);
  stage(14, 'Initializing Babylon WebGPU engine…');
  const engine = await createStrikeEngine(canvas, profile);

  stage(22, 'Creating scene graph…');
  const scene = new Scene(engine);
  scene.skipPointerMovePicking = true;
  scene.autoClear = true;
  scene.setRenderingAutoClearDepthStencil(1, true); // viewmodel group never clips into walls
  const camera = new UniversalCamera('fps-camera', new Vector3(0, 1.7, 9), scene);
  camera.minZ = 0.03; camera.maxZ = 500; camera.inputs.clear();
  scene.activeCamera = camera;

  stage(30, 'Starting Havok physics…');
  await enableHavok(scene);
  hud.physicsReady();

  stage(40, 'Generating procedural materials…');
  await nextFrame();
  const materials = new MaterialLibrary(scene, profile);
  stage(50, 'Building the Night City street…');
  await nextFrame();
  const world = createVerticalSlice(scene, profile, materials);

  stage(60, 'Lighting: neon, shadows, sky, reflections…');
  await nextFrame();
  const lighting = new LightingDirector(scene, camera, profile, world, materials);
  const post = new PostFXStack(scene, camera, profile);
  let governor = null;
  const applyLighting = name => {
    const preset = LIGHTING_PRESETS.includes(name) ? name : 'NIGHT_CITY';
    post.applyGrade(lighting.apply(preset));
    post.setGodRaysSource(lighting.getSunScreenMesh());
    settings.lighting = preset;
    governor?.settle(1.5);
    return preset;
  };

  stage(70, 'Player controller, camera rig and controls…');
  await nextFrame();
  const player = new StrikeCharacterController(scene, camera, world.spawn);
  const rig = new CameraRig(camera, profile, settings);
  const input = new InputRouter(canvas, settings);
  const bodycamOverlay = ensureBodycamOverlay();
  const bodycamClock = bodycamOverlay.querySelector('[data-clock]');
  const setCamera = mode => {
    const m = mode === 'BODYCAM' ? 'BODYCAM' : 'STANDARD';
    rig.setMode(m);
    post.setBodycam(m === 'BODYCAM');
    bodycamOverlay.classList.toggle('hidden', m !== 'BODYCAM');
    settings.camera = m;
    governor?.settle(1.5);
    return m;
  };

  stage(80, 'Rifle, combat effects and hostiles…');
  await nextFrame();
  const weapon = createM4Prototype(scene, camera, materials);
  validateWeaponContract(weapon);
  const vfx = new CombatVFX(scene, weapon.sockets.muzzle);
  const rifle = new RifleSystem(scene, camera, weapon, vfx, hud);
  const grenade = new GrenadeSystem(scene, camera);
  const enemy = new EnemyAgent(scene);
  lighting.addShadowCaster(enemy.root);

  governor = new PerformanceGovernor(engine, profile, {
    onShed: level => { post.setShedLevel(level); lighting.setShedLevel(level); },
  });
  if (settings.ci) governor.lock(true);
  applyLighting(settings.lighting);
  setCamera(settings.camera);

  stage(90, 'Compiling GPU shaders (first launch takes longest)…');
  await scene.whenReadyAsync();
  materials.freezeAll();
  hud.ready();
  window.__PROJECT_STRIKE_BOOT_STAGE__ = 'ready';

  let running = false;
  const enter = () => {
    hud.enter(); running = true; canvas.focus();
    if (matchMedia('(pointer:fine)').matches) input.requestPointerLock?.();
    governor.settle(2);
  };
  hud.deploy.addEventListener('click', enter, { once: true });

  let debugFireUntil = 0;
  let last = performance.now(), frames = 0, accum = 0, lastShots = 0;
  const weaponState = { ads: 0, fovMul: 1, kick: { pitch: 0.55, yaw: 0.18, roll: 0.35 }, kickUnits: 'deg', fired: 0 };
  const postState = { speed: 0, ads: 0, shake: 0 };
  engine.runRenderLoop(() => {
    const now = performance.now();
    if (!governor.shouldRender(now)) return;
    const frameSec = (now - last) / 1000; last = now;
    governor.update(frameSec);
    const dt = Math.min(0.05, frameSec || 1 / 60);

    const sample = input.sample();
    if (!running) sample.fire = sample.jump = sample.reload = sample.grenade = false;
    if (now < debugFireUntil) sample.fire = true;
    if (sample.cycleLighting) window.__PROJECT_STRIKE_DEBUG__.setLighting(LIGHTING_PRESETS[(LIGHTING_PRESETS.indexOf(settings.lighting) + 1) % LIGHTING_PRESETS.length]);
    if (sample.toggleBodycam) window.__PROJECT_STRIKE_DEBUG__.setCamera(settings.camera === 'BODYCAM' ? 'STANDARD' : 'BODYCAM');

    const p = player.update(dt, sample, { adsAmount: rifle.ads });
    const recoil = rifle.update(dt, sample);
    weaponState.ads = recoil.ads;
    weaponState.fovMul = 1 - 0.2 * recoil.ads;
    weaponState.fired = rifle.shots - lastShots; lastShots = rifle.shots;
    rig.update(dt, p, weaponState, null);
    if (sample.grenade) grenade.throw();
    grenade.update(dt);
    enemy.update(dt, p);
    lighting.update(dt);
    postState.speed = p.speed; postState.ads = recoil.ads; postState.shake = rig.shake;
    post.update(dt, postState);
    hud.setState(p.state);
    scene.render();

    frames++; accum += frameSec;
    if (accum >= 0.5) {
      if (settings.camera === 'BODYCAM' && bodycamClock) bodycamClock.textContent = new Date().toISOString().replace('T', ' ').slice(0, 19);
      hud.updateDiagnostics({ fps: frames / accum, quality: `${profile.tier} ${governor.pixelRatio.toFixed(2)}x`, state: p.state, shots: rifle.shots, draws: engine._drawCalls?.current ?? 0, meshes: scene.meshes.length });
      frames = 0; accum = 0;
    }
  });
  addEventListener('resize', () => engine.resize(), { passive: true });

  const status = window.__PROJECT_STRIKE_REBOOT__ = {
    engine: 'Babylon.js', renderer: 'WebGPU', physics: 'Havok', characterController: 'PhysicsCharacterController',
    platform: profile.platform, tier: profile.tier, quality: profile.tier, profile: describeProfile(profile),
    lighting: settings.lighting, camera: settings.camera, passes: post.describe(), ready: true, version: VERSION,
    get glslFallbackUsed() { return Boolean(engine._glslangAndTintAreFullyLoaded || engine._workingGlslangAndTintPromise); },
  };
  window.__PROJECT_STRIKE_DEBUG__ = {
    setLighting(name) { const v = applyLighting(name); status.lighting = v; status.passes = post.describe(); saveSettings(settings); return v; },
    setCamera(mode) { const v = setCamera(mode); status.camera = v; status.passes = post.describe(); saveSettings(settings); return v; },
    fire(ms = 500) { debugFireUntil = performance.now() + ms; },
    getState: () => ({ lighting: settings.lighting, camera: settings.camera, ammo: rifle.mag, tier: profile.tier, platform: profile.platform, passes: post.describe(), fps: governor.fps }),
  };
}

boot().catch(error => {
  console.error(error);
  hud.fail(error);
  window.__PROJECT_STRIKE_BOOT_STAGE__ = 'failed';
  window.__PROJECT_STRIKE_REBOOT__ = { ready: false, error: String(error?.message || error) };
});
