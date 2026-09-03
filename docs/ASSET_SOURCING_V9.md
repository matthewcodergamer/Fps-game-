# Project Strike V9 — realistic asset sourcing

V9 does **not** replace working high-detail repository assets with primitive or lower-fidelity models. The immediate runtime uses the real files already checked into `public/game-assets/` and streams them on iPhone with one model decode at a time.

## Authoritative gameplay models

- First-person arms: `models/characters/first_person_arms/free_fps_arms_gameready_-_rigged.glb`
- Main rifle: `models/weapons/rifles/colt_m4a1_carbine.glb`
- Mobile M4 optic: `models/weapons/attachments/crimson_trace_cts-1550_red_dot_sight.glb`
- Desktop M4 optic: `models/weapons/attachments/free_pbr_holo_sight_optics._cheerr.glb`
- Animated combat operator: `models/characters/operators/bamen_military_soldier_animated.glb`
- Frag: `models/grenades/high-quality_frag_grenade_3d_model.glb`
- Flashbang: `models/grenades/flashbang.glb`
- Enterable district: `models/environment/buildings/kenney-industrial/enterable/`

The BAMEN operator is already documented as CC BY 4.0 in `public/game-assets/models/characters/operators/BAMEN_LICENSE.md`.

## Open-license sources researched for expansion

### Quaternius Universal Base Characters

Source: https://quaternius.com/packs/universalbasecharacters.html

- CC0.
- Six humanoid base characters with multiple proportions and hair options.
- Humanoid rig.
- About 13k triangles per base character according to the publisher.
- FBX and glTF exports.
- Compatible with Quaternius Universal Animation Library.

Good V9/V10 candidate for civilians, allies and background NPC variants. It should be imported only after we establish a deterministic retargeting and texture-compression pipeline; the current BAMEN combat operator remains the higher-priority tactical target.

### Quaternius Universal Animation Library / UAL2

Sources:
- https://quaternius.com/packs/universalanimationlibrary.html
- https://quaternius.com/packs/universalanimationlibrary2.html

Both are CC0 humanoid animation libraries. Project Strike already has Quaternius UAL GLBs under `game-assets/animations/library/`; future work should retarget selected locomotion, combat, slide, parkour, hit and death clips to each compatible humanoid instead of shipping every clip into memory at once.

### Poly Haven

Source: https://polyhaven.com/

Poly Haven publishes CC0 HDRIs, textures and many 3D models. It is a good source for realistic industrial props and surface materials. Assets should be converted to mobile-friendly glTF and texture sizes before entering the runtime repository.

### Khronos glTF Sample Assets

Source: https://github.com/KhronosGroup/glTF-Sample-Assets

Useful for validating the renderer and advanced glTF material support. Licenses vary per model, so every candidate must be checked individually before copying it into Project Strike. Do not treat the whole collection as a single reusable license.

## Mobile import rules

1. No procedural block model may silently count as a successful weapon, arms or grenade load.
2. Critical models load before background district dressing.
3. iPhone allows one GLB/FBX decode at a time.
4. Decoded source-model cache entries are evicted after a clone is created on memory-constrained devices.
5. Large model/texture responses are streamed and are not cloned into Service Worker Cache Storage.
6. The 2.6 MB holo optic that coincided with the old Safari crash is not loaded on iPhone V9; the smaller **real** Crimson Trace repository GLB is used there instead.
7. Background buildings use streaming holders and appear as each real model finishes.
8. Future imported assets should be run through glTF Transform / Meshopt, with KTX2/Basis textures where visually acceptable, before shipping on iPhone.

## Next art pass

- Add 2–4 distinct humanoid NPC variants rather than cloning one operator six times.
- Retarget UAL locomotion, sprint, crouch, slide, hit-react, stagger and death clips.
- Add LODs for operators and buildings.
- Add streamed industrial props from CC0 sources after texture/triangle audits.
- Add material-specific PBR decals and surface sets without loading full-resolution textures on iPhone.
- Keep full-resolution desktop assets as a separate quality tier rather than making mobile fall back to boxes.
