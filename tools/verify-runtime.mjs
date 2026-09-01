import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('public/game-assets');
const requiredModels = [
  'models/characters/first_person_arms/free_fps_arms_gameready_-_rigged.glb',
  'models/characters/operators/bamen_military_soldier_animated.glb',
  'models/weapons/rifles/colt_m4a1_carbine.glb',
  'models/weapons/pistols/service_pistol.glb',
  'models/environment/buildings/kenney-industrial/enterable/building-a-enterable.glb'
];
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

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

for (const relative of requiredModels) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) throw new Error(`Missing runtime model: ${relative}`);
  const header = Buffer.alloc(4);
  const handle = fs.openSync(file, 'r');
  fs.readSync(handle, header, 0, 4, 0);
  fs.closeSync(handle);
  if (header.toString('ascii') !== 'glTF') throw new Error(`Invalid GLB header: ${relative}`);
}

const manifestPath = path.join(root, 'audio/audio-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const diskFiles = walk(path.join(root, 'audio'))
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

console.log(`Runtime verified: ${requiredModels.length} core GLBs and ${diskFiles.length} WAV files indexed.`);
