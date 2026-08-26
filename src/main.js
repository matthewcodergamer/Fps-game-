import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';
import { AudioManager } from './audio/AudioManager.js';

const $=s=>document.querySelector(s);
const canvas=$('#game');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
renderer.setSize(innerWidth,innerHeight,false);
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.08;

const scene=new THREE.Scene();
scene.background=new THREE.Color(0x89949f);
scene.fog=new THREE.FogExp2(0x89949f,.011);
const camera=new THREE.PerspectiveCamera(76,innerWidth/innerHeight,.05,240);
camera.rotation.order='YXZ';
const clock=new THREE.Clock();
const audio=new AudioManager();

scene.add(new THREE.HemisphereLight(0xc9ddff,0x4b4339,1.55));
const sun=new THREE.DirectionalLight(0xfff1d5,3.0);
sun.position.set(-20,30,15);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);
sun.shadow.camera.left=-48;sun.shadow.camera.right=48;sun.shadow.camera.top=48;sun.shadow.camera.bottom=-48;scene.add(sun);

const world=new THREE.Group();scene.add(world);
const colliders=[];
const makeMat=(c,r=.82,m=.02)=>new THREE.MeshStandardMaterial({color:c,roughness:r,metalness:m});
const mats={concrete:makeMat(0x747876,.96),metal:makeMat(0x35404a,.54,.8),wood:makeMat(0x654934,.9),floor:makeMat(0x505753,.98),dark:makeMat(0x171a1e,.32,.88)};

const floor=new THREE.Mesh(new THREE.PlaneGeometry(120,120),mats.floor);floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;world.add(floor);
function block(x,y,z,sx,sy,sz,material=mats.concrete){const mesh=new THREE.Mesh(new THREE.BoxGeometry(sx,sy,sz),material);mesh.position.set(x,y,z);mesh.castShadow=mesh.receiveShadow=true;world.add(mesh);colliders.push(new THREE.Box3().setFromObject(mesh));return mesh}
// Killhouse blockout: short lanes, center court, flanks and cover.
block(0,2,-24,48,4,2);block(0,2,24,48,4,2);block(-24,2,0,2,4,50);block(24,2,0,2,4,50);
block(-9,1.5,-9,9,3,1,mats.wood);block(9,1.5,-9,9,3,1,mats.wood);block(-12,1.5,6,1,3,13);block(12,1.5,6,1,3,13);
block(0,1.5,13,14,3,1);block(0,1.5,1,8,3,1);block(-18,1,-14,4,2,6,mats.metal);block(18,1,14,4,2,6,mats.metal);
for(let i=0;i<7;i++)block(-19+i*6,.6,19,2.6,1.2,2.6,i%2?mats.metal:mats.wood);

const targets=[];
function addTarget(x,z){const g=new THREE.Group();const body=new THREE.Mesh(new THREE.CapsuleGeometry(.42,.95,4,8),makeMat(0x59645d,.82));body.position.y=1.15;body.castShadow=true;const head=new THREE.Mesh(new THREE.SphereGeometry(.27,16,10),makeMat(0x8b7668,.78));head.position.y=2.03;head.castShadow=true;g.add(body,head);g.position.set(x,0,z);g.userData={health:100,alive:true,respawn:0};scene.add(g);targets.push(g)}
addTarget(0,-17);addTarget(-17,7);addTarget(17,-5);addTarget(6,18);

