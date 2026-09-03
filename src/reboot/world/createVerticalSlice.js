import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { SpotLight } from '@babylonjs/core/Lights/spotLight.js';
import { PhysicsAggregate } from '@babylonjs/core/Physics/v2/physicsAggregate.js';
import { PhysicsShapeType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin.js';

function pbr(scene,name,color,metallic=0,roughness=.78){const m=new PBRMaterial(name,scene);m.albedoColor=Color3.FromHexString(color);m.metallic=metallic;m.roughness=roughness;return m;}
function staticBox(scene,name,size,pos,mat){const m=MeshBuilder.CreateBox(name,{width:size[0],height:size[1],depth:size[2]},scene);m.position.set(...pos);m.material=mat;new PhysicsAggregate(m,PhysicsShapeType.BOX,{mass:0,friction:.85},scene);return m;}

export function createVerticalSlice(scene){
  scene.clearColor.set(.018,.026,.04,1);
  const hemi=new HemisphericLight('sky-fill',new Vector3(0,1,0),scene);hemi.intensity=.28;hemi.diffuse=new Color3(.42,.55,.72);hemi.groundColor=new Color3(.04,.045,.055);
  const moon=new DirectionalLight('key',new Vector3(-.34,-.8,.48),scene);moon.position=new Vector3(18,30,-20);moon.intensity=2.1;moon.diffuse=new Color3(.62,.76,1);
  const concrete=pbr(scene,'concrete','#20262b',0,.92), asphalt=pbr(scene,'asphalt','#101419',0,.95), metal=pbr(scene,'metal','#252b31',.72,.38), emissive=new StandardMaterial('sign',scene);emissive.emissiveColor=new Color3(.05,.75,1);emissive.diffuseColor=new Color3(.01,.08,.12);
  staticBox(scene,'street',[14,.3,80],[0,-.15,-18],asphalt);staticBox(scene,'left-sidewalk',[4,.5,80],[-9,.05,-18],concrete);staticBox(scene,'right-sidewalk',[4,.5,80],[9,.05,-18],concrete);
  staticBox(scene,'building-shell',[12,8,18],[-11,4,-20],concrete);staticBox(scene,'building-right',[10,6,14],[11,3,-31],metal);
  for(let z=7;z>-55;z-=8){const line=MeshBuilder.CreateBox(`lane-${z}`,{width:.12,height:.015,depth:3.3},scene);line.position.set(0,.015,z);const lm=new StandardMaterial(`lane-mat-${z}`,scene);lm.diffuseColor=new Color3(.55,.58,.55);lm.emissiveColor=new Color3(.04,.04,.035);line.material=lm;}
  const sign=MeshBuilder.CreateBox('neon-sign',{width:5.4,height:.35,depth:.06},scene);sign.position.set(-4.5,3.7,-12);sign.material=emissive;
  const spot=new SpotLight('neon-spill',new Vector3(-4.5,3.6,-11.6),new Vector3(.2,-.7,.8),1.45,8,scene);spot.diffuse=new Color3(.05,.7,1);spot.intensity=24;spot.range=12;
  for(let i=0;i<6;i++)staticBox(scene,`barrier-${i}`,[1.8,1,1],[i%2?3.3:-3.3,.5,-7-i*8],metal);
  return {lights:{hemi,moon,spot}};
}
