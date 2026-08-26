import * as THREE from 'three';

const COLORS={concrete:0xb5afa2,metal:0xffd68c,wood:0xb28a61,dirt:0x967d59,glass:0xc8eaff,flesh:0x9d3535};
export class ImpactSystem{
  constructor(scene,{maxDecals=120}={}){this.scene=scene;this.maxDecals=maxDecals;this.decals=[];this.particles=[]}
  impact(point,normal,type='concrete'){
    const group=new THREE.Group();group.position.copy(point).addScaledVector(normal,.006);group.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),normal);
    const mark=new THREE.Mesh(new THREE.CircleGeometry(type==='metal'?.018:.026,10),new THREE.MeshBasicMaterial({color:type==='flesh'?0x481313:0x1f1f1d,transparent:true,opacity:.72,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-4}));group.add(mark);this.scene.add(group);this.decals.push(group);if(this.decals.length>this.maxDecals)this.scene.remove(this.decals.shift());
    const count=type==='metal'?5:3;for(let i=0;i<count;i++){const p=new THREE.Mesh(new THREE.SphereGeometry(.006,4,3),new THREE.MeshBasicMaterial({color:COLORS[type]||COLORS.concrete}));p.position.copy(point);p.userData={life:.18+Math.random()*.2,vel:normal.clone().multiplyScalar(.4+Math.random()*1.8).add(new THREE.Vector3((Math.random()-.5)*.8,Math.random()*.8,(Math.random()-.5)*.8))};this.scene.add(p);this.particles.push(p)}
  }
  update(dt){for(let i=this.particles.length-1;i>=0;i--){const p=this.particles[i];p.userData.life-=dt;p.userData.vel.y-=5*dt;p.position.addScaledVector(p.userData.vel,dt);p.scale.multiplyScalar(.97);if(p.userData.life<=0){p.geometry.dispose();p.material.dispose();this.scene.remove(p);this.particles.splice(i,1)}}}
}
