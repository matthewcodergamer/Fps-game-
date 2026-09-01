export class GamepadInput {
  constructor(){this.previous=[];this.state=this.empty()}
  empty(){return{connected:false,id:'',moveX:0,moveY:0,lookX:0,lookY:0,fire:false,ads:false,sprint:false,jump:false,reload:false,slide:false,switchWeapon:false}}
  dz(v,dead=.16){const a=Math.abs(v);if(a<=dead)return 0;return Math.sign(v)*(a-dead)/(1-dead)}
  update(){const pads=navigator.getGamepads?.()||[],pad=[...pads].find(Boolean);if(!pad){this.previous=[];this.state=this.empty();return this.state}const b=i=>pad.buttons?.[i]?.pressed||false,edge=i=>b(i)&&!this.previous[i];this.state={connected:true,id:pad.id||'Gamepad',moveX:this.dz(pad.axes?.[0]||0),moveY:this.dz(pad.axes?.[1]||0),lookX:this.dz(pad.axes?.[2]||0,.12),lookY:this.dz(pad.axes?.[3]||0,.12),fire:b(7),ads:b(6),sprint:b(10),jump:edge(0),slide:edge(1),reload:edge(2),switchWeapon:edge(3)};this.previous=(pad.buttons||[]).map(x=>x.pressed);return this.state}
  pulse(strong=.22,duration=45){const pad=[...(navigator.getGamepads?.()||[])].find(Boolean),actuator=pad?.vibrationActuator;if(!actuator?.playEffect)return;actuator.playEffect('dual-rumble',{duration,strongMagnitude:strong,weakMagnitude:Math.min(1,strong*.65)}).catch(()=>{})}
}
