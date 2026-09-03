import fs from 'node:fs';
const required=['src/reboot/main.js','src/reboot/core/createEngine.js','src/reboot/physics/HavokWorld.js','src/reboot/player/StrikeCharacterController.js','src/reboot/weapons/RifleSystem.js','src/reboot/world/createVerticalSlice.js','ASSET_LICENSES.json'];
for(const file of required){if(!fs.existsSync(file))throw new Error(`Missing reboot file: ${file}`)}
const index=fs.readFileSync('index.html','utf8');
if(index.includes('three@')||index.includes('main-v4.js'))throw new Error('Legacy Three.js entry leaked into reboot index');
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
for(const dep of ['@babylonjs/core','@babylonjs/havok','@babylonjs/loaders'])if(!pkg.dependencies?.[dep])throw new Error(`Missing ${dep}`);
if(pkg.dependencies?.three||pkg.dependencies?.['@dimforge/rapier3d-compat'])throw new Error('Legacy engine dependency still active');
console.log('Project Strike reboot architecture verification passed.');
