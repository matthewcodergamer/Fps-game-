import fs from 'node:fs';
import path from 'node:path';

const fail = message => { throw new Error(message); };

const required = [
  'src/reboot/main.js', 'src/reboot/core/createEngine.js', 'src/reboot/core/DeviceProfile.js', 'src/reboot/core/Settings.js',
  'src/reboot/core/PerformanceGovernor.js', 'src/reboot/physics/HavokWorld.js', 'src/reboot/physics/Raycast.js',
  'src/reboot/player/StrikeCharacterController.js', 'src/reboot/player/CameraRig.js', 'src/reboot/weapons/WeaponSystem.js',
  'src/reboot/weapons/WeaponHandling.js', 'src/reboot/weapons/RecoilPattern.js', 'src/reboot/weapons/WeaponDefs.js',
  'src/reboot/world/createVerticalSlice.js', 'src/reboot/lighting/LightingDirector.js', 'src/reboot/lighting/ProceduralSky.js',
  'src/reboot/render/PostFXStack.js', 'src/reboot/render/BodycamPostProcess.js', 'src/reboot/render/MaterialLibrary.js',
  'src/reboot/audio/AudioEngine.js', 'index.html', 'desktop.html', 'ASSET_LICENSES.json'
];
for (const file of required) if (!fs.existsSync(file)) fail(`Missing reboot file: ${file}`);

for (const page of ['index.html', 'desktop.html']) {
  const html = fs.readFileSync(page, 'utf8');
  if (html.includes('three@') || html.includes('main-v4.js')) fail(`Legacy Three.js entry leaked into ${page}`);
  if (!html.includes('./src/reboot/main.js')) fail(`${page} does not load the reboot runtime`);
}
if (!fs.readFileSync('desktop.html', 'utf8').includes("__PROJECT_STRIKE_PLATFORM__")) fail('desktop.html must force the desktop platform');

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
for (const dep of ['@babylonjs/core', '@babylonjs/havok', '@babylonjs/loaders']) if (!pkg.dependencies?.[dep]) fail(`Missing ${dep}`);
if (pkg.dependencies?.three || pkg.dependencies?.['@dimforge/rapier3d-compat']) fail('Legacy engine dependency still active');

// WebGPU runtime contract: the engine downloads glslang + tint from the Babylon CDN the moment a GLSL shader compiles.
// Keep every rendering feature on components that ship WGSL shaders and keep all assets code-generated.
const glslOnly = [
  ['lensRenderingPipeline', 'LensRenderingPipeline (GLSL-only depthOfField/lensHighlights)'],
  ['Pipelines/ssaoRenderingPipeline', 'SSAORenderingPipeline v1 (use SSAO2)'],
  ['screenSpaceReflectionPostProcess', 'ScreenSpaceReflectionPostProcess v1 (use SSRRenderingPipeline)'],
  ['gpuParticleSystem', 'GPUParticleSystem (GLSL-only update shader)'],
  ['standardRenderingPipeline', 'StandardRenderingPipeline'],
  ['refractionPostProcess', 'RefractionPostProcess'],
  ['rectAreaLight', 'RectAreaLight (downloads LTC tables from the CDN)'],
  ['environmentHelper', 'EnvironmentHelper / createDefaultEnvironment (remote textures)'],
];
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const full = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(full) : full.endsWith('.js') ? [full] : [];
});
for (const file of walk('src')) {
  const source = fs.readFileSync(file, 'utf8');
  for (const [needle, label] of glslOnly) if (source.includes(needle)) fail(`${file} imports ${label}`);
  if (/ShadersStore\s*\[/.test(source)) fail(`${file} registers a GLSL shader; use ShaderStore.ShadersStoreWGSL`);
  if (/createDefaultEnvironment|CubeTexture\.CreateFromPrefilteredData/.test(source)) fail(`${file} loads a remote environment`);
  const urls = source.replace(/(^|\s)\/\/.*$/gm, '').match(/https?:\/\/[^\s'"`)]+/g) ?? [];
  if (urls.length) fail(`${file} references remote URLs at runtime: ${urls.join(', ')}`);
}

console.log('Project Strike reboot architecture verification passed.');
