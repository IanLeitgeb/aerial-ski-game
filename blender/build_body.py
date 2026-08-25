"""
Build ONE continuous skinned body for the athlete.

    ~/opt/blender-5.2.1-linux-x64/blender -b --factory-startup \
        --python blender/build_body.py -- --out assets/athlete_body.glb

WHY THIS EXISTS
---------------
The athlete has always been separate solids — first primitives, then nicer
capsules. No amount of shading hides that the limbs do not connect: at every
joint there is a visible seam where two objects overlap, and nothing deforms.
That is the single largest reason the figure does not read as a person.

APPROACH: METABALLS
-------------------
Rather than model a humanoid by hand (impossible headless, and it would drift
from the physics), the body is grown from METABALLS placed along each segment's
axis. Metaballs blend into one continuous isosurface, so shoulders, hips, elbows
and knees fuse organically instead of butting together. The result is then
converted to a real mesh and skinned.

The segment positions and dimensions come from body-model.json, the same source
the physics uses, so the body cannot drift from the simulation.

BUILT IN THE REFERENCE POSE
---------------------------
Unlike build_athlete.py, which places parts at the origin because game.js poses
each one separately, this body is built in the POSE_UNTUCKED reference pose. A
skinned mesh has to be bound in a real pose — the bind pose is what the skinning
weights are relative to — and the game then deforms it by driving the bones.
"""

import bpy
import json
import math
import os
import sys

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = 'assets/athlete_body.glb'
for i, a in enumerate(argv):
    if a == '--out' and i + 1 < len(argv):
        OUT = argv[i + 1]

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MODEL = json.load(open(os.path.join(HERE, 'body-model.json')))
SEGMENTS = {s['name']: s for s in MODEL['SEGMENTS']}
BASE_Z = MODEL['BASE_Z']
POSE = MODEL['POSE_UNTUCKED']

# Skis are rigid equipment, not body. They stay separate objects.
BODY_SEGMENTS = [n for n in SEGMENTS if n not in ('skiL', 'skiR')]


def log(m):
    print(f'[body] {m}', flush=True)


def bl(name):
    """
    Segment centre in BLENDER axes.

    Determined empirically, not from first principles: the glTF exporter's
    export_yup conversion combines with Blender's own axes such that the round
    trip lands as Babylon (x, y, z) = Blender (y, z, x). Measured by building the
    body, printing the Blender-side bounding box, and comparing it to what
    Babylon reported — the first version pre-swapped in the same direction the
    exporter already does, producing a figure 0.18 wide instead of 0.51 (the arms
    ended up along the depth axis, so it read as a vertical column).
    """
    p = POSE.get(name, {})
    x_babylon = p.get('x', 0.0)
    y_babylon = p.get('y', 0.0)
    z_babylon = BASE_Z.get(name, 0.0) + p.get('dz', 0.0)
    return (z_babylon, x_babylon, y_babylon)


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def build_metaball_body():
    """
    Grow the torso, head and limbs as one blended isosurface.

    Each segment contributes several metaball elements strung along its length.
    Stiffness controls how aggressively neighbours fuse — too high and the figure
    becomes a blob, too low and the joints separate again.
    """
    mball = bpy.data.metaballs.new('AthleteBody')
    # Lower = finer isosurface. 0.035 gave ~400 verts for a whole body, which
    # reads blocky; 0.02 lands nearer 3k after decimation, which a browser
    # skins comfortably.
    mball.resolution = 0.02
    mball.render_resolution = 0.02
    obj = bpy.data.objects.new('AthleteBody', mball)
    bpy.context.collection.objects.link(obj)

    def strand(name, count, radius_scale=1.0, stiffness=2.0):
        """
        Place metaball elements along a segment's axis.

        A metaball's isosurface sits WELL INSIDE its stated radius — the field
        falls below threshold before reaching it. Measuring showed the torso
        coming out ~0.18 across where the segment is 0.30x0.28, i.e. everything
        was roughly 40% too thin and the figure read as a cardboard cutout.
        RADIUS_COMPENSATION corrects for that shrinkage.

        (Blender's ELLIPSOID element type was tried first, to control depth
        separately; its size_x/y/z are expansion BEYOND the radius rather than
        the radius itself, which produced a 58-vertex speck. Spheres with honest
        radii are the simpler correct answer, since these segments are close to
        round anyway.)
        """
        # Calibrated, not guessed. Measuring the built mesh against the stated
        # radii showed the isosurface lands at ~0.72x the radius, so a segment
        # whose real half-width is W needs radius W/0.72 = 1.39*W. At 1.75 the
        # torso was 25% too wide and swallowed the arms, which is why the figure
        # kept reading as a blob with a bulge rather than a body with limbs.
        RADIUS_COMPENSATION = 1.40
        seg = SEGMENTS[name]
        cx, cy, cz = bl(name)
        half = seg['h'] / 2
        r = (seg['w'] + seg['d']) / 4 * radius_scale * RADIUS_COMPENSATION
        for i in range(count):
            t = (i / max(1, count - 1)) * 2 - 1
            el = mball.elements.new()
            el.co = (cx, cy, cz + t * half * 0.9)
            el.radius = r
            el.stiffness = stiffness

    # Torso: fuller at the chest, tapering to the hips.
    strand('torso', 11, radius_scale=1.00, stiffness=2.0)
    # Neck/head. A slightly smaller radius keeps the helmet from swallowing the
    # shoulders.
    strand('head', 5, radius_scale=1.10, stiffness=2.4)

    for side in ('L', 'R'):
        strand(f'upperArm{side}', 11, radius_scale=1.00, stiffness=1.9)
        strand(f'lowerArm{side}', 11, radius_scale=0.92, stiffness=1.9)
        strand(f'upperLeg{side}', 11, radius_scale=0.66, stiffness=1.5)
        strand(f'lowerLeg{side}', 11, radius_scale=0.62, stiffness=1.5)

    log(f'{len(mball.elements)} metaball elements placed')

    # Convert the isosurface into an editable mesh.
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target='MESH')
    body = bpy.context.active_object
    body.name = 'athleteBody'

    # Metaball tessellation is dense and uneven; decimate to something a browser
    # is happy to skin every frame, then smooth.
    dec = body.modifiers.new('decimate', 'DECIMATE')
    dec.ratio = 0.55
    bpy.ops.object.modifier_apply(modifier=dec.name)
    bpy.ops.object.shade_smooth()

    xs = [v.co.x for v in body.data.vertices]
    ys = [v.co.y for v in body.data.vertices]
    zs = [v.co.z for v in body.data.vertices]
    # Two material slots: suit (0) and helmet (1). Faces above the neck line get
    # slot 1, so Babylon receives two submeshes and can shade them differently.
    suit = bpy.data.materials.new('suitMat')
    helmet = bpy.data.materials.new('helmetMat')
    body.data.materials.append(suit)
    body.data.materials.append(helmet)

    head_seg = SEGMENTS['head']
    hx, hy, hz = bl('head')
    neck_z = hz - head_seg['h'] / 2 * 0.85
    n_head = 0
    for poly in body.data.polygons:
        cz = sum(body.data.vertices[v].co.z for v in poly.vertices) / len(poly.vertices)
        if cz >= neck_z:
            poly.material_index = 1
            n_head += 1
    log(f'material split: {n_head} helmet faces above z={neck_z:.3f}')

    log(f'body mesh: {len(body.data.vertices)} verts, {len(body.data.polygons)} faces')
    log(f'blender bbox: x={min(xs):.3f}..{max(xs):.3f} '
        f'y={min(ys):.3f}..{max(ys):.3f} z={min(zs):.3f}..{max(zs):.3f}')
    return body


