# Project Strike

Project Strike is a browser tactical FPS built with Three.js. The current **V6 AAA-feel + IK recovery build** keeps the existing renderer, asset translation layer and Stage 3 game loop, while fixing the Safari startup failure shown by the message `Module name, 'three' does not resolve to a valid URL.` It also adds a heavier procedural weapon/camera response layer, state-aware reload IK, scope parallax, material feedback and source-host recovery without replacing the repository's existing weapon, arm, environment or audio assets.

## Play the production build

GitHub Pages production URL:

`https://matthewcodergamer.github.io/Fps-game-/`

The normal Pages deployment is a Vite production build. Vite bundles Three.js and rewrites module paths into hashed `assets/` chunks.

## V6 startup / Safari recovery

The phone screenshot exposed a second hosting path: the repository's root `index.html` can sometimes be served directly instead of the Vite-built artifact. That source HTML boots `src/main-v4.js`, whose modules import bare specifiers such as `three` and `three/addons/...`. Browsers do not resolve those package names by themselves, which produced the fatal Safari error before WebGL ever started.

V6 makes both hosting modes valid:

```text
Vite / GitHub Pages production
index.html
   ↓
hashed Vite bundle
   ↓
bundled Three.js + game runtime

Direct source hosting / preview
index.html
   ↓
Three.js import map
   ↓
src/main-v4.js
   ↓
/public/game-assets URL normalization
```

The recovery consists of:

- **Three.js import map:** root HTML maps `three` and `three/addons/` to the matching Three.js 0.185.1 ESM build when raw source modules are being served.
- **Source asset normalization:** `AssetManager` rewrites `./game-assets/...` to `./public/game-assets/...` in source-host mode. This happens before GLTFLoader receives the URL, so external GLB textures resolve correctly on the first load.
- **Fetch recovery:** root HTML also remaps same-origin game-asset fetches while source mode is active.
- **Dual V8 service worker:** identical workers live at `service-worker.js` and `public/service-worker.js`. Vite copies the public worker into production while direct source hosting can register the root worker. V8 removes older Project Strike caches and can retry `/game-assets/` requests through `/public/game-assets/`.
- **Bounded model/audio waits:** required model waits have time limits; optional grenade/audio warmup cannot permanently hold the boot screen.
- **Visible boot watchdog:** the UI reports the current startup stage and exposes reload recovery instead of remaining on a meaningless static renderer message.

## AAA-feel motion layer

Project Strike now separates weapon mass from camera concussion rather than treating recoil as one transform.

```text
player input / look delta / acceleration
                 ↓
        authored + procedural base pose
                 ↓
       free-aim / inertia / jerk layer
                 ↓
       weapon spring translation/roll
                 ↓
        CCD hand IK correction
                 ↓
   shared viewmodel mass/breath response

shot recoil ─────┬───────────┐
                 ↓           ↓
          physical gun kick  camera pitch/yaw/roll + tiny FOV impulse
```

`src/gameplay/AAAFeelSystem.js` uses damped spring axes for kick and recovery. The weapon can lag slightly behind fast camera turns and acceleration changes, then settle instead of snapping back. Gun kick and camera shake are deliberately separate so recoil reads as both a physical firearm moving in the hands and a small lens/body impulse.

The V4 free-aim state remains part of actual barrel-origin ballistics. Hip fire therefore does not have to originate from the exact center of the camera. ADS tightens the free-aim correction and converges the physical barrel toward the sight line.

This is a web-native approximation of the design principles used by weighted modern FPS games. Project Strike is **not** using proprietary Call of Duty, Cyberpunk 2077, Bodycam, Counter-Strike, REDengine or Unreal Engine code.

## Scope and sight presentation

Scoped weapons keep the lightweight single-render approach for iPhone performance rather than rendering the entire world a second time. V6 adds a parallax presentation layer:

- the scope lens has a subtle moving reflection/highlight;
- the reticle position responds to the same free-aim offset driving the physical weapon;
- ADS continues to reduce world FOV smoothly;
- the implementation avoids a second full scene render, preserving the mobile performance budget.

A true dual-render Picture-in-Picture scope remains a future high-end-only option because it would render the world twice.

## Reload state machine + IK

Reloading now distinguishes retained-round and empty-magazine behavior.

### Tactical reload

```text
magazine still has / had a chambered round
        ↓
left-hand IK: foregrip → magazineGrip → foregrip
        ↓
magazine out / magazine in
        ↓
NO forced charging-handle cycle
```

### Empty reload

```text
weapon reaches 0 rounds
        ↓
left-hand IK: foregrip → magazineGrip
        ↓
magazine out / magazine in
        ↓
left-hand IK → chargingHandle
        ↓
bolt / charging-handle event
        ↓
left hand returns to foregrip
```

Authored reload clips are still preferred when a repository weapon/arm asset contains a matching clip. The procedural state machine, socket motion and IK are correction/fallback layers rather than replacements for authored animation.

## Inverse kinematics

