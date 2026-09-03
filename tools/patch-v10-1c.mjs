import fs from 'node:fs';

function replaceOnce(path, before, after, label) {
  let source = fs.readFileSync(path, 'utf8');
  if (source.includes(after)) return false;
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`V10.1c could not find ${label} in ${path}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`V10.1c found ambiguous ${label} in ${path}`);
  source = source.slice(0, first) + after + source.slice(first + before.length);
  fs.writeFileSync(path, source);
  return true;
}

let changed = false;
const body = 'src/characters/TrueBodyRig.js';
changed |= replaceOnce(
  body,
  `      if (node.isBone) {\n        for (const [key, expression] of Object.entries(BONE_PATTERNS)) {\n          if (!this.bones[key] && expression.test(node.name || '')) {\n            this.bones[key] = node;\n            this.rest.set(node, {\n              quaternion: node.quaternion.clone(),\n              position: node.position.clone(),\n              scale: node.scale.clone()\n            });\n          }\n        }\n      }`,
  `      for (const [key, expression] of Object.entries(BONE_PATTERNS)) {\n        if (!this.bones[key] && expression.test(node.name || '')) {\n          this.bones[key] = node;\n          this.rest.set(node, {\n            quaternion: node.quaternion.clone(),\n            position: node.position.clone(),\n            scale: node.scale.clone()\n          });\n        }\n      }`,
  'Mixamo node mapping without isBone dependency'
);
changed |= replaceOnce(
  body,
  `    const cameraClearance = .27 + slideWeight * .22 + (crouch ? .055 : 0);`,
  `    const cameraClearance = .44 + slideWeight * .30 + (crouch ? .10 : 0);`,
  'stronger camera clearance'
);

const main = 'src/main-v10.js';
changed |= replaceOnce(
  main,
  `        await view.loadWeapon(candidate);\n        if (!view.diagnostics.ik?.active) throw new Error('IK did not bind after weapon switch');`,
  `        await view.loadWeapon(candidate);\n        if (!view.diagnostics.ik?.active) throw new Error('IK did not bind after weapon switch');\n        if (typeof renderer.compileAsync === 'function') await renderer.compileAsync(view.scene, view.camera);\n        else await renderer.compile(view.scene, view.camera);`,
  'controlled WebGPU weapon upload'
);
changed |= replaceOnce(
  main,
  `    view.render(renderer);`,
  `    if (!switchingWeapon) view.render(renderer);`,
  'pause foreground render during weapon hot swap'
);

console.log(changed ? 'Applied V10.1c body mapping and WebGPU hot-swap synchronization.' : 'V10.1c already applied.');
