# Project Strike

Project Strike is a browser tactical FPS built with Three.js. The current **V4 recovery + IK build** keeps the existing WebGL/asset architecture and strengthens it for desktop and iPhone: real repository weapons and rigged arms remain the primary assets, startup is guarded against stalled model requests, and inverse kinematics now runs as a final correction layer after animation and weapon motion.

## V4: loading and deployment fixes

The GitHub Pages build was compiling successfully, so the recovery work focuses on runtime reliability rather than replacing the game. V4 adds:

- **Production service worker:** the actual worker lives in `public/service-worker.js`, so Vite copies it into `dist/`.
- **Bounded asset loading:** `AssetManager` applies time limits to GLB, glTF, FBX and JSON waits. A stalled request can no longer leave `DEPLOY` permanently disabled.
- **Recovery viewmodels:** repository arms/weapons are attempted first. If a core first-person model fails, a low-cost procedural recovery mesh is installed so gameplay can still start.
- **Non-blocking optional warmup:** grenade models and audio warm after the core runtime is ready instead of blocking startup.
- **Real browser deployment gate:** GitHub Actions runs desktop and iPhone-landscape Playwright gameplay tests before Pages deploys.
- **Asset verification with explicit recovery:** required runtime assets stay strict. The one previously committed truncated Remington 870 GLB is recorded as an optional recoverable asset and falls back to the procedural shotgun instead of blocking every unrelated deployment.

## Inverse kinematics

Project Strike now uses the **official Three.js `CCDIKSolver`** from `three/addons/animation/CCDIKSolver.js` for the real first-person arm skeleton.

```text
authored / procedural arm pose
              ↓
weapon recoil + sway + sprint + slide + free aim
              ↓
        weapon grip sockets
        ↙               ↘
  leftGrip           rightGrip
      ↓                  ↓
 left-hand CCD        right-hand CCD
      ↓                  ↓
 forearm/upper arm bone correction
              ↓
        final rendered pose
```

`src/animation/CharacterIKRig.js` discovers the actual `SkinnedMesh` containing each hand, builds the bone chain from the hand back through the upper arm, adds solver target bones at the weapon sockets, and runs CCD after the normal animation/procedural pose. The IK blend is state-aware: ADS locks hardest, sprint/slide/airborne movement reduces the correction, and the left hand releases during the middle of reloads so reload motion is not destroyed.

The weapon socket layer now exposes:

- `rightGrip`
- `leftGrip`
- `muzzle`
- `optic`
- `ejection`
- `magazineGrip`
- `chargingHandle`

Rifles, pistols, shotguns and snipers get different default grip profiles, and individual weapon definitions can later override those positions with `gripSockets`.

### Foot IK

The current true-body legs are lightweight procedural geometry, not a skinned character skeleton, so they do not use `CCDIKSolver`. Instead they use a terrain-aware two-segment correction layer:

```text
hip
 ↓
knee
 ↓
boot
 ↓
downward raycast
 ↓
actual pavement / curb / prop surface
```

Each foot samples meshes marked as world surfaces, raises/lowers its leg toward the hit point, adds knee compression, and aligns the boot to the surface normal. The correction blends down during fast sprinting and disables while airborne.

IK is deliberately the **last pose layer**. It does not replace authored animation.

## First-person body, weapons and movement

V4 builds on the existing separate first-person weapon scene rather than discarding it.

- The world contains a lightweight **true first-person torso, hips, legs and boots** beneath the camera. The head is intentionally omitted for the local camera.
- The repository rigged arm model and weapon render in their dedicated foreground pass after world depth is cleared, so walls cannot visually swallow the gun.
- Hip-fire originates from the **physical muzzle socket and barrel direction**. ADS smoothly converges the barrel direction toward the camera sight line.
- Weapon motion includes a small free-aim/deadzone layer, spring-like look lag, recoil, landing displacement and a calculated **jerk** response from changes in player acceleration.
- Movement retains acceleration/deceleration, sprint, crouch, momentum-based sliding and jumping, with jump-fatigue and heavy landing slowdown/compression.

