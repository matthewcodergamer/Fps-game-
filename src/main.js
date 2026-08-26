import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';
import { AudioManager } from './audio/AudioManager.js';

const canvas=document.querySelector('#game');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
renderer.setSize(innerWidth,innerHeight,false);
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;
const scene=new THREE.Scene();scene.background=new THREE.Color(0x8f9aa5);scene.fog=new THREE.FogExp2(0x8f9aa5,.012);
const camera=new THREE.PerspectiveCamera(76,innerWidth/innerHeight,.05,220);camera.rotation.order='YXZ';
const clock=new THREE.Clock();const audio=new AudioManager();

const hemi=new THREE.HemisphereLight(0xc8ddff,0x4a4036,1.7);scene.add(hemi);
const sun=new THREE.DirectionalLight(0xfff1d2,3.1);sun.position.set(-20,32,15);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-45;sun.shadow.camera.right=45;sun.shadow.camera.top=45;sun.shadow.camera.bottom=-45;scene.add(sun);

const world=new THREE.Group();scene.add(world);
function mat(color,rough=.8,metal=.02){return new THREE.MeshStandardMaterial({color,roughness:rough,metalness:metal})}
const concrete=mat(0x777a77,.95),metal=mat(0x37414b,.58,.75),wood=mat(0x6b4b35,.88),dark=mat(0x171b20,.42,.6);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(120,120),mat(0x555b57,.98));floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;world.add(floor);
function box(x,y,z,sx,sy,sz,m=concrete){const o=new THREE.Mesh(new THREE.BoxGeometry(sx,sy,sz),m);o.position.set(x,y,z);o.castShadow=o.receiveShadow=true;world.add(o);colliders.push(new THREE.Box3().setFromObject(o));return o}
const colliders=[];
// compact Killhouse blockout
box(0,2,-24,48,4,2);box(0,2,24,48,4,2);box(-24,2,0,2,4,50);box(24,2,0,2,4,50);
box(-9,1.5,-9,9,3,1,wood);box(9,1.5,-9,9,3,1,wood);box(-12,1.5,6,1,3,13,concrete);box(12,1.5,6,1,3,13,concrete);
box(0,1.5,13,14,3,1,concrete);box(0,1.5,1,8,3,1,concrete);box(-18,1,-14,4,2,6,metal);box(18,1,14,4,2,6,metal);
for(let i=0;i<7;i++)box(-19+i*6,.6,19,2.6,1.2,2.6,i%2?metal:wood);

// target dummies
const targets=[];
function target(x,z){const g=new THREE.Group();const body=new THREE.Mesh(new THREE.CapsuleGeometry(.42,.95,4,8),mat(0x5b665d,.8));body.position.y=1.15;body.castShadow=true;g.add(body);const head=new THREE.Mesh(new THREE.SphereGeometry(.27,16,10),mat(0x8b7668,.78));head.position.y=2.03;head.castShadow=true;g.add(head);g.position.set(x,0,z);g.userData={health:100,alive:true,respawn:0};scene.add(g);targets.push(g)}
target(0,-17);target(-17,7);target(17,-5);target(6,18);

// FPS viewmodel
const view=new THREE.Group();camera.add(view);scene.add(camera);
const handMat=mat(0x252a2f,.72),gunMat=mat(0x17191b,.3,.86),gunMetal=mat(0x33383c,.28,.92);
const gun=new THREE.Group();view.add(gun);
const receiver=new THREE.Mesh(new THREE.BoxGeometry(.14,.15,.58),gunMat);receiver.position.set(.20,-.22,-.47);gun.add(receiver);
const barrel=new THREE.Mesh(new THREE.CylinderGeometry(.025,.025,.58,12),gunMetal);barrel.rotation.x=Math.PI/2;barrel.position.set(.2,-.18,-.94);gun.add(barrel);
const mag=new THREE.Mesh(new THREE.BoxGeometry(.105,.33,.17),gunMat);mag.position.set(.18,-.42,-.43);mag.rotation.x=-.12;gun.add(mag);
const stock=new THREE.Mesh(new THREE.BoxGeometry(.16,.15,.34),gunMat);stock.position.set(.18,-.22,-.14);gun.add(stock);
const handR=new THREE.Mesh(new THREE.CapsuleGeometry(.075,.36,4,8),handMat);handR.rotation.z=-.45;handR.position.set(.28,-.46,-.28);gun.add(handR);
const handL=new THREE.Mesh(new THREE.CapsuleGeometry(.075,.42,4,8),handMat);handL.rotation.z=.55;handL.position.set(-.04,-.42,-.69);gun.add(handL);
const muzzle=new THREE.Object3D();muzzle.position.set(.2,-.18,-1.24);gun.add(muzzle);
const muzzleFlash=new THREE.PointLight(0xffb45f,0,4);muzzleFlash.position.copy(muzzle.position);gun.add(muzzleFlash);
gun.position.set(.19,-.08,.06);

