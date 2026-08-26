# Handoff — Blender athlete and baked scene lighting

Branch `worktree-blender-assets`, 25 commits ahead of `main`. Suite is green:
unit, golden traces, browser, mutation, coverage, and 36 Playwright drive tests.

Worktree: `/home/ian/GameProjects/aerial-ski-game/.claude/worktrees/blender-assets`
Served for eyeballing at `http://localhost:8100/` (python http.server, cwd = this worktree).

---

## The one open problem

**A rounded hump sits over each shoulder blade, and the neck reads too long.**

It is the last visible defect on the figure. Everything else the author raised —
skewed skis, a foot off the ski, a missing leg, an oversized head, oversized
biceps, a grey ramp, the athlete vanishing on crash — is fixed and has a test.

### What is known

The bind pose used to hold the arms **overhead** (`POSE_UNTUCKED`) while the game
**rests** with them down. `engine/core/pose.js:armSweep` sweeps the arm about a
pivot at `y = 0.150` by `phi = pi * armDrop`, so between bind and rest every arm
bone rotated a full pi *and* its origin fell 0.48 m. Linear blend skinning bunches
whatever is caught between, which is exactly where the hump is.

The arms are now bound hanging (`ARM_BIND` in `blender/build_body.py`). That
**reduced the hump but did not remove it.**

### Three hypotheses, none yet eliminated

1. **Residual bind-to-rest rotation.** The game's resting arm pose may not be
   exactly `armDrop = 1`; the render shows the arms angled outward, not straight
   down. If the rest pose is a blend, the bind is still some tens of degrees off.
   *Test:* read `character.meshes.upperArmL.rotation` at rest in the browser and
   compare with the bind's `-pi`.

2. **The girth field.** `add_girth` scales each vertex's offset from a
   ten-segment stick skeleton. Near the shoulder the nearest segment can be the
   upper arm or the torso, and the blend between their factors could inflate.
   *Test:* build with `GIRTH = 1.0` and the per-segment factor forced to 1.0; if
   the hump is unchanged, girth is not the cause.

3. **The base mesh's own scapula.** The whole-body Laplacian smoothing that used
   to flatten it was removed (deliberately — it was erasing all the athletic
   form). Some of what now reads as a hump may simply be a back with muscles on
   it, exaggerated by the arms being posed down and back.
   *Test:* render the mesh in Blender in its bind pose and compare with the
   browser. If the hump is present in Blender, it is geometry, not skinning.

Hypothesis 3 is the cheapest to check and would be worth doing first.

---

## Commands

```bash
# Rebuild the athlete (about 90 s on the 5070 Ti)
~/opt/blender-5.2.1-linux-x64/blender -b --factory-startup \
    --python blender/build_body.py -- --out assets/athlete_body.glb --res 2048 --samples 96

# Fast iteration: skip the bakes
~/opt/blender-5.2.1-linux-x64/blender -b --factory-startup \
    --python blender/build_body.py -- --out /tmp/probe.glb --res 256 --samples 4

# Re-bake the terrain lighting (needs blender/terrain.json, extracted from the game)
npx playwright test --config tests/drive/playwright.config.js extract-terrain
~/opt/blender-5.2.1-linux-x64/blender -b --factory-startup \
    --python blender/bake_lightmap.py -- --res 2048 --samples 512

# Look at it. Writes shots/figure.png, shots/figure_front.png, shots/scene.png
npx playwright test --config tests/drive/playwright.config.js look

# Measure the rig: skis, soles, crash visibility, leg profile
npx playwright test --config tests/drive/playwright.config.js rig

# Everything
./tests/run-all.sh
```

`build_body.py` logs a measurement for every stage — bone placement error, per
segment stretch, the leg width profile, shoulder and hip breadth against adult
proportions, the paint census, and the face and atlas shares. **Read the log
before looking at a render.** Nearly every bug in this work was found in those
numbers and misdiagnosed from the picture.

---

## Landmines

These all cost real time. Every one of them looked like a different bug than it
was.

**Measure in the character root's frame, never the world's.** The skier yaws in
the ready state and the rig is tilted onto the slope, so world X is not the
athlete's left-right and world Y is not their up. Classifying feet by world X put
both on one side and reported a sole 0.337 m "below" its ski.

**`extendSizeWorld` is an axis-aligned box in world space.** It reports a
forward-pointing ski as "wide" the moment the skier yaws. It told me `skiL` was
0.08 m long and 1.2 m wide and I "fixed" a ski that was never broken. Use
`extendSize`.

**Never select a body region by height.** `POSE_UNTUCKED` holds the arms
overhead, so "above the neckline" sweeps in both forearms and both hands. This bit
three separate places: the material split (47% of the mesh classified as helmet),
the helmet projection (the gloves were projected onto the head), and the head
scaling. Ask `segment_frame`, or better, the skin weights.

