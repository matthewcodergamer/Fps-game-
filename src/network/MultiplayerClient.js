const DEFAULT_TICK=20;

export class MultiplayerClient extends EventTarget{
  constructor(){super();this.ws=null;this.room=null;this.id=crypto.randomUUID();this.seq=0;this.connected=false;this.lastSend=0;this.tickRate=DEFAULT_TICK;this.remote=new Map()}
  async connect(url,room){
    this.room=room;this.ws=new WebSocket(url);
    return new Promise((resolve,reject)=>{
      this.ws.onopen=()=>{this.connected=true;this.send({t:'join',room,id:this.id});resolve()};
      this.ws.onerror=reject;
      this.ws.onclose=()=>{this.connected=false;this.dispatchEvent(new CustomEvent('disconnect'))};
      this.ws.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return}this.handle(m)};
    });
  }
  handle(m){
    if(m.id===this.id)return;
    if(m.t==='state'){this.remote.set(m.id,m);this.dispatchEvent(new CustomEvent('state',{detail:m}))}
    else if(m.t==='event')this.dispatchEvent(new CustomEvent('gameevent',{detail:m}));
    else this.dispatchEvent(new CustomEvent(m.t||'message',{detail:m}));
  }
  send(data){if(this.ws?.readyState===WebSocket.OPEN)this.ws.send(JSON.stringify(data))}
  update(now,state){
    if(!this.connected||now-this.lastSend<1000/this.tickRate)return;
    this.lastSend=now;this.send({t:'state',room:this.room,id:this.id,seq:++this.seq,ts:Date.now(),...state});
  }
  fire(payload){this.send({t:'event',kind:'fire',room:this.room,id:this.id,ts:Date.now(),...payload})}
  reload(payload={}){this.send({t:'event',kind:'reload',room:this.room,id:this.id,ts:Date.now(),...payload})}
  close(){this.ws?.close()}
}

export class SnapshotInterpolator{
  constructor(delay=100){this.delay=delay;this.buffers=new Map()}
  push(s){if(!this.buffers.has(s.id))this.buffers.set(s.id,[]);const b=this.buffers.get(s.id);b.push(s);if(b.length>30)b.shift()}
  sample(id,now=Date.now()){
    const b=this.buffers.get(id);if(!b?.length)return null;const t=now-this.delay;
    let a=b[0],c=b[b.length-1];for(let i=0;i<b.length-1;i++)if(b[i].ts<=t&&b[i+1].ts>=t){a=b[i];c=b[i+1];break}
    const span=Math.max(1,c.ts-a.ts),u=Math.max(0,Math.min(1,(t-a.ts)/span));
    const lerp=(x,y)=>x+(y-x)*u;
    return {...c,x:lerp(a.x,c.x),y:lerp(a.y,c.y),z:lerp(a.z,c.z),yaw:lerp(a.yaw,c.yaw),pitch:lerp(a.pitch,c.pitch)};
  }
}
