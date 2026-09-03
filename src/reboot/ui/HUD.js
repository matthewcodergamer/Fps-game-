export class HUD{
  constructor(){this.boot=document.querySelector('#boot');this.hud=document.querySelector('#hud');this.bootText=document.querySelector('#bootText');this.bar=document.querySelector('#progressBar');this.gpu=document.querySelector('#gpuStatus');this.physics=document.querySelector('#physicsStatus');this.quality=document.querySelector('#qualityStatus');this.deploy=document.querySelector('#deployBtn');this.ammo=document.querySelector('#ammo');this.state=document.querySelector('#stateLabel');this.fps=document.querySelector('#fps');this.diag=document.querySelector('#diagnostics');this.hitmarker=document.querySelector('#hitmarker');this.fatal=document.querySelector('#fatal');this._hitTimer=0;}
  progress(percent,text){this.bar.style.width=`${Math.max(3,percent)}%`;this.bootText.textContent=text;}
  capability(profile){this.gpu.textContent=`GPU: WEBGPU`;this.quality.textContent=`Quality: ${profile.tier}`;}
  physicsReady(){this.physics.textContent='Physics: HAVOK';}
  ready(){this.progress(100,'Vertical slice foundation ready.');this.deploy.disabled=false;this.deploy.textContent='DEPLOY';}
  enter(){this.boot.classList.add('hidden');this.hud.classList.remove('hidden');}
  setAmmo(mag,reserve,reloading){this.ammo.textContent=mag;this.state.textContent=reloading?'RELOADING':'READY';}
  setState(s){this.state.textContent=s;}
  hit(){this.hitmarker.classList.add('show');clearTimeout(this._hitTimer);this._hitTimer=setTimeout(()=>this.hitmarker.classList.remove('show'),90);}
  updateDiagnostics(info){this.fps.textContent=`${Math.round(info.fps)} FPS`;this.diag.textContent=`backend  WebGPU\nquality  ${info.quality}\nstate    ${info.state}\nphysics  Havok 60Hz\nshots    ${info.shots}\ndraws    ${info.draws}\nmeshes   ${info.meshes}`;}
  fail(error){this.boot?.classList.add('hidden');this.hud?.classList.add('hidden');this.fatal.classList.remove('hidden');this.fatal.textContent=`PROJECT STRIKE REBOOT FAILED\n\n${error?.message||error}\n\nThe legacy V10.1 runtime is preserved on branch legacy-v10.1.`;}
}
