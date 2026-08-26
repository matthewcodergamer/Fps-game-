import * as THREE from 'three';

export const SURFACES={
  glass:{resistance:.12,ricochet:.02},drywall:{resistance:.22,ricochet:.01},wood:{resistance:.38,ricochet:.04},metal:{resistance:.72,ricochet:.35},brick:{resistance:.86,ricochet:.12},concrete:{resistance:1,ricochet:.18},flesh:{resistance:.18,ricochet:0}
};

export class Ballistics{
  constructor(scene){this.scene=scene;this.raycaster=new THREE.Raycaster();this.tracers=[]}
  fire({origin,direction,velocity=820,damage=34,penetration=.55,range=240,targets=[],materialOf=()=>({type:'concrete',thickness:.2}),tracer=true}={}){
    const dir=direction.clone().normalize(),hits=[];let energy=1,pos=origin.clone(),remaining=range;
    for(let pass=0;pass<4&&remaining>0&&energy>.05;pass++){
      this.raycaster.set(pos,dir);this.raycaster.far=remaining;const hit=this.raycaster.intersectObjects(targets,true)[0];if(!hit)break;const mat=materialOf(hit),surface=SURFACES[mat.type]||SURFACES.concrete,travel=hit.distance;remaining-=travel;const applied=damage*energy;hits.push({hit,damage:applied,energy,surface:mat.type});const cost=surface.resistance*Math.max(.05,mat.thickness||.15)/Math.max(.05,penetration);energy-=cost;if(energy<=.05)break;pos.copy(hit.point).addScaledVector(dir,.03)
    }
    if(tracer)this.spawnTracer(origin,origin.clone().addScaledVector(dir,Math.min(range,hits[0]?.hit.distance||range)),velocity);return hits
  }
  spawnTracer(a,b,velocity){const geo=new THREE.BufferGeometry().setFromPoints([a,b]),mat=new THREE.LineBasicMaterial({color:0xffe4a6,transparent:true,opacity:.75}),line=new THREE.Line(geo,mat);line.userData.life=Math.max(.03,a.distanceTo(b)/Math.max(1,velocity));this.scene.add(line);this.tracers.push(line)}
  update(dt){for(let i=this.tracers.length-1;i>=0;i--){const t=this.tracers[i];t.userData.life-=dt;t.material.opacity=Math.max(0,t.userData.life*10);if(t.userData.life<=0){t.geometry.dispose();t.material.dispose();this.scene.remove(t);this.tracers.splice(i,1)}}}
}
