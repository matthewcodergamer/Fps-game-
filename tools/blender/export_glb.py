import bpy
import os
import sys

argv = sys.argv
argv = argv[argv.index('--') + 1:] if '--' in argv else []
if len(argv) < 2:
    raise SystemExit('usage: blender -b source.blend -P export_glb.py -- output.glb')

output = os.path.abspath(argv[1])
os.makedirs(os.path.dirname(output), exist_ok=True)

# Keep object hierarchy, skinning, animation clips, materials and textures.
bpy.ops.export_scene.gltf(
    filepath=output,
    export_format='GLB',
    use_selection=False,
    export_apply=False,
    export_animations=True,
    export_skins=True,
    export_morph=True,
    export_materials='EXPORT',
    export_yup=True,
    export_cameras=False,
    export_lights=False,
)
print(f'PROJECT_STRIKE_GLTF_EXPORT={output}')
