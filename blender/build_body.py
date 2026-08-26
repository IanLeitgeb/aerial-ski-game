"""
Build the athlete from a real human base mesh, rigged to the physics segments.

    ~/opt/blender-5.2.1-linux-x64/blender -b --factory-startup \
        --python blender/build_body.py -- --out assets/athlete_body.glb --res 2048

WHY THE METABALL BODY IS GONE
-----------------------------
The previous three athletes were separate solids, then capsules, then one
continuous metaball isosurface. The last of those was the closest and still read
as an alien, for a reason no amount of parameter tuning could reach: a metaball
body has no TOPOLOGY. It is a field, sampled. A shoulder is wherever two blobs
happen to overlap, so it is a bulge rather than a deltoid; there is no edge loop
at the elbow, so the elbow is a smooth tube; the arms do not attach to the torso,
they merge into it. Human silhouettes are read by exactly those features, and
none of them exist in an isosurface.

So the base is now a real human mesh: Blender Studio's CC0 Human Base Meshes
bundle, 10,582 vertices, 99.8% quads, already UV unwrapped, with proper edge
loops at every joint. blender/extract_base_mesh.py vendors the one body from the
50 MB bundle; blender/human_base_male.blend is the result.

FITTING IT TO A RIG THAT IS NOT ANATOMICAL
------------------------------------------
The game's body-model.json is a PHYSICS model — ten segments with masses and
inertias — and its segment centres are not where a human's joints are. Binding
the mesh directly to bones placed at those centres reproduces the original
problem: the "shoulder" lands mid-torso and the arms attach to the ribs.

The fix is to separate the two jobs the rig does:

  1. WEIGHTS need anatomically-correct bones, or the deformation is nonsense.
     Blender's Rigify ships a human metarig whose joint positions are real human
     proportions, so the shoulder, elbow, wrist, hip, knee and ankle are read off
     it and scaled to this mesh rather than guessed.

  2. THE BIND POSE needs to be the game's POSE_UNTUCKED, because that is the
     layout the physics drivers write to every frame.

So the rig is built anatomically, the mesh is bound to it, and THEN each bone is
posed onto its game segment and the pose is applied as the new rest pose. The
mesh reshapes to the game's proportions while keeping human topology and sane
weights.

PIPELINE
--------
  human_base_male.blend  (CC0, A-pose, anatomical)
    |
    +- align axes, soften anatomy, round the head into a helmet
    +- rig at ANATOMICAL joints (from the Rigify metarig, scaled)
    +- bind with heat-map weights
    +- pose each bone onto its game segment; apply as rest pose
    |
    +-- low     the result, UV'd and material-split, EXPORTED
    |
    +-- high    subdivided, displaced with suit detail, painted with vertex
                colours; never exported, exists only to be baked

  bake high -> low:  normal (tangent), ambient occlusion, albedo

REFERENCE
---------
Suit design matched to a World Cup aerials clip supplied by the author
(IMG_7841.MOV, a Canadian venue): white race suit, royal-blue stripe down the
full outside of each leg, powder-blue competition bib with a white number patch,
navy waist, dark gloves, dark helmet.

OUTPUT
------
assets/athlete_body.glb     skinned body + skis
assets/athlete_normal.png   tangent-space normals   (DATA: linear, not sRGB)
assets/athlete_ao.png       ambient occlusion       (DATA: linear, not sRGB)
assets/athlete_albedo.png   suit colours            (COLOUR: sRGB)
"""

import bpy
import json
import math
import os
import sys

from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.append(HERE)
import bakeutil                                              # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default):
    if name in argv:
        i = argv.index(name)
        if i + 1 < len(argv):
            return argv[i + 1]
    return default


OUT = arg('--out', 'assets/athlete_body.glb')
BASE = arg('--base', 'blender/human_base_male.blend')
RES = int(arg('--res', '2048'))
SAMPLES = int(arg('--samples', '128'))
DECIMATE = float(arg('--decimate', '0.85'))

ROOT = os.path.dirname(HERE)
MODEL = json.load(open(os.path.join(HERE, 'body-model.json')))
SEGMENTS = {s['name']: s for s in MODEL['SEGMENTS']}
BASE_Z = MODEL['BASE_Z']
POSE = MODEL['POSE_UNTUCKED']

BODY_SEGMENTS = [n for n in SEGMENTS if n not in ('skiL', 'skiR')]

# ── Suit palette, read off the reference footage ────────────────────────────
SUIT       = (0.86, 0.88, 0.91)      # white race suit, very slightly cool
STRIPE     = (0.09, 0.24, 0.62)      # royal blue, full length of the outer leg
BIB        = (0.55, 0.72, 0.88)      # powder-blue competition bib
BIB_NUMBER = (0.95, 0.96, 0.97)      # white number patch on the bib
WAIST      = (0.08, 0.11, 0.20)      # dark navy waistband under the bib
GLOVE      = (0.13, 0.14, 0.16)
HELMET     = (0.09, 0.10, 0.12)


def log(m):
    print(f'[body] {m}', flush=True)


def bl(name):
    """
    Segment centre in BLENDER axes.

    Determined empirically: the glTF exporter's export_yup conversion combines
    with Blender's own axes such that the round trip lands as Babylon (x, y, z) =
    Blender (y, z, x). So in Blender, X is fore/aft (chest faces +X), Y is
    left/right, and Z is up. The suit detail below depends on that mapping.
    """
    p = POSE.get(name, {})
    x_babylon = p.get('x', 0.0)
    y_babylon = p.get('y', 0.0)
    z_babylon = BASE_Z.get(name, 0.0) + p.get('dz', 0.0)
    return Vector((z_babylon, x_babylon, y_babylon))


def seg_ends(name):
    """The game's segment as a (head, tail) pair in Blender axes."""
    c = bl(name)
    half = SEGMENTS[name]['h'] / 2
    return c - Vector((0, 0, half)), c + Vector((0, 0, half))


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


# ── The base mesh ───────────────────────────────────────────────────────────

