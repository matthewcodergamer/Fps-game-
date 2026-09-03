import fs from 'node:fs';

const path = 'src/main-v10.js';
let source = fs.readFileSync(path, 'utf8');

if (source.includes("movementSource: movement.source")) {
  console.log('V10 authoritative movement wiring is already installed.');
  process.exit(0);
}

function replaceOnce(before, after, label) {
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`Could not patch ${label}: source contract changed.`);
  if (source.indexOf(before, index + before.length) >= 0) throw new Error(`Could not patch ${label}: source contract is ambiguous.`);
  source = source.slice(0, index) + after + source.slice(index + before.length);
}

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

fs.writeFileSync(path, source);
console.log('Installed V10 authoritative analog movement wiring in src/main-v10.js.');
