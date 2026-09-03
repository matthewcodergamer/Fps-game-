# Project Strike V10

Project Strike is a browser tactical FPS built with Three.js. **V10** is the current production architecture: WebGPU-first rendering, a strict real-asset loading gate, real repository weapons/arms/grenades/operators/body/buildings, CCD hand IK, authoritative mobile movement, bounded recoil, and GPU-driven weapon smoke/sparks.

## Current version

- **Game:** Project Strike V10
- **Package release:** `10.0.0`
- **Renderer:** Three.js `WebGPURenderer` / WebGPU
- **Production URL:** `https://matthewcodergamer.github.io/Fps-game-/?v=10`
- **Required-art policy:** required gameplay art must load successfully; primitive weapon/grenade/body/operator fallbacks do not count as a successful V10 boot.

The in-game loading screen and HUD show **V10**.

## V10 goals

V10 replaces the layered V8/V9 recovery architecture with one production path focused on:

- real high-quality repository GLBs;
- WebGPU rather than silently dropping to WebGL;
- a real loading gate before gameplay;
- stable mobile movement;
- stable firing/recoil with one camera-aim owner;
- real rigged first-person arms and weapon IK;
- GPU-compute smoke/sparks;
- serialized model decoding and lower peak memory on iPhone-class devices.

## Implemented

### WebGPU renderer

V10 initializes Three.js `WebGPURenderer`, waits for initialization, and verifies that the active backend is genuinely WebGPU. If the browser cannot provide WebGPU, V10 reports a startup error instead of silently pretending WebGL is WebGPU.

Rendering keeps sRGB output and ACES Filmic tone mapping. Touch/iPhone paths use a conservative render scale and disable shadow maps to reduce GPU-memory pressure while retaining the real PBR models.

### Proper loading gate

The boot screen is opaque and reports the current asset, percentage, progress bar, and renderer state. **DEPLOY stays disabled until the required V10 content is resident and the WebGPU shaders are compiled.**

The gate requires:

- real rigged FPS arms;
- real Colt M4A1 GLB;
- real optic;
- real animated world operator;
- real skinned local body;
- real frag grenade;
- real flashbang;
- required industrial district/building GLBs;
- working CCD hand IK;
- WebGPU smoke/spark buffers;
- WebGPU shader compilation.

### Real authoritative models

Important repository assets include:

- `public/game-assets/models/characters/first_person_arms/free_fps_arms_gameready_-_rigged.glb`
- `public/game-assets/models/weapons/rifles/colt_m4a1_carbine.glb`
- repository weapon optic GLBs
- `public/game-assets/models/characters/operators/bamen_military_soldier_animated.glb`
- `public/game-assets/models/characters/operators/bamen_military_soldier.glb`
- `public/game-assets/models/grenades/high-quality_frag_grenade_3d_model.glb`
- `public/game-assets/models/grenades/flashbang.glb`
- industrial buildings/environment GLBs under `public/game-assets/models/environment/`

The BAMEN attribution/license remains beside the operator assets.

### iPhone asset/memory strategy

V10 keeps the real models but changes how they are loaded:

- heavy model decoding is serialized instead of allowing many GLBs to decode simultaneously;
- large model/audio/texture responses are streamed directly instead of being duplicated into service-worker Cache Storage;
- V12 service-worker logic removes stale Project Strike cache generations and avoids large-response cloning;
- shader compilation happens before Deploy so the first shot/frame does not create a large compile spike;
- the game does not count block/primitive visual substitutions as successful required-asset loads.

A real iPhone Safari device can still have WebKit-specific memory limits that Chromium emulation cannot reproduce, so real-device profiling remains part of the optimization plan.

### Mobile movement fix

The V10 browser regression found the exact movement failure: the joystick bridge had a valid analog value, but the game simulation was not consuming it. V10 now uses an **authoritative analog movement bridge** and reads live X/Y directly every simulation tick.

The left movement pad and right look surface explicitly receive Pointer Events, including pointer capture/release handling. Desktop WASD remains independent.

### Recoil and firing fix

V10 removes the stacked recoil ownership that caused the camera/gun to rotate continuously or shake violently.

- Player pitch/yaw are authoritative.
- Camera rotation is rebuilt every simulation frame from the current player aim.
- Persistent aim recoil is small and deterministic.
- Physical weapon kick is separate and bounded in the viewmodel.
- Presentation code does not accumulate camera Euler rotations indefinitely.

The V10 WebGPU browser regression fires repeatedly and checks that recoil remains finite/bounded.

### First-person arms and inverse kinematics

