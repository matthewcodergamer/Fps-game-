import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';

function box(scene, parent, name, size, pos, color, metallic=.85, roughness=.34) {
  const mesh = MeshBuilder.CreateBox(name, { width:size[0], height:size[1], depth:size[2] }, scene);
  mesh.parent = parent; mesh.position.set(...pos); mesh.isPickable = false;
  const mat = new PBRMaterial(`${name}-mat`, scene); mat.albedoColor = Color3.FromHexString(color); mat.metallic = metallic; mat.roughness = roughness; mesh.material = mat;
  return mesh;
}

export function createM4Prototype(scene, camera) {
  const root = new TransformNode('weaponRoot', scene); root.parent = camera; root.position = new Vector3(.24, -.24, .62); root.rotation = new Vector3(.015, Math.PI, 0);
  box(scene, root, 'upper-receiver', [.09,.105,.47], [0,.01,0], '#202328');
  box(scene, root, 'handguard', [.075,.075,.42], [0,.005,-.42], '#24282c');
  box(scene, root, 'stock', [.09,.12,.28], [0,.025,.36], '#181b1f');
  box(scene, root, 'magazine', [.075,.25,.12], [0,-.14,.04], '#171a1e');
  box(scene, root, 'grip', [.065,.19,.08], [0,-.13,.22], '#181b1f');
  const barrel = MeshBuilder.CreateCylinder('barrel', { height:.48, diameter:.035 }, scene); barrel.parent=root; barrel.rotation.x=Math.PI/2; barrel.position.set(0,.015,-.78); barrel.isPickable=false;
  const barrelMat = new PBRMaterial('barrel-mat', scene); barrelMat.albedoColor=Color3.FromHexString('#101215'); barrelMat.metallic=1; barrelMat.roughness=.25; barrel.material=barrelMat;
  const optic = box(scene, root, 'optic', [.08,.08,.12], [0,.11,-.06], '#111316');
  optic.rotation.x = .02;
  const socket = (name, p) => { const n=new TransformNode(name,scene); n.parent=root; n.position=new Vector3(...p); return n; };
  return { root, sockets: {
    grip_right:socket('grip_right',[0,-.08,.19]), grip_left:socket('grip_left',[0,-.08,-.34]), muzzle:socket('muzzle',[0,.015,-1.03]), optic_mount:socket('optic_mount',[0,.12,-.06]), eject:socket('eject',[-.07,.05,-.02]), magazine:socket('magazine',[0,-.16,.04]), charging_handle:socket('charging_handle',[0,.07,.23]), shell_eject:socket('shell_eject',[-.075,.04,-.03])
  }};
}
