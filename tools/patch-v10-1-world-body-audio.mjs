import fs from 'node:fs';

function replaceOnce(path, before, after, label) {
  let source = fs.readFileSync(path, 'utf8');
  if (source.includes(after)) return false;
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`V10.1 patch could not find ${label} in ${path}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`V10.1 patch found ambiguous ${label} in ${path}`);
  source = source.slice(0, first) + after + source.slice(first + before.length);
  fs.writeFileSync(path, source);
  return true;
}

let changed = false;

// --- main-v10: brighter real world, real weapon switching, body-camera separation, audio tails ---
const main = 'src/main-v10.js';
changed |= replaceOnce(
  main,
  `  renderer.toneMappingExposure = touchDevice ? 1.02 : 0.92;`,
  `  renderer.toneMappingExposure = iOS ? 1.28 : touchDevice ? 1.16 : 1.0;`,
  'WebGPU exposure'
);
changed |= replaceOnce(
  main,
  `  let weaponIndex = 0;\n  let current = {\n    ...WEAPON_CATALOG[weaponIndex],\n    ammo: WEAPON_CATALOG[weaponIndex].mag,\n    currentReserve: WEAPON_CATALOG[weaponIndex].reserve\n  };`,
  `  const weaponStates = WEAPON_CATALOG.map(definition => ({\n    ...definition,\n    ammo: definition.mag,\n    currentReserve: definition.reserve\n  }));\n  let weaponIndex = 0;\n  let current = weaponStates[weaponIndex];`,
  'persistent weapon catalog states'
);
changed |= replaceOnce(
  main,
  `  let started = false;\n  let firing = false;\n  let pointerADS = false;`,
  `  let started = false;\n  let firing = false;\n  let switchingWeapon = false;\n  let pointerADS = false;`,
  'weapon switching state'
);
changed |= replaceOnce(
  main,
  `  function updateHUD() {\n    $('#ammo').textContent = current.ammo;\n    document.querySelector('.ammo span').textContent = \`/ \${current.currentReserve}\`;\n    $('#weaponName').textContent = current.name;\n  }`,
  `  function updateHUD() {\n    $('#ammo').textContent = current.ammo;\n    document.querySelector('.ammo span').textContent = \`/ \${current.currentReserve}\`;\n    $('#weaponName').textContent = current.name;\n    const nextButton = $('#switchBtn');\n    if (nextButton) {\n      let nextIndex = (weaponIndex + 1) % weaponStates.length;\n      if (iOS && weaponStates[nextIndex]?.mobileHeavy) nextIndex = (nextIndex + 1) % weaponStates.length;\n      nextButton.textContent = weaponStates[nextIndex]?.name || 'SWAP';\n      nextButton.title = 'Switch to next real repository weapon';\n    }\n  }`,
  'HUD weapon switch label'
);
changed |= replaceOnce(
  main,
  `  function reload() {`,
  `  function setFiring(value) {\n    const next = Boolean(value);\n    if (next === firing) return;\n    firing = next;\n    if (!started) return;\n    audio.playWeaponMechanical(current.bank, {\n      gain: next ? 0.055 : 0.085,\n      rate: next ? 1.045 : 0.94\n    });\n  }\n\n  async function switchWeapon(step = 1) {\n    if (switchingWeapon || player.reloading) return false;\n    switchingWeapon = true;\n    setFiring(false);\n    pointerADS = false;\n    $('#statusText').textContent = 'SWITCHING WEAPON';\n    const originalIndex = weaponIndex;\n    const originalCurrent = current;\n    let loaded = false;\n    let lastError = null;\n    for (let attempt = 1; attempt <= weaponStates.length; attempt++) {\n      const candidateIndex = (originalIndex + step * attempt + weaponStates.length * 4) % weaponStates.length;\n      const candidate = weaponStates[candidateIndex];\n      if (iOS && candidate.mobileHeavy) continue;\n      try {\n        await view.loadWeapon(candidate);\n        if (!view.diagnostics.ik?.active) throw new Error('IK did not bind after weapon switch');\n        weaponIndex = candidateIndex;\n        current = candidate;\n        player.recoilIndex = 0;\n        loaded = true;\n        audio.prewarm(current.bank).catch(() => {});\n        updateHUD();\n        $('#statusText').textContent = current.name;\n        setTimeout(() => { if (started && !player.reloading) $('#statusText').textContent = 'READY'; }, 520);\n        break;\n      } catch (error) {\n        lastError = error;\n        console.warn('Real weapon switch candidate failed; trying next repository model.', candidate?.name, error);\n      }\n    }\n    if (!loaded) {\n      weaponIndex = originalIndex;\n      current = originalCurrent;\n      updateHUD();\n      $('#statusText').textContent = 'WEAPON LOAD FAILED';\n      console.error('No next repository weapon could be loaded.', lastError);\n      setTimeout(() => { if (started) $('#statusText').textContent = 'READY'; }, 900);\n    }\n    switchingWeapon = false;\n    return loaded;\n  }\n\n  function reload() {`,
  'real weapon switch function'
);
changed |= replaceOnce(
  main,
  `    audio.playWeaponShot(current.bank, { gain: current.suppressed ? 0.58 : 0.82 });`,
  `    audio.playWeaponShot(current.bank, { gain: current.suppressed ? 0.58 : 0.82 });\n    setTimeout(() => {\n      if (started) audio.playWeaponMechanical(current.bank, { gain: current.class === 'pistol' ? 0.085 : 0.11, rate: 0.96 + Math.random() * 0.05 });\n    }, current.class === 'pistol' ? 22 : 34);`,
  'weapon mechanical tail'
);
changed |= replaceOnce(
  main,
  `      if (event.button === 0) firing = true;`,
  `      if (event.button === 0) setFiring(true);`,
  'desktop fire press'
);
changed |= replaceOnce(
  main,
  `      if (event.button === 0) firing = false;`,
  `      if (event.button === 0) setFiring(false);`,
  'desktop fire release'
);
changed |= replaceOnce(
  main,
  `    hold($('#fireBtn'), () => { firing = true; }, () => { firing = false; });`,
  `    hold($('#fireBtn'), () => setFiring(true), () => setFiring(false));`,
  'mobile fire hold'
);
changed |= replaceOnce(
  main,
  `    $('#switchBtn').onclick = () => {\n      $('#statusText').textContent = 'V10 CORE LOADOUT';\n      setTimeout(() => { if (started) $('#statusText').textContent = 'READY'; }, 650);\n    };`,
  `    $('#switchBtn').onclick = () => { switchWeapon(1).catch(error => console.error('Weapon switch failed.', error)); };`,
  'weapon switch button'
);
changed |= replaceOnce(
  main,
  `      if (event.code === 'KeyV') throwGrenade('flash');`,
  `      if (event.code === 'KeyV') throwGrenade('flash');\n      if (event.code === 'KeyQ') switchWeapon(1).catch(error => console.error('Weapon switch failed.', error));`,
  'keyboard weapon switch'
);
changed |= replaceOnce(
  main,
  `      position: camera.position,`,
  `      position: player.pos,`,
  'true body authoritative position'
);
changed |= replaceOnce(
  main,
  `    await audio.unlock();\n    audio.prewarm(current.bank).catch(() => {});`,
  `    await audio.unlock();\n    audio.setEnvironment?.('industrial');\n    audio.prewarm(current.bank).catch(() => {});`,
  'industrial audio environment'
);
changed |= replaceOnce(
  main,
  `    runtime: 'v10',`,
  `    runtime: 'v10.1',`,
  'runtime version diagnostic'
);
changed |= replaceOnce(
  main,
  `    requiredWorldModels: arena.required,`,
  `    requiredWorldModels: arena.required,\n    worldVisible: true,\n    worldLighting: arena.lighting,\n    weaponSwitching: 'real-repository-models',\n    audioEnvironment: 'industrial-convolution',`,
  'world/audio diagnostics'
);
changed |= replaceOnce(
  main,
  `  $('#stageBadge').textContent = 'V10';`,
  `  $('#stageBadge').textContent = 'V10.1';`,
  'stage version badge'
);

// --- true body: keep the head/helmet behind the eye point, especially during slide ---
const body = 'src/characters/TrueBodyRig.js';
changed |= replaceOnce(
  body,
  `  head: /(?:^|:)Head$/i,`,
  `  head: /(?:^|:)Head$/i,\n  neck: /(?:^|:)Neck$/i,`,
  'neck bone mapping'
);
changed |= replaceOnce(
  body,
  `      for (const key of ['head', 'leftShoulder', 'leftArm', 'rightShoulder', 'rightArm']) {`,
  `      for (const key of ['head', 'neck', 'leftShoulder', 'leftArm', 'rightShoulder', 'rightArm']) {`,
  'camera-facing bone suppression'
);
changed |= replaceOnce(
  body,
  `    const safeDt = THREE.MathUtils.clamp(dt || 0, 0, 1 / 30);\n    const feetY = position.y - eyeHeight;\n    this.root.position.set(position.x, feetY, position.z);\n    this.root.rotation.y = yaw;\n\n    const moveBlend = THREE.MathUtils.clamp(speed / 5.4, 0, 1);`,
  `    const safeDt = THREE.MathUtils.clamp(dt || 0, 0, 1 / 30);\n    const feetY = position.y - eyeHeight;\n    const slideWeight = THREE.MathUtils.clamp(slide / .68, 0, 1);\n    const forwardX = -Math.sin(yaw);\n    const forwardZ = -Math.cos(yaw);\n    const cameraClearance = .27 + slideWeight * .22 + (crouch ? .055 : 0);\n    this.root.position.set(\n      position.x - forwardX * cameraClearance,\n      feetY,\n      position.z - forwardZ * cameraClearance\n    );\n    this.root.rotation.y = yaw;\n\n    const moveBlend = THREE.MathUtils.clamp(speed / 5.4, 0, 1);`,
  'camera-safe body root'
);
changed |= replaceOnce(
  body,
  `    const crouchDrop = crouch ? .23 : 0;\n    const slideWeight = THREE.MathUtils.clamp(slide / .68, 0, 1);\n    const lookDown = THREE.MathUtils.clamp(-pitch / 1.2, 0, 1);\n    this.root.position.y -= crouchDrop + landImpulse * .03;\n    this.root.position.z += slideWeight * .08;`,
  `    const crouchDrop = crouch ? .23 : 0;\n    const lookDown = THREE.MathUtils.clamp(-pitch / 1.2, 0, 1);\n    this.root.position.y -= crouchDrop + slideWeight * .08 + landImpulse * .03;`,
  'slide body clearance'
);
changed |= replaceOnce(
  body,
  `    this.root.rotation.x = THREE.MathUtils.damp(this.root.rotation.x, slideWeight * .16, 14, safeDt);`,
  `    this.root.rotation.x = THREE.MathUtils.damp(this.root.rotation.x, slideWeight * .11, 14, safeDt);\n    globalThis.__PROJECT_STRIKE_TRUE_BODY_CLEARANCE__ = { cameraClearance, slideWeight, root: this.root.position.toArray() };`,
  'body clearance diagnostic'
);

// --- world visibility: brighter PBR-friendly lighting while retaining night mood ---
const world = 'src/world/RealisticDistrictV10.js';
changed |= replaceOnce(world, `  gradient.addColorStop(0, '#030611');`, `  gradient.addColorStop(0, '#07101f');`, 'sky zenith');
changed |= replaceOnce(world, `  gradient.addColorStop(0.48, '#111b31');`, `  gradient.addColorStop(0.48, '#243652');`, 'sky midtone');
changed |= replaceOnce(world, `  gradient.addColorStop(0.74, '#542238');`, `  gradient.addColorStop(0.74, '#744054');`, 'sky horizon');
changed |= replaceOnce(world, `  const asphalt = new THREE.MeshStandardMaterial({ color: 0x2a2b2d, roughness: 0.91, metalness: 0.02 });`, `  const asphalt = new THREE.MeshStandardMaterial({ color: 0x3b3e43, roughness: 0.91, metalness: 0.02 });`, 'asphalt visibility');
changed |= replaceOnce(world, `  const concrete = new THREE.MeshStandardMaterial({ color: 0x67696d, roughness: 0.89, metalness: 0.03 });`, `  const concrete = new THREE.MeshStandardMaterial({ color: 0x858991, roughness: 0.89, metalness: 0.03 });`, 'concrete visibility');
changed |= replaceOnce(
  world,
  `    const light = new THREE.PointLight(color, mobile ? 4.8 : 8.5, 12, 2);`,
  `    const light = new THREE.PointLight(color, mobile ? 7.2 : 10.5, 15, 2);`,
  'practical light intensity'
);
changed |= replaceOnce(
  world,
  `  const sun = new THREE.DirectionalLight(0xffbd91, mobile ? 2.1 : 2.6);`,
  `  const sun = new THREE.DirectionalLight(0xffc9a6, mobile ? 3.5 : 3.1);`,
  'directional light intensity'
);
changed |= replaceOnce(
  world,
  `  root.add(sun, new THREE.HemisphereLight(0x7f9ed0, 0x160e1a, mobile ? 0.95 : 0.72));`,
  `  const hemisphere = new THREE.HemisphereLight(0xa7c5ed, 0x241827, mobile ? 1.55 : 1.05);\n  const ambient = new THREE.AmbientLight(0x71809a, mobile ? 0.72 : 0.42);\n  root.add(sun, hemisphere, ambient);`,
  'PBR fill lighting'
);
changed |= replaceOnce(
  world,
  `    operatorUrl: OPERATOR_URL`,
  `    operatorUrl: OPERATOR_URL,\n    lighting: {\n      sun: sun.intensity,\n      hemisphere: hemisphere.intensity,\n      ambient: ambient.intensity,\n      practicalCount: practicals.length\n    }`,
  'world lighting diagnostics'
);

// --- Web Audio: real convolution reverb/early reflections for weapon space ---
const audio = 'src/audio/AudioManager.js';
changed |= replaceOnce(
  audio,
  `export class AudioManager {`,
  `function createIndustrialImpulse(ctx, seconds = 1.35, decay = 3.15) {\n  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));\n  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);\n  for (let channel = 0; channel < 2; channel++) {\n    const data = impulse.getChannelData(channel);\n    for (let i = 0; i < length; i++) {\n      const t = i / length;\n      const envelope = Math.pow(1 - t, decay);\n      const early = i < ctx.sampleRate * .09 ? 1.35 : 1;\n      data[i] = (Math.random() * 2 - 1) * envelope * early * .34;\n    }\n  }\n  return impulse;\n}\n\nexport class AudioManager {`,
  'industrial impulse helper'
);
changed |= replaceOnce(
  audio,
  `    this.compressor = null;`,
  `    this.compressor = null;\n    this.weaponDry = null;\n    this.reverbConvolver = null;\n    this.reverbGain = null;`,
  'audio reverb fields'
);
changed |= replaceOnce(
  audio,
  `      this.weaponBus = this.ctx.createGain();\n      this.weaponBus.gain.value = .92;\n      this.compressor = this.ctx.createDynamicsCompressor();`,
  `      this.weaponBus = this.ctx.createGain();\n      this.weaponBus.gain.value = .92;\n      this.weaponDry = this.ctx.createGain();\n      this.weaponDry.gain.value = .94;\n      this.reverbConvolver = this.ctx.createConvolver();\n      this.reverbConvolver.normalize = true;\n      this.reverbConvolver.buffer = createIndustrialImpulse(this.ctx);\n      this.reverbGain = this.ctx.createGain();\n      this.reverbGain.gain.value = .18;\n      this.compressor = this.ctx.createDynamicsCompressor();`,
  'audio node creation'
);
changed |= replaceOnce(
  audio,
  `      this.weaponBus.connect(this.compressor);\n      this.compressor.connect(this.master);\n      this.master.connect(this.ctx.destination);`,
  `      this.weaponBus.connect(this.weaponDry);\n      this.weaponDry.connect(this.compressor);\n      this.weaponBus.connect(this.reverbConvolver);\n      this.reverbConvolver.connect(this.reverbGain);\n      this.reverbGain.connect(this.master);\n      this.compressor.connect(this.master);\n      this.master.connect(this.ctx.destination);`,
  'weapon dry/wet routing'
);
changed |= replaceOnce(
  audio,
  `  clear() {`,
  `  setEnvironment(name = 'industrial') {\n    if (!this.ctx || !this.reverbGain || !this.weaponDry) return;\n    const spaces = { open: [.08, .98], street: [.13, .97], industrial: [.22, .94], interior: [.34, .9] };\n    const [wet, dry] = spaces[name] || spaces.industrial;\n    const now = this.ctx.currentTime;\n    this.reverbGain.gain.cancelScheduledValues(now);\n    this.weaponDry.gain.cancelScheduledValues(now);\n    this.reverbGain.gain.setTargetAtTime(wet, now, .045);\n    this.weaponDry.gain.setTargetAtTime(dry, now, .035);\n    globalThis.__PROJECT_STRIKE_AUDIO_ENVIRONMENT__ = { name, wet, dry, convolution: true };\n  }\n\n  clear() {`,
  'audio environment API'
);

console.log(changed ? 'Applied Project Strike V10.1 world/body/weapon/audio fixes.' : 'Project Strike V10.1 fixes already applied.');