First-person hand IK uses Three.js `CCDIKSolver` through `src/animation/CharacterIKRig.js`.

The solve order is:

```text
base/authored pose
      ↓
weapon motion / physical kick
      ↓
weapon grip sockets
      ↓
CCD hand correction
      ↓
foreground render
```

Weapon sockets include right grip, left grip, muzzle, optic, ejection, magazine grip, and charging handle. V10 keeps the loading gate locked if the required IK chain cannot bind.

### Real grenades

Frag and flash use their repository GLBs. V10 does not accept primitive grenade geometry as the final successful path.

Grenades include throw velocity, gravity, bounce damping, collision audio, timed detonation, dynamic flash/explosion light, and flash-screen/audio effects.

### Real local body and operators

World targets use the animated BAMEN operator. The local first-person body uses the real skinned BAMEN model rather than capsule/box presentation geometry, with first-person visibility adjustments to prevent head/duplicate upper-body camera clipping.

### GPU weapon effects

`src/rendering/GPUWeaponVFX.js` implements the V10 WebGPU/TSL particle path.

- smoke and sparks use GPU storage arrays and compute passes;
- large particle state does not require a JavaScript object update loop every frame;
- effects originate from the real muzzle transform;
- firing combines muzzle light, smoke/sparks, ballistic raycast, weapon kick, hit feedback, and repository audio.

The next VFX pass is depth-faded soft smoke, curl-noise turbulence, higher-quality smoke textures/volumes, HDR muzzle-flash cards, and WebGPU-compatible bloom.

### Audio

The repository audio system remains active. Safari/browser audio is unlocked by the Deploy gesture. Weapon shot, mechanical, collision and explosion layers stay separate, while heavy audio work is kept away from the critical model-decoding peak where possible.

### Environment

V10 requires real industrial environment models for the core district. Real enterable buildings, barriers, crates, boulders, collision surfaces and cyber/industrial lighting are part of the architecture. Three.js frustum culling remains active.

## Validation status

Before V10 was moved to `main`, the branch passed:

1. syntax, runtime-contract, GLB, audio-manifest and production Vite/WebGPU build validation;
2. an iPhone-sized WebGPU interaction regression that checks:
   - genuine WebGPU backend;
   - real M4A1/arms/body/operators/frag/flash/district asset path;
   - mobile analog movement changing player coordinates;
   - repeated firing without runaway camera rotation;
   - finite pitch/yaw/recoil state;
   - active CCD hand IK;
   - initialized GPU weapon VFX.

## Controls

**Desktop:** WASD, mouse, Shift sprint, Space jump, C/Ctrl slide/crouch, R reload, left mouse fire, right mouse ADS, G frag, V flash.

**Mobile:** left analog movement pad, right look surface, Fire, ADS, Reload, Jump, Slide/Crouch, Swap, Frag, Flash.

## Run locally

```bash
npm ci
npm run dev
```

Production checks:

```bash
npm run check
npm run test:browser
```

## Next implementation priorities

1. Profile V10 on the physical iPhone 11 and tune model/texture residency from real Safari memory behavior.
2. Add depth-buffer soft particles, curl-noise smoke turbulence and improved lit smoke textures/volumes.
3. Add HDR muzzle-flash cards and a WebGPU/TSL-compatible bloom/exposure pass.
4. Upgrade asphalt, concrete, glass, metal, grime and road materials with high-quality licensed/CC0 PBR assets.
5. Validate every secondary weapon for model orientation, sockets, muzzle, optic, magazine and animation behavior.
6. Expand animation layering: locomotion, tactical reload, empty reload/bolt, flinch, grenade throw and weapon-specific sequences.
7. Improve two-foot IK with pelvis compensation for slopes, curbs and stairs.
8. Extend Rapier-based physical reactions/ragdoll blending within an iPhone-safe rigid-body budget.
9. Add indoor/outdoor Web Audio convolution and more surface-specific shell/impact responses.
10. Add explicit texture/mesh LOD, KTX2/Basis where appropriate, and distance-based asset residency.

For the detailed implementation checklist, see [`docs/V10_IMPLEMENTATION_STATUS.md`](docs/V10_IMPLEMENTATION_STATUS.md).

## Project scope note

Project Strike is its own browser game. It does not claim to contain Rockstar NaturalMotion Euphoria, REDengine, Call of Duty engine code, Unreal Engine Lumen/Nanite, RTX path tracing, or other proprietary commercial-engine technology. V10 implements web-native approximations using Three.js, WebGPU, Web Audio, repository assets and project-owned gameplay code.
