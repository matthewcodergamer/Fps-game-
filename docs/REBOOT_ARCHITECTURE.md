# Project Strike Reboot Architecture

The active runtime is `src/reboot/main.js`. V10.1 is preserved on the `legacy-v10.1` branch and is no longer imported by the production page.

## Runtime contract

- Babylon.js WebGPU only; no hidden WebGL renderer fallback.
- Havok Physics V2 owns collision and the player uses Babylon `PhysicsCharacterController`.
- Camera presentation, aim recoil and weapon recoil are independent state layers.
- The first content target is intentionally one street, one rifle platform and one enemy.
- iPhone-class quality selection happens before the renderer and scene are created.

## Content pipeline contract

Production firearms are authored externally and delivered as optimized `.glb` files with PBR textures, LODs and standard sockets:

`weaponRoot`, `grip_right`, `grip_left`, `muzzle`, `optic_mount`, `eject`, `magazine`, `charging_handle`, `shell_eject`.

Every imported asset must receive an entry in `ASSET_LICENSES.json` before it is accepted for release. Raw marketplace source assets should stay outside the public repository when redistribution is restricted.

## Implemented in reboot.1

- WebGPU-only engine boot and device-tier quality profile.
- Havok Physics V2 and Babylon physics character controller.
- Walking, sprinting, jumping and sliding state machine.
- Separate aim recoil, weapon kick and camera impulse.
- M4-platform prototype with the production socket naming contract.
- One cyber-industrial street, one building cluster, one enemy agent and one frag grenade path.
- PBR lighting, emissive neon spill and glow/muzzle-light VFX.
- Touch controls plus mouse/keyboard controls.
- Runtime FPS/draw-call/mesh diagnostics.
- Asset licensing manifest and architecture verification gate.

## Next vertical-slice gates

1. Replace the code-generated M4 platform with a licensed optimized GLB while preserving the socket contract.
2. Add FPS arms and the Project Strike humanoid skeleton standard.
3. Add layered animation (locomotion, upper-body aim, reload, recoil, hand IK, foot IK).
4. Replace the capsule enemy visual with the first rigged operator and navigation/cover brain.
5. Add GPU smoke/impact decals and layered Web Audio zones.
6. Profile every addition on the iPhone 11 MOBILE preset before expanding content.
