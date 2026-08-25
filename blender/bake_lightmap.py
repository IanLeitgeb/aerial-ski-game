"""
Bake global illumination for the static scenery with Cycles + OptiX.

    ~/opt/blender-5.2.1-linux-x64/blender -b --factory-startup \
        --python blender/bake_lightmap.py -- --res 1024 --samples 256

WHY THIS IS THE REAL WIN
------------------------
Babylon (WebGL2) has no real-time global illumination. The scene is lit by one
directional light plus a hemisphere with zero bounce, which is why it reads flat
no matter how good the materials are.

But the scenery is STATIC — only the athlete moves. Static geometry can carry
lighting BAKED from an offline path tracer, giving multi-bounce GI at zero
runtime cost. Snow makes this unusually valuable: it is highly reflective, so in
reality it throws enormous amounts of light back up into shadowed areas. That
bounce is completely absent from the game right now.

INPUT
-----
blender/terrain.json, extracted from the RUNNING game by
tests/drive/extract-terrain.spec.js — real world-space geometry and the actual
light rig values, so the bake matches what the player sees rather than a
re-typed approximation.

OUTPUT
------
assets/terrain_baked.glb   geometry + lightmap UVs (UV channel 1)
assets/lightmap.png        the baked irradiance

The game loads the glb and applies the lightmap via material.lightmapTexture with
coordinatesIndex = 1.
"""

import bpy
import json
import math
import os
import sys

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default):
    if name in argv:
        i = argv.index(name)
        if i + 1 < len(argv):
            return argv[i + 1]
    return default


RES = int(arg('--res', '1024'))
SAMPLES = int(arg('--samples', '256'))

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = json.load(open(os.path.join(HERE, 'terrain.json')))


def log(msg):
    print(f'[bake] {msg}', flush=True)


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def build_geometry():
    """
    Rebuild the extracted meshes in Blender.

    Babylon is Y-up / left-handed; Blender is Z-up / right-handed. Converting
    (x, y, z) -> (x, z, y) also flips handedness, so triangle winding is reversed
    to keep normals facing outward. Getting this wrong bakes the lighting onto the
    BACK of every surface, which looks like a completely black lightmap.
    """
    objs = []
    for m in DATA['meshes']:
        p = m['positions']
        verts = [(p[i], p[i + 2], p[i + 1]) for i in range(0, len(p), 3)]
        idx = m['indices']
        faces = [(idx[i], idx[i + 2], idx[i + 1]) for i in range(0, len(idx), 3)]

        mesh = bpy.data.meshes.new(m['name'])
        mesh.from_pydata(verts, [], faces)
        mesh.validate()
        mesh.update()

        obj = bpy.data.objects.new(m['name'], mesh)
        bpy.context.collection.objects.link(obj)

        mat = bpy.data.materials.new(f"{m['name']}_mat")
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get('Principled BSDF')
        if bsdf:
            a = m.get('albedo') or [0.8, 0.8, 0.8]
            bsdf.inputs['Base Color'].default_value = (a[0], a[1], a[2], 1.0)
            if 'Roughness' in bsdf.inputs:
                bsdf.inputs['Roughness'].default_value = float(m.get('roughness', 0.8))
        obj.data.materials.append(mat)
        objs.append(obj)

    log(f'built {len(objs)} objects')
    return objs


