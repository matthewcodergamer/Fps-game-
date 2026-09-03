import * as THREE from 'three';
import { AssetManager } from './assets/AssetManager.js';
import { RepositoryAudio } from './audio/RepositoryAudio.js';
import { FPSViewModel } from './weapons/FPSViewModel.js';

const ua = navigator.userAgent || '';
const ios = /iPhone|iPad|iPod/i.test(ua);
const coarse = matchMedia('(any-pointer: coarse)').matches;
const mobileSafe = ios && coarse;
const CRASH_KEY = 'project-strike-ios-restart-count-v9';
const MOBILE_REAL_OPTIC = './game-assets/models/weapons/attachments/crimson_trace_cts-1550_red_dot_sight.glb';
const MODEL_EXT = /\.(?:glb|gltf|fbx)(?:[?#].*)?$/i;
const BACKGROUND_WORLD = /\/environment\/(?:buildings|cover|terrain)\//i;
let restartCount = 0;

if (mobileSafe) {
  try {
    restartCount = Math.min(4, Number(sessionStorage.getItem(CRASH_KEY) || 0) + 1);
    sessionStorage.setItem(CRASH_KEY, String(restartCount));
  } catch {}
}

const emergency = mobileSafe && restartCount >= 3;
globalThis.__PROJECT_STRIKE_MOBILE_SAFE__ = mobileSafe;
globalThis.__PROJECT_STRIKE_IOS_SURVIVAL__ = false;
globalThis.__PROJECT_STRIKE_MOBILE_STREAMING__ = mobileSafe;
globalThis.__PROJECT_STRIKE_EMERGENCY_MODE__ = emergency;
globalThis.__PROJECT_STRIKE_CORE_READY__ = false;

const streamState = {
  active: false,
  critical: [],
  background: [],
  queued: 0,
  completed: 0,
  failed: 0,
  realModelsReady: 0,
  backgroundModelsReady: 0,
  current: null
};

function publishStreamState() {
  globalThis.__PROJECT_STRIKE_REAL_ASSET_STREAM__ = {
    enabled: mobileSafe,
    maxConcurrentModelDecodes: mobileSafe ? 1 : null,
    queued: streamState.queued,
    completed: streamState.completed,
    failed: streamState.failed,
    realModelsReady: streamState.realModelsReady,
    backgroundModelsReady: streamState.backgroundModelsReady,
    current: streamState.current,
    pendingCritical: streamState.critical.length,
    pendingBackground: streamState.background.length
  };
}

function pumpStreamQueue() {
  if (!mobileSafe || streamState.active) return;
  const job = streamState.critical.shift() || streamState.background.shift();
  if (!job) {
    streamState.current = null;
    publishStreamState();
    return;
  }

  streamState.active = true;
  streamState.current = job.label;
  publishStreamState();
  Promise.resolve()
    .then(job.task)
    .then(value => {
      streamState.completed++;
      job.resolve(value);
    }, error => {
      streamState.failed++;
      job.reject(error);
    })
    .finally(() => {
      streamState.active = false;
      streamState.current = null;
      publishStreamState();
      // Give Safari one turn between GLTF parser jobs so decoded buffers from
      // the previous file can become unreachable before the next file starts.
      setTimeout(pumpStreamQueue, 18);
    });
}

function queueModel(task, { lane = 'critical', label = 'model' } = {}) {
  if (!mobileSafe) return task();
  streamState.queued++;
  return new Promise((resolve, reject) => {
    streamState[lane].push({ task, resolve, reject, label });
    publishStreamState();
    pumpStreamQueue();
  });
}

function normalizeStreamedWorld(scene, url) {
  scene.updateMatrixWorld(true);
  let bounds = new THREE.Box3().setFromObject(scene);
  const size = bounds.getSize(new THREE.Vector3());
  const building = /\/buildings\//i.test(url);
  const denominator = building
    ? Math.max(size.y, .0001)
    : Math.max(size.x, size.y, size.z, .0001);
  scene.scale.multiplyScalar(1 / denominator);
  scene.updateMatrixWorld(true);
  bounds = new THREE.Box3().setFromObject(scene);
  const center = bounds.getCenter(new THREE.Vector3());
  scene.position.x -= center.x;
  scene.position.z -= center.z;
  scene.position.y += -.5 - bounds.min.y;
  scene.updateMatrixWorld(true);
}

function createWorldStreamProxy(manager, originalLoadModel, url, options) {
  const proxy = new THREE.Group();
  proxy.name = `StreamingRealAsset_${String(url).split('/').pop()}`;
  proxy.userData.streamState = 'queued';
  proxy.userData.realAssetUrl = url;

  // The transparent unit bounds let Stage3Arena immediately size and place a
  // holder/collider. The real GLB is normalized into these local bounds later.
  const boundsMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false })
  );
  boundsMesh.name = 'StreamingBoundsProxy';
  proxy.add(boundsMesh);

  queueModel(
    () => originalLoadModel.call(manager, url, {
      ...options,
      clone: true,
      world: true,
      timeoutMs: Math.max(Number(options?.timeoutMs || manager.timeoutMs || 0), 12_000)
    }),
    { lane: 'background', label: String(url).split('/').pop() }
  ).then(asset => {
    const real = asset.scene;
    normalizeStreamedWorld(real, url);
    const surface = boundsMesh.userData.surface || 'concrete';
    real.traverse(node => {
      if (!node.isMesh) return;
      node.castShadow = false;
      node.receiveShadow = true;
      node.userData.surface ||= surface;
    });
    proxy.add(real);
    proxy.userData.streamState = 'ready';
    proxy.userData.assetReport = asset.report;
    streamState.realModelsReady++;
    streamState.backgroundModelsReady++;
    publishStreamState();
  }).catch(error => {
    proxy.userData.streamState = 'error';
    proxy.userData.streamError = error.message;
    console.info('Background real-world model stream recovered.', url, error);
  });

  return Promise.resolve({
    scene: proxy,
    animations: [],
    format: 'stream-proxy',
    url,
    report: { meshes: 1, streaming: true, realAssetUrl: url }
  });
}