**Segment classification uses SKIN WEIGHTS, not nearest capsule.** The torso's
capsule radius is 0.145 m, so once the arms hang beside the body their vertices
sit inside it. The forearms held 230 vertices and the torso 49,790. See
`dominant_segments`.

**A knee and an ankle are anatomical WAISTS.** Both are narrower than what sits
above and below them. My leg-profile test flagged them as 15 mm and 29 mm
"notches" and I smoothed skin weights twice trying to remove features that should
be there. `rig.spec.js` now skips both bands and its threshold is 30 mm, set where
the measurement can actually discriminate.

**The bind must equal the driver.** `linkTransformNode` puts a bone at its driver
node's transform, and the driver sits at the segment CENTRE. `pose_onto_segments`
therefore shifts the bones onto the centres in edit mode, *after* the deformation
has been applied to the vertices — that changes the bind matrices without moving
the mesh.

**The skeleton must stay FLAT.** Babylon applies a linked node's transform as the
bone's LOCAL transform relative to its parent bone, but `computePose` returns
ABSOLUTE positions. Parented bones double-count: `lowerLegL` ran at `-0.455 +
-0.815 = -1.27`. Do not reintroduce `bone.parent`.

**`image.generated_color` goes through colour management.** A (0.5, 0.5, 1.0)
normal-map background came back as (0.21, 0.21, 1.0). Use `bakeutil.fill_image`.

**Bake atlas backgrounds are filled, and `bake.use_clear` is off.** Only ~40% of
the atlas is covered; a black background bleeds into every island edge through
filtering and mipmaps and reads as camouflage on the suit.

**Assets are cache-busted with `ASSET_V` in `game.js`.** Bump it when `assets/`
is regenerated, or the browser serves the old athlete and every change looks like
it did nothing. This wasted a full round trip with the author.

---

## What the pipeline does

`blender/build_body.py`:

```
human_base_male.blend        CC0, Blender Studio Human Base Meshes, 10,582 verts,
  |                          99.8% quads, real edge loops at every joint
  +- align axes, light facial smoothing
  +- rig at ANATOMICAL joints, read off Rigify's human metarig and scaled
  +- bind with heat-map weights, lightly smoothed, boots ramped over 45 mm
  +- pose each bone onto its game segment; apply as rest; shift bind to centres
  +- shape the helmet as an ellipsoid; scale the head to 7.5 head-heights
  +- girth: slim compressed limbs, never thicken stretched ones; half strength
  +- seat the soles on the skis by measurement
  |
  +-- low    decimated 0.85 (head/hands harder), unwrapped into 0-1, EXPORTED
  +-- high   simple-subdivided, displaced with suit detail, vertex-painted
             bake high -> low: normal (tangent), AO (4 cm), albedo
```

The suit design is matched to the author's reference clip (`IMG_7841.MOV`): white
race suit, royal-blue stripe down the outside of each leg, powder-blue
competition bib with a white number patch, navy waist, dark gloves and helmet.

`blender/bake_lightmap.py` bakes sky visibility and sun visibility for the static
scenery. Both are MULTIPLIERS, which is what makes them safe to apply — an
additive baked term double-counts light the runtime already renders.

---

## Known limitations, deliberate

**The baked scene lighting contributes almost nothing** — 0.07/255. This is not a
wiring fault; `baked.spec.js` forces each slot to black and measures -35 and -82
luminance, so both reach the shader. It is the terrain: six flat slabs under an
open sky with the tree line 45 m off to the sides has almost no occlusion and
almost no shadow to capture. **Lighting is not what the scene is short of;
geometry is.** Building real terrain — a bowl-shaped landing hill, banks flanking
the run, trees close in — is what would make that bake worth having.

**The torso is 36.3% of standing height against an adult's 30%, and the legs
47.5% against 52%.** Real, and not fixable in the mesh: those are segment lengths
in `body-model.json`, and every pose table in `engine/core/body-model.js` carries
absolute joint positions, so lengths and all five pose tables must move together.
It is a coordinated change and it needs the golden traces rebaselined. The author
has authorised a rebaseline but the change has not been scoped.

(The arms are **not** too short. I reported them as 17% short against a reference
of 44% of standing height; that figure is arm SPAN. Shoulder-to-wrist is about
35%, and the game's 36.3% is right.)

**No face under the helmet, on purpose.** An aerials helmet covers the face
entirely, so geometry and texels spent there are never seen.

**`tests/drive/body.spec.js` "the body deforms when the physics poses the
athlete" is timing-sensitive.** It drives a long input sequence — charge, launch,
go airborne — and has flaked once under load while passing in isolation. If it
fails, re-run it alone before investigating.
