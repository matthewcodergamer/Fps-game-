export const STAGES=[
  {id:1,name:'Playable FPS Foundation',status:'complete',items:['Three.js renderer','Killhouse blockout','desktop + mobile input','sprint/crouch/slide/jump','ADS/fire/reload','targets/damage/respawn','shell casings','three-layer local audio importer']},
  {id:2,name:'Production Systems',status:'complete',items:['GLB/KTX2/Draco/Meshopt asset pipeline','Rapier WASM physics foundation','PBR weathering material system','geometry + animation LOD','weapon/character rig loaders and socket contracts','multiplayer room relay + snapshots/interpolation','per-device dynamic quality profiles','permanent three-layer audio layout + batch AWC/WAV tooling']},
  {id:3,name:'Hero Weapons + Character',status:'active',items:['realistic hero rifle','pistol','first-person arms rig','full-body soldier','IK hand sockets','reload/bolt/slide animation graph','red dot + holographic optics','replace temporary geometry viewmodel with production GLBs']},
  {id:4,name:'Combat + Effects Polish',status:'queued',items:['ballistics','penetration/ricochet','surface impacts','grenades','muzzle smoke','decals','hit reactions','ragdolls','distance/occlusion audio']},
  {id:5,name:'Maps + Visual Fidelity',status:'queued',items:['Killhouse art pass','Dustline','Port','CC0 PBR material library','KTX2 texture variants','rust/mud/wetness','baked lighting','night vision']},
  {id:6,name:'Online Multiplayer',status:'queued',items:['authoritative simulation','client prediction','server reconciliation','lag compensation','TDM/FFA','rooms','anti-cheat validation']},
  {id:7,name:'Content + Release',status:'queued',items:['full weapon roster','operators/customization','gunsmith','map editor','procedural map modules','PWA install/cache','asset pack updater','iPhone performance certification']}
];
