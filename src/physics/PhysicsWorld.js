import RAPIER from 'https://esm.sh/@dimforge/rapier3d-compat@0.20.0';

export class PhysicsWorld {
  constructor(){this.R=null;this.world=null;this.dynamic=new Set();}
  async init(){
    await RAPIER.init();
    this.R=RAPIER;
    this.world=new RAPIER.World({x:0,y:-9.81,z:0});
    return this;
  }
  fixedBox({x=0,y=0,z=0,hx=.5,hy=.5,hz=.5,friction=.8,restitution=.05}={}){
    const body=this.world.createRigidBody(this.R.RigidBodyDesc.fixed().setTranslation(x,y,z));
    const col=this.world.createCollider(this.R.ColliderDesc.cuboid(hx,hy,hz).setFriction(friction).setRestitution(restitution),body);
    return {body,col};
  }
  dynamicBox({x=0,y=1,z=0,hx=.1,hy=.1,hz=.1,mass=.1,friction=.7,restitution=.15}={}){
    const body=this.world.createRigidBody(this.R.RigidBodyDesc.dynamic().setTranslation(x,y,z).setCcdEnabled(true));
    const col=this.world.createCollider(this.R.ColliderDesc.cuboid(hx,hy,hz).setMass(mass).setFriction(friction).setRestitution(restitution),body);
    const item={body,col};this.dynamic.add(item);return item;
  }
  grenade({x,y,z,vx=0,vy=0,vz=0,radius=.055}={}){
    const body=this.world.createRigidBody(this.R.RigidBodyDesc.dynamic().setTranslation(x,y,z).setLinvel(vx,vy,vz).setCcdEnabled(true));
    const col=this.world.createCollider(this.R.ColliderDesc.ball(radius).setMass(.4).setFriction(.75).setRestitution(.35),body);
    const item={body,col,type:'grenade'};this.dynamic.add(item);return item;
  }
  raycast(origin,dir,maxToi=500,solid=true){
    if(!this.world)return null;
    const ray=new this.R.Ray(origin,dir);
    return this.world.castRay(ray,maxToi,solid);
  }
  step(dt){
    if(!this.world)return;
    this.world.timestep=Math.min(1/30,Math.max(1/120,dt));
    this.world.step();
  }
}
