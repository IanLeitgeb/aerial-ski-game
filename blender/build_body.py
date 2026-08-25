"""
Build the athlete: a low-poly skinned body carrying baked high-poly detail.

    ~/opt/blender-5.2.1-linux-x64/blender -b --factory-startup \
        --python blender/build_body.py -- --out assets/athlete_body.glb --res 2048

WHY THIS EXISTS
---------------
The athlete was separate solids, then capsules, then one continuous metaball
body. Each step helped and none of them fixed the real problem: the figure had no
SURFACE. A person in a race suit reads as a person because of seams, panels,
fabric creasing at the joints, a stripe down the leg, a bib over the chest — and
a smooth blended isosurface has none of that, so it stays a mannequin no matter
how good the lighting gets.

Adding that detail as geometry is not an option: it would be hundreds of
thousands of triangles for a figure that is often sixty pixels tall. The standard
answer is to build it at high resolution, BAKE it into maps, and put the maps on
a low-poly mesh. That is what this script does, and it is the reason the mesh is
built in Blender at all rather than in game.js.

REFERENCE
---------
Matched to a World Cup aerials clip supplied by the author (IMG_7841.MOV, a
Canadian venue). What that footage actually shows, and what the suit design below
reproduces:

  * a white / pale-grey race suit, slim and tight — the silhouette is long and
    thin, never bulky
  * a royal-blue stripe running the FULL outside of each leg, hip to ankle
  * a powder-blue competition bib over the torso, with a white number patch
  * dark navy at the waist, dark gloves, dark helmet
  * short aerial skis, pale topsheet

PIPELINE
--------
  base      metaballs grown along the physics segments  (proportions come from
            body-model.json, so the body cannot drift from the simulation)
    |
    +-- low     decimated, UV unwrapped, skinned, EXPORTED
    |
    +-- high    subdivided, then displaced with suit detail and painted with
                vertex colours; never exported, exists only to be baked

  bake high -> low:  normal (tangent), ambient occlusion, albedo

OUTPUT
------
assets/athlete_body.glb     low-poly skinned body + skis
assets/athlete_normal.png   tangent-space normals   (DATA: linear, not sRGB)
assets/athlete_ao.png       ambient occlusion       (DATA: linear, not sRGB)
assets/athlete_albedo.png   suit colours            (COLOUR: sRGB)

HONEST LIMITATION
-----------------
This bakes SUIT detail onto procedurally-grown proportions. It gives fabric,
seams, panels, the stripe and the bib — the things that actually read at game
distance and in a close render. It does not give anatomy or a face: no procedure
sculpts a convincing human, and pretending otherwise would just produce a
lumpier mannequin. If the figure ever needs to hold up in a portrait-scale
render, the base has to come from a real sculpt; everything downstream of `base`
here would still apply unchanged.

BUILT IN THE REFERENCE POSE
---------------------------
The body is built in POSE_UNTUCKED. A skinned mesh has to be bound in a real
pose — the bind pose is what the skinning weights are relative to — and the game
then deforms it by driving the bones.
"""

import bpy
import json
import math
import os
import sys

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
RES = int(arg('--res', '2048'))
SAMPLES = int(arg('--samples', '128'))

ROOT = os.path.dirname(HERE)
MODEL = json.load(open(os.path.join(HERE, 'body-model.json')))
SEGMENTS = {s['name']: s for s in MODEL['SEGMENTS']}
BASE_Z = MODEL['BASE_Z']
POSE = MODEL['POSE_UNTUCKED']

