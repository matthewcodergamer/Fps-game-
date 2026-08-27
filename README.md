# Project Strike

High-realism, mobile-first tactical FPS for the browser. The project targets iPhone-class hardware and desktop from one Three.js codebase, using LOD, compressed/streamed assets and scalable effects rather than maintaining a separate mobile game.

## Build status

### Stage 1 — Playable FPS Foundation — COMPLETE

Movement, touch/mouse look, sprint, crouch, slide, jump, ADS, automatic fire, reload, ammo, recoil, muzzle flash, shell casings, target damage/headshots, respawn, Killhouse blockout, PWA shell and three-layer audio architecture are implemented.

### Stage 2 — Production Systems — COMPLETE

The repository contains the Three.js production renderer, Rapier physics foundation, scalable quality path, model/asset infrastructure, multiplayer room/snapshot foundations, ballistics, grenades, optics, decals/effects and the permanent `resident`, `weapons_player`, `dlc_weapons` audio architecture.

### Stage 3 — Production Asset Integration — ACTIVE

Stage 3 replaces prototype geometry with realistic hero weapons, masculine first-person arms, rigged operators, high-quality environment assets, real PBR materials, authored/mocap animation plus procedural animation, IK/socket alignment and synchronized weapon audio.

Stage 3 foundation:

- `src/assets/ModelLoader.js` — GLB/glTF loader with Draco, Meshopt and KTX2 support plus runtime inspection.
- `src/animation/AnimationController.js` — base/upper/additive animation layers and procedural bone overrides.
- `src/audio/WeaponAudioRouter.js` — named weapon animation events resolve through manifests instead of hard-coded WAV filenames.
- `public/game-assets/manifests/weapons.json` — weapon model/socket/moving-part/audio contract.
- `public/game-assets/manifests/characters.json` — operator and first-person-arm skeleton contract.
- `public/game-assets/manifests/animations.json` — locomotion/combat/FPS animation-set contract.
- `.github/workflows/convert-blend.yml` + `tools/blender/export_glb.py` — validated headless Blender `.blend` → GLB conversion with texture relinking and conversion reports.
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
    └── conversion-reports/
```

Editable source assets belong under `assets-source/`; Safari should normally load validated runtime GLB/glTF/KTX2/audio from `public/game-assets/`.

## Project Strike Asset Uploader

The dedicated companion repository is `matthewcodergamer/Weapon-model-`.

GitHub Pages:

`https://matthewcodergamer.github.io/Weapon-model-/`

Current web version: **V12**.

The uploader:

- recursively opens ZIP and folder packages;
- keeps model files and textures together;
- classifies models, animations, Blender sources and PBR dependencies;
- recognizes common Base Color, Normal, Roughness, Metallic, AO, ORM/ARM, Height, Emissive and opacity maps;
- previews real GLB/glTF/FBX assets in the browser;
- converts supported FBX scenes to binary GLB;
- sends `.blend` packages, their original folder structure and an `asset.json` destination manifest to this repository;
- organizes runtime assets into the correct `public/game-assets/` category.

## Real Blender → GLB pipeline

Three.js does not render `.blend` directly. Blender packages uploaded by the V12 tool are stored as:

```text
assets-source/imports/<package>/
├── asset.json
└── raw/
    ├── model.blend
    └── textures/
```

The GitHub Actions conversion pipeline then:

1. waits briefly for large multi-file package uploads to settle;
2. refreshes to the newest `main` state;
3. opens the real `.blend` with headless Blender;
4. searches the package for image dependencies;
5. repairs broken image paths by matching texture filenames;
6. preserves existing Blender material node connections;
7. connects Base Color, Normal, Roughness and Metallic textures to empty Principled BSDF inputs when a package clearly provides those maps;
8. preserves hierarchy, skinning, armatures, animation clips and morph targets;
9. exports a binary GLB to the category defined by `asset.json`;
10. asserts that meshes exist, the output is non-empty and the file has a valid GLB header;
11. writes a JSON conversion report under `public/game-assets/manifests/conversion-reports/`;
12. commits the validated runtime GLB back to `main`.

This keeps the editable Blender source package while giving Safari and Three.js the self-contained runtime GLB they actually need.

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