const casings=[];
function spawnCasing(){const m=new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,.045,8),mat(0xc49a46,.35,.9));m.rotation.z=Math.PI/2;const p=new THREE.Vector3(.34,-.20,-.38);camera.localToWorld(p);m.position.copy(p);m.userData.vel=new THREE.Vector3(.9+Math.random()*.5,.7+Math.random()*.5,.2-Math.random()*.4).applyQuaternion(camera.quaternion);m.userData.life=2;scene.add(m);casings.push(m)}

const player={pos:new THREE.Vector3(0,1.72,10),vel:new THREE.Vector3(),yaw:0,pitch:0,height:1.72,crouch:false,slide:0,grounded:true,ammo:30,reserve:90,reloading:false,ads:false,fireCooldown:0};
const keys={};let started=false;let joy={x:0,y:0};let lookTouch=null,joyTouch=null;let firing=false;
function collides(pos){const r=.32,feet=pos.y-player.height;const pbox=new THREE.Box3(new THREE.Vector3(pos.x-r,feet,pos.z-r),new THREE.Vector3(pos.x+r,pos.y+.15,pos.z+r));return colliders.some(b=>b.intersectsBox(pbox))}
function movePlayer(delta){const f=new THREE.Vector3(-Math.sin(player.yaw),0,-Math.cos(player.yaw)),r=new THREE.Vector3(Math.cos(player.yaw),0,-Math.sin(player.yaw));let ix=0,iy=0;if(keys.KeyW)iy+=1;if(keys.KeyS)iy-=1;if(keys.KeyD)ix+=1;if(keys.KeyA)ix-=1;ix+=joy.x;iy+=-joy.y;const input=r.multiplyScalar(ix).add(f.multiplyScalar(iy));if(input.lengthSq()>1)input.normalize();const sprint=(keys.ShiftLeft||keys.ShiftRight||Math.hypot(joy.x,joy.y)>.86)&&iy>.1;let speed=sprint?7.4:4.6;if(player.crouch)speed=2.7;if(player.slide>0){speed=9.2*(player.slide/.55);player.slide=Math.max(0,player.slide-delta)}
 const next=player.pos.clone().addScaledVector(input,speed*delta);const nx=new THREE.Vector3(next.x,player.pos.y,player.pos.z);if(!collides(nx))player.pos.x=next.x;const nz=new THREE.Vector3(player.pos.x,player.pos.y,next.z);if(!collides(nz))player.pos.z=next.z;
 if(!player.grounded){player.vel.y-=18*delta;player.pos.y+=player.vel.y*delta;if(player.pos.y<=player.height){player.pos.y=player.height;player.vel.y=0;player.grounded=true}}
 const targetH=player.crouch?1.18:1.72;player.height=THREE.MathUtils.lerp(player.height,targetH,1-Math.exp(-12*delta));if(player.grounded)player.pos.y=player.height;
 camera.position.copy(player.pos);camera.rotation.y=player.yaw;camera.rotation.x=player.pitch;
 const t=performance.now()*.001;const moving=input.lengthSq()>.02;const bob=moving?Math.sin(t*(sprint?14:9))*(sprint?.014:.008):0;camera.position.y+=bob;
 const adsTarget=player.ads?new THREE.Vector3(-.20,.20,.23):new THREE.Vector3(.19,-.08,.06);gun.position.lerp(adsTarget,1-Math.exp(-14*delta));
 camera.fov=THREE.MathUtils.lerp(camera.fov,player.ads?59:(sprint?79:76),1-Math.exp(-10*delta));camera.updateProjectionMatrix();
}
function jump(){if(player.grounded&&!player.crouch){player.grounded=false;player.vel.y=6.2}}
function toggleSlide(){const moving=keys.KeyW||Math.hypot(joy.x,joy.y)>.72;if(moving&&!player.crouch){player.slide=.55;player.crouch=true;setTimeout(()=>{player.crouch=false},520)}else player.crouch=!player.crouch}
function reload(){if(player.reloading||player.ammo===30||player.reserve<=0)return;player.reloading=true;document.querySelector('#statusText').textContent='RELOADING';const oldY=gun.position.y;let t0=performance.now();const timer=setInterval(()=>{const t=(performance.now()-t0)/1150;gun.rotation.z=Math.sin(Math.min(1,t)*Math.PI)*-.45;mag.position.y=-.42-Math.sin(Math.min(1,t)*Math.PI)*.35;if(t>=1){clearInterval(timer);gun.rotation.z=0;mag.position.y=-.42;const need=30-player.ammo,take=Math.min(need,player.reserve);player.ammo+=take;player.reserve-=take;player.reloading=false;updateAmmo();document.querySelector('#statusText').textContent='READY'}},16)}
function updateAmmo(){document.querySelector('#ammo').textContent=player.ammo;document.querySelector('.ammo span').textContent='/ '+player.reserve}
function showHit(){const h=document.querySelector('#hitmarker');h.classList.add('show');setTimeout(()=>h.classList.remove('show'),90)}
function shoot(){if(!started||player.reloading||player.fireCooldown>0||player.ammo<=0)return;player.fireCooldown=.095;player.ammo--;updateAmmo();audio.playWeaponShot('lmg_combat');muzzleFlash.intensity=25;setTimeout(()=>muzzleFlash.intensity=0,38);spawnCasing();gun.position.z+=.035;gun.rotation.x-=.045;player.pitch=Math.max(-1.45,player.pitch-.012);
 const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(0,0),camera);const meshes=targets.filter(t=>t.userData.alive).flatMap(t=>t.children);const hits=ray.intersectObjects(meshes,false);if(hits.length){const hit=hits[0],tar=targets.find(t=>t.children.includes(hit.object));if(tar){tar.userData.health-=hit.object.geometry.type==='SphereGeometry'?100:34;showHit();if(tar.userData.health<=0){tar.userData.alive=false;tar.visible=false;tar.userData.respawn=2.4}}}
}

