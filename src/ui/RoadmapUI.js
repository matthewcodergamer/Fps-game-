import { STAGES } from '../core/Stages.js';

export function mountRoadmap(){
  const panel=document.querySelector('#roadmap'),list=document.querySelector('#stageList');
  if(!panel||!list)return;
  list.innerHTML=STAGES.map(s=>`<section class="stage ${s.status}"><div class="stageTop"><h3>${String(s.id).padStart(2,'0')} · ${s.name}</h3><span class="status">${s.status}</span></div><ul>${s.items.map(i=>`<li>${i}</li>`).join('')}</ul></section>`).join('');
  document.querySelector('#roadmapBtn')?.addEventListener('click',()=>panel.classList.remove('hidden'));
  document.querySelector('#closeRoadmap')?.addEventListener('click',()=>panel.classList.add('hidden'));
}
