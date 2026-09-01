# Project Strike

Project Strike is a browser tactical FPS built with Three.js. The current rework targets a readable, weighted first-person presentation on both desktop and iPhone: real repository weapon/arm models, grounded locomotion, an industrial combat district, and a dark cyan–magenta lighting palette inspired by futuristic night-city photography.

## What is playable

- Real M4A1, M4, AK-74, SCAR-L, VSS, pistol, SMG, shotgun, and sniper GLB assets.
- A separately rendered first-person layer for the real rigged arm model, weapon, optic, reload parts, muzzle, and ejection sockets. Clearing world depth before this pass prevents walls or post-processing from hiding the gun.
- Accelerated movement rather than instant sliding: walk, sprint, crouch, retained-momentum slide, jump, landing response, step-timed camera bob, sway, and weapon inertia.
- Mechanical recoil, ADS, reload motion, detachable named magazines, muzzle flash/smoke, casings, impact sparks, decals, headshots, frag grenades, and flashbangs.
- Animated repository operator targets using their embedded idle/walk/death clips when available.
- Eight real enterable Kenney industrial buildings plus repository barriers, crates, and boulders arranged as a street district.
- Cyber-twilight sky, warm low sun, cyan/magenta/violet practical lights, fog, rain, selective puddles, shadows, ACES color mapping, and restrained desktop bloom.
- Mouse/keyboard, touch, and standard gamepad input.
- A stable WebGL renderer with an automatic direct-render recovery path, replacing the previous fragile WebGPU/MRT startup path that could leave a black desktop screen.

## Asset translation layer

`src/assets/AssetManager.js` is the single runtime contract for models:

```text
GLB / glTF ── GLTFLoader + Meshopt ─┐
                                    ├─ inspect → clone skeletons → normalize materials → scene + clips + report
FBX ───────── FBXLoader ────────────┘
```

The loader reports mesh, skin, bone, material, animation, triangle, and bounds data. It uses skeleton-safe cloning, correct texture color spaces and anisotropy, and supports ordered GLB/FBX fallbacks. Runtime assets live under `public/game-assets/`; editable source files remain under `assets-source/`.

The arm asset is rigged but contains no authored clips. Its current idle, locomotion, recoil, slide, and reload movement is procedural. Operator models do contain embedded animation clips and play them through `AnimationMixer`. The code does not claim Mixamo retargeting where no compatible authored weapon animation exists.

## Rendering architecture

```text
industrial world + animated operators
                 ↓
       WebGL PBR world render
          ↓                ↓
desktop restrained bloom   mobile direct PBR
          └───────┬────────┘
             clear depth
                 ↓
separate weapon + rigged-arm scene
                 ↓
             HUD / touch UI
```

This is intentionally a reliable web-native pipeline, not a claim of Unreal Engine Lumen or Nanite. Desktop uses stable Three.js WebGL post-processing; phones use the cheaper direct path. Both use the same gameplay and asset code.

## Audio

All committed WAV files are indexed instead of relying on the old partial manifest. `npm run audio:manifest` scans RIFF headers and rebuilds `public/game-assets/audio/audio-manifest.json` with path, bank, layer, duration, and semantic kind.

Current indexed library:

- `weapons_player`: 122 clips
- `resident`: 1,795 clips
- `dlc_weapons`: 73 clips
- total: 1,990 WAV files across 33 banks

Audio unlocks only after Deploy because Safari and desktop browsers require a user gesture. The selected bank is prewarmed, shots prefer complete shot samples, reloads use short mechanical clips, resident effects can be positioned with HRTF, and the mix passes through a compressor/master bus.

## Controls

Desktop: WASD, mouse, Shift sprint, Space jump, C/Ctrl slide or crouch, R reload, left mouse fire, right mouse ADS, and Q/1/2 weapon switch.

Mobile: left movement pad, right-side look, Fire, ADS, Reload, Jump, Slide/Crouch, Swap, Frag, and Flash.

Controller: left/right sticks, RT fire, LT ADS, L3 sprint, A/Cross jump, B/Circle slide, X/Square reload, and Y/Triangle swap.

## Run and verify

```bash
npm install
npm run dev
```

```bash
npm run check
npm run test:browser
```

`npm run check` verifies required GLB headers, checks that all 1,990 WAV files are present in the generated manifest, and produces a Vite production build. Playwright then boots and enters the real game at 1440×900 desktop and 844×390 iPhone landscape sizes, checks the fullscreen canvas and HUD, captures render evidence, and fails on browser/page errors.

The GitHub Pages workflow builds and publishes pushes to `main`.

## Asset provenance

Third-party runtime assets retain their source and license records under `public/game-assets/manifests/` and beside the relevant assets. See `public/game-assets/manifests/asset-sources/project-strike-missing-assets.md` for the imported batch record.
