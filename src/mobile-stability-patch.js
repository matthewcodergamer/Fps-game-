import * as THREE from 'three';
import { AssetManager } from './assets/AssetManager.js';
import { RepositoryAudio } from './audio/RepositoryAudio.js';
import { GrenadeController } from './gameplay/CombatSystems.js';
import { FPSViewModel } from './weapons/FPSViewModel.js';

const ua = navigator.userAgent || '';
const ios = /iPhone|iPad|iPod/i.test(ua);
const coarse = matchMedia('(any-pointer: coarse)').matches;
const mobileSafe = ios && coarse;
const survivalMode = mobileSafe;
const CRASH_KEY = 'project-strike-ios-restart-count-v8';
let restartCount = 0;
let blockedModelLoads = 0;

if (mobileSafe) {
  try {
    restartCount = Math.min(4, Number(sessionStorage.getItem(CRASH_KEY) || 0) + 1);
    sessionStorage.setItem(CRASH_KEY, String(restartCount));
  } catch {}
}

const emergency = mobileSafe && restartCount >= 2;
globalThis.__PROJECT_STRIKE_MOBILE_SAFE__ = mobileSafe;
globalThis.__PROJECT_STRIKE_IOS_SURVIVAL__ = survivalMode;
globalThis.__PROJECT_STRIKE_EMERGENCY_MODE__ = emergency;
globalThis.__PROJECT_STRIKE_CORE_READY__ = false;

async function claimFreshWorker() {
  const state = { attempted: false, previous: null, controllerChanged: false, version: 'v10' };
  if (!mobileSafe || !('serviceWorker' in navigator)) return state;
  state.attempted = true;
  state.previous = navigator.serviceWorker.controller?.scriptURL || null;
  try {
    const registration = await navigator.serviceWorker.register('./service-worker.js?v=10', { updateViaCache: 'none' });
    await registration.update();
    if (state.previous && !state.previous.includes('v=10')) {
      await Promise.race([
        new Promise(resolve => {
          const onChange = () => {
            navigator.serviceWorker.removeEventListener('controllerchange', onChange);
            state.controllerChanged = true;
            resolve();
          };
          navigator.serviceWorker.addEventListener('controllerchange', onChange, { once: true });
        }),
        new Promise(resolve => setTimeout(resolve, 1800))
      ]);
    }
  } catch (error) {
    console.info('V10 worker preflight unavailable; survival boot remains active.', error);
  }
  return state;
}

