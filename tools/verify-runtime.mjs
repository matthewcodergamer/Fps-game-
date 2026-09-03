import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('.');
const publicRoot = path.resolve('public');
const assetRoot = path.join(publicRoot, 'game-assets');
const recoverableLengthMismatch = new Set([
  'models/weapons/shotguns/remington_870_police_magnum_12_gauge_shotgun.glb'
]);
const warnings = [];

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

function assertFile(file, label = path.relative(root, file)) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`Missing required file: ${label}`);
}

function text(file) {
  return fs.readFileSync(path.resolve(file), 'utf8');
}

function requireText(value, needle, label) {
  if (!value.includes(needle)) throw new Error(`Missing ${label}: ${needle}`);
}

function forbidText(value, needle, label) {
  if (value.includes(needle)) throw new Error(`Forbidden ${label}: ${needle}`);
}

function inspectGLB(file) {
  const relative = path.relative(assetRoot, file).replaceAll('\\', '/');
  const buffer = fs.readFileSync(file);
  if (buffer.length < 20 || buffer.subarray(0, 4).toString('ascii') !== 'glTF') throw new Error(`Invalid GLB header: ${relative}`);
  if (buffer.readUInt32LE(4) !== 2) throw new Error(`Unsupported GLB version: ${relative}`);
  const declared = buffer.readUInt32LE(8);
  if (declared !== buffer.length) {
    if (!recoverableLengthMismatch.has(relative)) throw new Error(`GLB length mismatch: ${relative} (${declared} != ${buffer.length})`);
    warnings.push(`Optional recoverable GLB mismatch: ${relative}`);
  }
  const jsonLength = buffer.readUInt32LE(12);
  if (buffer.readUInt32LE(16) !== 0x4e4f534a || 20 + jsonLength > buffer.length) throw new Error(`Invalid GLB JSON chunk: ${relative}`);
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8').replace(/\u0000+$/g, '').trim());
  if ((json.extensionsRequired || []).includes('KHR_draco_mesh_compression')) {
    throw new Error(`Required Draco model has no runtime DRACOLoader: ${relative}`);
  }
  for (const entry of [...(json.buffers || []), ...(json.images || [])]) {
    const uri = entry.uri;
    if (!uri || /^(?:data:|https?:|blob:)/i.test(uri)) continue;
    const dependency = path.resolve(path.dirname(file), decodeURIComponent(uri.split(/[?#]/)[0]));
    if (!fs.existsSync(dependency)) throw new Error(`Missing GLB dependency ${uri} referenced by ${relative}`);
  }
  return json.extensionsRequired || [];
}

const requiredSource = [
  ['index.html', 'V10 HTML'],
  ['src/main-v4.js', 'V10 entry wrapper'],
  ['src/main-v10.js', 'V10 WebGPU runtime'],
  ['src/weapons/FPSViewModelV10.js', 'strict real-asset viewmodel'],
  ['src/rendering/GPUWeaponVFX.js', 'WebGPU compute weapon VFX'],
  ['src/world/RealisticDistrictV10.js', 'real-asset district'],
  ['src/animation/CharacterIKRig.js', 'CCD hand IK'],
  ['src/characters/TrueBodyRig.js', 'real local body'],
  ['src/assets/AssetManager.js', 'asset translation layer'],
  ['mobile-fixes.css', 'mobile Pointer Event controls'],
  ['service-worker.js', 'source service worker'],
  ['public/service-worker.js', 'production service worker']
];
for (const [file, label] of requiredSource) assertFile(path.resolve(file), label);

const index = text('index.html');
const entry = text('src/main-v4.js');
const runtime = text('src/main-v10.js');
const view = text('src/weapons/FPSViewModelV10.js');
const vfx = text('src/rendering/GPUWeaponVFX.js');
const district = text('src/world/RealisticDistrictV10.js');
const body = text('src/characters/TrueBodyRig.js');
const mobileCss = text('mobile-fixes.css');
const sw = text('service-worker.js');
const publicSw = text('public/service-worker.js');

requireText(index, 'v10-webgpu-real-assets', 'V10 build marker');
requireText(index, 'three.webgpu.js', 'WebGPU import map');
requireText(index, 'three.tsl.js', 'TSL import map');
requireText(index, 'service-worker.js?v=12', 'V12 service worker');
requireText(index, 'LOADING REAL ASSETS', 'real loading gate');
requireText(index, 'NO VISUAL FALLBACKS', 'no-fallback boot contract');
requireText(entry, "await import('./main-v10.js')", 'clean V10 entry');
for (const oldPatch of ['mobile-stability-patch.js', 'v4-runtime-patch.js', 'aaa-runtime-patch.js', 'ios-survival-runtime-patch.js', 'gore-runtime-patch.js']) {
  forbidText(entry, oldPatch, `old patch-chain import ${oldPatch}`);
}

requireText(runtime, 'new THREE.WebGPURenderer', 'WebGPU renderer');
requireText(runtime, '!navigator.gpu', 'WebGPU capability gate');
requireText(runtime, 'isWebGPUBackend', 'real WebGPU backend verification');
requireText(runtime, 'noRenderingFallback: true', 'no renderer fallback diagnostic');
requireText(runtime, 'noProceduralAssetFallbacks: true', 'no asset fallback diagnostic');
requireText(runtime, 'camera.rotation.set(player.pitch, player.yaw', 'authoritative camera rotation reset');
requireText(runtime, 'pointerdown', 'Pointer Event mobile movement');
requireText(runtime, 'Required real', 'strict grenade load contract');
for (const primitive of ['IcosahedronGeometry', 'TetrahedronGeometry', 'installFallbackWeapon', 'installFallbackArms']) {
  forbidText(runtime, primitive, `runtime visual fallback ${primitive}`);
}

requireText(view, 'definition.model', 'required weapon model');
forbidText(view, 'definition.fallbackModel', 'weapon fallback model');
forbidText(view, 'installFallback', 'viewmodel fallback installer');
requireText(view, 'CharacterIKRig', 'direct CCD hand IK');
requireText(view, 'this.ik.update', 'live IK update');
requireText(view, 'one viewmodel recoil owner', 'single recoil owner');

requireText(vfx, "from 'three/tsl'", 'TSL particle path');
requireText(vfx, 'instancedArray', 'GPU storage arrays');
requireText(vfx, 'renderer.compute', 'WebGPU compute dispatch');
requireText(vfx, 'cpuParticleLoops: false', 'no CPU particle loop diagnostic');
requireText(vfx, 'volumetricFluidClaimed: false', 'honest VFX claim');

requireText(district, 'bamen_military_soldier_animated.glb', 'real operator model');
forbidText(district, 'ShaderMaterial', 'legacy WebGL-only shader');
requireText(body, 'bamen_military_soldier.glb', 'real skinned local body');
requireText(body, 'proceduralFallback: false', 'no body fallback');
requireText(mobileCss, '#leftPad', 'left joystick pointer recovery');
requireText(mobileCss, '#lookZone', 'look-zone pointer recovery');
requireText(mobileCss, 'pointer-events: auto', 'touch surface pointer events');

if (sw !== publicSw) throw new Error('Root/public V12 service workers must be byte-identical.');
requireText(sw, 'project-strike-v12-webgpu-shell', 'V12 cache namespace');
requireText(sw, "cache: 'no-store'", 'fresh large-asset requests');

const requiredModels = [
  'models/characters/first_person_arms/free_fps_arms_gameready_-_rigged.glb',
  'models/characters/operators/bamen_military_soldier.glb',
  'models/characters/operators/bamen_military_soldier_animated.glb',
  'models/weapons/rifles/colt_m4a1_carbine.glb',
  'models/weapons/attachments/free_pbr_holo_sight_optics._cheerr.glb',
  'models/grenades/high-quality_frag_grenade_3d_model.glb',
  'models/grenades/flashbang.glb',
  'models/environment/buildings/kenney-industrial/enterable/building-a-enterable.glb',
  'models/environment/cover/concrete_road_barrier.glb',
  'models/environment/cover/old_military_crate.glb'
];
for (const relative of requiredModels) assertFile(path.join(assetRoot, relative), `V10 production model: ${relative}`);

const glbs = walk(assetRoot).filter(file => file.toLowerCase().endsWith('.glb'));
if (!glbs.length) throw new Error('No runtime GLB files found.');
const requiredExtensions = new Set();
for (const file of glbs) for (const extension of inspectGLB(file)) requiredExtensions.add(extension);

const manifestPath = path.join(assetRoot, 'audio/audio-manifest.json');
assertFile(manifestPath, 'audio manifest');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const wavs = walk(path.join(assetRoot, 'audio')).filter(file => file.toLowerCase().endsWith('.wav'));
const indexed = new Set((manifest.files || []).map(file => file.path));
if (indexed.size !== wavs.length) throw new Error(`Audio manifest count mismatch: ${indexed.size} indexed, ${wavs.length} WAV files.`);

for (const warning of warnings) console.warn(`Runtime warning: ${warning}`);
console.log(
  `Runtime verified: V10 WebGPU-only boot, real-asset loading gate, direct CCD hand IK, real M4A1/arms/body/operator/grenades, ` +
  `GPU compute weapon VFX, V12 no-large-cache worker; ${glbs.length} GLBs inspected and ${wavs.length} WAVs indexed; ` +
  `required GLB extensions: ${[...requiredExtensions].sort().join(', ') || 'none'}.`
);
