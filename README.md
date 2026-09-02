# Project Strike

Project Strike is a browser tactical FPS built with Three.js. The current **V4 recovery build** keeps the existing WebGL/asset architecture and strengthens it for desktop and iPhone: real repository weapons and rigged arms remain the primary assets, while startup is now guarded against stalled model requests and optional systems no longer hold the entire game on the loading screen.

## V4: loading and deployment fixes

The GitHub Pages build was compiling successfully, so the fix focuses on runtime reliability rather than replacing the game. V4 adds:

- **Production service worker:** the actual worker now lives in `public/service-worker.js`, so Vite copies it into `dist/`. It no longer tries to pre-cache source-only files such as the unbuilt root `styles.css`.
- **Bounded asset loading:** `AssetManager` applies time limits to GLB, glTF, FBX and JSON waits. A valid-but-stalled request can no longer leave `DEPLOY` permanently disabled.
- **Recovery viewmodels:** repository arms/weapons are still attempted first. If a core first-person model fails, a low-cost procedural recovery mesh is installed so gameplay can still start and diagnostics clearly report the fallback.
- **Non-blocking optional warmup:** grenade models and audio warm after the core runtime is ready instead of blocking startup.
- **Stronger verification:** the runtime verifier checks every committed GLB container, relative GLB dependencies, the WAV manifest and the production service worker.
- **Real browser deployment gate:** GitHub Actions now runs the desktop and iPhone-landscape Playwright gameplay test before Pages can deploy.

## First-person body, weapons and movement

V4 builds on the existing separate first-person weapon scene rather than discarding it.

- The world now contains a lightweight **true first-person torso, hips, legs and boots** beneath the camera. The head is intentionally omitted for the local camera, avoiding the inside-face clipping problem while the body remains world geometry.
- The repository rigged arm model and weapon still render in their dedicated foreground pass after world depth is cleared, so walls cannot visually swallow the gun.
- Hip-fire now originates from the **physical muzzle socket and barrel direction**. ADS smoothly converges the barrel direction toward the camera sight line rather than treating every shot as a permanent center-screen laser.
- Weapon motion adds a small free-aim/deadzone layer, spring-like look lag, recoil, landing displacement and a calculated **jerk** response from changes in player acceleration.
- Movement retains acceleration/deceleration, sprint, crouch, momentum-based sliding and jumping, with jump-fatigue and heavy landing slowdown/compression added for a more tactile feel.

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

The new cyber-lighting rig adds localized warm/cool bounce lights and slowly moving additive haze sprites to make neon feel as if it is scattering through humid polluted air. This is intentionally much cheaper than real-time global illumination. A future offline baking pipeline can add second-UV lightmaps to selected GLB environment assets for higher-quality indirect lighting without increasing mobile runtime cost.

## Asset translation layer

`src/assets/AssetManager.js` is the single runtime contract for repository models:

```text
GLB / glTF ── GLTFLoader + Meshopt ─┐
                                    ├─ timeout guard → inspect → clone skeletons → normalize materials → scene + clips + report
FBX ───────── FBXLoader ────────────┘
```

Runtime assets live under `public/game-assets/`; editable/source imports remain under `assets-source/`. The verifier scans the committed GLB set, validates GLB v2 headers and lengths, checks relative external buffers/images, rejects unsupported required Draco compression, and confirms the complete audio manifest.

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
                    HUD / touch UI
```

The renderer uses sRGB output, ACES filmic tone mapping, shadows, PMREM environment reflections when available, fog, wet surfaces, rain and a direct-render recovery path if desktop post-processing fails.

## Combat and effects

The current build includes deterministic recoil patterns, ADS, procedural/authored reload support, named magazine/bolt/slide discovery, muzzle light and smoke, shell ejection, surface sparks, decals, headshots, animated operator targets, frag grenades, flashbangs and a sniper scope overlay. Synthetic muzzle/ejection/optic sockets are created when an asset does not provide a named socket.

## Audio

All committed WAV files are indexed through `public/game-assets/audio/audio-manifest.json` rather than relying on a partial hard-coded list. The current repository contains 1,990 indexed WAV files across the resident, player-weapon and DLC-weapon layers.

Audio unlock happens only after Deploy because Safari and other browsers require a user gesture. V4 bounds the initial audio warmup so a slow decode cannot prevent the player from entering the game; missing or late samples continue warming in the background while gameplay stays responsive.

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

`npm run check` syntax-checks the V4 runtime modules, validates the runtime asset library and produces the Vite production build. The Playwright suite then boots and enters the real game in desktop Chromium and an iPhone 11 landscape-sized mobile profile, verifies the V4 diagnostics, exercises movement/fire/slide/reload, checks the full-screen canvas and captures render evidence. Pages deployment only proceeds when both gates pass.

## Asset provenance

Third-party runtime assets retain their source and license records under `public/game-assets/manifests/` and beside the relevant assets. See `public/game-assets/manifests/asset-sources/project-strike-missing-assets.md` for the imported batch record.
