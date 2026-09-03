import fs from 'node:fs';

const path = 'src/main-v10.js';
let source = fs.readFileSync(path, 'utf8');
let changed = false;

function replaceOnce(before, after, label) {
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`Could not patch ${label}: source contract changed.`);
  if (source.indexOf(before, index + before.length) >= 0) throw new Error(`Could not patch ${label}: source contract is ambiguous.`);
  source = source.slice(0, index) + after + source.slice(index + before.length);
  changed = true;
}

if (!source.includes("movementSource: movement.source")) {
  replaceOnce(
  `  function slideOrCrouch() {\n    const moving = player.moveVelocity.length() > 1.1 || Math.hypot(touch.joy.x, touch.joy.y) > 0.62 || keys.KeyW;`,
  `  function movementAxes() {\n    const bridge = globalThis.__PROJECT_STRIKE_MOBILE_INPUT_BRIDGE__;\n    const bridgeReady = Boolean(touchDevice && bridge?.analogAuthoritative);\n    const x = bridgeReady && Number.isFinite(bridge?.x) ? bridge.x : touch.joy.x;\n    const y = bridgeReady && Number.isFinite(bridge?.y) ? bridge.y : touch.joy.y;\n    return { x, y, source: bridgeReady ? 'authoritative-mobile-bridge' : touch.joyPointer != null ? 'direct-pointer' : 'keyboard' };\n  }\n\n  function slideOrCrouch() {\n    const movement = movementAxes();\n    const moving = player.moveVelocity.length() > 1.1 || Math.hypot(movement.x, movement.y) > 0.62 || keys.KeyW;`,
    'movementAxes/slide input'
  );

  replaceOnce(
  `    let x = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + touch.joy.x;\n    let y = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) - touch.joy.y;`,
  `    const movement = movementAxes();\n    let x = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + movement.x;\n    let y = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) - movement.y;`,
    'updatePlayer movement input'
  );

  replaceOnce(
  `      joy: { ...touch.joy },\n      yaw: player.yaw,`,
  `      joy: { x: movement.x, y: movement.y },\n      movementSource: movement.source,\n      yaw: player.yaw,`,
    'movement diagnostics'
  );

  replaceOnce(
  `    mobilePointerMovement: true,`,
  `    mobilePointerMovement: 'authoritative-analog-bridge',`,
    'runtime movement diagnostics'
  );
}

for (const [before, after, label] of [
  [
    `      pad.setPointerCapture?.(event.pointerId);\n      event.preventDefault();`,
    `      try { pad.setPointerCapture?.(event.pointerId); } catch {}\n      event.preventDefault();`,
    'movement pointer capture'
  ],
  [
    `      lookZone.setPointerCapture?.(event.pointerId);\n      event.preventDefault();`,
    `      try { lookZone.setPointerCapture?.(event.pointerId); } catch {}\n      event.preventDefault();`,
    'look pointer capture'
  ],
  [
    `        element.setPointerCapture?.(event.pointerId);\n        on();`,
    `        try { element.setPointerCapture?.(event.pointerId); } catch {}\n        on();`,
    'button pointer capture'
  ]
]) {
  if (source.includes(before)) replaceOnce(before, after, label);
}

if (!source.includes("frameDriver: 'requestAnimationFrame-after-webgpu-init'")) {
  replaceOnce(
`    mobilePointerMovement: 'authoritative-analog-bridge',\n    realRepositoryModels: true,`,
`    mobilePointerMovement: 'authoritative-analog-bridge',\n    frameDriver: 'requestAnimationFrame-after-webgpu-init',\n    realRepositoryModels: true,`,
    'frame driver diagnostics'
  );
}

