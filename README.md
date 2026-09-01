# Project Strike

High-realism, mobile-first tactical FPS for the browser. Project Strike targets iPhone-class hardware and desktop from one Three.js codebase, scaling lighting, post-processing, shadows, particles, resolution and asset detail instead of maintaining a separate mobile game.

## Current build

### Stage 1 — Playable FPS Foundation — COMPLETE

Movement, touch/mouse look, sprint, crouch, slide, jump, ADS, fire, reload, ammo, recoil, muzzle flash, shell casings, target damage/headshots, respawn, Killhouse blockout, PWA shell and the three-layer audio architecture are implemented.

### Stage 2 — Production Systems — COMPLETE

The repository contains the Three.js asset/rendering foundation, Rapier physics foundation, scalable quality path, GLB/KTX2/Draco/Meshopt loading, multiplayer foundations, ballistics, grenades, optics, decals/effects and the permanent `resident`, `weapons_player`, `dlc_weapons` audio layout.

### Stage 3 — Playable Production Integration — ACTIVE

The browser now boots the real Stage 3 runtime from `src/main-stage3.js` instead of the proxy Stage 2 viewmodel.

Current playable integration includes:

- real M4A1, Service Pistol, AK-74, MP5A5 and AWM GLB viewmodels;
- real rigged first-person arms;
- animated military operator targets;
- Quaternius animation libraries retained for the next retargeting pass;
- procedural first-person weapon weight, sprint pose, camera inertia, ADS alignment, recoil, slide tilt and mechanical reload movement;
- mouse/keyboard, multitouch mobile controls and standard Gamepad API controller support;
- permanent repository weapon audio loaded from `public/game-assets/audio/audio-manifest.json` with lazy decoding, variation, mechanical layers and a mastered compressor bus;
- a real industrial arena assembled from the imported environment/cover assets;
- WebGPU-first rendering with WebGL2 fallback through Three.js WebGPURenderer;
- Forward+ clustered point lighting for emissive/neon local lights;
- ACES tone mapping and PBR image-based lighting;
- desktop/high-end SSGI + temporal AA + emissive bloom;
- mobile/balanced half-resolution GTAO + restrained bloom;
- dynamic resolution scaling targeting 60 FPS.

## Visual direction

Project Strike combines several high-level FPS qualities without trying to clone any one commercial game:

- **Cyberpunk-style presentation:** wet materials, emissive practical lights, strong color separation, bright local highlights and cinematic exposure.
- **Call-of-Duty-style first-person weight:** readable weapon silhouette, inertial sway, sprint displacement, fast ADS transition, recoil recovery and mechanical reload motion.
- **Counter-Strike-style readability:** compact routes, clean sightlines, predictable weapon states and low-latency input.
- **Bodycam-style physicality:** restrained edge vignette, camera roll/slide response and less floaty movement.

This is not a browser implementation of Unreal Engine 5 Lumen or Nanite. The renderer uses web-native equivalents that can scale to phones: PBR + IBL, clustered local lights, screen-space GI/AO, temporal AA, bloom, dynamic shadows, fog, LOD and dynamic resolution.

## Runtime asset structure

```text
public/game-assets/
├── audio/
│   ├── audio-manifest.json
│   ├── weapons_player/
│   ├── dlc_weapons/
│   └── resident/
├── models/
│   ├── weapons/
│   │   ├── rifles/
│   │   ├── pistols/
│   │   ├── smgs/
│   │   ├── shotguns/
│   │   ├── snipers/
│   │   └── attachments/
│   ├── characters/
│   │   ├── first_person_arms/
│   │   └── operators/
│   └── environment/
├── animations/
├── materials/
└── manifests/
```

Editable source assets belong under `assets-source/`; Safari normally loads validated runtime GLB/glTF/KTX2/audio from `public/game-assets/`.

## Rendering architecture

```text
PBR GLB materials + PMREM environment lighting
                 ↓
       sun + clustered local lights
                 ↓
        Three.js WebGPURenderer
                 ↓
     MRT color / normal / depth / velocity
           ↓                    ↓
 desktop/high-end             mobile
 SSGI + TRAA             half-res GTAO
           \                    /
            emissive bloom + ACES
                     ↓
             dynamic resolution
```

`src/rendering/CinematicPipeline.js` is deliberately tiered. Expensive screen-space GI is not enabled on the phone path by default; mobile gets cheaper AO/bloom and lower internal resolution so visual upgrades do not destroy responsiveness.

## Weapon / animation architecture

```text
real GLB weapon + FPS arms
          ↓
asset inspection / moving-part discovery
          ↓
procedural base pose + weapon-specific clips
          ↓
ADS / sway / recoil / sprint / slide / reload
          ↓
IK + authored animation retargeting (next pass)
```

The current runtime can animate common magazine, slide/bolt and trigger nodes when the imported hierarchy exposes useful names. `public/game-assets/manifests/weapons.json`, `characters.json` and `animations.json` record the current ready assets.

## Audio architecture

Project Strike uses the committed audio rather than placeholder oscillator sounds. `AudioManager` reads the root asset manifest, indexes the `resident`, `weapons_player` and `dlc_weapons` banks, lazy-decodes only the selected weapon bank, prefers full audio clips for shots and short components for mechanical reload events, varies pitch slightly, and routes weapon sound through a compressor/master bus to reduce harsh overlap.

## Controls

**Desktop** — WASD, mouse, Shift sprint, Space jump, C/Ctrl crouch/slide, R reload, LMB fire, RMB ADS, Q/1/2 switch weapon.

**Mobile** — left analog movement pad, right-side free look, Fire, ADS, Reload, Jump, Slide/Crouch and Swap.

**Controller** — left stick move, right stick look, RT fire, LT ADS, L3 sprint, A/Cross jump, B/Circle slide/crouch, X/Square reload, Y/Triangle swap. Supported controllers can receive recoil rumble.

## Run locally

```bash
npm install
npm run dev
```

Production validation:

```bash
npm run check
```

The GitHub Pages workflow builds with Vite and deploys `dist/` on pushes to `main`.

## Asset provenance

Third-party runtime assets keep their source/license records under `public/game-assets/manifests/` and beside assets where required. See `public/game-assets/manifests/asset-sources/project-strike-missing-assets.md` for the latest imported batch.
