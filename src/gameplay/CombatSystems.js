import * as THREE from 'three/webgpu';

const _up=new THREE.Vector3(0,1,0);
const _front=new THREE.Vector3(0,0,-1);

function fit(root,size=.18){
  root.updateMatrixWorld(true);
  const b=new THREE.Box3().setFromObject(root),s=b.getSize(new THREE.Vector3()),m=Math.max(s.x,s.y,s.z,.0001);
  root.scale.multiplyScalar(size/m);root.updateMatrixWorld(true);
  const c=new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3());root.position.sub(c);
  return root;
}

export class RecoilController{
  constructor(){this.index=new Map()}
  shot(def){
    const i=this.index.get(def.id)||0,p=def.pattern?.[i%def.pattern.length]||[def.recoil||1,0];
    this.index.set(def.id,i+1);
    return{pitch:(.0095*(def.recoil||1))*p[0],yaw:(.008*(def.recoil||1))*p[1]}
  }
  reset(id){this.index.set(id,0)}
}

export class CombatEffects{
  constructor(scene,{mobile=false}={}){
    this.scene=scene;this.mobile=mobile;this.items=[];this.decals=[];
    this.smokeGeo=new THREE.SphereGeometry(1,6,5);
    this.sparkGeo=new THREE.SphereGeometry(1,4,3);
    this.decalGeo=new THREE.CircleGeometry(1,10);
  }
  add(mesh,{life=1,vel=new THREE.Vector3(),grow=0,fade=true,gravity=0}={}){
    this.scene.add(mesh);this.items.push({mesh,life,maxLife:life,vel,grow,fade,gravity});return mesh
  }
  muzzle(pos,dir){
    const light=new THREE.PointLight(0xffa84f,this.mobile?7:18,4,2);light.position.copy(pos);this.scene.add(light);setTimeout(()=>this.scene.remove(light),32);
    for(let i=0;i<(this.mobile?3:7);i++){
      const mat=new THREE.MeshBasicMaterial({color:i?0xc3c8c8:0xf6f1db,transparent:true,opacity:.18,depthWrite:false});
      const m=new THREE.Mesh(this.smokeGeo,mat);m.position.copy(pos).addScaledVector(dir,.04+Math.random()*.08);m.scale.setScalar(.035+Math.random()*.035);
      const drift=dir.clone().multiplyScalar(.25+Math.random()*.35).add(new THREE.Vector3((Math.random()-.5)*.15,.12+Math.random()*.18,(Math.random()-.5)*.15));
      this.add(m,{life:.65+Math.random()*.55,vel:drift,grow:.55,fade:true});
    }
  }
  impact(point,normal,{kind='concrete',decal=true}={}){
    const colors={metal:0xffe3a0,wood:0xd8a16c,concrete:0xe8d7c2,body:0xb74a3e};
    for(let i=0;i<(this.mobile?3:8);i++){
      const mat=new THREE.MeshBasicMaterial({color:colors[kind]||colors.concrete,transparent:true,opacity:.9});
      const m=new THREE.Mesh(this.sparkGeo,mat);m.scale.setScalar(.005+Math.random()*.006);m.position.copy(point).addScaledVector(normal,.01);
      const tangent=new THREE.Vector3(Math.random()-.5,Math.random()-.15,Math.random()-.5).normalize().multiplyScalar(.7+Math.random()*2.3).addScaledVector(normal,.5+Math.random());
      this.add(m,{life:.1+Math.random()*.18,vel:tangent,gravity:3.5,fade:true});
    }
    if(decal)this.decal(point,normal,kind);
  }
  decal(point,normal,kind='concrete'){
    if(this.decals.length>(this.mobile?45:120)){const old=this.decals.shift();this.scene.remove(old);old.material.dispose()}
    const mat=new THREE.MeshBasicMaterial({color:kind==='body'?0x5d1010:0x171717,transparent:true,opacity:kind==='body'?.62:.78,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2});
    const m=new THREE.Mesh(this.decalGeo,mat);m.scale.setScalar(kind==='body'?.065:.035+Math.random()*.025);m.position.copy(point).addScaledVector(normal,.012);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),normal.clone().normalize());m.rotateZ(Math.random()*Math.PI*2);
    this.scene.add(m);this.decals.push(m)
  }
  explosion(pos,{flash=false}={}){
    const light=new THREE.PointLight(flash?0xffffff:0xff8b3a,this.mobile?24:55,flash?18:14,2);light.position.copy(pos);this.scene.add(light);setTimeout(()=>this.scene.remove(light),flash?120:75);
    const n=this.mobile?12:28;
    for(let i=0;i<n;i++){
      const mat=new THREE.MeshBasicMaterial({color:flash?0xffffff:(i%3?0xff9c4a:0x727272),transparent:true,opacity:.75,depthWrite:false});
      const m=new THREE.Mesh(this.smokeGeo,mat);m.position.copy(pos);m.scale.setScalar(.04+Math.random()*.08);
      const v=new THREE.Vector3(Math.random()-.5,Math.random()*.8,Math.random()-.5).normalize().multiplyScalar(1.4+Math.random()*4);
      this.add(m,{life:.45+Math.random()*.8,vel:v,grow:1.1,fade:true,gravity:flash?0:1.2})
    }
  }
  update(dt){
    for(let i=this.items.length-1;i>=0;i--){
      const p=this.items[i];p.life-=dt;p.vel.y-=p.gravity*dt;p.mesh.position.addScaledVector(p.vel,dt);
      if(p.grow)p.mesh.scale.addScalar(p.grow*dt);
      if(p.fade&&p.mesh.material)p.mesh.material.opacity=Math.max(0,p.life/p.maxLife);
      if(p.life<=0){this.scene.remove(p.mesh);p.mesh.material?.dispose?.();this.items.splice(i,1)}
    }
  }
}