This is inspired by the design principles behind weighted modern FPS handling, not a claim that Project Strike is running proprietary Call of Duty, Cyberpunk, Bodycam or Rainbow Six code.

## Cyberpunk lighting architecture

The web runtime does **not** claim Unreal Engine 5 Lumen, Nanite, hardware path tracing or RTX Ray Reconstruction. Those systems are not the right dependency target for a lightweight iPhone WebGL game.

Instead, V4 approximates the same visual language with a mobile-scalable stack:

```text
cold twilight sky + cool hemisphere fill
                  ↓
warm directional sunset key / shadow map
                  ↓
cyan + magenta + amber emissive practical lights
                  ↓
low-cost local bounce lights + additive haze volumes
                  ↓
rough PBR concrete / metal + wet puddle reflections
                  ↓
ACES tone mapping
          ↓                 ↓
desktop restrained bloom   mobile direct PBR
```

The cyber-lighting rig adds localized warm/cool bounce lights and slowly moving additive haze sprites to make neon feel as if it is scattering through humid polluted air. This is intentionally much cheaper than real-time global illumination.

## Asset translation layer

`src/assets/AssetManager.js` is the single runtime contract for repository models:

```text
GLB / glTF ── GLTFLoader + Meshopt ─┐
                                    ├─ timeout guard → inspect → clone skeletons → normalize materials → scene + clips + report
FBX ───────── FBXLoader ────────────┘
```

Runtime assets live under `public/game-assets/`; editable/source imports remain under `assets-source/`.

## Rendering architecture

```text
industrial world + animated operators + true body
                         ↓
                WebGL PBR world render
                  ↓                ↓
        desktop restrained bloom   mobile direct PBR
                  └───────┬────────┘
                      clear depth
                          ↓
          repository weapon + rigged-arm scene
                          ↓
              animation / recoil / sway
                          ↓
               CCD weapon-hand IK
                          ↓
                    HUD / touch UI
```

The renderer uses sRGB output, ACES filmic tone mapping, shadows, PMREM environment reflections when available, fog, wet surfaces, rain and a direct-render recovery path if desktop post-processing fails.

## Combat and effects

The current build includes deterministic recoil patterns, ADS, procedural/authored reload support, named magazine/bolt/slide discovery, muzzle light and smoke, shell ejection, surface sparks, decals, headshots, animated operator targets, frag grenades, flashbangs and a sniper scope overlay.

## Audio

All committed WAV files are indexed through `public/game-assets/audio/audio-manifest.json`. The current repository contains 1,990 indexed WAV files across the resident, player-weapon and DLC-weapon layers.

Audio unlock happens only after Deploy because Safari and other browsers require a user gesture. V4 bounds the initial audio warmup so a slow decode cannot prevent the player from entering the game.

## Controls

Desktop: WASD, mouse, Shift sprint, Space jump, C/Ctrl slide or crouch, R reload, left mouse fire, right mouse ADS, Q/number keys weapon switch, G frag and V flash.

Mobile: left movement pad, right-side look, Fire, ADS, Reload, Jump, Slide/Crouch, Swap, Frag and Flash.

Controller: left/right sticks, RT fire, LT ADS, L3 sprint, A/Cross jump, B/Circle slide, X/Square reload and Y/Triangle swap.

## Run and verify

```bash
npm ci
npm run dev
```

Before deployment:

```bash
npm run check
npm run test:browser
```

`npm run check` syntax-checks the V4 runtime and IK modules, validates the runtime asset library and produces the Vite production build. The Playwright suite boots the real game in desktop Chromium and an iPhone 11 landscape-sized profile, verifies that the repository arm rig produced at least one active CCD IK chain, exercises movement/fire/slide/reload, checks the full-screen canvas and captures render evidence. Pages deployment only proceeds when both gates pass.

## Asset provenance

Third-party runtime assets retain their source and license records under `public/game-assets/manifests/` and beside the relevant assets. See `public/game-assets/manifests/asset-sources/project-strike-missing-assets.md` for the imported batch record.
