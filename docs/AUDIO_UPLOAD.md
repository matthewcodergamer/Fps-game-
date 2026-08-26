# Project Strike — Permanent Audio Upload

The game uses exactly three top-level runtime audio layers:

```text
public/game-assets/audio/
├── weapons_player/
├── dlc_weapons/
└── resident/
```

## Important

Do **not** flatten the converter output. For each converted ZIP, extract its complete `Project-Strike-Audio` directory inside the matching layer folder.

### Weapons Player pack

Upload the extracted directory so this path exists:

```text
public/game-assets/audio/weapons_player/Project-Strike-Audio/
├── audio/
│   ├── weapons_player_lmg_combat/
│   ├── weapons_player_ptl_pistol/
│   ├── weapons_player_sht_pump/
│   └── ...
└── manifest/
    └── audio-manifest.json
```

### DLC Weapons pack

```text
public/game-assets/audio/dlc_weapons/Project-Strike-Audio/
├── audio/
│   ├── dlc_weapons_weapon_gadget_pistol/
│   ├── dlc_weapons_weapon_bullpup/
│   └── ...
└── manifest/
    └── audio-manifest.json
```

### Resident pack

```text
public/game-assets/audio/resident/Project-Strike-Audio/
├── audio/
│   ├── resident_weapons/
│   ├── resident_explosions/
│   ├── resident_collision/
│   └── ...
└── manifest/
    └── audio-manifest.json
```

`AudioManager.loadPermanent()` reads these manifests automatically and lazily decodes only the banks needed by the current weapon/game event. This prevents hundreds of WAV files from being decoded into RAM at startup on iPhone.

The two packs supplied during Stage 2 contain:

- `weapons_player`: 22 banks / 122 WAV streams.
- `dlc_weapons`: 6 banks / 73 WAV streams.
- `resident`: folder/runtime support is ready; the converted resident ZIP still needs to be supplied/uploaded.

The local **IMPORT AUDIO PACKS** button remains available for development and can load the same converted ZIPs without committing them.