// The real iPhone 11 screenshots show Safari dying while decoding the optic GLB.
// V8 therefore does not attempt *any* repository model decode on iOS. The
// existing procedural arena, operators, weapon and arm recovery paths become
// the authoritative first boot. Desktop keeps all repository models.
const workerUpgrade = await claimFreshWorker();
const modelExtension = /\.(?:glb|gltf|fbx)(?:[?#].*)?$/i;
const loadModel = AssetManager.prototype.loadModel;
AssetManager.prototype.loadModel = function (url, options = {}) {
  const value = String(url || '');
  if (survivalMode && modelExtension.test(value)) {
    blockedModelLoads++;
    globalThis.__PROJECT_STRIKE_BLOCKED_MODEL_LOADS__ = blockedModelLoads;
    const error = new Error(`iOS survival boot: repository model deferred (${value.split('/').pop()})`);
    error.name = 'IOSSurvivalModelDeferredError';
    return Promise.reject(error);
  }
  return loadModel.call(this, url, options);
};

// Optics and grenade presentation assets have procedural fallbacks already.
const loadAttachment = FPSViewModel.prototype.loadAttachment;
FPSViewModel.prototype.loadAttachment = function (url) {
  if (survivalMode) {
    this.diagnostics.attachment = { skipped: true, reason: 'ios-survival-zero-model-boot', url };
    return Promise.resolve(false);
  }
  return loadAttachment.call(this, url);
};

const grenadeInit = GrenadeController.prototype.init;
GrenadeController.prototype.init = function (assets) {
  if (survivalMode) {
    this._v8DeferredAssets = assets;
    return Promise.resolve(this);
  }
  return grenadeInit.call(this, assets);
};

// Do not pre-decode audio banks during the vulnerable startup transition.
// AudioContext still unlocks from the user's Deploy gesture; individual sounds
// can be loaded lazily later without holding a model decoder graph at the same time.
const repositoryPrewarm = RepositoryAudio.prototype.prewarm;
RepositoryAudio.prototype.prewarm = function (...args) {
  if (survivalMode) {
    return Promise.resolve({ weapon: 0, collision: 0, explosions: 0, weapons: 0, indexed: this.indexedFiles, warming: true, survivalMode: true });
  }
  return repositoryPrewarm.apply(this, args);
};

if (survivalMode) {
  const setPixelRatio = THREE.WebGLRenderer.prototype.setPixelRatio;
  THREE.WebGLRenderer.prototype.setPixelRatio = function (value) {
    const cap = emergency ? .60 : .70;
    return setPixelRatio.call(this, Math.min(Number(value) || 1, cap));
  };

  // PMREM allocates multiple offscreen cube faces. Direct lights are retained.
  THREE.PMREMGenerator.prototype.fromScene = function () {
    return { texture: null, dispose() {} };
  };

  // Disable shadow-map allocation before the first real render. Arena meshes and
  // lighting remain visible, but Safari does not need a 1024px shadow texture.
  const render = THREE.WebGLRenderer.prototype.render;
  THREE.WebGLRenderer.prototype.render = function (...args) {
    if (this.shadowMap) this.shadowMap.enabled = false;
    return render.apply(this, args);
  };
}

const readyTimer = setInterval(() => {
  const button = document.querySelector('#playBtn');
  if (!button || button.disabled) return;
  globalThis.__PROJECT_STRIKE_CORE_READY__ = true;
  clearInterval(readyTimer);
}, 80);
setTimeout(() => clearInterval(readyTimer), 60_000);

function enforceV8Identity() {
  const diagnostics = globalThis.__PROJECT_STRIKE_DIAGNOSTICS__;
  if (diagnostics) {
    Object.assign(diagnostics, {
      runtime: 'v8',
      iosSurvivalBoot: survivalMode,
      zeroModelStartup: survivalMode,
      largeAssetCacheDisabled: true,
      productionServiceWorker: 'v10'
    });
  }
  const badge = document.querySelector('#stageBadge');
  if (badge && badge.textContent !== 'V8') badge.textContent = 'V8';
}

// Older Stage 3/V4 layers still publish their own historical badge while they
// initialize. V8 is the authoritative outer runtime, so keep its visible and
// diagnostic identity stable throughout startup instead of setting it only once.
enforceV8Identity();
const identityTimer = setInterval(enforceV8Identity, 200);
setTimeout(() => {
  enforceV8Identity();
  clearInterval(identityTimer);
}, 90_000);

const badge = document.querySelector('#stageBadge');
if (badge && 'MutationObserver' in globalThis) {
  const badgeObserver = new MutationObserver(() => {
    if (badge.textContent !== 'V8') badge.textContent = 'V8';
  });
  badgeObserver.observe(badge, { childList: true, characterData: true, subtree: true });
  setTimeout(() => {
    enforceV8Identity();
    badgeObserver.disconnect();
  }, 90_000);
}

const stableTimer = setInterval(() => {
  const boot = document.querySelector('#boot');
  if (!mobileSafe || !boot?.classList.contains('hidden')) return;
  clearInterval(stableTimer);
  setTimeout(() => {
    try { sessionStorage.removeItem(CRASH_KEY); } catch {}
  }, 20_000);
}, 500);
setTimeout(() => clearInterval(stableTimer), 120_000);

globalThis.__PROJECT_STRIKE_MOBILE_STABILITY__ = {
  ios,
  mobileSafe,
  survivalMode,
  emergency,
  restartCount,
  workerUpgrade,
  maxConcurrentModelDecodes: survivalMode ? 0 : 3,
  initialRepositoryModelLoads: survivalMode ? 0 : null,
  initialEnterableBuildings: survivalMode ? 0 : 8,
  operatorFallback: survivalMode,
  viewModelFallback: survivalMode,
  opticFallback: survivalMode,
  grenadeFallback: survivalMode,
  heavyWorldPropsDeferred: survivalMode,
  pmremDisabled: survivalMode,
  shadowMapsDisabled: survivalMode,
  audioPrewarmDisabled: survivalMode,
  renderScaleCap: survivalMode ? (emergency ? .60 : .70) : null,
  largeAssetCacheDisabled: true,
  blockedModelLoads
};