def load_base():
    """
    Bring in the CC0 human body and put it in the rig's axes.

    The bundle's figure stands with its arm span along X and its fore/aft along
    Y; bl() expects the opposite. Rotating 90 degrees about Z lines them up, and
    which way the chest ends up facing is checked afterwards from the mesh's own
    asymmetry rather than assumed — the base mesh's front is its -Y side, so a
    +90 rotation puts the chest on +X, which is what bl() wants.
    """
    path = BASE if os.path.isabs(BASE) else os.path.join(ROOT, BASE)
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.objects = [n for n in src.objects if n == 'humanBase'] or list(src.objects)
    obj = dst.objects[0]
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)

    obj.rotation_euler = (0, 0, math.radians(90))
    bpy.ops.object.transform_apply(rotation=True)

    me = obj.data
    zs = [v.co.z for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    xs = [v.co.x for v in me.vertices]
    log(f'base mesh: {len(me.vertices)} verts, {len(me.polygons)} faces, '
        f'height {max(zs) - min(zs):.3f}, span y={min(ys):+.3f}..{max(ys):+.3f}, '
        f'x={min(xs):+.3f}..{max(xs):+.3f}')
    return obj


def soften(obj):
    """
    Remove the detail a race suit would hide, and round the head into a helmet.

    Two different problems. Over the body, the base mesh carries anatomical
    detail — nipples, navel, genitals, knuckles — that a skin-tight lycra suit
    covers; a light smoothing pass keeps the form and drops the detail. Over the
    head the problem is bigger: an aerials athlete wears a close-fitting helmet,
    and a head with a nose, ears and eye sockets reads unmistakably as a FACE no
    matter what colour it is painted. Smoothing hard above the jaw turns it into
    the dome it needs to be.
    """
    me = obj.data
    zs = [v.co.z for v in me.vertices]
    top = max(zs)
    height = top - min(zs)
    # The jaw sits at about 0.87 of standing height on a human figure.
    jaw = min(zs) + height * 0.86

    grp = obj.vertex_groups.new(name='headMask')
    for v in me.vertices:
        if v.co.z >= jaw:
            # Ramp in over the last few centimetres so the neck does not step.
            t = min(1.0, (v.co.z - jaw) / (height * 0.03))
            grp.add([v.index], t, 'REPLACE')

    # THE BODY IS NOT SMOOTHED ANY MORE, and that was the single biggest
    # self-inflicted wound in this pipeline.
    #
    # It used to run a Laplacian smooth at factor 0.6 for 3 iterations over the
    # whole figure, to hide anatomical detail a race suit would cover. What it
    # actually did was erase the deltoid, the collarbone, the calf and the
    # quadriceps — every landmark that makes a body read as ATHLETIC — and
    # Laplacian smoothing shrinks volume while it does it. The result was a
    # figure whose suit looked loose and flowy, because underneath it there was
    # no longer a body with any shape for the suit to wrap.
    #
    # The detail it was hiding is a few millimetres deep on a 1.5 m figure and
    # sits below one texel of the baked normal map. It was never the problem.
    bpy.context.view_layer.objects.active = obj

    head = obj.modifiers.new('softenHead', 'SMOOTH')
    head.factor = 1.0
    head.iterations = 26
    head.vertex_group = 'headMask'
    bpy.ops.object.modifier_apply(modifier=head.name)
    log(f'softened: body pass + {head.iterations} head iterations above z={jaw:.3f}')


# ── Anatomical joints ───────────────────────────────────────────────────────

def anatomical_joints(obj):
    """
    Real human joint positions, scaled onto this mesh.

    Read off Rigify's human metarig rather than guessed from fractions of the
    figure's height. Guessing is what produced an athlete whose arms grew out of
    its ribcage: the game's segment centres are a mass model, not a skeleton, and
    a shoulder placed at the centre of the "upperArm" segment is nowhere near
    where a shoulder is.

    Returned in the rig's axes — X fore/aft, Y lateral, Z up — which is the
    metarig's own axes rotated the same 90 degrees as the mesh.
    """
    bpy.ops.preferences.addon_enable(module='rigify')
    bpy.ops.object.armature_human_metarig_add()
    meta = bpy.context.active_object

    bones = meta.data.bones
    zs = [b.head_local.z for b in bones] + [b.tail_local.z for b in bones]
    meta_h = max(zs) - min(zs)

    me = obj.data
    mesh_zs = [v.co.z for v in me.vertices]
    mesh_h = max(mesh_zs) - min(mesh_zs)
    s = mesh_h / meta_h

    def conv(v):
        # Metarig axes -> rig axes: the same +90 degrees about Z applied to the
        # mesh, i.e. (x, y, z) -> (-y, x, z), then scaled to this figure.
        return Vector((-v.y * s, v.x * s, v.z * s))

    # WHICH METARIG SIDE IS THE GAME'S "L"?
    #
    # The game's L and R are LABELS, not anatomy. In this frame — X forward, Z up
    # — the figure's left is +Y, but bl('upperArmL').y is NEGATIVE. So the game's
    # "L" segments live on the anatomical right, and taking Rigify's .L for them
    # builds every limb on one side of the body and then poses it across to the
    # other. Measured, upperArmL was created at y = +0.165 and dragged to
    # -0.205: the limbs crossed the midline, the legs splayed, and the feet
    # missed the skis entirely.
    #
    # Derived from the sign rather than hardcoded, so it stays correct if the
    # pose tables are ever mirrored.
    probe = conv(bones['upper_arm.L'].head_local)
    game_left_is_metarig_L = (probe.y < 0) == (bl('upperArmL').y < 0)
    sideL = '.L' if game_left_is_metarig_L else '.R'
    sideR = '.R' if game_left_is_metarig_L else '.L'
    log(f'game "L" maps to metarig {sideL} '
        f'(metarig .L converts to y={probe.y:+.3f}, game wants {bl("upperArmL").y:+.3f})')

    def head_of(name):
        return conv(bones[name].head_local)

    def tail_of(name):
        return conv(bones[name].tail_local)

    j = {
        'hipL': head_of('thigh' + sideL), 'kneeL': tail_of('thigh' + sideL),
        'ankleL': tail_of('shin' + sideL),
        'hipR': head_of('thigh' + sideR), 'kneeR': tail_of('thigh' + sideR),
        'ankleR': tail_of('shin' + sideR),
        'shoulderL': head_of('upper_arm' + sideL), 'elbowL': head_of('forearm' + sideL),
        'wristL': head_of('hand' + sideL),
        'shoulderR': head_of('upper_arm' + sideR), 'elbowR': head_of('forearm' + sideR),
        'wristR': head_of('hand' + sideR),
        'pelvis': head_of('spine'), 'neck': tail_of('spine.003'),
        'crown': Vector((0.0, 0.0, max(mesh_zs))),
    }
    bpy.data.objects.remove(meta, do_unlink=True)
    log(f'anatomical joints from metarig (scale {s:.4f}): '
        f'shoulder z={j["shoulderL"].z:.3f} hip z={j["hipL"].z:.3f} '
        f'knee z={j["kneeL"].z:.3f}')
    return j


# Which anatomical joints each physics segment runs between, as (HEAD, TAIL).
#
# The order is not free: the game places a bone's HEAD at the segment's BOTTOM
# and its TAIL at the top (bone.head = centre - half), and every driver in the
# game is built on that convention. For the arms that matches anatomy directly,
# because POSE_UNTUCKED holds them overhead — the shoulder really is the lower
# end of the upper arm. For the LEGS it is the other way round: the hip is the
# TOP of the thigh and the ankle is the BOTTOM of the shin.
#
# Listing the legs anatomically (hip, knee) built them upside down — hips down at
# the knees, ankles up at the knees, feet halfway up the shin. It did not look
# like an inverted bone, it looked like a lumpy leg.
ANATOMY = {
    'torso':     ('pelvis', 'neck'),
    'head':      ('neck', 'crown'),
    'upperArmL': ('shoulderL', 'elbowL'), 'lowerArmL': ('elbowL', 'wristL'),
    'upperArmR': ('shoulderR', 'elbowR'), 'lowerArmR': ('elbowR', 'wristR'),
    'upperLegL': ('kneeL', 'hipL'),       'lowerLegL': ('ankleL', 'kneeL'),
    'upperLegR': ('kneeR', 'hipR'),       'lowerLegR': ('ankleR', 'kneeR'),
}

HIERARCHY = {
    'head': 'torso',
    'upperArmL': 'torso', 'upperArmR': 'torso',
    'lowerArmL': 'upperArmL', 'lowerArmR': 'upperArmR',
    'upperLegL': 'torso', 'upperLegR': 'torso',
    'lowerLegL': 'upperLegL', 'lowerLegR': 'upperLegR',
}


def build_armature(joints):
    """Ten bones, named for the physics segments, placed at real joints."""
    bpy.ops.object.armature_add(location=(0, 0, 0))
    arm = bpy.context.active_object
    arm.name = 'AthleteRig'
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.data.edit_bones
    for b in list(eb):
        eb.remove(b)

    made = {}
    for name, (a, b) in ANATOMY.items():
        bone = eb.new(name)
        bone.head = joints[a]
        bone.tail = joints[b]
        made[name] = bone
    # THE SKELETON IS FLAT. No bone is parented to another, and that is the whole
    # point rather than an oversight.
    #
    # game.js drives each bone with Bone.linkTransformNode, and Babylon applies a
    # linked node's transform as the bone's LOCAL transform, relative to its
    # parent bone. But computePose returns ABSOLUTE positions — the driver meshes
    # are all siblings under one root — so every parented bone added its own
    # absolute position on top of its parent's. Measured in the running game:
    #
    #     upperLegL  node -0.455  ->  runs at -0.455   (parent torso at 0)
    #     lowerLegL  node -0.815  ->  runs at -1.270   (-0.455 + -0.815)
    #
    # The shin was displaced by a whole hip's worth, the boots hung 0.35 m below
    # the skis, and every limb was stretched between a correct joint and a
    # doubled one. With no parents, each bone simply takes its driver's transform
    # and lands exactly where the simulation says it is.
    #
    # Nothing else wants the hierarchy: the weights are per-bone, and the pose
    # transfer below sets each bone's matrix absolutely.
    for c in HIERARCHY:
        made[c].use_connect = False
        # Do NOT inherit the parent's scale.
        #
        # Fitting a human to the game's segment lengths scales every bone along
        # its own axis, and that scale is non-uniform by construction. A child
        # inheriting it gets sheared in the parent's frame rather than stretched
        # in its own: measured, the shins ended up at y = -0.278 against a target
        # of -0.075, nearly four times too far out, while their Z placement was
        # exactly right. On screen that reads as splayed legs missing the skis,
        # which points at the skis rather than at scale inheritance.
        made[c].inherit_scale = 'NONE'

    bpy.ops.object.mode_set(mode='OBJECT')
    log(f'armature: {len(made)} bones at anatomical joints')
    return arm


def skin(body, arm):
    """
    Bind with heat-map weights.

    This is where a real mesh pays off twice over. Automatic weights work by
    diffusing influence across the SURFACE, so they need topology that follows
    the anatomy — which the metaball body did not have, and which is why its
    elbows and shoulders deformed like putty.
    """
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    log('skinned with automatic (heat map) weights')


# ── Visual proportion correction ────────────────────────────────────────────
# How much smaller to draw the head than its physics segment.
#
# body-model.json is a MASS model and its head segment is 0.24 m against a
# 1.515 m standing figure — 6.3 head-heights, where a real adult is about 7.5.
# That single ratio is most of why the athlete reads as a cartoon: an oversized
# head is the strongest "not a real person" cue there is, and it survives any
# amount of work on the suit.
#
# Corrected in the MESH only. Changing the segment would change its mass
# distribution and therefore the rotational inertia the whole simulation is
# tuned around, and every golden trace with it. The head is the one segment
# where a visual-only change is clean: nothing is attached below it, so shrinking
# what is drawn moves no other joint. The arms (36% of height against a real 44%)
# and the torso (36% against 30%) are wrong in the same way and CANNOT be fixed
# this way — a shorter drawn arm would part company with the wrist driver the
# game positions. Those need the physics model changed and the traces rebaselined.
HEAD_SCALE = 0.84

# How hard the helmet and gloves are collapsed and shrunk relative to the suit.
#
# The decimate vertex group is FAR from linear in its weight — calibrated on this
# mesh, weight 1.0 retained 5% of the head's faces while weight 0.30 retained 89%
# of the suit's. Taking the obvious 1.0 crushed the helmet from 25% of the mesh to
# 2.2%, which is 133 faces for a whole head and visibly faceted. These two numbers
# land the head near 12% and the hands near 5%, leaving the suit ~83%.
#
# UV_SHRINK scales the head and hands during the unwrap only, so they claim
# UV_SHRINK^2 — about a third — of the atlas area they otherwise would.
GIRTH = 1.00
REDUCE_W = 0.60
BODY_KEEP = 0.30
UV_SHRINK = 0.55


def retune_proportions(body):
    """Shrink the drawn head about the neck, leaving the physics segment alone."""
    seg = SEGMENTS['head']
    c = bl('head')
    neck_z = c.z - seg['h'] / 2
    pivot = Vector((c.x, c.y, neck_z))
    n = 0
    for v in body.data.vertices:
        if segment_frame(v.co)[0] != 'head':
            continue
        v.co = pivot + (Vector(v.co) - pivot) * HEAD_SCALE
        n += 1
    stand = (bl('head').z + seg['h'] / 2) - (bl('lowerLegL').z - SEGMENTS['lowerLegL']['h'] / 2)
    log(f'head scaled {HEAD_SCALE:.2f} about the neck ({n} verts): '
        f'{stand / (seg["h"] * HEAD_SCALE):.2f} head-heights drawn, '
        f'{stand / seg["h"]:.2f} by the physics model')


def skeleton_offset(co):
    """
    Vector from the nearest point on the SKELETON to this point.

    Distance to the union of the segment axes, which is continuous everywhere —
    including across joints. That continuity is the whole reason for computing it
    this way: scaling each vertex's offset from its own segment's axis would jump
    wherever the nearest segment changes, tearing a seam around every hip and
    shoulder.
    """
    p = Vector(co)
    best, best_d = None, 1e9
    for name in BODY_SEGMENTS:
        c = bl(name)
        # SAME SIDE ONLY.
        #
        # The legs are 0.15 m apart and each is about 0.10 m across, so a vertex
        # on the INNER face of one thigh is nearly as close to the other thigh's
        # axis as to its own. Whichever won, scaling that vertex's offset pulled it
        # towards that axis — and for the shins, whose factor is 0.75, that dragged
        # both inner faces across the gap until the two legs merged into a single
        # column. It reads as one leg missing, not as a leg in the wrong place.
        if abs(c.y) > 0.02 and (c.y > 0) != (p.y > 0):
            continue
        half = SEGMENTS[name]['h'] / 2
        z = max(c.z - half, min(c.z + half, p.z))          # clamp onto the axis
        near = Vector((c.x, c.y, z))
        d = (p - near).length
        if d < best_d:
            best_d, best = d, near
    if best is None:
        return Vector((0, 0, 0)), 0.0
    return p - best, best_d


def build_report(body, tag):
    """
    Measure the figure against adult proportions.

    "Stringy" is a judgement; these are the numbers behind it. Shoulder breadth
    runs about 25% of standing height on an adult male and hip breadth about 19%,
    so a figure whose limbs and trunk fall well under that reads as a stick
    regardless of how good its topology is.
    """
    zs = [v.co.z for v in body.data.vertices]
    lo = bl('lowerLegL').z - SEGMENTS['lowerLegL']['h'] / 2
    hi = bl('head').z + SEGMENTS['head']['h'] / 2
    stand = hi - lo

    def width_at(z, band=0.03):
        ys = [v.co.y for v in body.data.vertices if abs(v.co.z - z) < band]
        return (max(ys) - min(ys)) if ys else 0.0

    shoulder = width_at(bl('torso').z + SEGMENTS['torso']['h'] / 2 * 0.72)
    chest = width_at(bl('torso').z + SEGMENTS['torso']['h'] / 2 * 0.30)
    hip = width_at(bl('torso').z - SEGMENTS['torso']['h'] / 2 * 0.80)
    thigh = width_at(bl('upperLegL').z)
    log(f'{tag}: standing {stand:.3f} m | shoulder {shoulder:.3f} '
        f'({shoulder / stand:.1%} of height, adult ~25%) | chest {chest:.3f} '
        f'({chest / stand:.1%}) | hip {hip:.3f} ({hip / stand:.1%}, adult ~19%) '
        f'| thighs {thigh:.3f}')
    return {'stand': stand, 'shoulder': shoulder, 'hip': hip}


def add_girth(body, stretch):
    """
    Give every limb back the width:length ratio it was built with.

    The figure read as "stringy" and the trunk measurements said it was not thin —
    hip breadth came out at 19.3% of standing height against an adult's 19%. The
    fault was not girth, it was that fitting a human to the game's segment lengths
    stretches each limb by a DIFFERENT amount and leaves every cross-section
    alone. Measured against the anatomical rig:

        upper arm  x1.22      thigh  x0.79
        forearm    x1.12      shin   x0.93
        torso      x1.00

    So the arms were pulled 22% longer at their original thickness — which is
    exactly what a stringy arm is — while the thighs were squashed 21% shorter and
    went stocky. The mismatch between the two is what reads as wrong; neither one
    alone would.

    Scaling each vertex's offset from the skeleton by its own segment's stretch
    restores the ratio: the arms thicken by the same factor they were lengthened,
    the thighs slim by the same factor they were shortened. No joint moves, no
    segment length changes, and the physics model is untouched.

    The factor is blended between segments by inverse-square distance rather than
    taken from the nearest one, so it varies smoothly across every joint instead
    of stepping at the hip and shoulder.
    """
    axes = {n: (bl(n), SEGMENTS[n]['h'] / 2) for n in BODY_SEGMENTS}
    n = 0
    for v in body.data.vertices:
        off, dist = skeleton_offset(v.co)
        if dist < 1e-6:
            continue
        p = Vector(v.co)
        num = den = 0.0
        for name, (c, half) in axes.items():
            z = max(c.z - half, min(c.z + half, p.z))
            d2 = (p - Vector((c.x, c.y, z))).length_squared + 1e-4
            w = 1.0 / (d2 * d2)
            # ONLY EVER SLIM, NEVER THICKEN.
            #
            # Matching girth to stretch in both directions was wrong, and it is
            # where the oversized biceps and shoulders came from: the upper arm is
            # posed 1.23x longer than the mesh's own anatomy, so it was thickened
            # 23% to match, and the shoulder next to it came along through the
            # blend. But a limb held at a longer reach does not get FATTER — its
            # girth is set by the body it belongs to. Stretching a limb and leaving
            # its cross-section alone is correct.
            #
            # Compression is the asymmetric case: the thigh is posed at 0.79 of
            # its anatomical length, and a thigh squashed to four-fifths while
            # keeping its full width really does read as stocky. So slimming is
            # applied and thickening is not.
            num += w * min(1.0, stretch.get(name, 1.0))
            den += w
        # Applied at HALF strength. The blended factor is a blunt instrument —
        # it moves every vertex along its own offset from a ten-segment stick
        # skeleton — and at full strength the step between the thigh's 0.79 and
        # the torso's 1.00 carved a visible notch out of the inner thigh. Half
        # keeps most of the de-stocking and stops the deformation from cutting
        # into the silhouette.
        f = 1.0 + ((num / den) - 1.0) * 0.5
        f *= GIRTH
        v.co = p + off * (f - 1.0)
        n += 1
    lo, hi = min(stretch.values()), max(stretch.values())
    log(f'girth matched to stretch ({lo:.2f}..{hi:.2f}) x global {GIRTH:.2f}, '
        f'{n} verts')


def seat_soles(body):
    """
    Put the soles on the skis, by measuring where they ended up.

    Both boots came out 0.337 m below the ski — symmetrically, with about a
    thousand vertices each below the topsheet, so not a stray weight but the whole
    boot region. Working out WHY from first principles means tracing a foot
    through an anatomical rest position, a bone whose head was lifted by the boot
    height, a non-uniform scale along that bone's own axis, and a girth field: four
    transforms, each of which I had already got wrong once.

    Measuring the result and correcting it is both shorter and self-correcting —
    if any of those transforms changes, this still lands the sole on the ski. The
    lift falls off from sole to ankle so the correction does not dislocate the leg
    above it.
    """
    ski_top = bl('skiL').z + SEGMENTS['skiL']['h'] / 2
    ankle_z = bl('lowerLegL').z - SEGMENTS['lowerLegL']['h'] / 2 + 0.10

    boot = [v for v in body.data.vertices if v.co.z < ankle_z]
    if not boot:
        log('seat soles: no boot vertices found')
        return
    sole = min(v.co.z for v in boot)
    lift = ski_top - sole
    if abs(lift) < 1e-4:
        log('seat soles: already seated')
        return
    span = max(1e-4, ankle_z - sole)
    for v in boot:
        t = min(1.0, max(0.0, (ankle_z - v.co.z) / span))
        v.co.z += lift * (t * t * (3 - 2 * t))          # smoothstep to the ankle
    log(f'seat soles: lifted {lift:+.3f} m so the sole meets the ski at '
        f'z={ski_top:.3f} ({len(boot)} boot verts)')


def rigid_boots(body, arm, joints):
    """
    Weight everything below the ankle rigidly to the shin.

    A ski boot does not flex, and heat-map weights do not know that: they blend
    influence smoothly across the ankle, so the foot bends and shears with the
    shin and the ski — which is parented to the same segment — appears to pivot
    against the sole. Pinning the foot to one bone at full weight makes the boot
    behave like the moulded shell it is.
    """
    ankle_z = min(joints['ankleL'].z, joints['ankleR'].z)
    fixed = 0
    for v in body.data.vertices:
        if v.co.z > ankle_z:
            continue
        side = 'L' if v.co.y < 0 else 'R'
        for g in list(v.groups):
            body.vertex_groups[g.group].remove([v.index])
        body.vertex_groups[f'lowerLeg{side}'].add([v.index], 1.0, 'REPLACE')
        fixed += 1
    log(f'boots made rigid: {fixed} vertices pinned to the shins')


def pose_onto_segments(body, arm, foot_lift):
    """
    Move every bone from its anatomical position onto its game segment, then make
    that the rest pose.

    This is the step that reconciles a human skeleton with a ten-box physics
    model. Each bone is posed so its head and tail land exactly on the segment's
    ends, which translates, rotates and stretches the limb; the mesh follows
    through the armature modifier. Applying the deformation to the mesh and the
    pose to the armature then makes the whole thing the new rest state, so the
    game receives a body already in POSE_UNTUCKED with human topology.

    Parents are posed before children: a child's target is absolute, so it has to
    be set after the parent has already moved or the parent's transform is
    applied on top of it.
    """
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='POSE')

    order = ['torso'] + [n for n in ANATOMY if n != 'torso']
    order.sort(key=lambda n: 0 if n == 'torso' else (1 if HIERARCHY.get(n) == 'torso' else 2))
    stretch = {}

    for name in order:
        pb = arm.pose.bones[name]
        head, tail = seg_ends(name)
        # Leave room for the boot. The shin segment ends exactly where the ski
        # begins, so a foot posed onto it hangs straight through the ski. Lifting
        # the ankle by the foot's own height puts the sole on the ski instead,
        # which is what a ski boot does, and costs the shin the same length the
        # boot occupies — as on a real leg.
        if name.startswith('lowerLeg'):
            head = head + Vector((0, 0, foot_lift))
        d = tail - head
        length = d.length
        rest_len = pb.bone.length
        if rest_len < 1e-6 or length < 1e-6:
            continue

        # PRESERVE THE REST ROLL.
        #
        # The obvious construction — rotation_difference from (0, 1, 0) to the
        # target direction — throws the roll away. It finds *a* rotation taking
        # the Y axis onto d, minimal in angle, with no regard for where the bone's
        # other two axes end up; the bone's own rest orientation never enters the
        # calculation. Every limb therefore came out twisted about its own axis by
        # an arbitrary amount, which is invisible on a smooth tube and glaring the
        # moment the limb ends in something with a direction: the feet pointed off
        # sideways and took the skis with them, and the hands splayed at random.
        #
        # Rotating the bone's REST basis onto the target keeps the roll it was
        # built with, so a foot that pointed forwards in the A-pose still points
        # forwards afterwards.
        rest_basis = pb.bone.matrix_local.to_3x3()
        rest_y = rest_basis.col[1].normalized()
        turn = rest_y.rotation_difference(d.normalized()).to_matrix()
        basis = (turn @ rest_basis).to_4x4()
        scale = Matrix.Scale(length / rest_len, 4, Vector((0, 1, 0)))
        pb.matrix = Matrix.Translation(head) @ basis @ scale
        stretch[name] = length / rest_len
        bpy.context.view_layer.update()

    # Did the BONES land where they were told? Separating this from where the
    # mesh landed is the only way to tell a rig fault from a weighting fault —
    # they look identical on screen and have nothing in common as fixes.
    worst = 0.0
    for name in ANATOMY:
        pb = arm.pose.bones[name]
        head, tail = seg_ends(name)
        if name.startswith('lowerLeg'):
            head = head + Vector((0, 0, foot_lift))
        err = (pb.matrix.translation - head).length
        worst = max(worst, err)
        if err > 0.005:
            log(f'  BONE {name:11s} landed {err:.3f} m from its target '
                f'({pb.matrix.translation.y:+.3f} vs {head.y:+.3f} lateral)')
    log(f'bone placement: worst error {worst * 1000:.1f} mm')

    bpy.ops.object.mode_set(mode='OBJECT')

    # Bake the deformation into the mesh, THEN make the pose the rest pose. Doing
    # only the second leaves the mesh in its old shape with a new rest pose, i.e.
    # exactly the deformation applied in reverse.
    bpy.context.view_layer.objects.active = body
    mod = next((m for m in body.modifiers if m.type == 'ARMATURE'), None)
    if mod:
        bpy.ops.object.modifier_copy(modifier=mod.name)
        dup = [m for m in body.modifiers if m.type == 'ARMATURE'][-1]
        bpy.ops.object.modifier_apply(modifier=dup.name)

    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.select_all(action='SELECT')
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')

    # After applying the pose as the rest pose, every bone must have a rest LENGTH
    # equal to the segment it was posed onto, and no residual pose scale. If a
    # scale survives here it does not show up in Blender at all — the mesh looks
    # right, because the modifier and the rest pose cancel — but the bind matrices
    # exported to glTF carry it, and the game skins with the scale applied a second
    # time. That is invisible in every Blender-side check and puts the boots a
    # third of a metre below the skis in the browser.
    # ── Make the BIND match the DRIVER ──────────────────────────────────────
    # A linked bone is placed at its driver node's transform, and the node sits at
    # the segment's CENTRE. The bind pose above puts each bone's head at the
    # segment's BOTTOM, so at runtime every bone jumps by half its own segment and
    # the mesh goes with it — measured, the soles floated 0.107 m over the skis.
    #
    # Moving the bones in EDIT mode does this without disturbing the mesh: the
    # deformation has already been applied to the vertices and the pose is
    # identity, so changing the rest changes only the bind matrices the exporter
    # writes. Bind then equals driver, and the figure renders exactly as built.
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    for name in ANATOMY:
        eb = arm.data.edit_bones[name]
        centre = bl(name)
        shift = centre - eb.head
        eb.head = eb.head + shift
        eb.tail = eb.tail + shift
    bpy.ops.object.mode_set(mode='OBJECT')
    log('bind pose shifted onto the driver nodes (segment centres)')

    bad = []
    for name in ANATOMY:
        pb = arm.pose.bones[name]
        want = SEGMENTS[name]['h']
        if name.startswith('lowerLeg'):
            want -= foot_lift
        got = pb.bone.length
        s = pb.scale
        if abs(got - want) > 0.005 or max(abs(s.x - 1), abs(s.y - 1), abs(s.z - 1)) > 1e-3:
            bad.append(f'{name}: rest length {got:.3f} vs {want:.3f}, '
                       f'pose scale ({s.x:.3f},{s.y:.3f},{s.z:.3f})')
    if bad:
        log('REST POSE DID NOT BAKE CLEANLY:')
        for b in bad:
            log('  ' + b)
    else:
        log('rest pose baked cleanly: every bone at its segment length, scale 1')

    me = body.data
    zs = [v.co.z for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    log(f'posed onto segments: height {max(zs) - min(zs):.3f}, '
        f'lateral span {max(ys) - min(ys):.3f}')
    log('stretch per segment: ' + ', '.join(
        f'{k} x{v:.2f}' for k, v in sorted(stretch.items())))

    # Where each segment's geometry ACTUALLY landed, against where the rig put the
    # bone. "The figure looks wrong" is not a diagnosis; this says which limb is
    # wrong and by how much, and it is the only way to tell a bad weight from a
    # bad bone from a bad target.
    gi = {g.name: g.index for g in body.vertex_groups}
    for name in ('upperLegL', 'upperLegR', 'lowerLegL', 'lowerLegR',
                 'upperArmL', 'upperArmR', 'torso'):
        if name not in gi:
            continue
        idx = gi[name]
        pts = [v.co for v in me.vertices
               if any(g.group == idx and g.weight > 0.5 for g in v.groups)]
        if not pts:
            log(f'  {name:11s} NO vertices weighted above 0.5 — this limb is '
                f'not driven by its own bone')
            continue
        head, tail = seg_ends(name)
        cy = sum(p.y for p in pts) / len(pts)
        log(f'  {name:11s} n={len(pts):5d} '
            f'z={min(p.z for p in pts):+.3f}..{max(p.z for p in pts):+.3f} '
            f'(target {head.z:+.3f}..{tail.z:+.3f}) '
            f'y_mean={cy:+.3f} (target {head.y:+.3f})')
    return stretch


# ── Suit detail ─────────────────────────────────────────────────────────────

def segment_frame(co):
    """
    Which body segment a point belongs to, and where on it.

    Returns (name, along, radial, out, front, local) where `along` is -1..1 up the
    segment, `radial` is distance from its axis, `out` is +1/-1 naming the OUTBOARD
    direction along the lateral axis, and `front` is +1 towards the chest.

    `out` is a property of the SEGMENT, not of the vertex: it is which way is
    away-from-the-midline for this limb. An earlier version computed instead which
    side the vertex was on and then used that as the outboard direction, which
    inverts it — so the blue stripe and the panel seam were both painted down the
    INSIDE of each leg, where they are invisible between the athlete's knees.
    """
    x, y, z = co
    best, best_d = None, 1e9
    for name in BODY_SEGMENTS:
        seg = SEGMENTS[name]
        c = bl(name)
        half = seg['h'] / 2
        r = (seg['w'] + seg['d']) / 4
        axial = max(0.0, abs(z - c.z) - half)
        radial = math.hypot(x - c.x, y - c.y)
        d = math.hypot(radial, axial) - r
        if d < best_d:
            best_d, best = d, (name, c, half, radial)
    name, c, half, radial = best
    along = max(-1.0, min(1.0, (z - c.z) / half)) if half > 0 else 0.0
    out = 1.0 if c.y >= 0 else -1.0
    front = 1.0 if (x - c.x) > 0 else -1.0
    return name, along, radial, out, front, (x - c.x, y - c.y, z - c.z)


def bib_mask(name, along, front, ly):
    """
    1 inside the competition bib, 0 outside, with a short ramp at the border.

    The bib in the reference covers the chest from just under the arms to the
    waist and wraps a little way round the ribs; it is a front garment, so the
    back of the torso is bare suit.
    """
    if name != 'torso' or front < 0:
        return 0.0
    if not (-0.68 < along < 0.52):
        return 0.0
    edge = min(along + 0.68, 0.52 - along) / 0.12
    wrap = 1.0 - max(0.0, (abs(ly) - 0.09) / 0.05)
    return max(0.0, min(1.0, edge)) * max(0.0, min(1.0, wrap))


def displace_suit(mesh):
    """
    Push the high-poly surface around to make it read as a suit.

    Every amplitude here is in METRES on a figure about 1.7 m tall, so they look
    absurdly small written down — a 1.5 mm seam, a 0.5 mm weave. That is the right
    order: baked into a 2048 map over a 2 m figure, one texel is about a
    millimetre, and relief any deeper than this stops looking like fabric and
    starts looking like armour plating.
    """
    verts = mesh.vertices
    normals = [v.normal.copy() for v in verts]
    moved = 0
    for i, v in enumerate(verts):
        x, y, z = v.co
        name, along, radial, out, front, local = segment_frame((x, y, z))
        lx, ly, lz = local
        d = 0.0

        is_head = name == 'head'
        is_leg = name.startswith(('upperLeg', 'lowerLeg'))
        is_arm = name.startswith(('upperArm', 'lowerArm'))

        if is_head:
            # Helmet: hard, smooth, with a shallow crown ridge and the goggle
            # strap. No fabric weave — a woven helmet reads as a knitted hat.
            d += 0.0012 * math.exp(-((ly / 0.03) ** 2))          # crown ridge
            d += 0.0022 * math.exp(-(((lz - 0.02) / 0.022) ** 2))  # goggle strap
        else:
            d += (bakeutil.fbm(x * 420, y * 420, z * 420, octaves=2) - 0.5) * 0.0011

            # Fabric bunches where a limb bends, so the wrinkles concentrate near
            # the ends of each segment and run around it rather than along it.
            joint = max(0.0, abs(along) - 0.55) / 0.45
            if joint > 0:
                band = bakeutil.fbm(z * 90, x * 26, y * 26, octaves=3)
                d -= joint * joint * (band - 0.45) * 0.010

            # Panel seams: a groove up the outboard side of every limb and one up
            # the spine. The single strongest "this is a garment" cue.
            azim = math.atan2(ly, lx)
            if is_leg or is_arm:
                outward = math.pi / 2 * out
                dphi = abs(math.atan2(math.sin(azim - outward), math.cos(azim - outward)))
                d -= 0.0016 * math.exp(-((dphi / 0.13) ** 2))
                if is_leg and dphi < 0.30:
                    # The blue stripe is a printed panel, very slightly proud of
                    # the fabric — enough for the light to catch its edge.
                    d += 0.0009 * (1.0 - (dphi / 0.30) ** 6)
            if name == 'torso':
                dphi = abs(math.atan2(math.sin(azim - math.pi), math.cos(azim - math.pi)))
                d -= 0.0014 * math.exp(-((dphi / 0.16) ** 2))

            # The bib is a separate garment over the suit, so it gets a real lip.
            d += 0.0026 * bib_mask(name, along, front, ly)

            # Waistband, glove cuffs, boot cuffs: hard steps, not soft blends.
            # The glove is at along = +1, not -1: POSE_UNTUCKED holds the arms UP,
            # so the hand is at the TOP of the forearm segment.
            if name == 'torso' and -0.95 < along < -0.72:
                d += 0.0016
            if name.startswith('lowerArm') and along > 0.80:
                d += 0.0022
            if name.startswith('lowerLeg') and along < -0.74:
                d += 0.0030

        if d:
            v.co = (x + normals[i].x * d, y + normals[i].y * d, z + normals[i].z * d)
            moved += 1
    log(f'suit displacement applied to {moved}/{len(verts)} high-poly verts')


def paint_suit(mesh):
    """
    Vertex colours for the suit design, baked to the albedo map afterwards.

    Painting in 3D and baking is far more robust than drawing into UV space: the
    unwrap can change without any of this moving, and a region defined by "the
    outboard side of the leg" cannot land on the wrong island.
    """
    attr = mesh.color_attributes.new(name='suit', type='FLOAT_COLOR', domain='POINT')
    counts = {}
    for i, v in enumerate(mesh.vertices):
        x, y, z = v.co
        name, along, radial, out, front, local = segment_frame((x, y, z))
        lx, ly, lz = local
        col, tag = SUIT, 'suit'

        if name == 'head':
            col, tag = HELMET, 'helmet'
        elif name.startswith('lowerArm') and along > 0.78:
            col, tag = GLOVE, 'glove'
        elif name == 'torso' and -0.95 < along < -0.70:
            col, tag = WAIST, 'waist'
        elif name.startswith(('upperLeg', 'lowerLeg')):
            azim = math.atan2(ly, lx)
            outward = math.pi / 2 * out
            dphi = abs(math.atan2(math.sin(azim - outward), math.cos(azim - outward)))
            # Narrowed from 0.38: at that width the stripe wrapped most of the
            # way round the shin and the leg read as blue with a white edge
            # rather than white with a blue stripe.
            if dphi < 0.26:
                col, tag = STRIPE, 'stripe'

        if bib_mask(name, along, front, ly) > 0.5:
            # A plain block rather than a legible numeral: at any distance this
            # figure is ever shown, a white patch and a white "15" are the same
            # number of pixels, and a drawn digit would be the one detail that
            # looks obviously synthetic up close.
            if -0.34 < along < 0.06 and abs(ly) < 0.062:
                col, tag = BIB_NUMBER, 'number'
            else:
                col, tag = BIB, 'bib'

        attr.data[i].color = (col[0], col[1], col[2], 1.0)
        counts[tag] = counts.get(tag, 0) + 1
    log(f'suit painted: {counts}')

    # Every region of the design must have landed somewhere. A region whose
    # condition never fires produces no error and no warning — the bake simply
    # comes out without it, which is indistinguishable from a design that never
    # included it. That is exactly how the gloves went missing.
    missing = [t for t in ('suit', 'helmet', 'waist', 'bib', 'number',
                           'stripe', 'glove') if counts.get(t, 0) == 0]
    if missing:
        raise SystemExit(
            f'[body] these suit regions matched no vertices: {missing}. Their '
            f'conditions are wrong for the reference pose, and the bake would '
            f'silently omit them.')
    return counts


# ── Low / high poly ─────────────────────────────────────────────────────────

def region_of(co):
    """'head', 'hand' or 'body' — the three budgets that get different shares."""
    name, along, radial, out, front, local = segment_frame(co)
    if name == 'head':
        return 'head'
    if name.startswith('lowerArm') and along > 0.78:
        return 'hand'
    return 'body'


def region_shares(body):
    """What fraction of the faces each region holds."""
    counts = {'head': 0, 'hand': 0, 'body': 0}
    vs = body.data.vertices
    for poly in body.data.polygons:
        c = Vector((0, 0, 0))
        for vi in poly.vertices:
            c = c + vs[vi].co
        counts[region_of(c / len(poly.vertices))] += 1
    total = max(1, sum(counts.values()))
    return {k: v / total for k, v in counts.items()}, counts


def finish_lowpoly(body):
    """
    Decimate, unwrap and split the helmet into its own material slot — spending
    both budgets on the SUIT rather than on the head and hands.

    A human base mesh puts its topology where a human needs it: the face and the
    knuckles. This athlete wears a helmet and gloves, so those are precisely the
    two regions with the least detail to carry, and they were taking ~40% of the
    triangles and a matching share of the texture atlas. The suit — where the
    seams, the bib and the leg stripe actually live — got what was left.

    Two independent corrections, because triangles and texels are allocated by
    different mechanisms:
      * DECIMATION is steered by a vertex group, so the helmet and gloves collapse
        harder than the suit.
      * THE UNWRAP is steered by temporarily shrinking those regions in 3D.
        smart_project allocates island area from world area, so a head scaled down
        before unwrapping claims proportionally fewer texels; the geometry is put
        straight back afterwards and only the UVs keep the change.
    """
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    body.name = 'athleteBody'

    before, _ = region_shares(body)
    log(f'faces before: head {before["head"]:.1%}, hand {before["hand"]:.1%}, '
        f'suit {before["body"]:.1%}')

    if DECIMATE < 0.999:
        # Weight 1 where the collapse should bite hardest. The suit keeps a floor
        # so it is still reduced, just far less.
        grp = body.vertex_groups.new(name='reduce')
        for v in body.data.vertices:
            r = region_of(v.co)
            grp.add([v.index], REDUCE_W if r in ('head', 'hand') else BODY_KEEP, 'REPLACE')
        dec = body.modifiers.new('decimate', 'DECIMATE')
        dec.ratio = DECIMATE
        dec.vertex_group = 'reduce'
        dec.vertex_group_factor = 1.0
        bpy.ops.object.modifier_apply(modifier=dec.name)
    bpy.ops.object.shade_smooth()

    after, counts = region_shares(body)
    log(f'faces after:  head {after["head"]:.1%}, hand {after["hand"]:.1%}, '
        f'suit {after["body"]:.1%}  ({counts})')

    # UNWRAP FRESH, into 0-1.
    #
    # The base mesh arrives already unwrapped, and the temptation is to keep that
    # layout — it is a proper human one with the seams where an artist put them.
    # But it is spread across UDIM tiles: measured in the running game, its UVs
    # spanned 11.9 rather than 1. A bake writes into a single 0-1 image, so all
    # but one tile's worth of the body sampled outside the atlas and wrapped onto
    # whatever was there, which rendered as dark blotches scattered over the suit.
    # Decimation has already discarded the artist topology those seams were placed
    # for, so there is little left to preserve.
    # Shrink the head and hands in 3D for the duration of the projection only.
    # smart_project sizes each island from the world area of the faces it covers,
    # so this is the lever that decides how many texels a region gets. Scaling by
    # UV_SHRINK claims UV_SHRINK^2 of the area it otherwise would.
    saved = [v.co.copy() for v in body.data.vertices]
    pivots, groups = {}, {'head': [], 'hand': []}
    for i, v in enumerate(body.data.vertices):
        r = region_of(v.co)
        if r != 'body':
            groups[r].append(i)
    for r, idxs in groups.items():
        if not idxs:
            continue
        p = Vector((0, 0, 0))
        for i in idxs:
            p = p + body.data.vertices[i].co
        pivots[r] = p / len(idxs)
        for i in idxs:
            v = body.data.vertices[i]
            v.co = pivots[r] + (v.co - pivots[r]) * UV_SHRINK

    bpy.context.scene.tool_settings.use_uv_select_sync = True
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66.0), island_margin=0.0,
                             area_weight=1.0, correct_aspect=True,
                             scale_to_bounds=False)
    bpy.ops.uv.pack_islands(rotate=True, scale=True, merge_overlap=False,
                            margin_method='FRACTION', margin=0.004,
                            shape_method='AABB')
    bpy.ops.object.mode_set(mode='OBJECT')

    # Put the geometry back. Only the UVs keep the reweighting.
    for i, co in enumerate(saved):
        body.data.vertices[i].co = co
    # The share of the ATLAS each region ended up with. This is the number the
    # unwrap weighting exists to move, and it is not the same as the face share —
    # texels are allocated by island area, triangles by the decimator.
    uvl = body.data.uv_layers.active.data
    area = {'head': 0.0, 'hand': 0.0, 'body': 0.0}
    vs = body.data.vertices
    for poly in body.data.polygons:
        uvs = [uvl[i].uv for i in poly.loop_indices]
        a = 0.0
        for i in range(len(uvs)):
            x1, y1 = uvs[i]
            x2, y2 = uvs[(i + 1) % len(uvs)]
            a += x1 * y2 - x2 * y1
        c = Vector((0, 0, 0))
        for vi in poly.vertices:
            c = c + vs[vi].co
        area[region_of(c / len(poly.vertices))] += abs(a) * 0.5
    total = max(1e-9, sum(area.values()))
    log(f'unwrap weighted (head/hands x{UV_SHRINK:.2f}): atlas share — '
        f'head {area["head"] / total:.1%}, hand {area["hand"] / total:.1%}, '
        f'suit {area["body"] / total:.1%}')

    uvs = body.data.uv_layers.active.data
    us = [d.uv[0] for d in uvs]
    vs = [d.uv[1] for d in uvs]
    span = max(max(us) - min(us), max(vs) - min(vs))
    log(f'unwrapped: uv span {span:.3f}, '
        f'u={min(us):+.3f}..{max(us):+.3f} v={min(vs):+.3f}..{max(vs):+.3f}')
    if span > 1.02 or min(us) < -0.02 or min(vs) < -0.02:
        raise SystemExit(
            f'[body] UVs are outside 0-1 (span {span:.3f}). Everything beyond the '
            f'first tile would sample outside the baked atlas.')

    suit = bpy.data.materials.new('suitMat')
    helmet = bpy.data.materials.new('helmetMat')
    body.data.materials.clear()
    body.data.materials.append(suit)
    body.data.materials.append(helmet)

    # Two material slots — suit (0) and helmet (1) — so Babylon receives two
    # submeshes and can give the helmet its own roughness. They SHARE the baked
    # maps and the single UV layout; the split is about shading, not texturing.
    #
    # Assigned by SEGMENT, not by height. A bare "above the neckline" threshold
    # works on a standing figure and fails completely here: POSE_UNTUCKED holds
    # the arms overhead, so the forearms and gloves sit well above the neck and
    # 47% of the mesh came back classified as helmet. segment_frame already knows
    # which segment a point belongs to, so ask it.
    n_head = 0
    for poly in body.data.polygons:
        cx = sum(body.data.vertices[v].co.x for v in poly.vertices) / len(poly.vertices)
        cy = sum(body.data.vertices[v].co.y for v in poly.vertices) / len(poly.vertices)
        cz = sum(body.data.vertices[v].co.z for v in poly.vertices) / len(poly.vertices)
        if segment_frame((cx, cy, cz))[0] == 'head':
            poly.material_index = 1
            n_head += 1
    log(f'low-poly: {len(body.data.vertices)} verts, {len(body.data.polygons)} '
        f'faces, {n_head} helmet faces ({n_head / max(1, len(body.data.polygons)):.0%})')
    return body