# Skis are rigid equipment, not body. They stay separate objects.
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

    Determined empirically, not from first principles: the glTF exporter's
    export_yup conversion combines with Blender's own axes such that the round
    trip lands as Babylon (x, y, z) = Blender (y, z, x). Measured by building the
    body, printing the Blender-side bounding box, and comparing it to what Babylon
    reported — the first version pre-swapped in the same direction the exporter
    already does, producing a figure 0.18 wide instead of 0.51 (the arms ended up
    along the depth axis, so it read as a vertical column).

    So, in Blender: X is fore/aft (chest faces +X), Y is left/right, Z is up.
    The suit detail below depends on that mapping.
    """
    p = POSE.get(name, {})
    x_babylon = p.get('x', 0.0)
    y_babylon = p.get('y', 0.0)
    z_babylon = BASE_Z.get(name, 0.0) + p.get('dz', 0.0)
    return (z_babylon, x_babylon, y_babylon)


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


# ── Base body ───────────────────────────────────────────────────────────────

def build_base():
    """
    Grow the torso, head and limbs as one blended isosurface.

    Metaballs rather than a hand-modelled humanoid: they blend into one continuous
    surface, so shoulders, hips, elbows and knees fuse organically instead of
    butting together, and the placement is driven by body-model.json so it cannot
    drift from the physics.
    """
    mball = bpy.data.metaballs.new('AthleteBody')
    # Lower = finer isosurface. 0.035 gave ~400 verts for a whole body, which
    # reads blocky; 0.02 lands nearer 3k after decimation, which a browser skins
    # comfortably — and gives the high-poly something to subdivide from.
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

        (Blender's ELLIPSOID element type was tried first, to control depth
        separately; its size_x/y/z are expansion BEYOND the radius rather than the
        radius itself, which produced a 58-vertex speck. Spheres with honest radii
        are the simpler correct answer, since these segments are close to round
        anyway.)
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

    strand('torso', 11, radius_scale=1.00, stiffness=2.0)
    # A slightly smaller head radius keeps the helmet from swallowing the
    # shoulders.
    strand('head', 5, radius_scale=1.10, stiffness=2.4)

    for side in ('L', 'R'):
        strand(f'upperArm{side}', 11, radius_scale=1.00, stiffness=1.9)
        strand(f'lowerArm{side}', 11, radius_scale=0.92, stiffness=1.9)
        strand(f'upperLeg{side}', 11, radius_scale=0.66, stiffness=1.5)
        strand(f'lowerLeg{side}', 11, radius_scale=0.62, stiffness=1.5)

    log(f'{len(mball.elements)} metaball elements placed')

    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target='MESH')
    base = bpy.context.active_object
    base.name = 'athleteBase'
    log(f'base isosurface: {len(base.data.vertices)} verts')
    return base


# ── Suit detail ─────────────────────────────────────────────────────────────

def segment_frame(co):
    """
    Which body segment a point belongs to, and where on it.

    Returns (name, along, radial, out, front, local) where `along` is -1..1 up the
    segment, `radial` is distance from its axis, `out` is +1/-1 naming the OUTBOARD
    direction along the lateral axis, and `front` is +1 towards the chest.
    Everything the suit design needs is expressed in these terms rather than in raw
    coordinates, so the detail follows the body instead of being projected onto it
    from outside.

    `out` is a property of the SEGMENT, not of the vertex: it is which way is
    away-from-the-midline for this limb. The first version computed instead which
    side the vertex was on and then used that as the outboard direction, which
    inverts it — so the blue stripe and the panel seam were both painted down the
    INSIDE of each leg, where they are invisible between the athlete's knees.
    Nothing failed; the figure just came out plain white.
    """
    x, y, z = co
    best, best_d = None, 1e9
    for name in BODY_SEGMENTS:
        seg = SEGMENTS[name]
        cx, cy, cz = bl(name)
        half = seg['h'] / 2
        r = (seg['w'] + seg['d']) / 4
        dz = z - cz
        axial = max(0.0, abs(dz) - half)
        radial = math.hypot(x - cx, y - cy)
        d = math.hypot(radial, axial) - r
        if d < best_d:
            best_d = d
            best = (name, cx, cy, cz, half, radial)
    name, cx, cy, cz, half, radial = best
    along = max(-1.0, min(1.0, (z - cz) / half)) if half > 0 else 0.0
    # Outboard is away from the body's midline, which is Blender Y — so it is
    # simply the sign of the segment's own lateral offset.
    out = 1.0 if cy >= 0 else -1.0
    front = 1.0 if (x - cx) > 0 else -1.0
    return name, along, radial, out, front, (x - cx, y - cy, z - cz)


def displace_suit(mesh):
    """
    Push the high-poly surface around to make it read as a suit.

    Every amplitude here is in METRES on a figure about 1.8 m tall, so they look
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
            strap = math.exp(-(((lz - 0.02) / 0.022) ** 2))
            d += 0.0022 * strap                                   # goggle strap
        else:
            # Fabric weave: fine, isotropic, everywhere on the suit.
            d += (bakeutil.fbm(x * 420, y * 420, z * 420, octaves=2) - 0.5) * 0.0011

            # Creasing at the joints. Fabric bunches where a limb bends, so the
            # wrinkles concentrate near the ends of each segment and run around
            # it rather than along it.
            joint = max(0.0, abs(along) - 0.55) / 0.45
            if joint > 0:
                band = bakeutil.fbm(z * 90, x * 26, y * 26, octaves=3)
                d -= joint * joint * (band - 0.45) * 0.010

            # Panel seams: a groove up the outboard side of every limb and one up
            # the spine. This is the single strongest "this is a garment" cue.
            if is_leg or is_arm:
                azim = math.atan2(ly, lx)
                outward = math.pi / 2 * out
                dphi = abs(math.atan2(math.sin(azim - outward),
                                      math.cos(azim - outward)))
                d -= 0.0016 * math.exp(-((dphi / 0.13) ** 2))
            if name == 'torso':
                azim = math.atan2(ly, lx)
                dphi = abs(math.atan2(math.sin(azim - math.pi),
                                      math.cos(azim - math.pi)))
                d -= 0.0014 * math.exp(-((dphi / 0.16) ** 2))

            # The blue leg stripe is a printed panel, very slightly proud of the
            # surrounding fabric — enough for the light to catch its edge.
            if is_leg:
                azim = math.atan2(ly, lx)
                outward = math.pi / 2 * out
                dphi = abs(math.atan2(math.sin(azim - outward),
                                      math.cos(azim - outward)))
                if dphi < 0.42:
                    d += 0.0009 * (1.0 - (dphi / 0.42) ** 6)

            # The bib is a separate garment hanging over the suit, so it gets a
            # real lip all the way round rather than a printed edge.
            b = bib_mask(name, along, front, ly)
            d += 0.0026 * b

            # Waistband, glove cuffs, boot cuffs: hard steps, not soft blends.
            if name == 'torso' and -0.95 < along < -0.72:
                d += 0.0016
            # The glove is at along = +1, not -1: POSE_UNTUCKED holds the arms
            # UP, so the forearm runs upward from the elbow and the hand is at the
            # top of the segment. The first version tested for the bottom and
            # silently painted no gloves at all — the paint census (which counts
            # every tag) is what caught it, since a missing region looks like
            # nothing rather than like an error.
            if name.startswith('lowerArm') and along > 0.80:
                d += 0.0022
            if name.startswith('lowerLeg') and along < -0.74:
                d += 0.0030

        if d:
            v.co = (x + normals[i].x * d,
                    y + normals[i].y * d,
                    z + normals[i].z * d)
            moved += 1
    log(f'suit displacement applied to {moved}/{len(verts)} high-poly verts')


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


