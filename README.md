# Project Strike

High-realism, mobile-first tactical FPS for the browser. The project targets iPhone-class hardware and desktop from one Three.js codebase, using LOD, compressed/streamed assets and scalable effects instead of maintaining a separate mobile game.

## Build status

### Stage 1 — Playable FPS Foundation — COMPLETE

Movement, touch/mouse look, sprint, crouch, slide, jump, ADS, automatic fire, reload, ammo, recoil, muzzle flash, shell casings, target damage/headshots, respawn, Killhouse blockout, PWA shell and local three-layer audio import are implemented.

### Stage 2 — Production Systems — COMPLETE

The repository now contains:

- Three.js production renderer and iPhone-aware rendering path.
- Rapier WASM physics foundation.
- GLB/glTF asset loader with Draco, Meshopt and KTX2 support.
- PBR material/weathering system for dirt, rust and wetness.
- Geometry LOD and distance-based animation update systems.
- Weapon GLB socket runtime and humanoid character/animation contracts.
- Chunked map loader and seeded modular layout foundation.
- WebSocket room relay, room client, snapshots and interpolation.
- Ballistics, penetration and tracer foundations.
- Red-dot/scope runtime.
- Grenade physics runtime.
- Impact/decal pooling.
- Night-vision rendering module.
- Device quality manager with dynamic resolution hooks.
- Asset Inspector for GLB triangle/bone/animation/socket validation.
- Permanent `resident`, `weapons_player`, `dlc_weapons` audio architecture.
- Browser and Node AWC/WAV batch tooling.

Stage 3 is now active and replaces prototype geometry with production first-person weapons, hands, character rigs, IK sockets, reload/bolt/slide animation and optics.

## Runtime entry

`index.html` runs `src/main-stage2.js` plus `src/runtime-stage2-hooks.js`. Those filenames remain for compatibility even though the project roadmap has advanced to Stage 3.

## Asset structure

```text
public/game-assets/
├── audio/
│   ├── weapons_player/
│   ├── dlc_weapons/
│   └── resident/
├── models/
│   ├── weapons/
│   └── characters/
├── animations/
├── maps/
├── textures/
│   └── materials/
└── manifests/
```

## Audio deployment

The converted development ZIPs supplied so far contain:

- `weapons_player`: **22 banks / 122 WAV streams**.
- `dlc_weapons`: **6 banks / 73 WAV streams**.
- `resident`: the runtime layer exists, but a converted resident ZIP is still required for its WAV payload.

Use `/tools/audio-deploy.html` from the deployed site to select the converted ZIPs and create one Git commit containing the actual binary WAV files. The deployer preserves the three top-level layers and each AWC bank as a subfolder, then regenerates `public/game-assets/audio/audio-manifest.json`.

Expected permanent layout:

```text
public/game-assets/audio/
├── weapons_player/
│   ├── lmg_combat/
│   ├── ptl_pistol/
│   ├── sht_bullpup/
│   └── ...
├── dlc_weapons/
│   ├── ptl_revolver/
│   ├── ptl_navy_revolver/
│   └── ...
├── resident/
│   ├── weapons/
│   ├── explosions/
│   ├── collision/
│   └── ...
└── audio-manifest.json
```

The start screen can also import the same ZIPs locally during development.

## Asset targets

Runtime models use GLB/glTF. First-person hero weapons use high-detail LOD0; world weapons and characters use LOD0–LOD3. Runtime texture targets are KTX2/Basis with mipmaps and quality tiers. High-resolution source art can remain 4K/8K/high-poly because runtime derivatives are selected by device and distance.

`public/game-assets/manifests/asset-catalog.json` contains the current model, animation and PBR material acquisition plan.

## Internal tools

- `/tools/asset-viewer/` opens local GLB/glTF files and reports triangle count, materials, bones, animations and required Project Strike weapon sockets.
- `/tools/audio-deploy.html` deploys converted WAV ZIPs into the permanent three-layer GitHub tree in a single commit.
- `tools/audio/convert-awc.mjs` is the batch AWC-to-WAV converter used by the asset pipeline.

## Multiplayer

`server/` contains the first room relay service. GitHub Pages hosts only the game client; the relay/server must be deployed separately. The client already has room connection, remote snapshots and interpolation infrastructure. Later online work adds authoritative hit simulation, client prediction/reconciliation and lag compensation.

## Controls

Desktop: WASD, mouse, Shift sprint, Space jump, C/Ctrl crouch/slide, R reload, LMB fire, RMB ADS.

Mobile: left movement pad, right-side free look, Fire, ADS, Reload, Jump and Slide/Crouch.

See `docs/ARCHITECTURE.md` and `docs/STAGE_2_COMPLETE.md` for the production contract and completed Stage 2 handoff.
