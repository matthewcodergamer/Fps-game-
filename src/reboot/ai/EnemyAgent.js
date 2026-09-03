import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';

export class EnemyAgent{
  constructor(scene){this.scene=scene;this.health=100;this.state='PATROL';this.dead=false;this.root=MeshBuilder.CreateCapsule('enemy-operator',{height:1.8,radius:.34},scene);this.root.position.set(0,.9,-18);const m=new PBRMaterial('enemy-mat',scene);m.albedoColor=Color3.FromHexString('#38474b');m.metallic=.2;m.roughness=.62;this.root.material=m;this.root.metadata={shootable:true,onHit:(hit,damage,dir)=>this.hit(damage,dir)};this.patrol=0;}
  hit(damage,dir){if(this.dead)return;this.health-=damage;this.state='WOUNDED';this.root.position.addInPlace(dir.scale(.06));if(this.health<=0){this.dead=true;this.state='DEAD';this.root.rotation.z=1.42;this.root.position.y=.38;}}
  update(dt,player){if(this.dead)return;const d=Vector3.Distance(player.position,this.root.position);if(d<28)this.state='ENGAGE';else if(this.state!=='WOUNDED')this.state='PATROL';if(this.state==='PATROL'){this.patrol+=dt*.55;this.root.position.x=Math.sin(this.patrol)*2.4;}else if(this.state==='ENGAGE'){this.root.lookAt(new Vector3(player.position.x,this.root.position.y,player.position.z));const to=player.position.subtract(this.root.position);to.y=0;if(d>9)this.root.position.addInPlace(to.normalize().scale(dt*.9));}else if(this.state==='WOUNDED'){this.state='ENGAGE';}}
}