// Temporary first-person weapon viewmodel. Real GLB weapon/arm rigs plug into this root later.
const viewRoot=new THREE.Group();camera.add(viewRoot);scene.add(camera);
const gun=new THREE.Group();viewRoot.add(gun);
const gunMat=mats.dark,gunMetal=makeMat(0x343a3d,.26,.94),glove=makeMat(0x242a2e,.72,.08);
const receiver=new THREE.Mesh(new THREE.BoxGeometry(.14,.15,.58),gunMat);receiver.position.set(.20,-.22,-.47);gun.add(receiver);
const barrel=new THREE.Mesh(new THREE.CylinderGeometry(.025,.025,.58,12),gunMetal);barrel.rotation.x=Math.PI/2;barrel.position.set(.2,-.18,-.94);gun.add(barrel);
const mag=new THREE.Mesh(new THREE.BoxGeometry(.105,.33,.17),gunMat);mag.position.set(.18,-.42,-.43);mag.rotation.x=-.12;gun.add(mag);
const stock=new THREE.Mesh(new THREE.BoxGeometry(.16,.15,.34),gunMat);stock.position.set(.18,-.22,-.14);gun.add(stock);
const handR=new THREE.Mesh(new THREE.CapsuleGeometry(.075,.36,4,8),glove);handR.rotation.z=-.45;handR.position.set(.28,-.46,-.28);gun.add(handR);
const handL=new THREE.Mesh(new THREE.CapsuleGeometry(.075,.42,4,8),glove);handL.rotation.z=.55;handL.position.set(-.04,-.42,-.69);gun.add(handL);
const muzzleFlash=new THREE.PointLight(0xffb25e,0,4);muzzleFlash.position.set(.2,-.18,-1.24);gun.add(muzzleFlash);gun.position.set(.19,-.08,.06);

const player={pos:new THREE.Vector3(0,1.72,10),vel:new THREE.Vector3(),yaw:0,pitch:0,height:1.72,crouch:false,slide:0,grounded:true,ammo:30,reserve:90,reloading:false,ads:false,cooldown:0};
const keys={};let started=false,firing=false,joy={x:0,y:0},joyId=null,lookTouch=null;
const casings=[];

function collides(pos){const r=.32,feet=pos.y-player.height;const box=new THREE.Box3(new THREE.Vector3(pos.x-r,feet,pos.z-r),new THREE.Vector3(pos.x+r,pos.y+.12,pos.z+r));return colliders.some(c=>c.intersectsBox(box))}
function jump(){if(player.grounded&&!player.crouch){player.grounded=false;player.vel.y=6.15}}
function slideOrCrouch(){const moving=keys.KeyW||Math.hypot(joy.x,joy.y)>.7;if(moving&&!player.crouch){player.slide=.58;player.crouch=true;setTimeout(()=>{if(player.slide<=0)player.crouch=false},600)}else player.crouch=!player.crouch}
function updateAmmo(){$('#ammo').textContent=player.ammo;document.querySelector('.ammo span').textContent='/ '+player.reserve}
function reload(){if(player.reloading||player.ammo===30||player.reserve<=0)return;player.reloading=true;$('#statusText').textContent='RELOADING';const start=performance.now();const timer=setInterval(()=>{const t=Math.min(1,(performance.now()-start)/1150);gun.rotation.z=Math.sin(t*Math.PI)*-.45;mag.position.y=-.42-Math.sin(t*Math.PI)*.34;if(t>=1){clearInterval(timer);gun.rotation.z=0;mag.position.y=-.42;const need=30-player.ammo,take=Math.min(need,player.reserve);player.ammo+=take;player.reserve-=take;player.reloading=false;updateAmmo();$('#statusText').textContent='READY'}},16)}
function casing(){const c=new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,.045,8),makeMat(0xc49a46,.34,.9));c.rotation.z=Math.PI/2;const p=new THREE.Vector3(.34,-.20,-.38);camera.localToWorld(p);c.position.copy(p);c.userData={life:2,vel:new THREE.Vector3(.9+Math.random()*.5,.7+Math.random()*.5,.2-Math.random()*.4).applyQuaternion(camera.quaternion)};scene.add(c);casings.push(c)}
function hitmarker(){const h=$('#hitmarker');h.classList.add('show');setTimeout(()=>h.classList.remove('show'),85)}
function shoot(){if(!started||player.reloading||player.cooldown>0||player.ammo<=0)return;player.cooldown=.095;player.ammo--;updateAmmo();audio.playWeaponShot('lmg_combat');muzzleFlash.intensity=24;setTimeout(()=>muzzleFlash.intensity=0,34);casing();gun.position.z+=.035;gun.rotation.x-=.045;player.pitch=Math.max(-1.45,player.pitch-.012);
 const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(0,0),camera);const hit=ray.intersectObjects(targets.filter(t=>t.userData.alive).flatMap(t=>t.children),false)[0];if(!hit)return;const target=targets.find(t=>t.children.includes(hit.object));if(!target)return;target.userData.health-=hit.object.geometry.type==='SphereGeometry'?100:34;hitmarker();if(target.userData.health<=0){target.userData.alive=false;target.visible=false;target.userData.respawn=2.4}}