function setupInput(){addEventListener('keydown',e=>{keys[e.code]=true;if(e.code==='Space')jump();if(e.code==='KeyR')reload();if(e.code==='KeyC'||e.code==='ControlLeft')toggleSlide()});addEventListener('keyup',e=>keys[e.code]=false);addEventListener('mousedown',e=>{if(e.button===0)firing=true;if(e.button===2)player.ads=true});addEventListener('mouseup',e=>{if(e.button===0)firing=false;if(e.button===2)player.ads=false});addEventListener('contextmenu',e=>e.preventDefault());addEventListener('mousemove',e=>{if(document.pointerLockElement===canvas){player.yaw-=e.movementX*.0022;player.pitch-=e.movementY*.0022;player.pitch=THREE.MathUtils.clamp(player.pitch,-1.45,1.45)}});
 const left=document.querySelector('#leftPad'),stick=left.querySelector('.stick');const resetJoy=()=>{joy={x:0,y:0};stick.style.transform='translate(0,0)'};left.addEventListener('touchstart',e=>{joyTouch=e.changedTouches[0].identifier},{passive:false});left.addEventListener('touchmove',e=>{e.preventDefault();const t=[...e.changedTouches].find(x=>x.identifier===joyTouch);if(!t)return;const r=left.getBoundingClientRect(),dx=t.clientX-(r.left+r.width/2),dy=t.clientY-(r.top+r.height/2),m=Math.min(38,Math.hypot(dx,dy)),a=Math.atan2(dy,dx);joy={x:Math.cos(a)*m/38,y:Math.sin(a)*m/38};stick.style.transform=`translate(${joy.x*38}px,${joy.y*38}px)`},{passive:false});left.addEventListener('touchend',resetJoy);
 const look=document.querySelector('#lookZone');look.addEventListener('touchstart',e=>{const t=e.changedTouches[0];lookTouch={id:t.identifier,x:t.clientX,y:t.clientY}},{passive:false});look.addEventListener('touchmove',e=>{e.preventDefault();const t=[...e.changedTouches].find(x=>x.identifier===lookTouch?.id);if(!t)return;const dx=t.clientX-lookTouch.x,dy=t.clientY-lookTouch.y;lookTouch.x=t.clientX;lookTouch.y=t.clientY;player.yaw-=dx*.0045;player.pitch-=dy*.0045;player.pitch=THREE.MathUtils.clamp(player.pitch,-1.45,1.45)},{passive:false});look.addEventListener('touchend',()=>lookTouch=null);
 const hold=(el,on,off)=>{el.addEventListener('touchstart',e=>{e.preventDefault();on()},{passive:false});el.addEventListener('touchend',e=>{e.preventDefault();off?.()},{passive:false})};hold(document.querySelector('#fireBtn'),()=>firing=true,()=>firing=false);hold(document.querySelector('#adsBtn'),()=>player.ads=true,()=>player.ads=false);document.querySelector('#reloadBtn').onclick=reload;document.querySelector('#jumpBtn').onclick=jump;document.querySelector('#slideBtn').onclick=toggleSlide;
}
setupInput();

