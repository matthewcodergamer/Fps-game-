import * as THREE from 'three';

export class GrenadeSystem{
  constructor(scene,physics,audio){this.scene=scene;this.physics=physics;this.audio=audio;this.items=[]}
  throw({position,velocity,fuse=3,radius=6,damage=120}={}){
    const mesh=new THREE.Mesh(new THREE.SphereGeometry(.055,10,8),new THREE.MeshStandardMaterial({color:0x303633,roughness:.65,metalness:.35}));mesh.position.copy(position);mesh.castShadow=true;this.scene.add(mesh);let body=null;if(this.physics?.world)body=this.physics.grenade({x:position.x,y:position.y,z:position.z,vx:velocity.x,vy:velocity.y,vz:velocity.z}).body;const item={mesh,body,vel:velocity.clone(),fuse,radius,damage};this.items.push(item);return item
  }
  explode(item,onDamage){const p=item.mesh.position.clone();this.audio?.playResident('explosions',{gain:.9,position:p});const flash=new THREE.PointLight(0xffae54,70,12,2);flash.position.copy(p);this.scene.add(flash);setTimeout(()=>this.scene.remove(flash),80);onDamage?.({position:p,radius:item.radius,damage:item.damage});this.scene.remove(item.mesh);const i=this.items.indexOf(item);if(i>=0)this.items.splice(i,1)}
  update(dt,onDamage){for(const g of [...this.items]){g.fuse-=dt;if(g.body){const p=g.body.translation(),q=g.body.rotation();g.mesh.position.set(p.x,p.y,p.z);g.mesh.quaternion.set(q.x,q.y,q.z,q.w)}else{g.vel.y-=9.81*dt;g.mesh.position.addScaledVector(g.vel,dt);if(g.mesh.position.y<.06){g.mesh.position.y=.06;g.vel.y=Math.abs(g.vel.y)*.35;g.vel.x*=.7;g.vel.z*=.7}}if(g.fuse<=0)this.explode(g,onDamage)}}
}