function updatePlayer(dt){const forward=new THREE.Vector3(-Math.sin(player.yaw),0,-Math.cos(player.yaw)),right=new THREE.Vector3(Math.cos(player.yaw),0,-Math.sin(player.yaw));let x=(keys.KeyD?1:0)-(keys.KeyA?1:0)+joy.x;let y=(keys.KeyW?1:0)-(keys.KeyS?1:0)-joy.y;const dir=right.multiplyScalar(x).add(forward.multiplyScalar(y));if(dir.lengthSq()>1)dir.normalize();const sprint=(keys.ShiftLeft||keys.ShiftRight||Math.hypot(joy.x,joy.y)>.86)&&y>.1;let speed=player.crouch?2.7:sprint?7.4:4.6;if(player.slide>0){speed=9.1*(player.slide/.58);player.slide=Math.max(0,player.slide-dt)}
 const next=player.pos.clone().addScaledVector(dir,speed*dt);const nx=new THREE.Vector3(next.x,player.pos.y,player.pos.z);if(!collides(nx))player.pos.x=next.x;const nz=new THREE.Vector3(player.pos.x,player.pos.y,next.z);if(!collides(nz))player.pos.z=next.z;
 if(!player.grounded){player.vel.y-=18*dt;player.pos.y+=player.vel.y*dt;if(player.pos.y<=player.height){player.pos.y=player.height;player.vel.y=0;player.grounded=true}}
 player.height=THREE.MathUtils.lerp(player.height,player.crouch?1.18:1.72,1-Math.exp(-12*dt));if(player.grounded)player.pos.y=player.height;
 camera.position.copy(player.pos);camera.rotation.y=player.yaw;camera.rotation.x=player.pitch;const moving=dir.lengthSq()>.02,t=performance.now()*.001;camera.position.y+=moving?Math.sin(t*(sprint?14:9))*(sprint?.014:.008):0;
 const target=player.ads?new THREE.Vector3(-.20,.20,.23):new THREE.Vector3(.19,-.08,.06);gun.position.lerp(target,1-Math.exp(-14*dt));camera.fov=THREE.MathUtils.lerp(camera.fov,player.ads?59:sprint?79:76,1-Math.exp(-10*dt));camera.updateProjectionMatrix();
}

