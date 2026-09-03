import { Ray } from '@babylonjs/core/Culling/ray.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';

export class RifleSystem {
  constructor(scene,camera,weapon,vfx,hud){this.scene=scene;this.camera=camera;this.weapon=weapon;this.vfx=vfx;this.hud=hud;this.mag=30;this.reserve=120;this.cooldown=0;this.reload=0;this.ads=0;this.aimPitch=0;this.aimYaw=0;this.weaponKick=0;this.weaponPitch=0;this.cameraImpulse=0;this.shots=0;}
  update(dt,input){
    this.cooldown=Math.max(0,this.cooldown-dt); this.vfx.update(dt);
    const targetAds=input.ads?1:0; this.ads += (targetAds-this.ads)*(1-Math.exp(-dt*14));
    if(input.reload && this.reload<=0 && this.mag<30 && this.reserve>0) this.reload=1.75;
    if(this.reload>0){this.reload-=dt;if(this.reload<=0){const n=Math.min(30-this.mag,this.reserve);this.mag+=n;this.reserve-=n;}}
    if(input.fire && this.reload<=0 && this.cooldown<=0 && this.mag>0) this.fire();
    this.aimPitch*=Math.exp(-dt*12);this.aimYaw*=Math.exp(-dt*13);this.weaponKick*=Math.exp(-dt*18);this.weaponPitch*=Math.exp(-dt*15);this.cameraImpulse*=Math.exp(-dt*20);
    const hip=new Vector3(.24,-.24,.62), ads=new Vector3(0,-.155,.47); this.weapon.root.position.copyFrom(Vector3.Lerp(hip,ads,this.ads));
    this.weapon.root.position.z += this.weaponKick; this.weapon.root.rotation.x=.015+this.weaponPitch; this.hud.setAmmo(this.mag,this.reserve,this.reload>0);
    return { cameraPitch:this.cameraImpulse, aimPitch:this.aimPitch, aimYaw:this.aimYaw, ads:this.ads };
  }
  fire(){
    this.mag--;this.cooldown=.085;this.shots++;this.aimPitch+=.0113;this.aimYaw+=(Math.random()-.5)*.0042;this.weaponKick-=.045;this.weaponPitch-=.052;this.cameraImpulse+=.0026;this.vfx.shot();
    const forward=this.camera.getDirection(new Vector3(0,0,1));
    const right=this.camera.getDirection(new Vector3(1,0,0));
    const up=this.camera.getDirection(new Vector3(0,1,0));
    const dir=forward.add(up.scale(this.aimPitch)).add(right.scale(this.aimYaw)).normalize();
    const ray=new Ray(this.camera.globalPosition.clone(),dir,160);
    const hit=this.scene.pickWithRay(ray,m=>m.isPickable && m.metadata?.shootable);
    if(hit?.hit){ hit.pickedMesh?.metadata?.onHit?.(hit,34,dir); this.hud.hit(); }
  }
}
