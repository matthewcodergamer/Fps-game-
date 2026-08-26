# Project Strike Asset Pipeline

## Goal

Source quality stays high while runtime cost is controlled. Source models/textures are never judged by their raw file size alone; every shipping asset is normalized, baked, LODed, compressed and profiled before entering `public/game-assets/`.

## Chosen prototype / bootstrap sources

The following sources are selected because they provide clearly reusable assets and fit the runtime pipeline. They are **bootstrap assets**, not a statement that every one is a final hero asset.

### Weapons

- **Assault Rifle Mark1 — VerzatileDev** — CC0, FBX, detachable magazine, animatable. Source: `https://verzatiledev.itch.io/assault-rifle`
- **Ultimate Guns Pack — Quaternius** — CC0, 40 weapons, FBX/OBJ/Blend. Source: `https://quaternius.com/packs/ultimategun.html`
- **Low Poly FPS Rifle and Hands — Robin Lamb / OpenGameArt** — CC0, GLTF/FBX/Blend/OBJ, shoot animation. Source: `https://opengameart.org/content/low-poly-fps-rifle-and-hands`
- **Service Pistol — GrandStudio** — CC0, GLB/GLTF, 1K web version, ~27.5k polygons, detachable magazines. Source: `https://grandstudio.dev/model/service_pistol`

Hero weapon requirements remain stricter than bootstrap assets: correct proportions, PBR maps, separate magazine, bolt/slide, trigger, attachment rails and explicit sockets.

### Characters and animations

- **Universal Base Characters — Quaternius** — CC0, rigged humanoid glTF/FBX, ~13k triangles, compatible with the Universal Animation Library. Source: `https://quaternius.com/packs/universalbasecharacters.html`
- **Universal Animation Library — Quaternius** — CC0, 120+ humanoid animations including directional locomotion, sprint, gun/combat and deaths. Source: `https://quaternius.com/packs/universalanimationlibrary.html`

### PBR materials

Poly Haven materials are CC0 and are the primary bootstrap source for environment material authoring:

- Rusty Metal: `https://polyhaven.com/a/rusty_metal`
- Rusty Painted Metal: `https://polyhaven.com/a/rusty_painted_metal`
- Concrete: `https://polyhaven.com/a/concrete`
- Rough Concrete: `https://polyhaven.com/a/rough_concrete`
- Metal Plate: `https://polyhaven.com/a/metal_plate`

Source downloads can be 4K/8K. Runtime derivatives should normally be 2K/1K/512 KTX2 with mipmaps.

## Weapon import contract

```text
SOURCE FBX/BLEND/GLTF
      ↓
Blender cleanup
      ↓
meters / +Y up / -Z forward
      ↓
separate moving components
      ↓
UV + PBR validation
      ↓
bake high-poly → game mesh
      ↓
create required sockets
      ↓
LOD generation
      ↓
GLB export
      ↓
Meshopt/Draco + KTX2
      ↓
Asset Inspector validation
```

Required named nodes for a final firearm:

```text
WeaponRoot
├── Receiver
├── Magazine
├── Bolt_or_Slide
├── ChargingHandle
├── Trigger
├── MuzzleSocket
├── EjectionSocket
├── MagazineSocket
├── OpticSocket
├── MuzzleAttachmentSocket
├── UnderbarrelSocket
├── LeftHandSocket
└── RightHandSocket
```

## Geometry budgets

### First-person hero weapon

- LOD0 only in first-person camera.
- Typical target: ~40k–80k triangles after bake, but profile actual shader/material cost.
- 1K–2K runtime textures on iPhone depending on memory profile.

### World weapon

```text
LOD0  ~40–60k  0–3 m
LOD1  ~25–35k  3–8 m
LOD2  ~10–15k  8–18 m
LOD3  ~3–6k    18–40 m
Cull / simplified beyond configured range
```

### Character

```text
LOD0  40–80k close
LOD1  ~30k
LOD2  ~15k
LOD3  ~7k
```

Animation evaluation also drops from 60 Hz close → 30 Hz medium → 15 Hz far → 8 Hz very far.

## Texture compilation

Each PBR material can contain:

```text
BaseColor
Normal GL
AO/Roughness/Metalness
optional Height
DirtMask
RustMask
WetnessMask
```

Runtime variants:

```text
2048 KTX2
1024 KTX2
512 KTX2
256 KTX2 for tiny/far props
```

The current `MaterialSystem` already supports dirt/rust/wetness blending with procedural fallback detail. Real KTX2 maps replace the fallback as assets are committed.

## Where to put finalized assets

```text
public/game-assets/
├── models/
│   ├── weapons/fps_rifle_01/
│   ├── weapons/world_rifle_01/
│   └── characters/soldier_01/
├── animations/humanoid/
└── textures/materials/
```

Use `/tools/asset-viewer/` before connecting a model to gameplay. The inspector reports triangles, materials, bones, animation clips and missing Project Strike weapon sockets.
