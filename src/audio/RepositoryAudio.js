import { AudioManager } from './AudioManager.js';

const mobileAudio = matchMedia('(any-pointer: coarse)').matches;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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
    if(!this._prewarmTasks)this._prewarmTasks=new Map();
    if(!this._prewarmTasks.has(weaponBank)){
      const task=mobileAudio
        ? (async()=>{
            // iPhone Safari gets one small decode group at a time. Missing
            // sounds still lazy-load on first use through AudioManager.
            const weapon=await this.preloadWeapon(weaponBank,{limit:2});
            const collision=await this.preloadResident('collision',{limit:1});
            const explosions=await this.preloadResident('explosions',{limit:1});
            const weapons=await this.preloadResident('weapons',{limit:1});
            return{weapon,collision,explosions,weapons,indexed:this.indexedFiles,warming:false};
          })()
        : Promise.all([
            this.preloadWeapon(weaponBank,{limit:4}),
            this.preloadResident('collision',{limit:2}),
            this.preloadResident('explosions',{limit:2}),
            this.preloadResident('weapons',{limit:2})
          ]).then(([weapon,collision,explosions,weapons])=>({weapon,collision,explosions,weapons,indexed:this.indexedFiles,warming:false}));
      this._prewarmTasks.set(weaponBank,task.finally(()=>this._prewarmTasks?.delete(weaponBank)));
    }
    const fallback={weapon:0,collision:0,explosions:0,weapons:0,indexed:this.indexedFiles,warming:true};
    // Deploy must never wait on a slow decode. The task keeps warming in the
    // background while gameplay starts and individual banks remain lazy-loadable.
    return Promise.race([
      this._prewarmTasks.get(weaponBank),
      sleep(mobileAudio?450:1200).then(()=>fallback)
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
