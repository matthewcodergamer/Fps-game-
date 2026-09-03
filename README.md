# Project Strike — Babylon Reboot

Project Strike has moved to a clean Babylon.js + WebGPU + Havok architecture. The old V10.1 runtime is preserved on the `legacy-v10.1` branch as an asset/reference snapshot and is not imported by the active game page.

## Reboot.1 vertical slice

The active build deliberately focuses on one small combat slice instead of expanding content prematurely:

- Babylon.js 9 WebGPU-only renderer
- Havok Physics V2
- Babylon `PhysicsCharacterController`
- walk / sprint / jump / slide locomotion states
- M4-platform first-person prototype with standard weapon sockets
- separated aim recoil, weapon recoil and camera impulse
- one cyber-industrial street and building cluster
- one enemy combat agent
- one Havok frag-grenade path
- muzzle flash, dynamic light and glow response
- touch controls plus mouse/keyboard controls
- iPhone-class quality selection and runtime diagnostics
- asset license manifest and release validation gate

## Run

```bash
npm install
npm run dev
```

Validate and build:

```bash
npm run check
npm run test:browser
```

## Architecture

See `docs/REBOOT_ARCHITECTURE.md`. Production weapon GLBs must provide the socket contract defined in `src/reboot/assets/AssetContract.js` and every production asset must be registered in `ASSET_LICENSES.json` before release.

## Legacy

V10.1 remains available on branch `legacy-v10.1`. Do not re-import its runtime patch chain into `src/reboot/`; migrate only proven data, assets and isolated logic behind the new subsystem contracts.