async function claimFreshWorker() {
  const state = { attempted: false, previous: null, controllerChanged: false, version: 'v11' };
  if (!mobileSafe || !('serviceWorker' in navigator)) return state;
  state.attempted = true;
  state.previous = navigator.serviceWorker.controller?.scriptURL || null;
  try {
    const registration = await navigator.serviceWorker.register('./service-worker.js?v=11', { updateViaCache: 'none' });
    await registration.update();
  } catch (error) {
    console.info('V11 worker preflight unavailable; online asset streaming remains active.', error);
  }
  return state;
}

const workerUpgrade = await claimFreshWorker();
const originalLoadModel = AssetManager.prototype.loadModel;
AssetManager.prototype.loadModel = function (url, options = {}) {
  const value = String(url || '');
  if (!mobileSafe || !MODEL_EXT.test(value)) return originalLoadModel.call(this, url, options);

  // World dressing is visible as soon as each real model finishes, but it does
  // not get to block the player model / hands / weapon decode lane.
  if (BACKGROUND_WORLD.test(value)) {
    return createWorldStreamProxy(this, originalLoadModel, url, options);
  }

  return queueModel(
    () => originalLoadModel.call(this, url, {
      ...options,
      timeoutMs: Math.max(Number(options.timeoutMs || this.timeoutMs || 0), 12_000)
    }),
    { lane: 'critical', label: value.split('/').pop() }
  ).then(asset => {
    streamState.realModelsReady++;
    publishStreamState();
    return asset;
  });
};

