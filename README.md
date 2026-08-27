# Project Strike

High-realism, mobile-first tactical FPS for the browser. The project targets iPhone-class hardware and desktop from one Three.js codebase, using LOD, compressed/streamed assets and scalable effects rather than maintaining a separate mobile game.

## Build status

### Stage 1 — Playable FPS Foundation — COMPLETE

Movement, touch/mouse look, sprint, crouch, slide, jump, ADS, automatic fire, reload, ammo, recoil, muzzle flash, shell casings, target damage/headshots, respawn, Killhouse blockout, PWA shell and three-layer audio architecture are implemented.

### Stage 2 — Production Systems — COMPLETE

The repository contains the Three.js production renderer, Rapier physics foundation, scalable quality path, model/asset infrastructure, multiplayer room/snapshot foundations, ballistics, grenades, optics, decals/effects and the permanent `resident`, `weapons_player`, `dlc_weapons` audio architecture.

### Stage 3 — Production Asset Integration — ACTIVE

Stage 3 replaces prototype geometry with realistic hero weapons, masculine first-person arms, rigged operators, high-quality environment assets, real PBR materials, authored/mocap animation plus procedural animation, IK/socket alignment and synchronized weapon audio.

New Stage 3 foundation:

- `src/assets/ModelLoader.js` — GLB/glTF loader with Draco, Meshopt and KTX2 support plus runtime inspection.
- `src/animation/AnimationController.js` — base/upper/additive animation layers and procedural bone overrides.
- `src/audio/WeaponAudioRouter.js` — named weapon animation events resolve through manifests instead of hard-coded WAV filenames.
- `public/game-assets/manifests/weapons.json` — weapon model/socket/moving-part/audio contract.
- `public/game-assets/manifests/characters.json` — operator and first-person-arm skeleton contract.
- `public/game-assets/manifests/animations.json` — locomotion/combat/FPS animation-set contract.
- `.github/workflows/convert-blend.yml` + `tools/blender/export_glb.py` — real headless Blender `.blend` → GLB conversion.
- `docs/ASSET_PIPELINE_V2.md` — production source/runtime pipeline and validation rules.

## Runtime asset structure

```text
public/game-assets/
├── audio/
│   ├── weapons_player/
│   ├── dlc_weapons/
│   └── resident/
├── models/
│   ├── weapons/
│   │   ├── rifles/
│   │   ├── pistols/
│   │   └── attachments/
│   ├── characters/
│   │   ├── first_person_arms/
│   │   └── operators/
│   └── environment/
├── animations/
├── materials/
└── manifests/
```

Editable source assets belong under `assets-source/`; Safari should normally load validated runtime GLB/glTF/KTX2/audio from `public/game-assets/`.

## Asset-processing tools

The companion repository `matthewcodergamer/RAGE-Weapon-Audio-Web` now also contains `model-processor.html`.

The model processor:

- extracts ZIPs locally
- resolves complete glTF packages
- previews actual GLB/glTF models
- parses FBX with Three.js
- converts successfully parsed FBX scenes to binary GLB with `GLTFExporter`
- reports mesh/triangle/material/texture/bone/animation counts
- never fake-converts Blender files

Blender files use the real headless Blender GitHub Action in this repository.

## Animation direction

Project Strike uses a hybrid animation architecture:

```text
mocap / authored animation
        ↓
Three.js AnimationMixer
        ↓
base locomotion + upper-body weapon layer
        ↓
additive recoil / reactions
        ↓
IK + procedural bone controls
        ↓
final pose
```

General humanoid locomotion can be retargeted from high-quality mocap. First-person reload/fire/inspect clips stay weapon-specific. Recoil, sway, ADS alignment, slide tilt, camera inertia, aim offsets, hand placement and later foot placement are procedural runtime layers.

## Audio synchronization

Audio is not attached to models as random files. Weapon definitions emit named events such as `fire`, `magOut`, `magIn`, `bolt`, `slideRelease`, `chargingHandle`, `pinPull` and `grenadeRelease`. `WeaponAudioRouter` resolves those events to the correct imported audio-bank entries.

## Controls

Desktop: WASD, mouse, Shift sprint, Space jump, C/Ctrl crouch/slide, R reload, LMB fire, RMB ADS.

Mobile: left movement pad, right-side free look, Fire, ADS, Reload, Jump and Slide/Crouch.

See `docs/ARCHITECTURE.md`, `docs/STAGE_2_COMPLETE.md`, and `docs/ASSET_PIPELINE_V2.md`.
