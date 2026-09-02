import fs from 'node:fs';
import path from 'node:path';

const publicRoot = path.resolve('public');
const assetRoot = path.join(publicRoot, 'game-assets');
const warnings = [];

const recoverableLengthMismatch = new Set([
  'models/weapons/shotguns/remington_870_police_magnum_12_gauge_shotgun.glb'
]);

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

function assertFile(file, label = path.relative(process.cwd(), file)) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${label}`);
  if (!fs.statSync(file).isFile()) throw new Error(`Expected a file: ${label}`);
}

function requireText(text, needle, label) {
  if (!text.includes(needle)) throw new Error(`Missing ${label}: ${needle}`);
}

function inspectGLB(file) {
  const relative = path.relative(assetRoot, file).replaceAll('\\', '/');
  const handle = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(20);
    const bytes = fs.readSync(handle, header, 0, header.length, 0);
    if (bytes < 20 || header.subarray(0, 4).toString('ascii') !== 'glTF') {
      throw new Error(`Invalid GLB header: ${relative}`);
    }
    const version = header.readUInt32LE(4);
    if (version !== 2) throw new Error(`Unsupported GLB version ${version}: ${relative}`);
    const declaredLength = header.readUInt32LE(8);
    const actualLength = fs.statSync(file).size;
    if (declaredLength !== actualLength) {
      if (!recoverableLengthMismatch.has(relative)) {
        throw new Error(`GLB length mismatch: ${relative} (${declaredLength} != ${actualLength})`);
      }
      warnings.push(`Recoverable optional GLB uses procedural fallback: ${relative} (${declaredLength} declared, ${actualLength} bytes present)`);
    }
    const jsonLength = header.readUInt32LE(12);
    const jsonType = header.readUInt32LE(16);
    if (jsonType !== 0x4e4f534a) throw new Error(`GLB first chunk is not JSON: ${relative}`);
    if (20 + jsonLength > actualLength) throw new Error(`GLB JSON chunk is truncated: ${relative}`);
    const jsonBuffer = Buffer.alloc(jsonLength);
    fs.readSync(handle, jsonBuffer, 0, jsonLength, 20);
    const json = JSON.parse(jsonBuffer.toString('utf8').replace(/\u0000+$/g, '').trim());
    if ((json.extensionsRequired || []).includes('KHR_draco_mesh_compression')) {
      throw new Error(`Runtime GLB requires Draco but AssetManager does not install DRACOLoader: ${relative}`);
    }
    const external = [];
    for (const buffer of json.buffers || []) if (buffer.uri) external.push(buffer.uri);
    for (const image of json.images || []) if (image.uri) external.push(image.uri);
    for (const uri of external) {
      if (/^(?:data:|https?:|blob:)/i.test(uri)) continue;
      const decoded = decodeURIComponent(uri.split(/[?#]/)[0]);
      const referenced = path.resolve(path.dirname(file), decoded);
      if (!fs.existsSync(referenced)) throw new Error(`Missing GLB dependency ${uri} referenced by ${relative}`);
    }
    return json.extensionsRequired || [];
  } finally {
    fs.closeSync(handle);
  }
}

const publicWorkerPath = path.join(publicRoot, 'service-worker.js');
const sourceWorkerPath = path.resolve('service-worker.js');
const requiredSourceFiles = [
  [publicWorkerPath, 'production service worker'],
  [sourceWorkerPath, 'source-host service worker'],
  [path.resolve('src/animation/CharacterIKRig.js'), 'weapon IK module'],
  [path.resolve('src/gameplay/AAAFeelSystem.js'), 'AAA feel module'],
  [path.resolve('src/gameplay/PhysicalReactionSystem.js'), 'physical reaction module'],
  [path.resolve('src/mobile-stability-patch.js'), 'V8 iOS survival patch'],
  [path.resolve('src/ios-survival-runtime-patch.js'), 'V8 procedural readiness adapter'],
  [path.resolve('src/aaa-runtime-patch.js'), 'AAA integration patch'],
  [path.resolve('src/gore-runtime-patch.js'), 'physical reaction integration patch']
];
for (const [file, label] of requiredSourceFiles) assertFile(file, label);

const index = fs.readFileSync(path.resolve('index.html'), 'utf8');
const entry = fs.readFileSync(path.resolve('src/main-v4.js'), 'utf8');
const publicWorker = fs.readFileSync(publicWorkerPath, 'utf8');
const sourceWorker = fs.readFileSync(sourceWorkerPath, 'utf8');
const assetManager = fs.readFileSync(path.resolve('src/assets/AssetManager.js'), 'utf8');
const mobilePatch = fs.readFileSync(path.resolve('src/mobile-stability-patch.js'), 'utf8');
const survivalAdapter = fs.readFileSync(path.resolve('src/ios-survival-runtime-patch.js'), 'utf8');

requireText(index, 'V8 IOS SURVIVAL BOOT', 'visible V8 build marker');
requireText(index, 'src/main-v4.js?v=8', 'cache-busted V8 entry');
requireText(index, "./service-worker.js?v=10", 'V10 worker registration');
requireText(index, "updateViaCache: 'none'", 'service-worker cache bypass');
requireText(index, '__PROJECT_STRIKE_PREBOOT__', 'pre-module cache purge');
requireText(index, "key.startsWith('project-strike-')", 'old Project Strike cache purge');
requireText(index, '__PROJECT_STRIKE_ENTRY_LOADED__', 'early JavaScript boot watchdog');
requireText(index, 'type="importmap"', 'raw-source import map');
requireText(index, 'three/addons/', 'Three.js addons import map');
requireText(index, '__PROJECT_STRIKE_SOURCE_MODE__', 'source-mode recovery');
requireText(index, '/public/game-assets/', 'source-host asset mapping');

for (const modulePath of [
  "await import('./mobile-stability-patch.js')",
  "await import('./v4-runtime-patch.js')",
  "await import('./ios-survival-runtime-patch.js')",
  "await import('./aaa-runtime-patch.js')",
  "await import('./gore-runtime-patch.js')"
]) requireText(entry, modulePath, `runtime module ${modulePath}`);
requireText(entry, '__PROJECT_STRIKE_PREBOOT__', 'V8 preboot wait');
requireText(entry, "build: 'v8-ios-survival'", 'V8 runtime build marker');

if (publicWorker !== sourceWorker) throw new Error('Root and public V10 service workers must remain byte-identical.');
requireText(publicWorker, "project-strike-v10-shell", 'V10 cache namespace');
requireText(publicWorker, "cache: 'no-store'", 'fresh navigation/asset requests');
requireText(publicWorker, 'never cloned into Cache Storage', 'zero large-asset cache rule');
requireText(publicWorker, "key.startsWith(CACHE_PREFIX)", 'old Project Strike cache deletion');

requireText(assetManager, 'this.cache.delete(resolvedUrl)', 'decoded model cache eviction');
requireText(assetManager, 'Math.min(loaded, total)', 'progress clamping');

// These are the architecture-level invariants for the real iPhone Safari crash:
// the model loader rejects all repository model formats before it can call the
// original loader, PMREM/shadow-map allocation is disabled, and audio does not
// pre-decode during the vulnerable transition.
requireText(mobilePatch, 'IOSSurvivalModelDeferredError', 'zero-model iOS rejection');
requireText(mobilePatch, "const modelExtension = /\\.(?:glb|gltf|fbx)", 'all supported model formats guarded');
requireText(mobilePatch, 'maxConcurrentModelDecodes: survivalMode ? 0 : 3', 'zero iOS model decoders');
requireText(mobilePatch, 'initialRepositoryModelLoads: survivalMode ? 0 : null', 'zero startup repository models');
requireText(mobilePatch, 'shadowMapsDisabled: survivalMode', 'iOS shadow-map disable');
requireText(mobilePatch, 'audioPrewarmDisabled: survivalMode', 'iOS audio prewarm disable');
requireText(mobilePatch, "productionServiceWorker: 'v10'", 'V10 diagnostics');
requireText(survivalAdapter, 'proceduralViewmodelCountsAsReady', 'procedural fallback readiness');

// Desktop continues to use and validate the repository asset library. V8 only
// bypasses these files on actual iOS survival boot.
const glbs = walk(assetRoot).filter(file => file.toLowerCase().endsWith('.glb'));
if (!glbs.length) throw new Error('No runtime GLB files found.');
const requiredExtensions = new Set();
for (const file of glbs) for (const extension of inspectGLB(file)) requiredExtensions.add(extension);

const requiredModels = [
  'models/characters/first_person_arms/free_fps_arms_gameready_-_rigged.glb',
  'models/characters/operators/bamen_military_soldier_animated.glb',
  'models/weapons/rifles/colt_m4a1_carbine.glb',
  'models/weapons/pistols/service_pistol.glb',
  'models/environment/buildings/kenney-industrial/enterable/building-a-enterable.glb',
  'models/grenades/high-quality_frag_grenade_3d_model.glb',
  'models/grenades/flashbang.glb'
];
for (const relative of requiredModels) {
  assertFile(path.join(assetRoot, relative), `desktop runtime model: ${relative}`);
  if (recoverableLengthMismatch.has(relative)) throw new Error(`Required runtime model cannot be marked recoverable: ${relative}`);
}

const requiredBanks = ['lmg_combat', 'ptl_pistol', 'lmg_mg_player', 'smg_smg', 'sht_pump', 'snp_rifle', 'collision', 'explosions'];
const manifestPath = path.join(assetRoot, 'audio/audio-manifest.json');
assertFile(manifestPath, 'audio manifest');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const diskFiles = walk(path.join(assetRoot, 'audio'))
  .filter(file => file.toLowerCase().endsWith('.wav'))
  .map(file => path.relative(path.resolve('.'), file).replaceAll('\\', '/'));
const indexedFiles = new Set((manifest.files || []).map(file => file.path));
const missing = diskFiles.filter(file => !indexedFiles.has(file));
if (missing.length) throw new Error(`Audio manifest is missing ${missing.length} WAV files. Run npm run audio:manifest.`);
if (indexedFiles.size !== diskFiles.length) throw new Error(`Audio manifest count mismatch: ${indexedFiles.size} indexed, ${diskFiles.length} on disk.`);
const banks = new Set((manifest.files || []).map(file => file.bank));
for (const bank of requiredBanks) if (!banks.has(bank)) throw new Error(`Audio manifest is missing required bank: ${bank}`);

for (const warning of warnings) console.warn(`Runtime warning: ${warning}`);
console.log(
  `Runtime verified: V8 iPhone zero-model survival boot + V10 fresh-cache worker present; ` +
  `${glbs.length} desktop GLBs inspected, ${diskFiles.length} WAV files indexed; ` +
  `CCD IK + AAA feel + physical reactions preserved; required GLB extensions: ` +
  `${[...requiredExtensions].sort().join(', ') || 'none'}, recoverable optional assets: ${warnings.length}.`
);
