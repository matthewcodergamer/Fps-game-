import fs from 'node:fs';
import path from 'node:path';

const publicRoot = path.resolve('public');
const assetRoot = path.join(publicRoot, 'game-assets');

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

function inspectGLB(file) {
  const handle = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(20);
    const bytes = fs.readSync(handle, header, 0, header.length, 0);
    if (bytes < 20 || header.subarray(0, 4).toString('ascii') !== 'glTF') {
      throw new Error(`Invalid GLB header: ${path.relative(assetRoot, file)}`);
    }
    const version = header.readUInt32LE(4);
    if (version !== 2) throw new Error(`Unsupported GLB version ${version}: ${path.relative(assetRoot, file)}`);
    const declaredLength = header.readUInt32LE(8);
    const actualLength = fs.statSync(file).size;
    if (declaredLength !== actualLength) {
      throw new Error(`GLB length mismatch: ${path.relative(assetRoot, file)} (${declaredLength} != ${actualLength})`);
    }
    const jsonLength = header.readUInt32LE(12);
    const jsonType = header.readUInt32LE(16);
    if (jsonType !== 0x4e4f534a) throw new Error(`GLB first chunk is not JSON: ${path.relative(assetRoot, file)}`);
    const jsonBuffer = Buffer.alloc(jsonLength);
    fs.readSync(handle, jsonBuffer, 0, jsonLength, 20);
    const json = JSON.parse(jsonBuffer.toString('utf8').replace(/\u0000+$/g, '').trim());

    if ((json.extensionsRequired || []).includes('KHR_draco_mesh_compression')) {
      throw new Error(`Runtime GLB requires Draco but AssetManager does not install DRACOLoader: ${path.relative(assetRoot, file)}`);
    }

    const external = [];
    for (const buffer of json.buffers || []) if (buffer.uri) external.push(buffer.uri);
    for (const image of json.images || []) if (image.uri) external.push(image.uri);
    for (const uri of external) {
      if (/^(?:data:|https?:|blob:)/i.test(uri)) continue;
      const decoded = decodeURIComponent(uri.split(/[?#]/)[0]);
      const referenced = path.resolve(path.dirname(file), decoded);
      if (!fs.existsSync(referenced)) {
        throw new Error(`Missing GLB dependency ${uri} referenced by ${path.relative(assetRoot, file)}`);
      }
    }
    return json.extensionsRequired || [];
  } finally {
    fs.closeSync(handle);
  }
}

assertFile(path.join(publicRoot, 'service-worker.js'), 'production service worker: public/service-worker.js');
const index = fs.readFileSync(path.resolve('index.html'), 'utf8');
if (!index.includes('src/main-v4.js')) throw new Error('index.html is not booting src/main-v4.js');
if (!index.includes("./service-worker.js?v=6")) throw new Error('index.html is not registering the V6 production service worker');

const glbs = walk(assetRoot).filter(file => file.toLowerCase().endsWith('.glb'));
if (!glbs.length) throw new Error('No runtime GLB files found.');
const requiredExtensions = new Set();
for (const file of glbs) {
  for (const extension of inspectGLB(file)) requiredExtensions.add(extension);
}

const requiredModels = [
  'models/characters/first_person_arms/free_fps_arms_gameready_-_rigged.glb',
  'models/characters/operators/bamen_military_soldier_animated.glb',
  'models/weapons/rifles/colt_m4a1_carbine.glb',
  'models/weapons/pistols/service_pistol.glb',
  'models/environment/buildings/kenney-industrial/enterable/building-a-enterable.glb',
  'models/grenades/high-quality_frag_grenade_3d_model.glb',
  'models/grenades/flashbang.glb'
];
for (const relative of requiredModels) assertFile(path.join(assetRoot, relative), `runtime model: ${relative}`);

const requiredBanks = [
  'lmg_combat',
  'ptl_pistol',
  'lmg_mg_player',
  'smg_smg',
  'sht_pump',
  'snp_rifle',
  'collision',
  'explosions'
];
const manifestPath = path.join(assetRoot, 'audio/audio-manifest.json');
assertFile(manifestPath, 'audio manifest');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const diskFiles = walk(path.join(assetRoot, 'audio'))
  .filter(file => file.toLowerCase().endsWith('.wav'))
  .map(file => path.relative(path.resolve('.'), file).replaceAll('\\', '/'));
const indexedFiles = new Set((manifest.files || []).map(file => file.path));
const missing = diskFiles.filter(file => !indexedFiles.has(file));
if (missing.length) throw new Error(`Audio manifest is missing ${missing.length} WAV files. Run npm run audio:manifest.`);
if (indexedFiles.size !== diskFiles.length) {
  throw new Error(`Audio manifest count mismatch: ${indexedFiles.size} indexed, ${diskFiles.length} on disk.`);
}
const banks = new Set((manifest.files || []).map(file => file.bank));
for (const bank of requiredBanks) {
  if (!banks.has(bank)) throw new Error(`Audio manifest is missing required bank: ${bank}`);
}

console.log(
  `Runtime verified: ${glbs.length} GLBs validated, ${diskFiles.length} WAV files indexed, ` +
  `service worker present, required GLB extensions: ${[...requiredExtensions].sort().join(', ') || 'none'}.`
);