def make_highpoly(low):
    """
    The detail source: subdivided from the SAME mesh, then displaced and painted.

    Sharing the base matters. A high-poly built independently would not sit on the
    low-poly surface, and every baked normal would carry that mismatch as a
    smeared, wobbling error across the whole body.
    """
    high = low.copy()
    high.data = low.data.copy()
    high.name = 'athleteHigh'
    bpy.context.collection.objects.link(high)
    # It must not be deformed by the rig while it is being baked from.
    for m in list(high.modifiers):
        high.modifiers.remove(m)

    bpy.ops.object.select_all(action='DESELECT')
    high.select_set(True)
    bpy.context.view_layer.objects.active = high

    sub = high.modifiers.new('subsurf', 'SUBSURF')
    # SIMPLE, not Catmull-Clark. Catmull-Clark SMOOTHS as it subdivides, so the
    # high-poly ends up a different SHAPE from the low-poly — and a normal bake
    # records exactly the difference between the two. On a decimated human that
    # difference is centimetres of whole-body reshaping, which swamps the
    # millimetre suit detail this bake exists for and renders as grey mottling
    # crawling over the figure. (It went unnoticed on the metaball body, which was
    # already smooth enough that Catmull-Clark barely moved it.)
    #
    # Simple subdivision adds vertices without moving the surface, so the only
    # difference left between high and low is the displacement applied below —
    # which is precisely what should end up in the map.
    sub.subdivision_type = 'SIMPLE'
    sub.levels = sub.render_levels = 2
    bpy.ops.object.modifier_apply(modifier=sub.name)
    log(f'high-poly: {len(high.data.vertices)} verts before displacement')

    displace_suit(high.data)
    paint_suit(high.data)

    high.data.materials.clear()
    mat = bpy.data.materials.new('highSuit')
    mat.use_nodes = True
    tree = mat.node_tree
    bsdf = tree.nodes.get('Principled BSDF')
    ca = tree.nodes.new('ShaderNodeVertexColor')
    ca.layer_name = 'suit'
    tree.links.new(ca.outputs['Color'], bsdf.inputs['Base Color'])
    if 'Roughness' in bsdf.inputs:
        bsdf.inputs['Roughness'].default_value = 0.72
    high.data.materials.append(mat)
    return high