Project Strike uses the **official Three.js `CCDIKSolver`** from `three/addons/animation/CCDIKSolver.js` for the real first-person arm skeleton.

`src/animation/CharacterIKRig.js` discovers the actual hand effectors from the imported skinned rig, including Blender-style generic bone names, builds hand → forearm → upper-arm chains, and runs CCD after the normal animation/procedural pose.

Weapon interaction sockets include:

- `rightGrip`
- `leftGrip`
- `muzzle`
- `optic`
- `ejection`
- `magazineGrip`
- `chargingHandle`

During normal firing and ADS, hands remain locked to the physical weapon. During reloads, V6 can move the left IK target to the magazine or charging handle rather than simply turning IK off.

### Foot placement

The current local true-body legs are lightweight procedural geometry rather than a full skinned leg skeleton. Terrain placement therefore uses optimized raycast/two-segment foot correction instead of pretending those meshes support CCD bones. Ground candidates are broad-phase filtered and sampled at a lower frequency while the rendered leg pose interpolates every frame.

## Physical first-person awareness

The runtime uses two presentation layers:

```text
WORLD PASS
industrial district
animated operators
local torso / hips / legs / boots
world shadows and collision
        ↓ clear depth
FIRST-PERSON PASS
repository rigged arms
repository weapon + attachment
recoil / sway / reload
CCD hand IK
```

The local head is omitted to prevent the camera from clipping through a face mesh. Looking down still exposes the local body geometry and foot placement. Other world characters keep their own world-space models, while the local high-detail arms/weapon are isolated in the first-person pass.

## Rendering and performance architecture

The runtime does not claim Unreal Engine 5 Lumen, Nanite, hardware path tracing, RTX or REDengine rendering. Those systems are not available as drop-in technologies for a lightweight WebGL iPhone build.

Instead Project Strike uses:

- sRGB output and ACES filmic tone mapping;
- PMREM environment reflections when supported;
- PBR material maps from repository GLBs;
- directional/hemisphere lighting and shadow maps;
- cyan, magenta and warm practical bounce lights;
- additive atmospheric haze;
- wet puddle materials;
- desktop restrained bloom with a direct-render fallback;
- direct PBR mobile mode;
- normal Three.js frustum culling for world meshes;
- a separate foreground viewmodel pass so the weapon cannot disappear into walls.

## Responsive impacts and audio

The existing hit/decal pipeline now receives an additional material response layer.

- **Concrete:** pale chips, lower-pitched collision transient, dark impact decal.
- **Metal:** bright narrow fragments/sparks and a sharper collision transient.
- **Wood:** elongated splinters and a softer mid-pitched impact transient.
- **Glass:** translucent tetrahedral shards and a higher-pitched transient when a surface is tagged as glass.
- **Body:** existing body hit treatment with a lower, quieter transient.

Mobile uses fewer spawned fragments than desktop. Existing muzzle smoke/light, shell ejection, headshot hitmarkers, frag/flash effects and repository gunshot/mechanical audio remain active.

## Asset translation layer

`src/assets/AssetManager.js` remains the single runtime contract for repository models:

```text
GLB / glTF ── GLTFLoader + Meshopt ─┐
                                    ├─ URL recovery → timeout guard → inspect → clone skeletons → normalize materials → scene + clips + report
FBX ───────── FBXLoader ────────────┘
```

Runtime assets live under `public/game-assets/`; editable/source imports remain under `assets-source/`.

## Audio

All committed WAV files are indexed through `public/game-assets/audio/audio-manifest.json`. The repository currently contains **1,990 indexed WAV files** across resident, player-weapon and DLC-weapon layers.

Safari requires a user gesture before Web Audio can start, so audio still unlocks after Deploy. Audio prewarm is optional and bounded so a slow decode cannot block gameplay startup.

## Controls

Desktop: WASD, mouse, Shift sprint, Space jump, C/Ctrl slide or crouch, R reload, left mouse fire, right mouse ADS, Q/number keys weapon switch, G frag and V flash.

Mobile: left movement pad, right-side look, Fire, ADS, Reload, Jump, Slide/Crouch, Swap, Frag and Flash.

Controller: left/right sticks, RT fire, LT ADS, L3 sprint, A/Cross jump, B/Circle slide, X/Square reload and Y/Triangle swap.

## Run and verify

```bash
npm ci
npm run dev
```

Production verification:

```bash
npm run check
npm run test:browser
```

`npm run check` now validates the V4 IK layer, V6 AAA modules, both V8 workers, raw-source import-map/asset recovery, GLB integrity, the audio manifest and the Vite production build. GitHub Pages deploys after the hard production build succeeds. The heavier Playwright desktop/iPhone gameplay suite runs afterward as a diagnostic so a slow software-rendered CI browser cannot prevent a valid production artifact from publishing.

## Asset provenance

Third-party runtime assets retain their source and license records under `public/game-assets/manifests/` and beside the relevant assets. See `public/game-assets/manifests/asset-sources/project-strike-missing-assets.md` for the imported batch record.