if (source.includes('  renderer.setAnimationLoop(() => {')) {
  replaceOnce(
`  renderer.setAnimationLoop(() => {\n    const dt = Math.min(1 / 30, clock.getDelta());\n    if (started) {\n      updatePlayer(dt);\n      player.cooldown = Math.max(0, player.cooldown - dt);\n      if (firing) shoot();\n    } else {\n      camera.position.set(0, 2.05, 13);\n      camera.rotation.set(-0.025, 0, 0, 'YXZ');\n      view.update(dt, { time: performance.now() * 0.001, speed: 0, stepPhase: 0 });\n    }\n\n    arena.update(dt, performance.now() * 0.001);\n    grenades.update(dt, arena, player.pos);\n    vfx.update(dt);\n\n    renderer.autoClear = true;\n    renderer.render(scene, camera);\n    renderer.autoClear = false;\n    renderer.clearDepth();\n    view.render(renderer);\n    renderer.autoClear = true;\n\n    fpsFrames++;\n    fpsElapsed += dt;\n    if (fpsElapsed >= 0.5) {\n      $('#fps').textContent = \`${'${Math.round(fpsFrames / fpsElapsed)}'} FPS\`;\n      fpsFrames = 0;\n      fpsElapsed = 0;\n    }\n  });`,
`  let frameHandle = 0;\n  let frameFatal = false;\n  function frame() {\n    if (frameFatal) return;\n    frameHandle = requestAnimationFrame(frame);\n    const dt = Math.min(1 / 30, clock.getDelta());\n    if (!started) {\n      camera.position.set(0, 2.05, 13);\n      camera.rotation.set(-0.025, 0, 0, 'YXZ');\n      view.update(dt, { time: performance.now() * 0.001, speed: 0, stepPhase: 0 });\n    }\n    arena.update(dt, performance.now() * 0.001);\n    vfx.update(dt);\n    try {\n      renderer.autoClear = true;\n      renderer.render(scene, camera);\n      renderer.autoClear = false;\n      renderer.clearDepth();\n      view.render(renderer);\n      renderer.autoClear = true;\n    } catch (error) {\n      frameFatal = true;\n      cancelAnimationFrame(frameHandle);\n      fatal(error);\n      return;\n    }\n    fpsFrames++;\n    fpsElapsed += dt;\n    if (fpsElapsed >= 0.5) {\n      $('#fps').textContent = \`${'${Math.round(fpsFrames / fpsElapsed)}'} FPS\`;\n      fpsFrames = 0;\n      fpsElapsed = 0;\n    }\n  }\n  frame();`,
    'WebGPU gameplay frame loop'
  );
}

if (!source.includes("simulationDriver: 'fixed-timer-independent-of-render'")) {
  replaceOnce(
`    frameDriver: 'requestAnimationFrame-after-webgpu-init',\n    realRepositoryModels: true,`,
`    frameDriver: 'requestAnimationFrame-after-webgpu-init',\n    simulationDriver: 'fixed-timer-independent-of-render',\n    realRepositoryModels: true,`,
    'simulation driver diagnostics'
  );
}

if (!source.includes('function simulationTick()')) {
  const insertionPoint = `  playButton.onclick = async () => {\n`;
  const simulation = `  let simulationLast = performance.now();\n  let simulationTicks = 0;\n  function simulationTick() {\n    const now = performance.now();\n    const dt = Math.min(1 / 30, Math.max(1 / 240, (now - simulationLast) / 1000));\n    simulationLast = now;\n    if (started) {\n      updatePlayer(dt);\n      player.cooldown = Math.max(0, player.cooldown - dt);\n      if (firing) shoot();\n      grenades.update(dt, arena, player.pos);\n      simulationTicks++;\n      if (globalThis.__PROJECT_STRIKE_DIAGNOSTICS__) {\n        globalThis.__PROJECT_STRIKE_DIAGNOSTICS__.simulationTicks = simulationTicks;\n        globalThis.__PROJECT_STRIKE_DIAGNOSTICS__.lastSimulationAt = now;\n      }\n    }\n  }\n  const simulationTimer = setInterval(simulationTick, 1000 / 60);\n  addEventListener('pagehide', () => clearInterval(simulationTimer), { once: true });\n\n`;
  replaceOnce(insertionPoint, simulation + insertionPoint, 'fixed simulation loop');
}

// Once a fixed simulation owns gameplay, remove duplicate gameplay updates from
// the presentation frame if a previous migration already installed them.
const oldRafGameplay = `    if (started) {\n      updatePlayer(dt);\n      player.cooldown = Math.max(0, player.cooldown - dt);\n      if (firing) shoot();\n    } else {\n      camera.position.set(0, 2.05, 13);\n      camera.rotation.set(-0.025, 0, 0, 'YXZ');\n      view.update(dt, { time: performance.now() * 0.001, speed: 0, stepPhase: 0 });\n    }\n\n    arena.update(dt, performance.now() * 0.001);\n    grenades.update(dt, arena, player.pos);\n    vfx.update(dt);`;
const newRafPresentation = `    if (!started) {\n      camera.position.set(0, 2.05, 13);\n      camera.rotation.set(-0.025, 0, 0, 'YXZ');\n      view.update(dt, { time: performance.now() * 0.001, speed: 0, stepPhase: 0 });\n    }\n    arena.update(dt, performance.now() * 0.001);\n    vfx.update(dt);`;
if (source.includes(oldRafGameplay)) replaceOnce(oldRafGameplay, newRafPresentation, 'decouple gameplay from rAF');

if (!changed) {
  console.log('V10 authoritative input, fixed simulation, and WebGPU presentation wiring are already installed.');
  process.exit(0);
}

fs.writeFileSync(path, source);
console.log('Installed V10 authoritative input, fixed simulation, and independent WebGPU presentation.');
