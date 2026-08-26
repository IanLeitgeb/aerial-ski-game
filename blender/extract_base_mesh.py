"""
Extract one body from Blender Studio's Human Base Meshes bundle into the repo.

    curl -O https://download.blender.org/demo/asset-bundles/human-base-meshes/\
human-base-meshes-bundle-v1.4.1.zip
    unzip human-base-meshes-bundle-v1.4.1.zip
    ~/opt/blender-5.2.1-linux-x64/blender -b --factory-startup \
        --python blender/extract_base_mesh.py -- \
        --bundle .../human_base_meshes_bundle.blend \
        --out blender/human_base_male.blend

WHY A COMMITTED COPY
--------------------
The bundle is 50 MB and 407 objects; the build needs exactly one of them. Vendoring
the single mesh keeps build_body.py reproducible with no network access and no
50 MB in the history, and pins the exact geometry the bakes were calibrated
against — a future bundle revision that retopologises the body would otherwise
silently change the figure.

LICENCE
-------
Blender Studio Human Base Meshes, CC0 1.0 (public domain dedication). No
attribution is required; it is recorded here because knowing an asset's
provenance matters more than the licence minimum.
    https://www.blender.org/download/demo-files/
    https://developer.blender.org/docs/features/asset_system/asset_bundles/human_base_meshes/

WHY THIS ASSET
--------------
GEO-body_male_realistic is 10,582 vertices and 99.8% quads, already UV unwrapped,
1.690 m tall, in a relaxed A-pose, with real edge loops around the shoulder,
elbow, hip and knee. Those loops are the entire point: they are what lets a joint
bend as a joint. The metaball body this replaces had no topology at all — it was
an isosurface blended along the segment axes, so a shoulder was a bulge where two
fields overlapped, and no amount of tuning was going to make that read as a
person.
"""

import bpy
import os
import sys

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    if name in argv:
        i = argv.index(name)
        if i + 1 < len(argv):
            return argv[i + 1]
    return default


BUNDLE = arg('--bundle')
OUT = arg('--out', 'blender/human_base_male.blend')
OBJECT = arg('--object', 'GEO-body_male_realistic')

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def log(m):
    print(f'[extract] {m}', flush=True)


bpy.ops.wm.read_factory_settings(use_empty=True)

with bpy.data.libraries.load(BUNDLE, link=False) as (src, dst):
    if OBJECT not in src.objects:
        raise SystemExit(f'[extract] {OBJECT} not in bundle')
    dst.objects = [OBJECT]

obj = dst.objects[0]
bpy.context.collection.objects.link(obj)
bpy.context.view_layer.objects.active = obj
obj.select_set(True)

# Drop the multires modifier. It carries sculpted subdivision levels the base
# cage does not need — the pipeline generates its own high-poly by subdividing —
# and it would otherwise be applied at export and multiply the vertex count.
for m in list(obj.modifiers):
    log(f'removing modifier {m.type}')
    obj.modifiers.remove(m)

# Eyes and other sub-objects are not linked in, so anything parented is gone.
obj.parent = None
obj.name = 'humanBase'
obj.data.name = 'humanBase'
obj.location = (0, 0, 0)
obj.rotation_euler = (0, 0, 0)
obj.scale = (1, 1, 1)

me = obj.data
zs = [v.co.z for v in me.vertices]
xs = [v.co.x for v in me.vertices]
quads = sum(1 for p in me.polygons if len(p.vertices) == 4)
log(f'{len(me.vertices)} verts, {len(me.polygons)} faces ({quads} quads), '
    f'{len(me.uv_layers)} uv layers')
log(f'height {max(zs) - min(zs):.3f} m, arm span {max(xs) - min(xs):.3f} m')

out = OUT if os.path.isabs(OUT) else os.path.join(ROOT, OUT)
bpy.ops.wm.save_as_mainfile(filepath=out, compress=True)
log(f'BASE_EXTRACTED path={out} bytes={os.path.getsize(out)}')
