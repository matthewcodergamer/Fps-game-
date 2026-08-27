import bpy
import json
import os
import re
import sys
from pathlib import Path

argv = sys.argv
argv = argv[argv.index('--') + 1:] if '--' in argv else []
if len(argv) < 2:
    raise SystemExit('usage: blender -b -P export_glb.py -- source.(blend|fbx|gltf|glb) output.glb [report.json]')

source = os.path.abspath(argv[0])
output = os.path.abspath(argv[1])
report_path = os.path.abspath(argv[2]) if len(argv) > 2 else output + '.report.json'
package_root = os.path.dirname(source)
os.makedirs(os.path.dirname(output), exist_ok=True)
os.makedirs(os.path.dirname(report_path), exist_ok=True)

IMAGE_EXTS = {'.png', '.jpg', '.jpeg', '.tif', '.tiff', '.exr', '.hdr', '.bmp', '.tga', '.webp'}


def role_for(name):
    n = name.lower()
    if re.search(r'base.?color|basecolor|albedo|diffuse|_diff\b', n):
        return 'basecolor'
    if re.search(r'normal|_nor\b|_nrm\b', n):
        return 'normal'
    if re.search(r'rough|roughness', n):
        return 'roughness'
    if re.search(r'metal|metallic', n):
        return 'metallic'
    if re.search(r'ambient.?occlusion|occlusion|_ao\b', n):
        return 'ao'
    if re.search(r'height|displace', n):
        return 'height'
    if re.search(r'emissive|emission|glow', n):
        return 'emissive'
    return 'unknown'


def discover_images(root):
    out = []
    for p in Path(root).rglob('*'):
        if p.is_file() and p.suffix.lower() in IMAGE_EXTS:
            out.append(p)
    return out


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_source(path):
    ext = Path(path).suffix.lower()
    if ext == '.blend':
        bpy.ops.wm.open_mainfile(filepath=path)
    elif ext == '.fbx':
        reset_scene()
        bpy.ops.import_scene.fbx(filepath=path, use_image_search=True)
    elif ext in {'.gltf', '.glb'}:
        reset_scene()
        bpy.ops.import_scene.gltf(filepath=path)
    else:
        raise SystemExit(f'Project Strike assertion failed: unsupported source format {ext}')


def relink_images(candidates):
    by_name = {p.name.lower(): p for p in candidates}
    relinked = []
    missing = []
    for image in bpy.data.images:
        if image.source not in {'FILE', 'TILED'}:
            continue
        raw = bpy.path.abspath(image.filepath or image.filepath_raw or '')
        if raw and os.path.exists(raw):
            continue
        wanted = os.path.basename(raw or image.filepath or image.name).lower()
        match = by_name.get(wanted)
        if not match:
            stem = Path(wanted).stem
            match = next((p for p in candidates if p.stem.lower() == stem), None)
        if match:
            image.filepath = str(match)
            image.filepath_raw = str(match)
            try:
                image.reload()
            except Exception:
                pass
            relinked.append({'image': image.name, 'path': str(match)})
        else:
            missing.append(image.name)
    return relinked, missing


def image_by_role(candidates):
    found = {}
    for p in candidates:
        role = role_for(p.name)
        if role != 'unknown' and role not in found:
            found[role] = p
    return found


def load_image(path):
    existing = next((i for i in bpy.data.images if os.path.abspath(bpy.path.abspath(i.filepath or '')) == os.path.abspath(str(path))), None)
    if existing:
        return existing
    try:
        return bpy.data.images.load(str(path), check_existing=True)
    except Exception:
        return None


def find_principled(nodes):
    return next((n for n in nodes if n.type == 'BSDF_PRINCIPLED'), None)


