export class AudioManager {
  constructor(){
    this.ctx=null;
    this.master=null;
    this.layers={resident:new Map(),weapons_player:new Map(),dlc_weapons:new Map()};
    this.manifest=null;
    this.objectUrls=[];
  }
  async unlock(){
    if(!this.ctx){
      const C=window.AudioContext||window.webkitAudioContext;
      this.ctx=new C();
      this.master=this.ctx.createGain();
      this.master.gain.value=.9;
      this.master.connect(this.ctx.destination);
    }
    if(this.ctx.state==='suspended')await this.ctx.resume();
  }
  clear(){
    for(const url of this.objectUrls)URL.revokeObjectURL(url);
    this.objectUrls.length=0;
    for(const m of Object.values(this.layers))m.clear();
    this.manifest=null;
  }
  detectLayer(path=''){
    const p=path.toLowerCase();
    if(p.includes('dlc_weapons'))return 'dlc_weapons';
    if(p.includes('resident'))return 'resident';
    return 'weapons_player';
  }
  async importZip(file){
    if(!window.JSZip)throw new Error('ZIP support failed to load.');
    await this.unlock();
    this.clear();
    const zip=await JSZip.loadAsync(file);
    const entries=Object.values(zip.files).filter(x=>!x.dir);
    const manifestEntry=entries.find(x=>/audio-manifest\.json$/i.test(x.name));
    if(manifestEntry){
      try{this.manifest=JSON.parse(await manifestEntry.async('text'))}catch{}
    }
    let loaded=0;
    for(const entry of entries){
      if(!/\.wav$/i.test(entry.name))continue;
      const blob=await entry.async('blob');
      const arr=await blob.arrayBuffer();
      let buffer;
      try{buffer=await this.ctx.decodeAudioData(arr.slice(0))}catch{continue}
      const layer=this.detectLayer(entry.name);
      const key=entry.name.split('/').pop().replace(/\.wav$/i,'');
      this.layers[layer].set(key,buffer);
      loaded++;
    }
    return {loaded,layers:Object.fromEntries(Object.entries(this.layers).map(([k,v])=>[k,v.size]))};
  }
  find(layer,contains){
    const bank=this.layers[layer];
    if(!bank)return null;
    const q=String(contains||'').toLowerCase();
    for(const [k,v] of bank){if(k.toLowerCase().includes(q))return v}
    return null;
  }
  playBuffer(buffer,{gain=1,rate=1,position=null}={}){
    if(!buffer||!this.ctx)return null;
    const src=this.ctx.createBufferSource();
    src.buffer=buffer;src.playbackRate.value=rate;
    const g=this.ctx.createGain();g.gain.value=gain;
    if(position&&this.ctx.createPanner){
      const p=this.ctx.createPanner();p.panningModel='HRTF';p.distanceModel='inverse';p.refDistance=2;p.maxDistance=160;p.rolloffFactor=1.15;
      p.positionX.value=position.x;p.positionY.value=position.y;p.positionZ.value=position.z;
      src.connect(g);g.connect(p);p.connect(this.master);
    }else{src.connect(g);g.connect(this.master)}
    src.start();return src;
  }
  play(layer,contains,opts={}){return this.playBuffer(this.find(layer,contains),opts)}
  playWeaponShot(name='lmg_combat'){
    let b=this.find('weapons_player',name);
    if(!b)b=this.find('dlc_weapons',name);
    if(b)return this.playBuffer(b,{gain:.9,rate:.985+Math.random()*.03});
    return null;
  }
}
