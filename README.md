# Project Strike

High-realism, mobile-first browser FPS foundation targeting iPhone and desktop.

## Current playable foundation

- Three.js tactical test range / Killhouse blockout.
- Desktop WASD + pointer-lock mouse look.
- Mobile dual-zone touch controls.
- Sprint, jump, crouch and slide.
- ADS/FOV transition.
- Automatic fire, ammo, reload animation, recoil and muzzle flash.
- Physical-style pooled shell-casing prototype.
- Target dummies with head/body damage, hit marker, death and respawn.
- FPS diagnostics.
- PWA shell/service worker.
- Three-layer audio architecture with multi-ZIP local import.
- Weapon definitions mapped to `weapons_player` and `dlc_weapons` banks.

## Audio layers

```text
public/game-assets/audio/
├── weapons_player/
├── dlc_weapons/
├── resident/
└── audio-manifest.json
```

The game can currently import multiple converted Project-Strike-Audio ZIPs from the start screen, so private/local audio does not need to be committed to a public repository. The runtime audio manager reads each converter manifest and reconstructs the original bank/layer mapping.

## Uploaded audio status

The current conversion set supplied during development contains:

- `weapons_player`: 22 banks / 122 WAV streams.
- `dlc_weapons`: 6 banks / 73 WAV streams.
- `resident`: runtime folder prepared; converted ZIP still needed.

## Asset targets

Runtime models: GLB/glTF with LOD0-LOD3, Meshopt/Draco where useful.

Runtime textures: KTX2/Basis with quality tiers and mipmaps.

Source art may remain 4K/8K/high-poly; the runtime receives optimized derivatives chosen by device quality and distance.

See `docs/ARCHITECTURE.md` for the full production contract.
