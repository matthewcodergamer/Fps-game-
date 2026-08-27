# Project Strike — Production Asset Pipeline V2

## Runtime asset tree

```text
public/game-assets/
├── audio/
│   ├── weapons_player/
│   ├── dlc_weapons/
│   └── resident/
├── models/
│   ├── weapons/
│   │   ├── rifles/
│   │   ├── pistols/
│   │   ├── smgs/
│   │   ├── shotguns/
│   │   ├── snipers/
│   │   ├── lmgs/
│   │   └── attachments/
│   ├── characters/
│   │   ├── first_person_arms/
│   │   ├── operators/
│   │   └── equipment/
│   ├── grenades/
│   ├── props/
│   └── environment/
│       ├── buildings/
│       ├── modular/
│       ├── industrial/
│       ├── cover/
│       ├── foliage/
│       └── terrain/
├── animations/
│   ├── locomotion/
│   ├── combat/
│   ├── rifle/
│   ├── pistol/
│   ├── shotgun/
│   ├── sniper/
│   ├── grenade/
│   ├── hit_reactions/
│   └── deaths/
├── materials/
│   ├── concrete/
│   ├── metal/
│   ├── rust/
│   ├── wood/
│   ├── mud/
│   ├── dirt/
│   ├── fabric/
│   └── glass/
└── manifests/
```

## Source tree

Source files are not the format the game should normally load.

```text
assets-source/
├── fbx/
├── blend/
├── gltf/
├── textures/
├── mocap/
└── originals/
```

The browser runtime targets GLB/glTF, KTX2 textures and compressed game audio.

## Validation contract

A model is not considered ready because a file has a `.glb` extension. The processor/runtime must successfully parse it and report mesh count, triangle count, materials, textures, bones and animation clips. Characters must contain a usable skin/skeleton. First-person arms should contain finger bones and clean hand topology. Weapons should preserve movable components rather than merging the entire gun.

Recommended weapon names/sockets:

- `MuzzleSocket`
- `EjectionSocket`
- `MagazineSocket`
- `OpticSocket`
- `LeftHandSocket`
- `RightHandSocket`
- movable `bolt`, `slide`, `charging_handle`, `trigger`, `magazine`, `hammer` as appropriate

## Animation architecture

Project Strike uses authored/mocap animation plus procedural runtime control:

```text
mocap / authored clips
        ↓
AnimationMixer
        ↓
base locomotion layer
        +
upper-body weapon layer
        +
additive recoil/reactions
        +
IK / bone constraints
        +
procedural camera + weapon motion
        ↓
final pose
```

General locomotion can be retargeted from a standard humanoid source. Weapon-specific first-person reloads remain authored clips, while recoil, sway, ADS alignment, slide tilt, camera inertia and aim offsets are procedural.

## Audio synchronization

Weapon definitions bind model/animation events to audio events. The animation timeline should emit named events such as:

- `fire`
- `magOut`
- `magIn`
- `bolt`
- `slideRelease`
- `chargingHandle`
- `pinPull`
- `grenadeRelease`
- `casingImpact`

`WeaponAudioRouter` resolves those events through `weapons.json` rather than hard-coded filenames.

## FBX → GLB

The browser model processor parses FBX with Three.js `FBXLoader`, renders the parsed scene for verification, then exports it with `GLTFExporter` in binary mode. A conversion is only accepted after the source successfully parses.

## Blender → GLB

`.blend` is Blender's native project format and is not parsed by Three.js. Do not rename it or fake-convert it. Place Blender sources under `assets-source/blend/`. `.github/workflows/convert-blend.yml` uses real headless Blender to export GLB files into `public/game-assets/imported/blend/`.

## LOD/material production

Master assets may use high-quality source geometry and 4K/8K source textures. Runtime builds generate LOD0–LOD3 and KTX2 texture variants. Hero first-person weapons keep the highest useful detail; remote weapons, characters and environment pieces reduce geometry/material cost with distance.