function bindInput(){
 addEventListener('keydown',e=>{keys[e.code]=true;if(e.code==='Space')jump();if(e.code==='KeyR')reload();if(e.code==='KeyC'||e.code==='ControlLeft')slideOrCrouch()});addEventListener('keyup',e=>keys[e.code]=false);
 addEventListener('mousedown',e=>{if(e.button===0)firing=true;if(e.button===2)player.ads=true});addEventListener('mouseup',e=>{if(e.button===0)firing=false;if(e.button===2)player.ads=false});addEventListener('contextmenu',e=>e.preventDefault());
 addEventListener('mousemove',e=>{if(document.pointerLockElement===canvas){player.yaw-=e.movementX*.0022;player.pitch=THREE.MathUtils.clamp(player.pitch-e.movementY*.0022,-1.45,1.45)}});
 const pad=$('#leftPad'),stick=pad.querySelector('.stick');const reset=()=>{joy={x:0,y:0};stick.style.transform='translate(0,0)'};
 pad.addEventListener('touchstart',e=>{joyId=e.changedTouches[0].identifier},{passive:false});pad.addEventListener('touchmove',e=>{e.preventDefault();const t=[...e.changedTouches].find(v=>v.identifier===joyId);if(!t)return;const r=pad.getBoundingClientRect(),dx=t.clientX-(r.left+r.width/2),dy=t.clientY-(r.top+r.height/2),m=Math.min(38,Math.hypot(dx,dy)),a=Math.atan2(dy,dx);joy={x:Math.cos(a)*m/38,y:Math.sin(a)*m/38};stick.style.transform=`translate(${joy.x*38}px,${joy.y*38}px)`},{passive:false});pad.addEventListener('touchend',reset);
 const look=$('#lookZone');look.addEventListener('touchstart',e=>{const t=e.changedTouches[0];lookTouch={id:t.identifier,x:t.clientX,y:t.clientY}},{passive:false});look.addEventListener('touchmove',e=>{e.preventDefault();const t=[...e.changedTouches].find(v=>v.identifier===lookTouch?.id);if(!t)return;const dx=t.clientX-lookTouch.x,dy=t.clientY-lookTouch.y;lookTouch.x=t.clientX;lookTouch.y=t.clientY;player.yaw-=dx*.0045;player.pitch=THREE.MathUtils.clamp(player.pitch-dy*.0045,-1.45,1.45)},{passive:false});look.addEventListener('touchend',()=>lookTouch=null);
 const hold=(el,on,off)=>{el.addEventListener('touchstart',e=>{e.preventDefault();on()},{passive:false});el.addEventListener('touchend',e=>{e.preventDefault();off?.()},{passive:false})};hold($('#fireBtn'),()=>firing=true,()=>firing=false);hold($('#adsBtn'),()=>player.ads=true,()=>player.ads=false);$('#reloadBtn').onclick=reload;$('#jumpBtn').onclick=jump;$('#slideBtn').onclick=slideOrCrouch;
}
bindInput();

$('#playBtn').onclick=async()=>{started=true;$('#boot').classList.add('hidden');$('#hud').classList.remove('hidden');await audio.unlock();if(matchMedia('(pointer:fine)').matches)canvas.requestPointerLock?.()};
$('#audioZip').onchange=async e=>{const files=[...e.target.files];if(!files.length)return;const status=$('#audioStatus');status.textContent=`Importing ${files.length} audio pack${files.length===1?'':'s'}…`;await audio.unlock();audio.clear();let total=0,failed=0;const layers={resident:0,weapons_player:0,dlc_weapons:0};for(let i=0;i<files.length;i++){status.textContent=`Importing audio pack ${i+1} of ${files.length}…`;try{const r=await audio.importZip(files[i]);total+=r.loaded;failed+=r.failed;for(const k of Object.keys(layers))layers[k]+=r.layers[k]}catch(err){failed++;console.error(err)}}status.textContent=`Audio ready · ${total} WAVs · resident ${layers.resident} · weapons ${layers.weapons_player} · DLC ${layers.dlc_weapons}${failed?` · ${failed} skipped`:''}`};

let frames=0,elapsed=0,lastFps=performance.now();
function loop(){requestAnimationFrame(loop);const dt=Math.min(.035,clock.getDelta());if(started){player.cooldown=Math.max(0,player.cooldown-dt);if(firing)shoot();updatePlayer(dt);gun.rotation.x=THREE.MathUtils.lerp(gun.rotation.x,0,1-Math.exp(-18*dt));for(let i=casings.length-1;i>=0;i--){const c=casings[i];c.userData.life-=dt;c.userData.vel.y-=6*dt;c.position.addScaledVector(c.userData.vel,dt);c.rotation.x+=8*dt;c.rotation.z+=12*dt;if(c.position.y<.03){c.position.y=.03;c.userData.vel.multiplyScalar(.28)}if(c.userData.life<=0){scene.remove(c);casings.splice(i,1)}}for(const t of targets){if(!t.userData.alive){t.userData.respawn-=dt;if(t.userData.respawn<=0){t.userData.health=100;t.userData.alive=true;t.visible=true}}}}
 renderer.render(scene,camera);frames++;elapsed+=dt;if(performance.now()-lastFps>500){$('#fps').textContent=Math.round(frames/elapsed)+' FPS';frames=0;elapsed=0;lastFps=performance.now()}}
loop();

addEventListener('resize',()=>{renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix()});
if('serviceWorker'in navigator)addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(()=>{}));
