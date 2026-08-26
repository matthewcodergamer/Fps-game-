# Stage 2 Complete — Production Systems Handoff

Stage 2 is complete. The prototype from Stage 1 now has the production contracts and subsystems required for real art, combat content and multiplayer iteration.

## Completed systems

### Assets
- GLB/glTF runtime loading.
- Draco and Meshopt-ready geometry paths.
- KTX2 texture loading and material hooks.
- Weapon socket conventions for muzzle, ejection, hands, optics and attachments.
- Humanoid character/animation contracts.
- Asset inspector tooling.

### Rendering and materials
- PBR material runtime.
- Dirt, rust and wetness shader hooks.
- Geometry LOD infrastructure.
- Animation update LOD infrastructure.
- Device quality profiles and dynamic-resolution hooks.
- Night-vision rendering module.

### Physics and combat infrastructure
- Rapier WASM physics wrapper/foundation.
- Grenade/rigid-body integration points.
- Ballistics, penetration and tracer foundations.
- Impact and decal pooling.

### World
- Chunk/map loading contract.
- Seeded modular layout generator foundation.
- Killhouse blockout remains the current playable validation map.

### Multiplayer
- WebSocket room relay service.
- Multiplayer client/controller.
- Snapshot replication and interpolation foundation.
- Remote-player runtime hooks.

### Audio
- Permanent three-layer contract: `weapons_player`, `dlc_weapons`, `resident`.
- Local multi-ZIP import for development.
- Browser AWC extraction/conversion tool.
- Node AWC-to-WAV batch converter.
- One-commit browser Audio Deploy tool for permanent binary WAV deployment.

## Audio payload state

Converted payloads currently available from the supplied Project Strike ZIPs:

- `weapons_player`: 22 banks / 122 WAV files.
- `dlc_weapons`: 6 banks / 73 WAV files.
- `resident`: no converted resident ZIP was supplied in the current upload set.

Permanent runtime target:

```text
public/game-assets/audio/
├── weapons_player/<bank>/*.wav
├── dlc_weapons/<bank>/*.wav
├── resident/<bank>/*.wav
└── audio-manifest.json
```

The deploy page is `tools/audio-deploy.html`. It is intentionally separate from gameplay and performs a single Git tree/commit for a complete audio import.

## Stage 3

Stage 3 is now active. Its job is to replace temporary procedural/blockout presentation with production content:

- realistic hero rifle GLB;
- pistol GLB;
- high-quality first-person hands/arms rig;
- third-person soldier;
- IK hand sockets;
- magazine, bolt, slide and charging-handle animation;
- red-dot and holographic optic presentation;
- weapon attachment mounting;
- production first-person animation graph.

Stage 2 should remain stable while Stage 3 content plugs into these systems rather than bypassing them.
