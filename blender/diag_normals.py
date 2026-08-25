"""
Diagnostic: is the rebuilt terrain facing OUT?

A map baked onto inward-facing geometry comes back black, and looks exactly like
a bake that failed for some other reason — which is what happened here twice.

The obvious test does not work. Counting up-facing against down-facing faces
tells you nothing: a box has two of each whether its normals point out or in.
Even "is the +Z face at the top" misreports on a tilted slab.

SIGNED VOLUME is unambiguous. For a closed mesh, sum(v0 . (v1 x v2)) / 6 over its
triangles is positive when the normals point outward and negative when they point
inward, regardless of orientation, tilt or shape.

Plain Python — no bpy. The question is about the numbers in terrain.json and the
conversion applied to them, so there is nothing for Blender to do, and running it
without a 400 MB launch makes it cheap enough to reach for.

    python3 blender/diag_normals.py
"""

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = json.load(open(os.path.join(HERE, 'terrain.json')))


def signed_volume(verts, faces):
    total = 0.0
    for a, b, c in faces:
        ax, ay, az = verts[a]
        bx, by, bz = verts[b]
        cx, cy, cz = verts[c]
        # a . (b x c)
        total += (ax * (by * cz - bz * cy)
                  - ay * (bx * cz - bz * cx)
                  + az * (bx * cy - by * cx))
    return total / 6.0


out, inward = [], 0
for m in DATA['meshes']:
    p = m['positions']
    # Same conversion the bake uses: Babylon (x, y, z) -> Blender (x, z, y),
    # with the winding reversed to compensate for the handedness flip.
    verts = [(p[i], p[i + 2], p[i + 1]) for i in range(0, len(p), 3)]
    idx = m['indices']
    faces = [(idx[i], idx[i + 2], idx[i + 1]) for i in range(0, len(idx), 3)]
    v = signed_volume(verts, faces)
    if v < 0:
        inward += 1
    out.append((m['name'], v))

for name, v in out[:12]:
    print(f'[diag] {name:14s} signed volume {v:+12.3f} '
          f'{"OUTWARD" if v > 0 else "INWARD (inverted)"}', flush=True)
print(f'[diag] TOTAL {len(out)} meshes, {inward} inverted, '
      f'{len(out) - inward} outward', flush=True)
