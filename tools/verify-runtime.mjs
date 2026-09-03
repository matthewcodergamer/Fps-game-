import fs from 'node:fs';
import path from 'node:path';

const publicRoot = path.resolve('public');
const assetRoot = path.join(publicRoot, 'game-assets');
const warnings = [];

// This historical optional file has a container-length mismatch and is not part
// of the V10 initial ready set. It remains on disk pending binary repair.
const quarantinedGLBs = new Set([
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

function forbidText(text, needle, label) {
  if (text.includes(needle)) throw new Error(`Forbidden ${label}: ${needle}`);
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
      if (quarantinedGLBs.has(relative)) {
        warnings.push(`Quarantined malformed optional GLB: ${relative} (${declaredLength} declared, ${actualLength} bytes)`);
        return [];
      }
      throw new Error(`GLB length mismatch: ${relative} (${declaredLength} != ${actualLength})`);
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
    for (const entry of [...(json.buffers || []), ...(json.images || [])]) {
      const uri = entry?.uri;
      if (!uri || /^(?:data:|https?:|blob:)/i.test(uri)) continue;
      const decoded = decodeURIComponent(uri.split(/[?#]/)[0]);
      const referenced = path.resolve(path.dirname(file), decoded);
      if (!fs.existsSync(referenced)) throw new Error(`Missing GLB dependency ${uri} referenced by ${relative}`);
    }
    return json.extensionsRequired || [];
  } finally {
    fs.closeSync(handle);
  }
}

const files = {
  index: path.resolve('index.html'),
  entry: path.resolve('src/main-v10.js'),
  runtime: path.resolve('src/main-v10-runtime.js'),
  strictView: path.resolve('src/weapons/StrictFPSViewModel.js'),
  ik: path.resolve('src/animation/CharacterIKRig.js'),
  strictGrenades: path.resolve('src/gameplay/StrictGrenadeController.js'),
  gpuEffects: path.resolve('src/rendering/WebGPUWeaponEffects.js'),
  pipeline: path.resolve('src/rendering/CinematicPipeline.js'),
  assetManager: path.resolve('src/assets/AssetManager.js'),
  body: path.resolve('src/characters/TrueBodyRig.js'),
  arena: path.resolve('src/world/Stage3Arena.js'),
  vite: path.resolve('vite.config.js'),
  rootWorker: path.resolve('service-worker.js'),
  publicWorker: path.resolve('public/service-worker.js')
};
for (const [label, file] of Object.entries(files)) assertFile(file, label);

const text = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, fs.readFileSync(file, 'utf8')]));

// Visible shell / cache contract.
requireText(text.index, 'V10 · WEBGPU · REAL ASSETS ONLY', 'V10 visible build marker');
requireText(text.index, 'id="loadBar"', 'real loading progress bar');
requireText(text.index, 'id="loadAsset"', 'current asset loading label');
requireText(text.index, 'three.webgpu.js', 'WebGPU raw-source import map');
requireText(text.index, 'three.tsl.js', 'TSL raw-source import map');
requireText(text.index, 'src/main-v10.js?v=10', 'V10 entry');
requireText(text.index, 'service-worker.js?v=12', 'V12 service worker registration');
requireText(text.index, "updateViaCache: 'none'", 'worker update cache bypass');
requireText(text.index, "key.startsWith('project-strike-')", 'old Project Strike cache purge');
requireText(text.index, 'background:#020408', 'non-white shell background');

// Clean entry: no legacy transform/survival monkey-patch stack.
requireText(text.entry, "await import('./main-v10-runtime.js')", 'V10 runtime import');
for (const legacy of [
  'mobile-stability-patch',
  'v4-runtime-patch',
  'ios-survival-runtime-patch',
  'aaa-runtime-patch',
  'gore-runtime-patch',
  'main-stage3'
]) forbidText(text.entry, legacy, 'legacy V8/V9 entry import');

// Strict WebGPU backend and loading gate.
requireText(text.runtime, 'new THREE.WebGPURenderer', 'WebGPU renderer construction');
requireText(text.runtime, 'THREE.WebGPUCoordinateSystem', 'real WebGPU backend enforcement');
requireText(text.runtime, 'WebGL fallback is disabled', 'no WebGL compatibility backend');
requireText(text.runtime, 'await renderer.compileAsync(scene, camera)', 'world pipeline precompile');
requireText(text.runtime, 'await renderer.compileAsync(view.scene, view.camera)', 'viewmodel pipeline precompile');
requireText(text.runtime, "pos: new THREE.Vector3(0, 1.85, 8)", 'spawn clear of old curb overlap');
requireText(text.runtime, "owner: 'single-shot-impulse'", 'single recoil owner diagnostics');
requireText(text.runtime, 'cameraSpring: false', 'camera spring removed');
requireText(text.runtime, 'transformPatch: false', 'legacy transform recoil removed');
requireText(text.runtime, "addEventListener('pointerdown'", 'pointer-event mobile controls');
requireText(text.runtime, 'setPointerCapture', 'independent multitouch pointer capture');
requireText(text.runtime, 'view.barrelDirectionWorld', 'physical barrel ballistics');
requireText(text.runtime, 'proceduralFallbacks: false', 'strict no-fallback diagnostics');

// GPU weapon effects are compute-buffer driven, not CPU sphere loops.
requireText(text.gpuEffects, "from 'three/tsl'", 'TSL compute imports');
requireText(text.gpuEffects, 'instancedArray', 'GPU particle storage');
requireText(text.gpuEffects, 'renderer.compute', 'WebGPU compute dispatch');
requireText(text.gpuEffects, 'SpriteNodeMaterial', 'GPU particle rendering');
requireText(text.gpuEffects, 'cpuParticleMeshes: false', 'no CPU particle mesh claim');
requireText(text.gpuEffects, 'V10CrossQuadMuzzleFlash', 'cross-quad muzzle flash');

// Strict real model contract.
requireText(text.strictView, 'Required first-person arm model failed', 'strict arms');
requireText(text.strictView, 'Required weapon model failed', 'strict weapon');
requireText(text.strictView, 'requireIK()', 'required weapon IK');
requireText(text.ik, 'CCDIKSolver', 'official Three CCD IK solver');
requireText(text.strictGrenades, 'Required real', 'strict real grenade clone');
forbidText(text.strictGrenades, 'IcosahedronGeometry', 'grenade primitive fallback');
requireText(text.arena, 'fallbackTargets: false', 'no primitive target fallback');
forbidText(text.arena, 'fallbackTarget', 'operator fallback function');
requireText(text.body, 'proceduralFallback: false', 'real local-body contract');

// iPhone decode/memory contract.
requireText(text.assetManager, 'this.decodeTail = Promise.resolve()', 'serialized decoder queue');
requireText(text.assetManager, 'maxConcurrentModelDecodes: MEMORY_SAFE ? 1 : null', 'one mobile model decode');
requireText(text.assetManager, 'this.cache.delete(resolvedUrl)', 'decoded source eviction');
requireText(text.assetManager, 'modelFallbacks: false', 'asset manager no-fallback contract');
requireText(text.runtime, 'outputBufferType: touchDevice ? THREE.UnsignedByteType', 'mobile 8-bit WebGPU output');

// WebGPU-native render pipeline and unified Three runtime.
requireText(text.pipeline, "from 'three/webgpu'", 'WebGPU cinematic pipeline');
requireText(text.pipeline, 'new THREE.RenderPipeline', 'WebGPU RenderPipeline');
requireText(text.pipeline, "BloomNode.js", 'TSL bloom node');
forbidText(text.pipeline, 'EffectComposer', 'legacy WebGL composer');
requireText(text.vite, "find: /^three$/", 'bare Three alias');
requireText(text.vite, "find: /^three\\/webgpu$/", 'explicit WebGPU alias');

if (text.rootWorker !== text.publicWorker) throw new Error('Root/public V12 service workers must be byte-identical.');
requireText(text.rootWorker, "project-strike-v12-webgpu-shell", 'V12 cache namespace');
requireText(text.rootWorker, "cache: 'no-store'", 'fresh navigation and asset streaming');
requireText(text.rootWorker, "url.pathname.includes('/game-assets/')", 'large asset no-cache path');

// Validate the actual repository GLB library and hard-required V10 model set.
const glbs = walk(assetRoot).filter(file => file.toLowerCase().endsWith('.glb'));
if (!glbs.length) throw new Error('No runtime GLB files found.');
const requiredExtensions = new Set();
for (const file of glbs) for (const extension of inspectGLB(file)) requiredExtensions.add(extension);

const requiredModels = [
  'models/characters/first_person_arms/free_fps_arms_gameready_-_rigged.glb',
  'models/characters/operators/bamen_military_soldier.glb',
  'models/characters/operators/bamen_military_soldier_animated.glb',
  'models/weapons/rifles/colt_m4a1_carbine.glb',
  'models/grenades/high-quality_frag_grenade_3d_model.glb',
  'models/grenades/flashbang.glb',
  'models/environment/buildings/kenney-industrial/enterable/building-a-enterable.glb',
  'models/environment/buildings/kenney-industrial/enterable/building-b-enterable.glb',
  'models/environment/buildings/kenney-industrial/enterable/building-c-enterable.glb',
  'models/environment/buildings/kenney-industrial/enterable/building-e-enterable.glb',
  'models/environment/buildings/kenney-industrial/enterable/building-h-enterable.glb',
  'models/environment/buildings/kenney-industrial/enterable/building-j-enterable.glb',
  'models/environment/cover/concrete_road_barrier.glb',
  'models/environment/cover/old_military_crate.glb',
  'models/environment/terrain/boulder_01.glb'
];
for (const relative of requiredModels) {
  if (quarantinedGLBs.has(relative)) throw new Error(`Required V10 model is quarantined: ${relative}`);
  assertFile(path.join(assetRoot, relative), `required V10 real model: ${relative}`);
}

// Audio remains repository-authored and must be completely indexed.
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

for (const warning of warnings) console.warn(`Runtime warning: ${warning}`);
console.log(
  `Runtime verified: V10 strict WebGPU + real-model loading gate; ${glbs.length} GLBs inspected, ` +
  `${requiredModels.length} hard-required real models present, ${diskFiles.length} WAV files indexed; ` +
  `required GLB extensions: ${[...requiredExtensions].sort().join(', ') || 'none'}; ` +
  `quarantined optional malformed assets: ${warnings.length}.`
);
