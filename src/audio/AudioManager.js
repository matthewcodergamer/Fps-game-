export class AudioManager {
  constructor(){
    this.ctx=null;
    this.master=null;
    this.layers={resident:new Map(),weapons_player:new Map(),dlc_weapons:new Map()};
    this.manifests=[];
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
    for(const layer of Object.values(this.layers))layer.clear();
    this.manifests.length=0;
  }

  detectLayer(path=''){
    const p=String(path).toLowerCase();
    if(p.includes('dlc_weapons'))return 'dlc_weapons';
    if(p.includes('resident'))return 'resident';
    return 'weapons_player';
  }

  normalizeBank(source='',fallback=''){
    const clean=String(source||fallback).replace(/\\/g,'/');
    const file=clean.split('/').pop()||clean;
    return file.replace(/\.awc$/i,'').replace(/^weapons_player_/i,'').replace(/^dlc_weapons_/i,'').replace(/^resident_/i,'');
  }

  ensureBank(layer,bank){
    const map=this.layers[layer];
    if(!map.has(bank))map.set(bank,[]);
    return map.get(bank);
  }

  async importZip(file,{replace=false}={}){
    if(!window.JSZip)throw new Error('ZIP support failed to load.');
    await this.unlock();
    if(replace)this.clear();

    const zip=await JSZip.loadAsync(file);
    const entries=Object.values(zip.files).filter(x=>!x.dir);
    const manifestEntry=entries.find(x=>/audio-manifest\.json$/i.test(x.name));
    let manifest=null;
    if(manifestEntry){
      try{manifest=JSON.parse(await manifestEntry.async('text'));this.manifests.push(manifest)}catch(err){console.warn('Audio manifest parse failed',err)}
    }

    const metadataByBasename=new Map();
    if(manifest?.banks){
      for(const bankMeta of manifest.banks){
        const layer=this.detectLayer(bankMeta.source||bankMeta.id);
        const bank=this.normalizeBank(bankMeta.source,bankMeta.id);
        for(const stream of bankMeta.streams||[]){
          const basename=(stream.file||'').split('/').pop();
          if(basename)metadataByBasename.set(basename.toLowerCase(),{layer,bank,stream,bankMeta});
        }
      }
    }

    let loaded=0,failed=0;
    const layerCounts={resident:0,weapons_player:0,dlc_weapons:0};
    for(const entry of entries){
      if(!/\.wav$/i.test(entry.name))continue;
      try{
        const arr=await entry.async('arraybuffer');
        const buffer=await this.ctx.decodeAudioData(arr.slice(0));
        const basename=entry.name.split('/').pop().toLowerCase();
        const meta=metadataByBasename.get(basename);
        const layer=meta?.layer||this.detectLayer(entry.name);
        const bank=meta?.bank||this.normalizeBank('',entry.name.split('/').slice(-2,-1)[0]);
        this.ensureBank(layer,bank).push({
          buffer,
          id:meta?.stream?.id||basename.replace(/\.wav$/i,''),
          index:meta?.stream?.index??loaded,
          source:entry.name,
          duration:buffer.duration
        });
        loaded++;layerCounts[layer]++;
      }catch(err){failed++;console.warn('Audio decode failed:',entry.name,err)}
    }

    return {loaded,failed,layers:layerCounts,banks:Object.fromEntries(Object.entries(this.layers).map(([k,v])=>[k,v.size]))};
  }

  getBank(layer,bank){return this.layers[layer]?.get(bank)||null}

  findBank(bank){
    for(const layer of ['weapons_player','dlc_weapons','resident']){
      const exact=this.layers[layer].get(bank);
      if(exact?.length)return {layer,bank,streams:exact};
      for(const [name,streams] of this.layers[layer]){
        if(name.includes(bank)||bank.includes(name))return {layer,bank:name,streams};
      }
    }
    return null;
  }

  chooseStream(streams){
    if(!streams?.length)return null;
    return streams[Math.floor(Math.random()*streams.length)];
  }

  playBuffer(buffer,{gain=1,rate=1,position=null,lowpass=null}={}){
    if(!buffer||!this.ctx)return null;
    const src=this.ctx.createBufferSource();
    src.buffer=buffer;src.playbackRate.value=rate;
    const gainNode=this.ctx.createGain();gainNode.gain.value=gain;
    let tail=gainNode;
    if(lowpass){const filter=this.ctx.createBiquadFilter();filter.type='lowpass';filter.frequency.value=lowpass;gainNode.connect(filter);tail=filter}
    if(position&&this.ctx.createPanner){
      const p=this.ctx.createPanner();p.panningModel='HRTF';p.distanceModel='inverse';p.refDistance=2;p.maxDistance=180;p.rolloffFactor=1.1;
      p.positionX.value=position.x;p.positionY.value=position.y;p.positionZ.value=position.z;
      src.connect(gainNode);tail.connect(p);p.connect(this.master);
    }else{src.connect(gainNode);tail.connect(this.master)}
    src.start();return src;
  }

  playBank(layer,bank,opts={}){
    const stream=this.chooseStream(this.getBank(layer,bank));
    return stream?this.playBuffer(stream.buffer,opts):null;
  }

  playWeaponShot(bank='lmg_combat',opts={}){
    const hit=this.findBank(bank);if(!hit)return null;
    const stream=this.chooseStream(hit.streams);if(!stream)return null;
    return this.playBuffer(stream.buffer,{gain:.9,rate:.985+Math.random()*.03,...opts});
  }

  playResident(bank,opts={}){return this.playBank('resident',bank,opts)}
}