# ── Baking ──────────────────────────────────────────────────────────────────

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
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True
    log(f'cycles device: {used}')
    return used


def target_image(low, img):
    """Point every LOW-POLY material at `img`, replacing any previous target."""
    for slot in low.material_slots:
        mat = slot.material
        if not mat:
            continue
        if not mat.use_nodes:
            mat.use_nodes = True
        tree = mat.node_tree
        for n in [n for n in tree.nodes if n.bl_idname == 'ShaderNodeTexImage']:
            tree.nodes.remove(n)
        node = tree.nodes.new('ShaderNodeTexImage')
        node.image = img
        node.select = True
        tree.nodes.active = node


def bake_maps(low, high, out_dir):
    """
    Transfer the high-poly's detail onto the low-poly's UVs.

    selected_to_active with a cage: rays are fired from just outside the low-poly
    surface, hit the high-poly, and record what they found. cage_extrusion has to
    clear the deepest displacement — too small and the rays start inside the
    high-poly and the map fills with black speckle.
    """
    bake = bpy.context.scene.render.bake
    bake.use_selected_to_active = True
    bake.cage_extrusion = 0.02
    bake.margin = 16
    # use_clear wipes the target image to black before baking, which would undo
    # the background fill below — the whole point of which is that the atlas must
    # NOT be black where nothing is baked.
    bake.use_clear = False

    def run(kind, name, srgb, fill, setup=None):
        # FILL THE BACKGROUND FIRST, and not with black.
        #
        # Unwrapping a decimated human produces a lot of small islands, and only
        # about 40% of the atlas ends up covered. A bake leaves the rest at the
        # image's initial colour, which defaults to black — and then bilinear
        # filtering and every mip level pull that black in across each island's
        # edge. On the figure it read as dark blotches scattered over the suit, as
        # if the texture were camouflage. Starting from a neutral value (suit
        # colour, white occlusion, flat normal) makes the bleed invisible, because
        # what bleeds in is what should be there anyway.
        img = bpy.data.images.new(name, width=RES, height=RES, float_buffer=True)
        # Written straight into the pixel buffer rather than through
        # generated_color, which puts the value through colour management: a
        # normal-map fill of (0.5, 0.5, 1.0) came back as (0.21, 0.21, 1.0), i.e.
        # a background normal tilted hard to one side instead of flat. foreach_set
        # writes the numbers as given.
        bakeutil.fill_image(img, fill)
        target_image(low, img)
        bpy.ops.object.select_all(action='DESELECT')
        high.select_set(True)
        low.select_set(True)
        bpy.context.view_layer.objects.active = low      # active = the TARGET
        if setup:
            setup(bake)
        log(f'baking {name} {RES}x{RES} at {SAMPLES} samples...')
        bpy.ops.object.bake(type=kind)
        return bakeutil.save_bake(img, os.path.join(out_dir, f'{name}.png'),
                                  srgb=srgb, log=log)

    stats = {}
    bpy.context.scene.render.bake.normal_space = 'TANGENT'
    # A tangent-space normal pointing straight out is (0.5, 0.5, 1.0); occlusion
    # with nothing occluding is 1.0; unpainted suit is the suit's own colour.
    stats['normal'] = run('NORMAL', 'athlete_normal', srgb=False,
                          fill=(0.5, 0.5, 1.0, 1.0))
    # AO IS LIMITED TO A SHORT DISTANCE, on purpose.
    #
    # An unlimited AO bake sees the whole body, and the body is baked in
    # POSE_UNTUCKED with its arms overhead — so it records the shadow the arms
    # cast into the shoulders and the gap between them, and freezes it into the
    # texture. At runtime the arms MOVE, and that occlusion stays behind on the
    # chest wherever the athlete puts them. It renders as grey blotching that
    # follows the body around.
    #
    # What is worth baking is only what the low-poly cannot express: the seams,
    # the fold at a joint, the lip around the bib. Those are all within a few
    # centimetres. The pose-dependent part is SSAO2's job, and SSAO2 is already
    # in the pipeline — it is computed per frame from the actual pose, which is
    # exactly what a baked map cannot be.
    if bpy.context.scene.world is None:
        bpy.context.scene.world = bpy.data.worlds.new('bakeWorld')
    bpy.context.scene.world.light_settings.distance = 0.04
    stats['ao'] = run('AO', 'athlete_ao', srgb=False, fill=(1.0, 1.0, 1.0, 1.0))

    def albedo_only(b):
        b.use_pass_direct = False
        b.use_pass_indirect = False
        b.use_pass_color = True
    stats['albedo'] = run('DIFFUSE', 'athlete_albedo', srgb=True,
                          fill=(SUIT[0], SUIT[1], SUIT[2], 1.0), setup=albedo_only)
    return stats