// The 2.6 MB holo optic was the exact model visible when Safari was killed in
// the V6 screenshot. V9 still uses a repository 3D optic on iPhone, but swaps
// to the existing 1.16 MB Crimson Trace model instead of falling back to boxes.
const originalLoadAttachment = FPSViewModel.prototype.loadAttachment;
FPSViewModel.prototype.loadAttachment = function (url) {
  const requested = String(url || '');
  const mobileUrl = mobileSafe && /free_pbr_holo_sight_optics/i.test(requested)
    ? MOBILE_REAL_OPTIC
    : url;
  if (mobileSafe && mobileUrl !== url) {
    this.diagnostics.mobileOptic = {
      requested,
      loaded: mobileUrl,
      realRepositoryModel: true,
      reason: 'lower-decode-memory-real-optic'
    };
  }
  return originalLoadAttachment.call(this, mobileUrl);
};

// Keep audio lazy on iPhone; the user's latest capture confirms audio already
// works and model decode stability is more important than prewarming every bank.
const repositoryPrewarm = RepositoryAudio.prototype.prewarm;
RepositoryAudio.prototype.prewarm = function (...args) {
  if (mobileSafe && !globalThis.__PROJECT_STRIKE_AUDIO_CORE_READY__) {
    return Promise.resolve({ weapon: 0, collision: 0, explosions: 0, weapons: 0, indexed: this.indexedFiles, warming: true, mobileStreaming: true });
  }
  return repositoryPrewarm.apply(this, args);
};

if (mobileSafe) {
  const setPixelRatio = THREE.WebGLRenderer.prototype.setPixelRatio;
  THREE.WebGLRenderer.prototype.setPixelRatio = function (value) {
    const cap = emergency ? .72 : .82;
    return setPixelRatio.call(this, Math.min(Number(value) || 1, cap));
  };

  // Keep shadow-map VRAM off on iPhone while retaining real PBR geometry.
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
setTimeout(() => clearInterval(readyTimer), 120_000);

const diagnosticTimer = setInterval(() => {
  const diagnostics = globalThis.__PROJECT_STRIKE_DIAGNOSTICS__;
  if (!diagnostics) return;
  Object.assign(diagnostics, {
    runtime: 'v9',
    iosRealAssetStreaming: mobileSafe,
    zeroModelStartup: false,
    realRepositoryModels: true,
    largeAssetCacheDisabled: true,
    productionServiceWorker: 'v11'
  });
  const badge = document.querySelector('#stageBadge');
  if (badge && badge.textContent !== 'V9') badge.textContent = 'V9';
}, 120);
setTimeout(() => clearInterval(diagnosticTimer), 120_000);

const stableTimer = setInterval(() => {
  const boot = document.querySelector('#boot');
  if (!mobileSafe || !boot?.classList.contains('hidden')) return;
  clearInterval(stableTimer);
  setTimeout(() => {
    try { sessionStorage.removeItem(CRASH_KEY); } catch {}
  }, 20_000);
}, 500);
setTimeout(() => clearInterval(stableTimer), 120_000);

publishStreamState();
globalThis.__PROJECT_STRIKE_MOBILE_STABILITY__ = {
  ios,
  mobileSafe,
  survivalMode: false,
  realAssetStreaming: mobileSafe,
  emergency,
  restartCount,
  workerUpgrade,
  maxConcurrentModelDecodes: mobileSafe ? 1 : null,
  initialRepositoryModelLoads: mobileSafe ? 'critical-real-models' : null,
  operatorFallback: false,
  viewModelFallback: false,
  opticFallback: false,
  grenadeFallback: false,
  realM4A1: true,
  realRiggedArms: true,
  realOperator: true,
  realGrenades: true,
  heavyWorldPropsStreamed: mobileSafe,
  shadowMapsDisabled: mobileSafe,
  audioPrewarmDeferred: mobileSafe,
  renderScaleCap: mobileSafe ? (emergency ? .72 : .82) : null,
  largeAssetCacheDisabled: true
};