async function start(){started=true;document.querySelector('#boot').classList.add('hidden');document.querySelector('#hud').classList.remove('hidden');await audio.unlock();if(matchMedia('(pointer:fine)').matches)canvas.requestPointerLock?.();}
document.querySelector('#playBtn').onclick=start;
document.querySelector('#audioZip').onchange=async e=>{const f=e.target.files[0];if(!f)return;const s=document.querySelector('#audioStatus');s.textContent='Importing local audio…';try{const r=await audio.importZip(f);s.textContent=`Loaded ${r.loaded} WAVs · resident ${r.layers.resident} · weapons ${r.layers.weapons_player} · DLC ${r.layers.dlc_weapons}`}catch(err){s.textContent='Audio import failed: '+err.message}};

let fpsAcc=0,fpsFrames=0,lastFps=performance.now();
function animate(){requestAnimationFrame(animate);const dt=Math.min(.035,clock.getDelta());if(started){player.fireCooldown=Math.max(0,player.fireCooldown-dt);if(firing)shoot();movePlayer(dt);gun.position.z=THREE.MathUtils.lerp(gun.position.z,player.ads?.23:.06,1-Math.exp(-18*dt));gun.rotation.x=THREE.MathUtils.lerp(gun.rotation.x,0,1-Math.exp(-18*dt));for(let i=casings.length-1;i>=0;i--){const c=casings[i];c.userData.life-=dt;c.userData.vel.y-=6*dt;c.position.addScaledVector(c.userData.vel,dt);c.rotation.x+=8*dt;c.rotation.z+=12*dt;if(c.position.y<.03){c.position.y=.03;c.userData.vel.multiplyScalar(.28)}if(c.userData.life<=0){scene.remove(c);casings.splice(i,1)}}for(const t of targets){if(!t.userData.alive){t.userData.respawn-=dt;if(t.userData.respawn<=0){t.userData.health=100;t.userData.alive=true;t.visible=true}}}}
 renderer.render(scene,camera);fpsFrames++;fpsAcc+=dt;if(performance.now()-lastFps>500){document.querySelector('#fps').textContent=Math.round(fpsFrames/fpsAcc)+' FPS';fpsFrames=0;fpsAcc=0;lastFps=performance.now()}}
animate();
addEventListener('resize',()=>{renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix()});
if('serviceWorker'in navigator)navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
