import * as THREE from 'three/webgpu';
import { pass,mrt,output,diffuseColor,normalView,velocity,emissive,vec4,packNormalToRGB,unpackRGBToNormal,sample,add } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { ssgi } from 'three/addons/tsl/display/SSGINode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';

/** Desktop WebGPU: SSGI + temporal AA + emissive bloom. Mobile: half-resolution GTAO + restrained bloom. */
export function createCinematicPipeline(renderer,scene,camera,{cinematic=false,mobile=false}={}){
  try{
    const scenePass=pass(scene,camera);scenePass.setMRT(mrt({output,diffuseColor,normal:packNormalToRGB(normalView),velocity,emissive:vec4(emissive,output.a)}));
    const color=scenePass.getTextureNode('output'),diffuse=scenePass.getTextureNode('diffuseColor'),depth=scenePass.getTextureNode('depth'),packedNormal=scenePass.getTextureNode('normal'),velocityNode=scenePass.getTextureNode('velocity'),emissiveNode=scenePass.getTextureNode('emissive');
    scenePass.getTexture('diffuseColor').type=THREE.UnsignedByteType;scenePass.getTexture('normal').type=THREE.UnsignedByteType;scenePass.getTexture('emissive').type=THREE.UnsignedByteType;
    const normal=sample(uv=>unpackRGBToNormal(packedNormal.sample(uv)));let composed=color;
    if(cinematic){const gi=ssgi(color,depth,normal,camera);gi.sliceCount.value=1;gi.stepCount.value=6;gi.radius.value=8;gi.aoIntensity.value=1.05;gi.giIntensity.value=1.25;gi.useTemporalFiltering=true;gi.resolutionScale=.7;const aoNode=gi.getAONode(),indirect=gi.getGINode();composed=vec4(add(color.rgb.mul(aoNode.r),diffuse.rgb.mul(indirect.rgb)),color.a)}
    else{const gtao=ao(depth,normal,camera);gtao.resolutionScale=mobile?.42:.55;gtao.useTemporalFiltering=!mobile;gtao.samples.value=mobile?6:10;gtao.radius.value=mobile?.28:.42;const occ=gtao.getTextureNode().r.mul(.42).add(.58);composed=vec4(color.rgb.mul(occ),color.a)}
    const glow=bloom(emissiveNode,cinematic?.58:.34,.45,.72);glow.setResolutionScale?.(mobile?.42:.55);composed=composed.add(glow);if(cinematic){const temporal=traa(composed,depth,velocityNode,camera);temporal.useSubpixelCorrection=false;composed=temporal}
    const pipeline=new THREE.RenderPipeline(renderer);pipeline.outputNode=composed;return{mode:cinematic?'SSGI + TRAA + bloom':'GTAO + bloom',render:()=>pipeline.render(),resize:()=>{pipeline.needsUpdate=true},dispose:()=>pipeline.dispose?.()};
  }catch(error){console.warn('Cinematic pipeline unavailable; direct render fallback',error);return{mode:'direct PBR',render:()=>renderer.render(scene,camera),resize:()=>{},dispose:()=>{}}}
}
