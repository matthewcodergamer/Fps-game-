# Project Strike

Project Strike is a browser tactical FPS built with Three.js. The current **V9 real-asset streaming build** keeps the repository's real rigged characters, weapons, grenades, industrial environment and audio while changing how memory-constrained iPhones receive those assets.

## Play

GitHub Pages:

`https://matthewcodergamer.github.io/Fps-game-/?v=9`

A fresh V9 page shows:

`V9 REAL ASSET STREAMING · ONE GLB DECODE · WEBGL2`

## What V9 fixes

The V8 emergency build stopped a real iPhone Safari crash by rejecting every GLB/GLTF/FBX on iOS and using procedural recovery geometry. That proved the crash was in the heavy model-decode startup path, but the visual result was intentionally temporary.

V9 restores the real art while preserving the useful stability lessons:

- the iPhone model decoder is serialized to **one model at a time**;
- critical character/viewmodel assets have priority over district dressing;
- background buildings and props stream into holders after their real GLBs finish;
- decoded source-model cache references are evicted after mobile clones are created;
- large model/audio/texture responses are streamed directly and are not duplicated in Service Worker Cache Storage;
- shadow-map VRAM remains disabled on iPhone while real PBR meshes still render;
- the old 2.6 MB holo optic that coincided with the Safari crash is replaced **on iPhone only** by the smaller real Crimson Trace repository GLB;
- desktop keeps the full repository quality path.

## Real authoritative assets

V9 requires these repository models instead of counting block geometry as successful art:

- `public/game-assets/models/characters/first_person_arms/free_fps_arms_gameready_-_rigged.glb`
- `public/game-assets/models/weapons/rifles/colt_m4a1_carbine.glb`
- `public/game-assets/models/weapons/attachments/crimson_trace_cts-1550_red_dot_sight.glb` on iPhone
- `public/game-assets/models/weapons/attachments/free_pbr_holo_sight_optics._cheerr.glb` on desktop
- `public/game-assets/models/characters/operators/bamen_military_soldier_animated.glb` for world operators
- `public/game-assets/models/characters/operators/bamen_military_soldier.glb` for the local true-first-person body
- `public/game-assets/models/grenades/high-quality_frag_grenade_3d_model.glb`
- `public/game-assets/models/grenades/flashbang.glb`
- enterable industrial buildings under `public/game-assets/models/environment/buildings/`

The BAMEN soldier attribution/license is kept beside the model in `public/game-assets/models/characters/operators/BAMEN_LICENSE.md`.

## Mobile movement fix

The HUD container deliberately uses `pointer-events: none` so it does not eat the whole screen. The action buttons already opted back into pointer events, but the movement pad and look surface did not. That is why Fire/ADS could work while the joystick could not move the player.

`mobile-fixes.css` explicitly restores interaction on `#leftPad` and `#lookZone`, sets `touch-action: none`, keeps the joystick knob non-interactive, and preserves the button stacking order.

## Bounded recoil

The previous AAA recoil layer used a high-frequency explicit spring with raw frame time. A dropped Safari frame could make the numerical spring unstable, producing the violent up/down camera oscillation seen on the real phone.

V9 changes `src/gameplay/AAAFeelSystem.js` to:

- clamp frame time;
- sub-step recoil integration to no more than 1/120 second per spring step;
- hard-bound spring value and velocity;
- reduce mobile camera concussion while retaining visible weapon kick;
- cap per-frame camera pitch/yaw/roll and FOV presentation offsets.

The gameplay `RecoilController` still owns persistent aim recoil, but its mobile kick is reduced so it does not stack excessively with presentation recoil.

## Real true-first-person body

V8's local torso/legs were capsule/box geometry. V9's `TrueBodyRig` loads the real rigged BAMEN soldier after Deploy through the same serialized `AssetManager` queue. It hides the head and upper-arm bone branches so the camera and dedicated FPS arm rig stay clean, then drives the real Mixamo hips/spine/leg/foot bones for stride and ground placement.

If that model genuinely fails, the local body is hidden instead of silently presenting block geometry as final art.

## Inverse kinematics

First-person hand IK uses Three.js `CCDIKSolver` through `src/animation/CharacterIKRig.js`.

The solve order is:

```text
authored/procedural pose
        ↓
weapon sway / recoil / free aim
        ↓
physical weapon sockets
        ↓
right/left hand CCD correction
        ↓
render foreground weapon + arms
```

Weapon sockets include right grip, left grip, muzzle, optic, ejection, magazine grip and charging handle. Reload logic can retarget the left hand to the magazine/charging handle.

## Physical reactions

Project Strike includes its own web-native positional reaction system: limb hit zones and health, stagger/limp state, heavy-hit dismemberment proxies, bone hiding where the imported skeleton supports it, stump meshes, impact/blood particles and explosion reactions.

This is **not** Rockstar NaturalMotion Euphoria and the project does not claim to contain proprietary Rockstar, Call of Duty, Unreal Engine, REDengine or other commercial-engine code.

## Rendering architecture

Project Strike uses WebGL2/Three.js features that are practical in a browser:

- sRGB output and ACES filmic tone mapping;
- PBR materials from repository GLBs;
- desktop PMREM/environment reflections and restrained bloom;
- mobile direct-PBR rendering with a lower render scale;
- directional, hemisphere and practical cyberpunk lighting;
- separate first-person render pass so weapon geometry does not disappear into walls;
- frustum culling and streamed background model holders.

It does not claim UE5 Lumen, Nanite, hardware path tracing or RTX.

## Audio

The repository contains 1,990 indexed WAV files in `public/game-assets/audio/audio-manifest.json`. Safari audio unlocks from the Deploy gesture. V9 keeps large prewarm work lazy on iPhone so model decoding and audio decoding do not peak at the same moment.

## Controls

Desktop: WASD, mouse, Shift sprint, Space jump, C/Ctrl slide/crouch, R reload, left mouse fire, right mouse ADS, weapon switch, G frag, V flash.

Mobile: left movement pad, right-side look, Fire, ADS, Reload, Jump, Slide/Crouch, Swap, Frag and Flash.

Controller: left/right sticks, RT fire, LT ADS, L3 sprint, A/Cross jump, B/Circle slide, X/Square reload, Y/Triangle swap.

## Asset sourcing

See `docs/ASSET_SOURCING_V9.md` for the current source/quality strategy. V9 retains the existing higher-detail BAMEN combat operator instead of downgrading it, and records CC0 candidates such as Quaternius Universal Base Characters / Universal Animation Library for future civilian/operator variety and retargetable animation expansion.

## Run and verify

```bash
npm ci
npm run dev
```

Production gates:

```bash
npm run check
npm run test:browser
```

`npm run check` validates the V9/V11 boot architecture, GLB integrity, real required assets, mobile input and bounded-recoil invariants, audio manifest and production Vite build. The browser suite exercises desktop and an iPhone 11 landscape profile and verifies the real-model request path, touch-control CSS, finite recoil state and a live WebGL2 context.
