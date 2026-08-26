# Project Strike

High-realism, mobile-first tactical FPS for the browser. The project targets iPhone-class hardware and desktop from one Three.js codebase, using LOD, compressed/streamed assets and scalable effects instead of maintaining a separate mobile game.

## Build status

### Stage 1 — Playable FPS Foundation — COMPLETE

Movement, touch/mouse look, sprint, crouch, slide, jump, ADS, automatic fire, reload, ammo, recoil, muzzle flash, shell casings, target damage/headshots, respawn, Killhouse blockout, PWA shell and local three-layer audio import are implemented.

### Stage 2 — Production Systems — ACTIVE

The repository now contains:

- Three.js production renderer and iPhone-aware rendering path.
- Rapier WASM physics runtime.
- GLB/glTF asset loader with Draco, Meshopt and KTX2 support.
- PBR material/weathering system for dirt, rust and wetness.
- Geometry LOD and distance-based animation update system.
- Weapon GLB socket runtime.
- Humanoid character/animation runtime.
- Chunked map loader and streaming foundation.
- Seeded modular procedural layout generator.
- WebSocket room relay server, client snapshots and interpolation.
- Ballistics, penetration and tracer foundation.
- Red-dot/scope runtime.
- Grenade physics runtime.
- Impact/decal pooling.
- Night-vision post-processing module.
- Asset Inspector tool for GLB triangle/bone/animation/socket validation.
- Permanent `resident`, `weapons_player`, `dlc_weapons` audio layout plus ZIP development import.

The game itself includes **BUILD STATUS**, showing Stage 1 complete and Stage 2 active instead of presenting the foundation as a finished game.

## Runtime entry

`index.html` runs `src/main-stage2.js`.

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

## Audio status

The converted development packs supplied so far contain:

- `weapons_player`: **22 banks / 122 WAV streams**.
- `dlc_weapons`: **6 banks / 73 WAV streams**.
- `resident`: runtime folder ready; converted pack still required.

The start screen can import those ZIPs locally. For permanent hosting, extract each complete `Project-Strike-Audio` directory into its matching top-level layer. See `docs/AUDIO_UPLOAD.md`.

## Asset targets

Runtime models use GLB/glTF. First-person hero weapons use high-detail LOD0; world weapons and characters use LOD0–LOD3. Runtime texture targets are KTX2/Basis with mipmaps and quality tiers. High-resolution source art can remain 4K/8K/high-poly because runtime derivatives are selected by device and distance.

`public/game-assets/manifests/asset-catalog.json` contains the current model, animation and CC0 PBR material acquisition plan.

## Internal tools

`/tools/asset-viewer/` opens local GLB/glTF files and reports triangle count, materials, bones, animations and required Project Strike weapon sockets.

## Multiplayer

`server/` contains the first room relay service. GitHub Pages hosts only the game client; the relay/server must be deployed separately. The client already has snapshot interpolation infrastructure. The online stage adds authoritative hit simulation, prediction/reconciliation and lag compensation.

## Controls

Desktop: WASD, mouse, Shift sprint, Space jump, C/Ctrl crouch/slide, R reload, LMB fire, RMB ADS.

Mobile: left movement pad, right-side free look, Fire, ADS, Reload, Jump and Slide/Crouch.

See `docs/ARCHITECTURE.md` for the complete production contract and roadmap.
