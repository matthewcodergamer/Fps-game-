export class AnimationLayers {
  constructor(){this.layers={locomotion:0,upperBodyAim:0,weapon:0,recoil:0,handIK:0,footIK:0};}
  set(name,weight){if(!(name in this.layers))throw new Error(`Unknown animation layer ${name}`);this.layers[name]=Math.max(0,Math.min(1,weight));}
  snapshot(){return {...this.layers};}
}