def build_armature():
    """
    Bones named after the physics segments, positioned in the reference pose.
    The names ARE the interface between simulation and rig.
    """
    bpy.ops.object.armature_add(location=(0, 0, 0))
    arm = bpy.context.active_object
    arm.name = 'AthleteRig'
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.data.edit_bones
    for b in list(eb):
        eb.remove(b)

    made = {}
    for name in BODY_SEGMENTS:
        seg = SEGMENTS[name]
        cx, cy, cz = bl(name)
        half = seg['h'] / 2
        b = eb.new(name)
        b.head = (cx, cy, cz - half)
        b.tail = (cx, cy, cz + half)
        made[name] = b

    hierarchy = {
        'head': 'torso',
        'upperArmL': 'torso', 'upperArmR': 'torso',
        'lowerArmL': 'upperArmL', 'lowerArmR': 'upperArmR',
        'upperLegL': 'torso', 'upperLegR': 'torso',
        'lowerLegL': 'upperLegL', 'lowerLegR': 'upperLegR',
    }
    for c, p in hierarchy.items():
        if c in made and p in made:
            made[c].parent = made[p]
            made[c].use_connect = False

    bpy.ops.object.mode_set(mode='OBJECT')
    log(f'armature: {len(made)} bones')
    return arm


def skin(body, arm):
    """
    Bind with AUTOMATIC WEIGHTS — the whole point of the exercise.

    Rigid one-bone-per-part binding (what the previous athlete used) is correct
    when the parts are separate solids, but on a continuous mesh it would tear
    the surface at every joint. Heat-map weights blend influence across the joint
    so the elbow and knee bend as skin rather than snapping.
    """
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    log('skinned with automatic (heat map) weights')


def add_equipment():
    """Skis stay rigid, separate objects parented to the lower-leg bones."""
    made = []
    for name in ('skiL', 'skiR'):
        seg = SEGMENTS[name]
        cx, cy, cz = bl(name)
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(cx, cy, cz))
        o = bpy.context.active_object
        o.name = name
        o.scale = (seg['w'], seg['d'], seg['h'])
        bpy.ops.object.transform_apply(scale=True)
        m = o.modifiers.new('bevel', 'BEVEL')
        m.width = 0.006
        m.segments = 3
        bpy.ops.object.modifier_apply(modifier=m.name)
        bpy.ops.object.shade_smooth()
        made.append(o)
    return made


def main():
    clear()
    body = build_metaball_body()
    arm = build_armature()
    skin(body, arm)
    equip = add_equipment()

    out = OUT if os.path.isabs(OUT) else os.path.join(ROOT, OUT)
    os.makedirs(os.path.dirname(out), exist_ok=True)

    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(
        filepath=out, export_format='GLB',
        export_yup=True, export_apply=False,   # apply=False keeps the armature
        export_skins=True, export_animations=False,
    )
    log(f'BODY_EXPORTED path={out} verts={len(body.data.vertices)} '
        f'bones={len(arm.data.bones)} equipment={len(equip)}')


main()
