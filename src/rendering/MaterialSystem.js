import * as THREE from 'three';

export const MATERIAL_LIBRARY={
  concrete:{color:0x747873,roughness:.92,metalness:0,detail:'concrete'},
  paintedConcrete:{color:0x737a78,roughness:.78,metalness:0,detail:'paintedConcrete'},
  cleanMetal:{color:0x454b50,roughness:.34,metalness:.9,detail:'metal'},
  rustedMetal:{color:0x5a4638,roughness:.74,metalness:.52,detail:'rust'},
  corrugatedSteel:{color:0x62676b,roughness:.47,metalness:.82,detail:'metal'},
  wood:{color:0x725039,roughness:.86,metalness:0,detail:'wood'},
  asphalt:{color:0x34383a,roughness:.96,metalness:0,detail:'asphalt'},
  dirt:{color:0x665642,roughness:1,metalness:0,detail:'dirt'},
  mud:{color:0x443a2f,roughness:.72,metalness:0,detail:'mud'},
  glass:{color:0xa9c1ca,roughness:.08,metalness:0,transparent:true,opacity:.23,detail:'glass'}
};

function hashNoise(x,y){const n=Math.sin(x*12.9898+y*78.233)*43758.5453;return n-Math.floor(n)}
function makeDetailCanvas(kind,size=256){
  const c=document.createElement('canvas');c.width=c.height=size;const g=c.getContext('2d');
  const img=g.createImageData(size,size);for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    let n=hashNoise(x,y),r=128,gc=128,b=128;
    if(kind==='rust'){r=120+n*90;gc=70+n*45;b=35+n*28}
    else if(kind==='dirt'||kind==='mud'){r=80+n*65;gc=68+n*52;b=48+n*34}
    else {const v=95+n*75;r=gc=b=v}
    const i=(y*size+x)*4;img.data[i]=r;img.data[i+1]=gc;img.data[i+2]=b;img.data[i+3]=255;
  }g.putImageData(img,0,0);return c;
}

export class MaterialSystem{
  constructor(){this.detailTextures=new Map()}
  detail(kind){
    if(!this.detailTextures.has(kind)){
      const t=new THREE.CanvasTexture(makeDetailCanvas(kind));t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(4,4);t.colorSpace=THREE.SRGBColorSpace;this.detailTextures.set(kind,t)
    }return this.detailTextures.get(kind)
  }
  create(name,{dirt=0,rust=0,wetness=0}={}){
    const d=MATERIAL_LIBRARY[name]||MATERIAL_LIBRARY.concrete;
    const m=new THREE.MeshStandardMaterial({color:d.color,roughness:Math.max(.06,d.roughness-wetness*.34),metalness:d.metalness,transparent:!!d.transparent,opacity:d.opacity??1});
    if(d.detail!=='glass'){m.map=this.detail(d.detail);m.map.colorSpace=THREE.SRGBColorSpace}
    m.userData.weathering={dirt,rust,wetness};
    m.onBeforeCompile=shader=>{
      shader.uniforms.uDirt={value:dirt};shader.uniforms.uRust={value:rust};shader.uniforms.uWet={value:wetness};
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>\nfloat grime=clamp(uDirt,0.0,1.0);float rustv=clamp(uRust,0.0,1.0);diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.43,.37,.28),grime*.55);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.36,.17,.07),rustv*.45);`);
    };
    return m;
  }
}
