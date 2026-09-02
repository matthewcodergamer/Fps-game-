import * as THREE from 'three';
import { AssetManager } from './assets/AssetManager.js';
import { GrenadeController } from './gameplay/CombatSystems.js';
import { FPSViewModel } from './weapons/FPSViewModel.js';

const ua = navigator.userAgent || '';
const ios = /iPhone|iPad|iPod/i.test(ua);
const coarse = matchMedia('(any-pointer: coarse)').matches;
const mobileSafe = ios && coarse;
const CRASH_KEY = 'project-strike-ios-restart-count-v7';
let restartCount = 0;

if (mobileSafe) {
  try {
    restartCount = Math.min(4, Number(sessionStorage.getItem(CRASH_KEY) || 0) + 1);
    sessionStorage.setItem(CRASH_KEY, String(restartCount));
  } catch {}
}

const emergency = mobileSafe && restartCount >= 2;
globalThis.__PROJECT_STRIKE_MOBILE_SAFE__ = mobileSafe;
globalThis.__PROJECT_STRIKE_EMERGENCY_MODE__ = emergency;
globalThis.__PROJECT_STRIKE_CORE_READY__ = false;

async function claimStreamingWorker() {
  const state = { attempted: false, previous: null, controllerChanged: false };
  if (!mobileSafe || !('serviceWorker' in navigator)) return state;
  state.attempted = true;
  state.previous = navigator.serviceWorker.controller?.scriptURL || null;
  try {
    const registration = await navigator.serviceWorker.register('./service-worker.js?v=9');
    await registration.update();
    if (state.previous && !state.previous.includes('v=9')) {
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
    console.info('V9 worker preflight unavailable; direct network loading remains active.', error);
  }
  return state;
}

// If V8 is already controlling this tab, do not begin large GLB work until V9
// has had a chance to install/claim the page. V8 cloned every GLB into Cache
// Storage and could trigger an iOS process kill during the very first V7 visit.
const workerUpgrade = await claimStreamingWorker();

const allowedBuildings = emergency ? 2 : 3;
const admittedBuildings = new Set();
let decodeActive = 0;
const decodeQueue = [];
const decodeLimit = mobileSafe ? 1 : 3;

function acquireDecodeSlot() {
  if (decodeActive < decodeLimit) {
    decodeActive++;
    return Promise.resolve();
  }
  return new Promise(resolve => decodeQueue.push(resolve));
}

function releaseDecodeSlot() {
  decodeActive = Math.max(0, decodeActive - 1);
  const next = decodeQueue.shift();
  if (next) {
    decodeActive++;
    next();
  }
}

const parseModel = AssetManager.prototype.parseModel;
AssetManager.prototype.parseModel = async function (...args) {
  if (!mobileSafe) return parseModel.apply(this, args);
  await acquireDecodeSlot();
  try {
    return await parseModel.apply(this, args);
  } finally {
    releaseDecodeSlot();
  }
};

const loadModel = AssetManager.prototype.loadModel;
AssetManager.prototype.loadModel = function (url, options = {}) {
  const value = String(url || '');
  if (mobileSafe) {
    if (/characters\/operators\/bamen_military_soldier_animated\.glb/i.test(value)) {
      return Promise.reject(new Error('iOS memory governor: procedural operator fallback selected'));
    }
    if (/environment\/buildings\/kenney-industrial\/enterable\//i.test(value)) {
      if (!admittedBuildings.has(value) && admittedBuildings.size >= allowedBuildings) {
        return Promise.reject(new Error('iOS memory governor: distant building deferred'));
      }
      admittedBuildings.add(value);
    }
    // The repository cover/terrain GLBs are much larger than the enterable
    // Kenney buildings. The arena already has collision/primitive street cover,
    // so defer these multi-megabyte props on iPhone instead of spending the
    // startup memory peak on decorative meshes.
    if (options.world && /environment\/(?:cover|terrain)\//i.test(value)) {
      return Promise.reject(new Error('iOS memory governor: heavy world prop deferred'));
    }
  }
  return loadModel.call(this, url, options);
};

const loadAttachment = FPSViewModel.prototype.loadAttachment;
FPSViewModel.prototype.loadAttachment = function (url) {
  if (mobileSafe) {
    this.diagnostics.attachment = { skipped: true, reason: 'ios-memory-budget', url };
    return Promise.resolve(false);
  }
  return loadAttachment.call(this, url);
};

const grenadeInit = GrenadeController.prototype.init;
GrenadeController.prototype.init = function (assets) {
  if (mobileSafe) {
    this._v7DeferredAssets = assets;
    return Promise.resolve(this);
  }
  return grenadeInit.call(this, assets);
};

if (mobileSafe) {
  const setPixelRatio = THREE.WebGLRenderer.prototype.setPixelRatio;
  THREE.WebGLRenderer.prototype.setPixelRatio = function (value) {
    const cap = emergency ? .72 : .88;
    return setPixelRatio.call(this, Math.min(Number(value) || 1, cap));
  };

  THREE.PMREMGenerator.prototype.fromScene = function () {
    return { texture: null, dispose() {} };
  };
}

const readyTimer = setInterval(() => {
  const button = document.querySelector('#playBtn');
  if (!button || button.disabled) return;
  globalThis.__PROJECT_STRIKE_CORE_READY__ = true;
  clearInterval(readyTimer);
}, 80);
setTimeout(() => clearInterval(readyTimer), 60_000);

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
  emergency,
  restartCount,
  workerUpgrade,
  maxConcurrentModelDecodes: decodeLimit,
  initialEnterableBuildings: mobileSafe ? allowedBuildings : 8,
  operatorFallback: mobileSafe,
  opticFallback: mobileSafe,
  grenadeFallback: mobileSafe,
  heavyWorldPropsDeferred: mobileSafe,
  pmremDisabled: mobileSafe,
  largeAssetCacheDisabled: true
};
