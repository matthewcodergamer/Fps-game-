import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const NV_SHADER={uniforms:{tDiffuse:{value:null},time:{value:0},strength:{value:1}},vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,fragmentShader:`uniform sampler2D tDiffuse;uniform float time;uniform float strength;varying vec2 vUv;float rnd(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233))+time*23.)*43758.5453);}void main(){vec4 c=texture2D(tDiffuse,vUv);float l=dot(c.rgb,vec3(.2126,.7152,.0722));float n=(rnd(vUv*vec2(900.,500.))-.5)*.08;vec3 nv=vec3(.05,1.,.26)*(pow(l, .72)*1.45+n);float d=distance(vUv,vec2(.5));nv*=smoothstep(.74,.35,d);gl_FragColor=vec4(mix(c.rgb,nv,strength),1.);}`};

export class NightVision{
  constructor(renderer,scene,camera){this.renderer=renderer;this.composer=new EffectComposer(renderer);this.renderPass=new RenderPass(scene,camera);this.pass=new ShaderPass(NV_SHADER);this.composer.addPass(this.renderPass);this.composer.addPass(this.pass);this.enabled=false}
  setEnabled(v){this.enabled=!!v}
  render(dt){this.pass.uniforms.time.value+=dt;if(this.enabled)this.composer.render();else this.renderer.render(this.renderPass.scene,this.renderPass.camera)}
  resize(w,h){this.composer.setSize(w,h)}
}
