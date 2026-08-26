export class AudioManager {
  constructor(){this.ctx=null;this.master=null;this.layers={resident:new Map(),weapons_player:new Map(),dlc_weapons:new Map()};this.manifests=[];this.permanentLoaded=false;this.loading=new Map()}
  async unlock(){if(!this.ctx){const C=window.AudioContext||window.webkitAudioContext;this.ctx=new C();this.master=this.ctx.createGain();this.master.gain.value=.9;this.master.connect(this.ctx.destination)}if(this.ctx.state==='suspended')await this.ctx.resume()}
  clear(){for(const layer of Object.values(this.layers))layer.clear();this.manifests.length=0;this.permanentLoaded=false;this.loading.clear()}
  detectLayer(path=''){const p=String(path).toLowerCase();if(p.includes('dlc_weapons'))return'dlc_weapons';if(p.includes('resident'))return'resident';return'weapons_player'}
  normalizeBank(source='',fallback=''){const clean=String(source||fallback).replace(/\\/g,'/'),file=clean.split('/').pop()||clean;return file.replace(/\.awc$/i,'').replace(/^weapons_player_/i,'').replace(/^dlc_weapons_/i,'').replace(/^resident_/i,'')}
  ensureBank(layer,bank){const map=this.layers[layer];if(!map.has(bank))map.set(bank,[]);return map.get(bank)}

  async decodeArrayBuffer(arr){await this.unlock();return this.ctx.decodeAudioData(arr.slice(0))}
  async fetchDecode(url){const r=await fetch(url);if(!r.ok)throw new Error(`${r.status} ${url}`);return this.decodeArrayBuffer(await r.arrayBuffer())}

  async importZip(file,{replace=false}={}){
    if(!window.JSZip)throw new Error('ZIP support failed to load.');await this.unlock();if(replace)this.clear();const zip=await JSZip.loadAsync(file),entries=Object.values(zip.files).filter(x=>!x.dir),manifestEntry=entries.find(x=>/audio-manifest\.json$/i.test(x.name));let manifest=null;if(manifestEntry){try{manifest=JSON.parse(await manifestEntry.async('text'));this.manifests.push(manifest)}catch(err){console.warn('Audio manifest parse failed',err)}}
    const metadata=new Map();if(manifest?.banks)for(const bankMeta of manifest.banks){const layer=this.detectLayer(bankMeta.source||bankMeta.id),bank=this.normalizeBank(bankMeta.source,bankMeta.id);for(const stream of bankMeta.streams||[]){const basename=(stream.file||'').split('/').pop();if(basename)metadata.set(basename.toLowerCase(),{layer,bank,stream})}}
    let loaded=0,failed=0;const layerCounts={resident:0,weapons_player:0,dlc_weapons:0};for(const entry of entries){if(!/\.wav$/i.test(entry.name))continue;try{const basename=entry.name.split('/').pop().toLowerCase(),meta=metadata.get(basename),layer=meta?.layer||this.detectLayer(entry.name),bank=meta?.bank||this.normalizeBank('',entry.name.split('/').slice(-2,-1)[0]),buffer=await this.decodeArrayBuffer(await entry.async('arraybuffer'));this.ensureBank(layer,bank).push({buffer,url:null,id:meta?.stream?.id||basename.replace(/\.wav$/i,''),index:meta?.stream?.index??loaded,source:entry.name,duration:buffer.duration});loaded++;layerCounts[layer]++}catch(err){failed++;console.warn('Audio decode failed:',entry.name,err)}}return{loaded,failed,layers:layerCounts,banks:Object.fromEntries(Object.entries(this.layers).map(([k,v])=>[k,v.size]))}
  }

  /** Loads metadata for audio committed under the three permanent layer folders. WAVs stay lazy until a bank is used. */
  async loadPermanent(){
    if(this.permanentLoaded)return;const specs=[
      {layer:'weapons_player',manifest:'./game-assets/audio/weapons_player/Project-Strike-Audio/manifest/audio-manifest.json',base:'./game-assets/audio/weapons_player/Project-Strike-Audio/'},
      {layer:'dlc_weapons',manifest:'./game-assets/audio/dlc_weapons/Project-Strike-Audio/manifest/audio-manifest.json',base:'./game-assets/audio/dlc_weapons/Project-Strike-Audio/'},
      {layer:'resident',manifest:'./game-assets/audio/resident/Project-Strike-Audio/manifest/audio-manifest.json',base:'./game-assets/audio/resident/Project-Strike-Audio/'}
    ];
    for(const spec of specs){try{const r=await fetch(spec.manifest,{cache:'no-cache'});if(!r.ok)continue;const manifest=await r.json();this.manifests.push(manifest);for(const bankMeta of manifest.banks||[]){const bank=this.normalizeBank(bankMeta.source,bankMeta.id),dest=this.ensureBank(spec.layer,bank);for(const stream of bankMeta.streams||[]){if(dest.some(x=>x.id===stream.id))continue;dest.push({buffer:null,url:new URL(stream.file,spec.base).href,id:stream.id,index:stream.index,source:stream.file,duration:stream.duration||0})}}}catch(err){console.info(`No permanent ${spec.layer} pack yet`,err)}}this.permanentLoaded=true;
  }
  async preloadBank(layer,bank){await this.loadPermanent();const streams=this.getBank(layer,bank);if(!streams?.length)return 0;let n=0;for(const s of streams){if(s.buffer){n++;continue}if(!s.url)continue;const key=s.url;try{if(!this.loading.has(key))this.loading.set(key,this.fetchDecode(key));s.buffer=await this.loading.get(key);n++}catch(err){console.warn('Audio fetch failed',s.url,err)}finally{this.loading.delete(key)}}return n}
  async preloadWeapon(bank){await this.loadPermanent();for(const layer of ['weapons_player','dlc_weapons'])if(this.layers[layer].has(bank))return this.preloadBank(layer,bank);return 0}
  getBank(layer,bank){return this.layers[layer]?.get(bank)||null}
  findBank(bank){for(const layer of ['weapons_player','dlc_weapons','resident']){const exact=this.layers[layer].get(bank);if(exact?.length)return{layer,bank,streams:exact};for(const[name,streams]of this.layers[layer])if(name.includes(bank)||bank.includes(name))return{layer,bank:name,streams}}return null}
  chooseStream(streams){const ready=streams?.filter(s=>s.buffer)||[];return ready.length?ready[Math.floor(Math.random()*ready.length)]:null}
  playBuffer(buffer,{gain=1,rate=1,position=null,lowpass=null}={}){if(!buffer||!this.ctx)return null;const src=this.ctx.createBufferSource();src.buffer=buffer;src.playbackRate.value=rate;const g=this.ctx.createGain();g.gain.value=gain;let tail=g;if(lowpass){const f=this.ctx.createBiquadFilter();f.type='lowpass';f.frequency.value=lowpass;g.connect(f);tail=f}if(position&&this.ctx.createPanner){const p=this.ctx.createPanner();p.panningModel='HRTF';p.distanceModel='inverse';p.refDistance=2;p.maxDistance=180;p.rolloffFactor=1.1;p.positionX.value=position.x;p.positionY.value=position.y;p.positionZ.value=position.z;src.connect(g);tail.connect(p);p.connect(this.master)}else{src.connect(g);tail.connect(this.master)}src.start();return src}
  playBank(layer,bank,opts={}){const stream=this.chooseStream(this.getBank(layer,bank));if(stream)return this.playBuffer(stream.buffer,opts);this.preloadBank(layer,bank).catch(()=>{});return null}
  play(layer,contains,opts={}){const map=this.layers[layer];if(!map)return null;for(const[name]of map)if(name.includes(contains)||contains.includes(name))return this.playBank(layer,name,opts);return null}
  playWeaponShot(bank='lmg_combat',opts={}){const hit=this.findBank(bank);if(!hit){this.preloadWeapon(bank).catch(()=>{});return null}const stream=this.chooseStream(hit.streams);if(!stream){this.preloadBank(hit.layer,hit.bank).catch(()=>{});return null}return this.playBuffer(stream.buffer,{gain:.9,rate:.985+Math.random()*.03,...opts})}
  playResident(bank,opts={}){return this.playBank('resident',bank,opts)}
}
