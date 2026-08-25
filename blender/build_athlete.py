"""
Build the aerial-ski athlete as a skinned mesh and export it to glTF.

    ~/opt/blender-5.2.1-linux-x64/blender -b --factory-startup \
        --python blender/build_athlete.py -- --out assets/athlete.glb

WHY A SCRIPT AND NOT A .blend
-----------------------------
This machine is headless, so there is no interactive Blender. More importantly,
the athlete's proportions are not an art decision — they are the SAME numbers the
physics uses. blender/body-model.json is generated from engine/core/body-model.js,
so the mesh cannot drift from the simulation: change a segment and both the
inertia tensor and the geometry follow.

A .blend would be an opaque binary duplicating those numbers. A script is
diffable, reviewable, and regenerates identically.

WHAT THIS REPLACES
------------------
Twelve disconnected primitives with visible gaps at every joint, which cannot
bend and cannot be skinned. The output is one mesh per body part bound to an
armature whose bones are named exactly after the physics segments, so game.js can
drive bones with the transforms it already computes.

DELIBERATE SCOPE
----------------
A well-proportioned, smooth, correctly-rigged athlete — NOT a sculpted photoreal
one. This is the structural step: real geometry plus a real skeleton. Sculpted
detail (suit wrinkles, helmet form, goggles) is a later sculpt-and-bake pass that
needs this rig to exist first.
"""

import bpy
import json
import math
import os
import sys

# ── Args ────────────────────────────────────────────────────────────────────
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = 'assets/athlete.glb'
for i, a in enumerate(argv):
    if a == '--out' and i + 1 < len(argv):
        OUT = argv[i + 1]

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MODEL = json.load(open(os.path.join(HERE, 'body-model.json')))
SEGMENTS = {s['name']: s for s in MODEL['SEGMENTS']}
BASE_Z = MODEL['BASE_Z']
POSE = MODEL['POSE_UNTUCKED']


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def seg_origin(name):
    """
    Every part is built at the ORIGIN, not at its posed position.

    game.js already positions each segment every frame via computePose(); the
    geometry only needs to be centred on its own local origin, exactly as the
    primitives it replaces were. Baking the pose offset into the vertices would
    double-apply it the moment the pose solver ran.
    """
    return (0.0, 0.0, 0.0)


def add_capsule(name, radius, height, location, segments=32, rings=8):
    """
    A capsule reads as a limb; a cylinder reads as a pipe. Rounded ends also mean
    adjacent parts overlap slightly instead of leaving the gaps the primitive
    version had at every joint.
    """
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=segments, radius=radius, depth=max(height - 2 * radius, 0.01),
        location=location)
    body = bpy.context.active_object
    body.name = name

    for end in (1, -1):
        bpy.ops.mesh.primitive_uv_sphere_add(
            segments=segments, ring_count=rings, radius=radius,
            location=(location[0], location[1],
                      location[2] + end * max(height / 2 - radius, 0.0)))
        cap = bpy.context.active_object
        cap.select_set(True)
        body.select_set(True)
        bpy.context.view_layer.objects.active = body
        bpy.ops.object.join()

    bpy.ops.object.shade_smooth()
    return body


def add_box(name, w, h, d, location, bevel=0.01):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)
    o = bpy.context.active_object
    o.name = name
    o.scale = (w, d, h)          # Blender: x=width, y=depth, z=height
    bpy.ops.object.transform_apply(scale=True)
    # A hard-edged box reads as programmer art; a bevelled one catches light.
    m = o.modifiers.new('bevel', 'BEVEL')
    m.width = bevel
    m.segments = 3
    bpy.ops.object.modifier_apply(modifier=m.name)
    # NOTE: mesh.use_auto_smooth was REMOVED in Blender 4.1. shade_smooth() now
    # handles this on its own; setting the old attribute raises AttributeError.
    bpy.ops.object.shade_smooth()
    return o


