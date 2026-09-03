import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { PointLight } from '@babylonjs/core/Lights/pointLight.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { GlowLayer } from '@babylonjs/core/Layers/glowLayer.js';

export class CombatVFX {
  constructor(scene, muzzle) {
    this.scene=scene; this.muzzle=muzzle;
    this.flash=MeshBuilder.CreatePlane('muzzle-flash',{size:.16},scene); this.flash.parent=muzzle; this.flash.position.z=-.06; this.flash.billboardMode=7; this.flash.isPickable=false;
    const mat=new StandardMaterial('muzzle-flash-mat',scene); mat.emissiveColor=new Color3(1,.62,.18); mat.disableLighting=true; this.flash.material=mat; this.flash.setEnabled(false);
    this.light=new PointLight('muzzle-light',Vector3.Zero(),scene); this.light.parent=muzzle; this.light.diffuse=new Color3(1,.55,.2); this.light.range=6; this.light.intensity=0;
    this.glow=new GlowLayer('combat-glow',scene,{blurKernelSize:16}); this.glow.intensity=.35;
    this.timer=0;
  }
  shot(){ this.timer=.045; this.flash.rotation.z=Math.random()*Math.PI; this.flash.scaling.setAll(.85+Math.random()*.4); this.flash.setEnabled(true); this.light.intensity=16; }
  update(dt){ if(this.timer<=0)return; this.timer-=dt; const t=Math.max(0,this.timer/.045); this.light.intensity=16*t; if(this.timer<=0){this.flash.setEnabled(false);this.light.intensity=0;} }
}