def auto_wire_materials(candidates):
    roles = image_by_role(candidates)
    wired = []
    for mat in bpy.data.materials:
        if not mat.use_nodes or not mat.node_tree:
            continue
        nodes = mat.node_tree.nodes
        links = mat.node_tree.links
        bsdf = find_principled(nodes)
        if not bsdf:
            continue

        def wire_color(role, socket_name, non_color=False):
            p = roles.get(role)
            sock = bsdf.inputs.get(socket_name)
            if not p or not sock or sock.is_linked:
                return
            img = load_image(p)
            if not img:
                return
            if non_color:
                try:
                    img.colorspace_settings.name = 'Non-Color'
                except Exception:
                    pass
            tex = nodes.new('ShaderNodeTexImage')
            tex.image = img
            tex.label = f'Project Strike {role}'
            links.new(tex.outputs.get('Color'), sock)
            wired.append({'material': mat.name, 'role': role, 'path': str(p)})

        wire_color('basecolor', 'Base Color', False)
        wire_color('roughness', 'Roughness', True)
        wire_color('metallic', 'Metallic', True)

        p = roles.get('normal')
        sock = bsdf.inputs.get('Normal')
        if p and sock and not sock.is_linked:
            img = load_image(p)
            if img:
                try:
                    img.colorspace_settings.name = 'Non-Color'
                except Exception:
                    pass
                tex = nodes.new('ShaderNodeTexImage')
                tex.image = img
                tex.label = 'Project Strike normal'
                normal = nodes.new('ShaderNodeNormalMap')
                links.new(tex.outputs.get('Color'), normal.inputs.get('Color'))
                links.new(normal.outputs.get('Normal'), sock)
                wired.append({'material': mat.name, 'role': 'normal', 'path': str(p)})
    return wired


def downscale_runtime_images(max_side=2048):
    changed = []
    for image in bpy.data.images:
        try:
            w, h = int(image.size[0]), int(image.size[1])
        except Exception:
            continue
        if w <= 0 or h <= 0 or max(w, h) <= max_side:
            continue
        scale = max_side / float(max(w, h))
        nw, nh = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
        try:
            image.scale(nw, nh)
            changed.append({'image': image.name, 'from': [w, h], 'to': [nw, nh]})
        except Exception:
            pass
    return changed


if not os.path.exists(source):
    raise SystemExit(f'Project Strike assertion failed: source not found: {source}')

import_source(source)
candidates = discover_images(package_root)
relinked, missing_images = relink_images(candidates)
auto_wired = auto_wire_materials(candidates)
resized_images = downscale_runtime_images(2048)

mesh_count = len([o for o in bpy.context.scene.objects if o.type == 'MESH'])
armature_count = len([o for o in bpy.context.scene.objects if o.type == 'ARMATURE'])
material_count = len(bpy.data.materials)
action_count = len(bpy.data.actions)
if mesh_count == 0:
    raise SystemExit('Project Strike assertion failed: source contains no mesh objects')

export_args = dict(
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
try:
    export_args['export_draco_mesh_compression_enable'] = True
    export_args['export_draco_mesh_compression_level'] = 6
    bpy.ops.export_scene.gltf(**export_args)
except Exception:
    export_args.pop('export_draco_mesh_compression_enable', None)
    export_args.pop('export_draco_mesh_compression_level', None)
    bpy.ops.export_scene.gltf(**export_args)

if not os.path.exists(output) or os.path.getsize(output) < 1024:
    raise SystemExit('Project Strike assertion failed: GLB output was not created or is unexpectedly small')
with open(output, 'rb') as f:
    magic = f.read(4)
if magic != b'glTF':
    raise SystemExit('Project Strike assertion failed: output does not have a valid GLB header')

report = {
    'version': 3,
    'source': source,
    'sourceFormat': Path(source).suffix.lower().lstrip('.'),
    'output': output,
    'outputBytes': os.path.getsize(output),
    'meshCount': mesh_count,
    'armatureCount': armature_count,
    'materialCount': material_count,
    'animationCount': action_count,
    'packageImagesFound': len(candidates),
    'relinkedImages': relinked,
    'autoWiredTextures': auto_wired,
    'runtimeTextureResizes': resized_images,
    'unresolvedImages': missing_images,
    'assertions': {
        'hasMeshes': mesh_count > 0,
        'validGlbHeader': True,
        'outputNonEmpty': True,
    },
}
with open(report_path, 'w', encoding='utf-8') as f:
    json.dump(report, f, indent=2)

print(f'PROJECT_STRIKE_GLTF_EXPORT={output}')
print(f'PROJECT_STRIKE_REPORT={report_path}')
print(json.dumps(report, indent=2))
