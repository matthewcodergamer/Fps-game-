import { AudioManager } from './AudioManager.js';

export class RepositoryAudio extends AudioManager{
  async preloadResident(bank,{limit=10}={}){
    await this.loadPermanent();
    const map=this.layers.resident;
    if(map.has(bank))return this.preloadBank('resident',bank,{limit});
    for(const [name] of map)if(name.includes(bank)||bank.includes(name))return this.preloadBank('resident',name,{limit});
    return 0;
  }
  async prewarm(weaponBank='lmg_combat'){
    await this.loadPermanent();
    await Promise.allSettled([
      this.preloadWeapon(weaponBank),
      this.preloadResident('collision',{limit:12}),
      this.preloadResident('explosions',{limit:10}),
      this.preloadResident('weapons',{limit:8})
    ]);
  }
  flashRing(strength=.7){
    if(!this.ctx||!this.master)return;
    const now=this.ctx.currentTime,dur=1.4+strength*1.6,osc=this.ctx.createOscillator(),gain=this.ctx.createGain(),filter=this.ctx.createBiquadFilter();
    osc.type='sine';osc.frequency.setValueAtTime(4100,now);osc.frequency.exponentialRampToValueAtTime(2650,now+dur);
    filter.type='highpass';filter.frequency.value=900;
    gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(.055*strength+.004,now+.015);gain.gain.exponentialRampToValueAtTime(.0001,now+dur);
    osc.connect(filter);filter.connect(gain);gain.connect(this.master);osc.start(now);osc.stop(now+dur+.02)
  }
  setFlashMuffle(strength=.7,duration=1.4){
    if(!this.master||!this.ctx)return;
    const now=this.ctx.currentTime,g=this.master.gain;g.cancelScheduledValues(now);g.setValueAtTime(g.value,now);g.linearRampToValueAtTime(Math.max(.18,.82-strength*.5),now+.02);g.linearRampToValueAtTime(.82,now+duration)
  }
}