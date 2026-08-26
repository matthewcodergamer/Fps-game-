import * as THREE from 'three';

export class RedDotOptic extends THREE.Group{
  constructor({color=0xff2d2d,size=.008}={}){super();this.reticle=new THREE.Sprite(new THREE.SpriteMaterial({color,depthTest:false,depthWrite:false,transparent:true,opacity:.95}));this.reticle.scale.set(size,size,size);this.add(this.reticle);this.aimDistance=50}
  update(camera,aimOrigin,aimDirection){const worldPoint=aimOrigin.clone().addScaledVector(aimDirection,this.aimDistance);this.worldToLocal(worldPoint);const z=this.reticle.position.z;this.reticle.position.set(worldPoint.x,worldPoint.y,z||-.02);this.reticle.quaternion.copy(camera.quaternion)}
}

export class ScopeController{
  constructor(camera){this.camera=camera;this.baseFov=camera.fov;this.ads=false;this.zoom=1}
  setADS(on,zoom=1){this.ads=on;this.zoom=Math.max(1,zoom)}
  update(dt){const target=this.ads?this.baseFov/this.zoom:this.baseFov;this.camera.fov=THREE.MathUtils.lerp(this.camera.fov,target,1-Math.exp(-12*dt));this.camera.updateProjectionMatrix()}
}
