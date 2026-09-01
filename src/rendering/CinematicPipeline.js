import * as THREE from 'three/webgpu';
import { pass,mrt,output,diffuseColor,normalView,velocity,emissive,vec4,packNormalToRGB,unpackRGBToNormal,sample,add } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { ssgi } from 'three/addons/tsl/display/SSGINode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';

/**
 * Fault-tolerant render pipeline.
 *
 * iPhone/Safari always starts from the direct PBR path. This deliberately avoids
 * the black-frame failure mode caused by unsupported/unstable MRT post-processing.
 * Desktop WebGPU can opt into SSGI/TRAA/bloom. If an advanced pass throws at
 * render time, the next frame permanently falls back to direct rendering.
 */
export function createCinematicPipeline(renderer,scene,camera,{cinematic=false,mobile=false,onFallback=null}={}){
  let pipeline=null,failed=false,mode=mobile?'direct PBR · mobile safe':'direct PBR';
  const direct=()=>renderer.render(scene,camera);

  if(!mobile){
    try{
      const scenePass=pass(scene,camera);
      scenePass.setMRT(mrt({
        output,
        diffuseColor,
        normal:packNormalToRGB(normalView),
        velocity,
        emissive:vec4(emissive,output.a)
      }));
      const color=scenePass.getTextureNode('output');
      const diffuse=scenePass.getTextureNode('diffuseColor');
      const depth=scenePass.getTextureNode('depth');
      const packedNormal=scenePass.getTextureNode('normal');
      const velocityNode=scenePass.getTextureNode('velocity');
      const emissiveNode=scenePass.getTextureNode('emissive');
      scenePass.getTexture('diffuseColor').type=THREE.UnsignedByteType;
      scenePass.getTexture('normal').type=THREE.UnsignedByteType;
      scenePass.getTexture('emissive').type=THREE.UnsignedByteType;
      const normal=sample(uv=>unpackRGBToNormal(packedNormal.sample(uv)));
      let composed=color;

      if(cinematic){
        const gi=ssgi(color,depth,normal,camera);
        gi.sliceCount.value=1;
        gi.stepCount.value=6;
        gi.radius.value=8;
        gi.aoIntensity.value=1.02;
        gi.giIntensity.value=1.15;
        gi.useTemporalFiltering=true;
        gi.resolutionScale=.68;
        const aoNode=gi.getAONode(),indirect=gi.getGINode();
        composed=vec4(add(color.rgb.mul(aoNode.r),diffuse.rgb.mul(indirect.rgb)),color.a);
      }else{
        const gtao=ao(depth,normal,camera);
        gtao.resolutionScale=.5;
        gtao.useTemporalFiltering=true;
        gtao.samples.value=8;
        gtao.radius.value=.38;
        const occ=gtao.getTextureNode().r.mul(.38).add(.62);
        composed=vec4(color.rgb.mul(occ),color.a);
      }

      const glow=bloom(emissiveNode,cinematic?.54:.28,.42,.74);
      glow.setResolutionScale?.(.5);
      composed=composed.add(glow);
      if(cinematic){
        const temporal=traa(composed,depth,velocityNode,camera);
        temporal.useSubpixelCorrection=false;
        composed=temporal;
      }
      pipeline=new THREE.RenderPipeline(renderer);
      pipeline.outputNode=composed;
      mode=cinematic?'SSGI + TRAA + bloom':'GTAO + bloom';
    }catch(error){
      console.warn('Project Strike advanced pipeline creation failed; using direct PBR.',error);
      failed=true;
      mode='direct PBR · recovered';
      onFallback?.(error);
    }
  }

  return{
    get mode(){return mode},
    get failed(){return failed},
    render(){
      if(!pipeline||failed){direct();return}
      try{pipeline.render()}
      catch(error){
        console.error('Project Strike advanced render pass failed; switching to direct PBR.',error);
        failed=true;mode='direct PBR · runtime recovery';
        try{pipeline.dispose?.()}catch{}
        pipeline=null;
        onFallback?.(error);
        direct();
      }
    },
    resize(){if(pipeline&&!failed)pipeline.needsUpdate=true},
    dispose(){try{pipeline?.dispose?.()}catch{}}
  };
}