import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { PhysicsAggregate } from '@babylonjs/core/Physics/v2/physicsAggregate.js';
import { PhysicsShapeType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin.js';

export class GrenadeSystem{
  constructor(scene,camera){this.scene=scene;this.camera=camera;this.active=[];}
  throw(){const mesh=MeshBuilder.CreateSphere('frag',{diameter:.12,segments:8},this.scene);mesh.position.copyFrom(this.camera.globalPosition);const mat=new StandardMaterial('frag-mat',this.scene);mat.diffuseColor=new Color3(.13,.16,.12);mesh.material=mat;const agg=new PhysicsAggregate(mesh,PhysicsShapeType.SPHERE,{mass:.4,restitution:.3,friction:.75},this.scene);const dir=this.camera.getDirection(new Vector3(0,0,1)).normalize();agg.body.applyImpulse(dir.scale(5.8).add(new Vector3(0,2.4,0)),mesh.getAbsolutePosition());this.active.push({mesh,agg,t:2.8});}
  update(dt){for(let i=this.active.length-1;i>=0;i--){const g=this.active[i];g.t-=dt;if(g.t<=0){this.explode(g.mesh.getAbsolutePosition());g.agg.dispose();g.mesh.dispose();this.active.splice(i,1);}}}
  explode(position){for(const mesh of this.scene.meshes){if(!mesh.metadata?.shootable)continue;const delta=mesh.getAbsolutePosition().subtract(position);const d=delta.length();if(d<7){const damage=Math.max(0,90*(1-d/7));mesh.metadata.onHit?.({pickedPoint:mesh.position.clone()},damage,delta.normalize());}}}
}