export class ScopeController{
  constructor(element){this.element=element;this.visible=false}
  update(def,ads){
    const next=!!(def?.scope&&ads);if(next===this.visible)return;this.visible=next;
    this.element?.classList.toggle('active',next)
  }
}

export class FootstepController{
  constructor(audio){this.audio=audio;this.acc=0;this.lastMoving=false}
  update(dt,{speed=0,sprint=false,crouch=false,grounded=true}={}){
    const moving=grounded&&speed>.7;
    if(!moving){this.acc=0;this.lastMoving=false;return}
    const interval=crouch?.58:sprint?.27:.4;this.acc+=dt;
    if(this.acc>=interval){
      this.acc%=interval;
      this.audio.playResident('collision',{gain:crouch?.035:sprint?.075:.055,rate:.88+Math.random()*.18})
    }
    this.lastMoving=true
  }
}

export class GrenadeController{
  constructor(scene,assets,audio,effects,{flashElement=null,mobile=false}={}){
    this.scene=scene;this.assets=assets;this.audio=audio;this.effects=effects;this.flashElement=flashElement;this.mobile=mobile;
    this.templates={};this.active=[];this.cooldown=0;
  }
  async load(type,url){
    try{const g=await this.assets.loadGLB(url,{clone:true});const model=fit(g.scene,.18);model.traverse(o=>{if(o.isMesh){o.castShadow=!this.mobile;o.receiveShadow=true}});this.templates[type]=model;return true}
    catch(e){console.info('Grenade model unavailable',type,e);return false}
  }
  async init(assets){await Promise.allSettled(Object.entries(assets).map(([k,v])=>this.load(k,v)))}
  clone(type){
    const t=this.templates[type];if(t)return t.clone(true);
    return new THREE.Mesh(new THREE.IcosahedronGeometry(.08,1),new THREE.MeshStandardMaterial({color:type==='flash'?0xb9c1c6:0x384038,roughness:.5,metalness:.55}))
  }
  throw(type,camera){
    if(this.cooldown>0)return false;this.cooldown=.55;
    const mesh=this.clone(type),p=new THREE.Vector3(.18,-.18,-.48);camera.localToWorld(p);mesh.position.copy(p);this.scene.add(mesh);
    const dir=new THREE.Vector3();camera.getWorldDirection(dir);const vel=dir.multiplyScalar(type==='flash'?11:10).addScaledVector(_up,3.2);
    this.active.push({type,mesh,vel,life:type==='flash'?1.45:2.25,bounces:0});this.audio.playResident('weapons',{gain:.08,rate:1.05});return true
  }
  flashPlayer(pos,playerPos){
    const d=pos.distanceTo(playerPos),strength=THREE.MathUtils.clamp(1-d/20,0,1);if(strength<=0)return;
    const el=this.flashElement;if(el){el.style.setProperty('--flash-strength',String(strength));el.classList.remove('active');void el.offsetWidth;el.classList.add('active');setTimeout(()=>el.classList.remove('active'),1700+strength*900)}
    this.audio.flashRing?.(strength);this.audio.setFlashMuffle?.(strength,1.2+strength*1.4)
  }
  detonate(g,arena,playerPos){
    const pos=g.mesh.position.clone();this.effects.explosion(pos,{flash:g.type==='flash'});
    this.audio.playResident('explosions',{gain:g.type==='flash'?.45:.65,position:pos});
    if(g.type==='flash')this.flashPlayer(pos,playerPos);
    else for(const t of arena.targets){
      if(!t.userData.alive)continue;const d=t.position.distanceTo(pos);if(d<7.5){t.userData.health-=Math.round((1-d/7.5)*130);if(t.userData.health<=0)arena.killTarget(t,new THREE.Vector3().subVectors(t.position,pos).normalize())}
    }
    this.scene.remove(g.mesh)
  }
  update(dt,arena,playerPos){
    this.cooldown=Math.max(0,this.cooldown-dt);
    for(let i=this.active.length-1;i>=0;i--){
      const g=this.active[i];g.life-=dt;g.vel.y-=9.81*dt;g.mesh.position.addScaledVector(g.vel,dt);g.mesh.rotation.x+=8*dt;g.mesh.rotation.z+=6*dt;
      if(g.mesh.position.y<.09){g.mesh.position.y=.09;if(g.vel.y<0){g.vel.y=Math.abs(g.vel.y)*.42;g.vel.x*=.74;g.vel.z*=.74;g.bounces++;this.audio.playResident('collision',{gain:.04,position:g.mesh.position,rate:.9+Math.random()*.2})}}
      if(g.life<=0){this.detonate(g,arena,playerPos);this.active.splice(i,1)}
    }
  }
}