def build_lighting():
    """Reproduce the game's light rig from the extracted values."""
    L = DATA['lighting']

    if L.get('sunDirection'):
        d = L['sunDirection']                       # Babylon direction
        bpy.ops.object.light_add(type='SUN', location=(0, 0, 50))
        sun = bpy.context.active_object
        sun.data.energy = max(1.0, (L.get('sunIntensity') or 1.0) * 3.0)
        c = L.get('sunColor') or [1, 1, 1]
        sun.data.color = (c[0], c[1], c[2])
        sun.data.angle = math.radians(1.5)          # soft-ish shadow edge
        # Point the sun ALONG the game's direction vector (Babylon -> Blender axes).
        bx, by, bz = d[0], d[2], d[1]
        sun.rotation_euler = (
            math.atan2(math.sqrt(bx * bx + by * by), -bz),
            0.0,
            math.atan2(by, bx) + math.pi / 2,
        )

    # Sky. The hemisphere light is what actually makes snow read as snow, and it
    # is also the source of most of the bounce we are here to capture.
    world = bpy.data.worlds.new('World')
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    if bg:
        hemi = L.get('hemiIntensity') or 0.45
        bg.inputs['Color'].default_value = (0.55, 0.70, 0.95, 1.0)   # cool sky
        bg.inputs['Strength'].default_value = max(0.3, hemi * 2.2)
    log('lighting rebuilt from the extracted rig')


def unwrap_for_lightmap(objs):
    """
    Lightmaps need their OWN non-overlapping UV set. The game meshes have no uv2
    at all, so one is generated here and exported with the geometry — the game
    must use exactly these UVs or the lightmap will not line up.
    """
    for o in objs:
        while len(o.data.uv_layers) > 0:
            o.data.uv_layers.remove(o.data.uv_layers[0])
        o.data.uv_layers.new(name='UVMap')       # channel 0
        o.data.uv_layers.new(name='Lightmap')    # channel 1

    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]

    # Pack every object into ONE atlas so a single texture covers the scene.
    for o in objs:
        o.data.uv_layers.active = o.data.uv_layers['Lightmap']

    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.lightmap_pack(PREF_CONTEXT='ALL_FACES', PREF_MARGIN_DIV=0.3)
    bpy.ops.object.mode_set(mode='OBJECT')
    log('lightmap UVs packed into a shared atlas')


def setup_bake_targets(objs, img):
    """Every material needs an image node selected as the bake destination."""
    for o in objs:
        for slot in o.material_slots:
            mat = slot.material
            if not mat or not mat.use_nodes:
                continue
            node = mat.node_tree.nodes.new('ShaderNodeTexImage')
            node.image = img
            node.select = True
            mat.node_tree.nodes.active = node


def configure_cycles():
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    used = 'CPU'
    for backend in ('OPTIX', 'CUDA'):
        try:
            prefs.compute_device_type = backend
            prefs.get_devices()
            devs = [d for d in prefs.devices if d.type == backend]
            if devs:
                for d in prefs.devices:
                    d.use = (d.type == backend)
                sc.cycles.device = 'GPU'
                used = f'{backend} ({devs[0].name})'
                break
        except Exception as e:
            log(f'{backend} unavailable: {e}')
    log(f'cycles device: {used}')

    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 8
    sc.cycles.diffuse_bounces = 8          # snow bounce is the whole point
    sc.cycles.caustics_reflective = False
    sc.cycles.caustics_refractive = False
    return used


def main():
    clear()
    objs = build_geometry()
    build_lighting()
    unwrap_for_lightmap(objs)

    img = bpy.data.images.new('lightmap', width=RES, height=RES, float_buffer=False)
    setup_bake_targets(objs, img)
    device = configure_cycles()

    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]

    sc = bpy.context.scene
    sc.render.bake.use_pass_direct = True
    sc.render.bake.use_pass_indirect = True
    sc.render.bake.use_selected_to_active = False
    sc.render.bake.margin = 4

    log(f'baking {RES}x{RES} at {SAMPLES} samples over {len(objs)} objects...')
    bpy.ops.object.bake(type='COMBINED')

    out_png = os.path.join(ROOT, 'assets', 'lightmap.png')
    os.makedirs(os.path.dirname(out_png), exist_ok=True)
    img.filepath_raw = out_png
    img.file_format = 'PNG'
    img.save()

    out_glb = os.path.join(ROOT, 'assets', 'terrain_baked.glb')
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(
        filepath=out_glb, export_format='GLB',
        export_yup=True, export_apply=True, export_animations=False,
    )

    log(f'BAKE_DONE device={device} png={out_png} glb={out_glb}')


main()
