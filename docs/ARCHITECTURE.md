# Project Strike Architecture

## Runtime

- Three.js renderer with WebGL2 baseline and future WebGPU renderer path.
- Mobile-first FPS controller with desktop pointer-lock adapter.
- Weapon definitions separated from rendering and audio data.
- Three-layer combat audio system: `weapons_player`, `dlc_weapons`, `resident`.
- PWA shell and service worker.
- IndexedDB asset caching is the next storage milestone.
- Rapier WASM is reserved for rigid bodies, grenades, props and ragdolls; FPS movement remains game-specific.

## Audio contract

Converted packs must preserve the source layer. Runtime layout:

```text
public/game-assets/audio/
├── weapons_player/
├── dlc_weapons/
├── resident/
└── audio-manifest.json
```

Current local-import path accepts one or more converted Project-Strike-Audio ZIPs and uses each ZIP's `audio-manifest.json` to map streams back to their original layer/bank. This means the same game code works whether audio is imported locally, committed into a private repository, or later hosted on an asset CDN.

## Weapon asset contract

Each shipping weapon will use a GLB root with named nodes/sockets where applicable:

```text
WeaponRoot
├── Receiver
├── Barrel
├── Magazine
├── Bolt_or_Slide
├── ChargingHandle
├── Trigger
├── MuzzleSocket
├── EjectionSocket
├── LeftHandSocket
├── RightHandSocket
├── OpticSocket
├── MuzzleAttachmentSocket
└── UnderbarrelSocket
```

First-person and world weapons are separate runtime presentations. First-person keeps hero detail; remote/world weapons use LOD0-LOD3.

## Production phases

1. Engine shell, diagnostics, PWA and asset contracts.
2. Mobile/desktop movement, jump, crouch, sprint and slide.
3. Hero rifle viewmodel, recoil, ADS, reload, casings and muzzle flash.
4. Proper GLB hands/weapon rig, animation layers and IK sockets.
5. Hitboxes, material impacts, decals and ballistics.
6. Third-person soldier, locomotion, hit reactions and ragdoll transition.
7. Two-player networking, prediction/interpolation and hit validation.
8. Killhouse art pass with PBR/KTX2/LOD/instancing/occlusion.
9. Additional weapons, attachments, grenades and optics.
10. Dirt/rust/wetness/wear shaders, night vision and weather.
11. Content streaming, IndexedDB packs and dynamic quality benchmark.
12. Fixed-map content expansion, then procedural modular maps.

## Performance rule

Source quality is not runtime cost. Keep high-resolution/high-poly source assets outside the runtime bundle; compile them to GLB LODs, KTX2 texture tiers, mesh compression and device-selected variants.