def paint_suit(mesh):
    """
    Vertex colours for the suit design, baked to the albedo map afterwards.

    Painting in 3D and baking is far more robust than trying to draw into UV
    space: the unwrap can change without any of this needing to move, and a region
    defined by "the outboard side of the leg" cannot land on the wrong island the
    way a hand-placed rectangle can.
    """
    attr = mesh.color_attributes.new(name='suit', type='FLOAT_COLOR',
                                     domain='POINT')
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
            dphi = abs(math.atan2(math.sin(azim - outward),
                                  math.cos(azim - outward)))
            if dphi < 0.38:
                col, tag = STRIPE, 'stripe'

        if bib_mask(name, along, front, ly) > 0.5:
            # The number patch sits in the middle of the bib. It is a plain block
            # rather than a legible numeral: at any distance the game or a render
            # ever shows this figure, a white patch and a white "15" are the same
            # number of pixels, and a procedurally drawn digit would be the one
            # detail that looks obviously synthetic up close.
            if -0.34 < along < 0.06 and abs(ly) < 0.062:
                col, tag = BIB_NUMBER, 'number'
            else:
                col, tag = BIB, 'bib'

        attr.data[i].color = (col[0], col[1], col[2], 1.0)
        counts[tag] = counts.get(tag, 0) + 1
    log(f'suit painted: {counts}')

    # Every region of the design must have actually landed somewhere. A region
    # whose condition never fires produces no error and no warning — the bake
    # simply comes out without it, which is indistinguishable from a design that
    # never included it. That is exactly how the gloves went missing.
    missing = [t for t in ('suit', 'helmet', 'waist', 'bib', 'number',
                           'stripe', 'glove') if counts.get(t, 0) == 0]
    if missing:
        raise SystemExit(
            f'[body] these suit regions matched no vertices: {missing}. '
            f'Their conditions are wrong for the reference pose, and the bake '
            f'would silently omit them.')
    return counts


# ── Low / high poly ─────────────────────────────────────────────────────────