def build_parts():
    """One object per physics segment, named identically."""
    parts = {}

    for name, seg in SEGMENTS.items():
        loc = seg_origin(name)
        w, h, d = seg['w'], seg['h'], seg['d']

        if name == 'head':
            # Helmet: a slightly flattened sphere, not a ball.
            bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24,
                                                 radius=h / 2, location=loc)
            o = bpy.context.active_object
            o.name = name
            o.scale = (w / h, d / h * 0.98, 1.0)
            bpy.ops.object.transform_apply(scale=True)
            bpy.ops.object.shade_smooth()
            parts[name] = o

        elif name in ('skiL', 'skiR'):
            parts[name] = add_box(name, w, h, d, loc, bevel=0.006)

        elif name == 'torso':
            # Torso tapers shoulders -> hips, like the original cylinder did.
            bpy.ops.mesh.primitive_cone_add(
                vertices=48, radius1=w / 2, radius2=w / 2 * 0.68,
                depth=h, location=loc)
            o = bpy.context.active_object
            o.name = name
            o.scale = (1.0, d / w, 1.0)
            bpy.ops.object.transform_apply(scale=True)
            bpy.ops.object.shade_smooth()
            parts[name] = o

        else:
            # Limbs as capsules.
            parts[name] = add_capsule(name, radius=w / 2, height=h, location=loc)

    return parts


def build_armature(parts):
    """
    Bones named EXACTLY after the physics segments, so game.js can map its
    existing per-segment transforms straight onto them with no lookup table.
    """
    bpy.ops.object.armature_add(location=(0, 0, 0))
    arm = bpy.context.active_object
    arm.name = 'AthleteRig'
    bpy.ops.object.mode_set(mode='EDIT')

    eb = arm.data.edit_bones
    for b in list(eb):
        eb.remove(b)

    bones = {}
    for name, seg in SEGMENTS.items():
        loc = seg_origin(name)
        h = seg['h'] if name not in ('skiL', 'skiR') else seg['d']
        bone = eb.new(name)
        bone.head = (loc[0], loc[1], loc[2] - h / 2)
        bone.tail = (loc[0], loc[1], loc[2] + h / 2)
        bones[name] = bone

    # Parent the chain so the skeleton behaves like a body rather than a pile of
    # disconnected bones. Kept as a flat hierarchy off the torso to match how the
    # physics drives each segment independently.
    hierarchy = {
        'head': 'torso',
        'upperArmL': 'torso', 'upperArmR': 'torso',
        'lowerArmL': 'upperArmL', 'lowerArmR': 'upperArmR',
        'upperLegL': 'torso', 'upperLegR': 'torso',
        'lowerLegL': 'upperLegL', 'lowerLegR': 'upperLegR',
        'skiL': 'lowerLegL', 'skiR': 'lowerLegR',
    }
    for child, parent in hierarchy.items():
        if child in bones and parent in bones:
            bones[child].parent = bones[parent]
            bones[child].use_connect = False

    bpy.ops.object.mode_set(mode='OBJECT')
    return arm


def bind(parts, arm):
    """
    Bind each part to its own bone with a full-weight vertex group. Not smooth
    blending: the physics moves each segment as a RIGID body, so envelope
    weighting would fight the simulation rather than help it.
    """
    for name, obj in parts.items():
        vg = obj.vertex_groups.new(name=name)
        vg.add([v.index for v in obj.data.vertices], 1.0, 'REPLACE')
        mod = obj.modifiers.new('armature', 'ARMATURE')
        mod.object = arm
        obj.parent = arm


def main():
    clear_scene()
    parts = build_parts()
    arm = build_armature(parts)
    bind(parts, arm)

    out_path = OUT if os.path.isabs(OUT) else os.path.join(ROOT, OUT)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format='GLB',
        export_yup=True,               # Babylon is Y-up
        export_apply=True,
        export_skins=True,
        export_animations=False,       # the physics animates it, not clips
    )

    tris = sum(len(o.data.loop_triangles) for o in parts.values() if o.data)
    print(f'ATHLETE_EXPORTED path={out_path} parts={len(parts)} '
          f'bones={len(arm.data.bones)} tris~{tris}')


main()
