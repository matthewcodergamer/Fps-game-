import { Scene } from '@babylonjs/core/scene.js';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import '@babylonjs/core/Physics/physicsEngineComponent.js';
import '@babylonjs/loaders/glTF/index.js';
import { detectDeviceProfile } from './core/DeviceProfile.js';
import { createStrikeEngine } from './core/createEngine.js';
import { enableHavok } from './physics/HavokWorld.js';
import { InputRouter } from './player/InputRouter.js';
import { StrikeCharacterController } from './player/StrikeCharacterController.js';
import { createVerticalSlice } from './world/createVerticalSlice.js';
import { createM4Prototype } from './weapons/createM4Prototype.js';
import { CombatVFX } from './vfx/CombatVFX.js';
import { RifleSystem } from './weapons/RifleSystem.js';
import { EnemyAgent } from './ai/EnemyAgent.js';
import { GrenadeSystem } from './physics/GrenadeSystem.js';
import { HUD } from './ui/HUD.js';
import { validateWeaponContract } from './assets/AssetContract.js';

const hud=new HUD();
async function boot(){
  await window.__PROJECT_STRIKE_PREBOOT__;
  const canvas=document.querySelector('#game');const profile=detectDeviceProfile();hud.capability(profile);hud.progress(10,'Initializing Babylon WebGPU engine…');
  const engine=await createStrikeEngine(canvas,profile);hud.progress(28,'Creating clean scene graph…');
  const scene=new Scene(engine);scene.skipPointerMovePicking=true;scene.autoClear=true;
  const camera=new UniversalCamera('fps-camera',new Vector3(0,2,9),scene);camera.minZ=.03;camera.maxZ=220;camera.fov=.92;camera.inputs.clear();scene.activeCamera=camera;
  hud.progress(42,'Starting Havok WASM and Physics V2…');await enableHavok(scene);hud.physicsReady();
  hud.progress(58,'Building one-street vertical slice…');createVerticalSlice(scene);
  hud.progress(68,'Creating Havok character controller…');const player=new StrikeCharacterController(scene,camera);const input=new InputRouter(canvas);
  hud.progress(78,'Creating independent aim / weapon / camera recoil layers…');const weapon=createM4Prototype(scene,camera);validateWeaponContract(weapon);const vfx=new CombatVFX(scene,weapon.sockets.muzzle);const rifle=new RifleSystem(scene,camera,weapon,vfx,hud);const grenade=new GrenadeSystem(scene,camera);
  hud.progress(88,'Spawning one combat agent…');const enemy=new EnemyAgent(scene);
  hud.progress(96,'Warming render pipeline…');await scene.whenReadyAsync();hud.ready();
  let last=performance.now(),frames=0,accum=0,fps=60;
  const enter=()=>{hud.enter();canvas.focus();if(matchMedia('(pointer:fine)').matches)canvas.requestPointerLock?.();};hud.deploy.addEventListener('click',enter,{once:true});
  engine.runRenderLoop(()=>{const now=performance.now();const dt=Math.min(.033,(now-last)/1000||1/60);last=now;const sample=input.sample();const p=player.update(dt,sample);const recoil=rifle.update(dt,sample);camera.rotation.x+=recoil.cameraPitch;if(sample.grenade)grenade.throw();grenade.update(dt);enemy.update(dt,p);hud.setState(p.state);scene.render();frames++;accum+=dt;if(accum>=.5){fps=frames/accum;frames=0;accum=0;hud.updateDiagnostics({fps,quality:profile.tier,state:p.state,shots:rifle.shots,draws:engine.drawCalls?.current??0,meshes:scene.meshes.length});}});
  addEventListener('resize',()=>engine.resize(),{passive:true});
  window.__PROJECT_STRIKE_REBOOT__={engine:'Babylon.js',renderer:'WebGPU',physics:'Havok',characterController:'PhysicsCharacterController',quality:profile.tier,ready:true,version:'11.0.0-reboot.1'};
}
boot().catch(error=>{console.error(error);hud.fail(error);window.__PROJECT_STRIKE_REBOOT__={ready:false,error:String(error?.message||error)};});