def make_lowpoly(base):
    """Decimate, smooth, unwrap, and split the helmet into its own material."""
    bpy.ops.object.select_all(action='DESELECT')
    base.select_set(True)
    bpy.context.view_layer.objects.active = base

    dec = base.modifiers.new('decimate', 'DECIMATE')
    dec.ratio = 0.55
    bpy.ops.object.modifier_apply(modifier=dec.name)
    bpy.ops.object.shade_smooth()
    base.name = 'athleteBody'

    # The maps have nowhere to live without a UV set, and the metaball conversion
    # produces none at all.
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66.0), island_margin=0.006,
                             area_weight=1.0, correct_aspect=True,
                             scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')

    suit = bpy.data.materials.new('suitMat')
    helmet = bpy.data.materials.new('helmetMat')
    base.data.materials.append(suit)
    base.data.materials.append(helmet)

    # Two material slots — suit (0) and helmet (1) — so Babylon receives two
    # submeshes and can give the helmet its own roughness. They SHARE the baked
    # maps and the single UV layout; the split is about shading, not texturing.
    head_seg = SEGMENTS['head']
    hx, hy, hz = bl('head')
    neck_z = hz - head_seg['h'] / 2 * 0.85
    n_head = 0
    for poly in base.data.polygons:
        cz = sum(base.data.vertices[v].co.z for v in poly.vertices) / len(poly.vertices)
        if cz >= neck_z:
            poly.material_index = 1
            n_head += 1
    log(f'low-poly: {len(base.data.vertices)} verts, {len(base.data.polygons)} '
        f'faces, {n_head} helmet faces above z={neck_z:.3f}')
    return base


def make_highpoly(low):
    """
    The detail source. Subdivided from the SAME base, then displaced and painted.

    Sharing the base matters: a high-poly built independently would not sit on the
    low-poly surface, and every baked normal would carry that mismatch as a
    smeared, wobbling error across the whole body.
    """
    high = low.copy()
    high.data = low.data.copy()
    high.name = 'athleteHigh'
    bpy.context.collection.objects.link(high)

    bpy.ops.object.select_all(action='DESELECT')
    high.select_set(True)
    bpy.context.view_layer.objects.active = high

    sub = high.modifiers.new('subsurf', 'SUBSURF')
    sub.levels = sub.render_levels = 2
    bpy.ops.object.modifier_apply(modifier=sub.name)
    log(f'high-poly: {len(high.data.vertices)} verts before displacement')

    displace_suit(high.data)
    paint_suit(high.data)

    # One emission-free material driven by the colour attribute, so the albedo
    # bake picks up the paint and nothing else.
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
    clear the deepest displacement above — too small and the rays start inside the
    high-poly and the map fills with black speckle.
    """
    bake = bpy.context.scene.render.bake
    bake.use_selected_to_active = True
    bake.cage_extrusion = 0.02
    bake.margin = 8

    def run(kind, name, srgb, setup=None):
        img = bpy.data.images.new(name, width=RES, height=RES, float_buffer=True)
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
    stats['normal'] = run('NORMAL', 'athlete_normal', srgb=False)
    stats['ao'] = run('AO', 'athlete_ao', srgb=False)

    def albedo_only(b):
        b.use_pass_direct = False
        b.use_pass_indirect = False
        b.use_pass_color = True
    stats['albedo'] = run('DIFFUSE', 'athlete_albedo', srgb=True, setup=albedo_only)
    return stats


# ── Rig ─────────────────────────────────────────────────────────────────────

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
    Bind with AUTOMATIC WEIGHTS — the whole point of a continuous body.

    Rigid one-bone-per-part binding (what the old separate-solids athlete used) is
    correct when the parts are separate objects, but on a continuous mesh it tears
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
    """Skis stay rigid, separate objects."""
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
    base = build_base()
    low = make_lowpoly(base)
    high = make_highpoly(low)

    device = configure_cycles()
    out_dir = os.path.join(ROOT, 'assets')
    os.makedirs(out_dir, exist_ok=True)
    stats = bake_maps(low, high, out_dir)

    # The high-poly has done its job. Leaving it in would export a second body.
    bpy.data.objects.remove(high, do_unlink=True)

    arm = build_armature()
    skin(low, arm)
    equip = add_equipment()

    with open(os.path.join(out_dir, 'athlete_maps.json'), 'w') as f:
        json.dump({
            'normal': 'assets/athlete_normal.png',
            'ao': 'assets/athlete_ao.png',
            'albedo': 'assets/athlete_albedo.png',
            'res': RES,
            'stats': stats,
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
