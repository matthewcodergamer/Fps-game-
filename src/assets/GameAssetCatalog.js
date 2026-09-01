export const DEFAULT_ARMS='./game-assets/models/characters/first_person_arms/free_fps_arms_gameready_-_rigged.glb';

const opticRed='./game-assets/models/weapons/attachments/crimson_trace_cts-1550_red_dot_sight.glb';
const opticHolo='./game-assets/models/weapons/attachments/free_pbr_holo_sight_optics._cheerr.glb';

export const WEAPON_CATALOG=[
  {id:'m4a1',name:'M4A1',class:'rifle',model:'./game-assets/models/weapons/rifles/colt_m4a1_carbine.glb',bank:'lmg_combat',mag:30,reserve:120,fireRate:700,damage:34,recoil:1,viewLength:.92,optic:opticHolo,pattern:[[1,.08],[1.08,-.12],[1.12,.15],[1.18,-.2],[1.22,.1]]},
  {id:'m4',name:'M4 CARBINE',class:'rifle',model:'./game-assets/models/weapons/rifles/m4_carbine.glb',bank:'lmg_combat',mag:30,reserve:120,fireRate:720,damage:33,recoil:.96,viewLength:.9,optic:opticRed,pattern:[[.95,.05],[1,-.08],[1.06,.1],[1.1,-.13]]},
  {id:'ak74',name:'AK-74',class:'rifle',model:'./game-assets/models/weapons/rifles/ak74.glb',bank:'lmg_mg_player',mag:30,reserve:120,fireRate:600,damage:38,recoil:1.34,viewLength:.9,optic:opticRed,pattern:[[1.18,.12],[1.28,-.16],[1.38,.22],[1.48,-.28],[1.56,.16]]},
  {id:'scarl',name:'SCAR-L',class:'rifle',model:'./game-assets/models/weapons/rifles/scarl.glb',bank:'lmg_combat',mag:30,reserve:120,fireRate:625,damage:37,recoil:1.22,viewLength:.92,optic:opticHolo,pattern:[[1.08,.08],[1.18,-.11],[1.26,.16],[1.34,-.2]]},
  {id:'vss',name:'VSS',class:'rifle',model:'./game-assets/models/weapons/rifles/vss.glb',bank:'snp_rifle',mag:20,reserve:100,fireRate:700,damage:42,recoil:.78,viewLength:.88,optic:null,suppressed:true,pattern:[[.7,.03],[.74,-.05],[.79,.06],[.84,-.07]]},
  {id:'service_pistol',name:'SERVICE PISTOL',class:'pistol',model:'./game-assets/models/weapons/pistols/service_pistol.glb',bank:'ptl_pistol',mag:17,reserve:68,fireRate:420,damage:28,recoil:1.2,viewLength:.45,optic:null,pattern:[[1.1,.04],[1.2,-.08],[1.28,.1]]},
  {id:'m1911',name:'M1911',class:'pistol',model:'./game-assets/models/weapons/pistols/m1911.glb',bank:'ptl_combat',mag:8,reserve:48,fireRate:350,damage:36,recoil:1.35,viewLength:.43,optic:null,pattern:[[1.25,.06],[1.36,-.1],[1.45,.12]]},
  {id:'p226',name:'P226',class:'pistol',model:'./game-assets/models/weapons/pistols/p226.glb',bank:'ptl_pistol',mag:15,reserve:75,fireRate:430,damage:29,recoil:1.12,viewLength:.44,optic:null,pattern:[[1.02,.03],[1.1,-.06],[1.17,.08]]},
  {id:'mp5a5',name:'MP5A5',class:'smg',model:'./game-assets/models/weapons/smgs/mp5a5.glb',bank:'smg_smg',mag:30,reserve:150,fireRate:800,damage:24,recoil:.78,viewLength:.7,optic:opticRed,pattern:[[.68,.04],[.72,-.05],[.78,.07],[.82,-.09]]},
  {id:'m3a1',name:'M3A1',class:'smg',model:'./game-assets/models/weapons/smgs/m3a1.glb',bank:'smg_micro',mag:30,reserve:150,fireRate:450,damage:30,recoil:1.05,viewLength:.7,optic:null,pattern:[[.95,.05],[1.03,-.09],[1.1,.12]]},
  {id:'rem870',name:'REMINGTON 870',class:'shotgun',model:'./game-assets/models/weapons/shotguns/remington_870_police_magnum_12_gauge_shotgun.glb',bank:'sht_pump',mag:8,reserve:40,fireRate:75,damage:18,pellets:8,recoil:2.2,viewLength:.96,optic:null,mobileHeavy:true,pattern:[[2.1,.12],[2.2,-.12]]},
  {id:'awm',name:'AWM',class:'sniper',model:'./game-assets/models/weapons/snipers/awm.glb',bank:'snp_rifle',mag:5,reserve:25,fireRate:48,damage:110,recoil:2.35,viewLength:1.05,scope:true,pattern:[[2.25,.08],[2.4,-.08]]},
  {id:'awp_cs2',name:'AWP',class:'sniper',model:'./game-assets/models/weapons/snipers/awp_cs2.glb',bank:'snp_rifle',mag:10,reserve:30,fireRate:42,damage:120,recoil:2.55,viewLength:1.06,scope:true,pattern:[[2.45,.1],[2.6,-.1]]},
  {id:'axmc',name:'AXMC',class:'sniper',model:'./game-assets/models/weapons/snipers/axmc.glb',bank:'snp_heavy',mag:5,reserve:25,fireRate:38,damage:135,recoil:2.7,viewLength:1.08,scope:true,pattern:[[2.6,.11],[2.8,-.11]]},
  {id:'m24',name:'M24',class:'sniper',model:'./game-assets/models/weapons/snipers/m24.glb',bank:'snp_rifle',mag:5,reserve:25,fireRate:45,damage:105,recoil:2.25,viewLength:1.02,scope:true,pattern:[[2.15,.07],[2.3,-.08]]}
];

export const GRENADE_ASSETS={
  frag:'./game-assets/models/grenades/high-quality_frag_grenade_3d_model.glb',
  flash:'./game-assets/models/grenades/flashbang.glb'
};

export const ANIMATION_PACKS=[
  './game-assets/animations/pistol/PistolFight_mixamo.glb',
  './game-assets/animations/library/quaternius_UAL1_Standard.glb',
  './game-assets/animations/library/quaternius_UAL2_Standard.glb'
];

export const ENVIRONMENT_ASSETS={
  cover:[
    './game-assets/models/environment/cover/concrete_road_barrier.glb',
    './game-assets/models/environment/cover/old_military_crate.glb'
  ],
  terrain:['./game-assets/models/environment/terrain/boulder_01.glb'],
  buildings:Array.from({length:18},(_,i)=>`./game-assets/models/environment/buildings/kenney-industrial/building-${String.fromCharCode(97+i)}.glb`)
};