def add_equipment():
    """Skis stay rigid, separate objects."""
    made = []
    for name in ('skiL', 'skiR'):
        seg = SEGMENTS[name]
        c = bl(name)
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=c)
        o = bpy.context.active_object
        o.name = name
        # (w, d, h) is correct and was briefly "fixed" to something else. bl()
        # maps POSITIONS through the exporter's yup conversion, but a scale is
        # local: Blender Y becomes Babylon Z, so the ski's 1.20 m depth lands on
        # the fall line. The apparent bug was a world-space bounding box being
        # read while the skier was yawed — see tests/drive/rig.spec.js.
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
    body = load_base()
    soften(body)
    joints = anatomical_joints(body)
    arm = build_armature(joints)
    skin(body, arm)
    rigid_boots(body, arm, joints)

    # How tall the boot is: ankle joint down to the sole, expressed in the shin's
    # own scale so it survives the stretch onto the game's segment length.
    sole = min(v.co.z for v in body.data.vertices)
    rest_shin = (joints['kneeL'] - joints['ankleL']).length
    foot_lift = (joints['ankleL'].z - sole) * (SEGMENTS['lowerLegL']['h'] / rest_shin)
    log(f'boot height {foot_lift:.3f} m (ankle {joints["ankleL"].z:.3f}, sole {sole:.3f})')

    stretch = pose_onto_segments(body, arm, foot_lift)
    retune_proportions(body)
    build_report(body, 'before girth')
    add_girth(body, stretch)
    seat_soles(body)
    build_report(body, 'after girth ')
    low = finish_lowpoly(body)
    high = make_highpoly(low)

    device = configure_cycles()
    out_dir = os.path.join(ROOT, 'assets')
    os.makedirs(out_dir, exist_ok=True)
    stats = bake_maps(low, high, out_dir)

    # The high-poly has done its job. Leaving it in would export a second body.
    bpy.data.objects.remove(high, do_unlink=True)

    equip = add_equipment()

    with open(os.path.join(out_dir, 'athlete_maps.json'), 'w') as f:
        json.dump({
            'normal': 'assets/athlete_normal.png',
            'ao': 'assets/athlete_ao.png',
            'albedo': 'assets/athlete_albedo.png',
            'res': RES, 'stats': stats,
        }, f, indent=1)

    out = OUT if os.path.isabs(OUT) else os.path.join(ROOT, OUT)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    low.select_set(True)
    arm.select_set(True)
    for o in equip:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=out, export_format='GLB', use_selection=True,
        export_yup=True, export_apply=False,   # apply=False keeps the armature
        export_skins=True, export_animations=False,
    )
    log(f'BODY_EXPORTED device={device} path={out} verts={len(low.data.vertices)} '
        f'bones={len(arm.data.bones)} equipment={len(equip)} res={RES}')


main()
